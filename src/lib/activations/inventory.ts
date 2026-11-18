import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems, inventoryMovements, activationMaterials } from "@/db/schema";
import { syncActivationExpenses } from "./budget";
import { ANIMATRICE_SQL } from "@/lib/users";
import { heldStockRefusal, holderLedger, inventoryStatus, transferMovements, type Holder, type HolderLedger, type InventoryStatus } from "./shared";

/**
 * Inventaire matériel (PLV, échantillons, goodies, print) — pas un WMS.
 *
 * `inventory_items.stock` est le stock CENTRAL courant. Il n'est modifié QUE par `recordMovement()`, dans la même
 * transaction que le mouvement : le stock central est toujours la somme des mouvements sans détenteur. Depuis la
 * migration 0062, un mouvement peut porter un détenteur (`holder_user_id`) : le stock d'une personne (goodies en main
 * d'une animatrice) est la somme de ses mouvements, et la même règle de refus s'y applique (`heldStockRefusal()`).
 * Un transfert passe par `transferMaterial()` (deux mouvements, une transaction). Une sortie liée à une activation
 * passe par `consumeMaterial()`, qui crée la ligne `activation_materials` (valorisée au coût unitaire du moment) puis
 * synchronise le reflet budgétaire de l'activation (le matériel est chargé à l'achat : aucune nouvelle dépense).
 */
export const MOVEMENT_TYPES = ["ENTREE", "SORTIE", "AJUSTEMENT", "TRANSFERT"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const MOVEMENT_LABELS: Record<MovementType, string> = { ENTREE: "Entrée", SORTIE: "Sortie", AJUSTEMENT: "Ajustement", TRANSFERT: "Transfert" };

export type MovementInput = {
  itemId: string; type: MovementType;
  /** Quantité SIGNÉE : positive pour une entrée, négative pour une sortie, ± pour un ajustement ou un transfert. */
  quantity: number;
  unitCost?: number | null; activationId?: string | null; clientId?: string | null; reason?: string | null;
  date: string; createdById?: string | null; importId?: string | null;
  /** Ligne de BL qui fait sortir l'article (sorties marketing, `validateDocument()`). */
  documentLineId?: string | null;
  /** Contre-mouvement : annule ce mouvement (BL annulé). */
  reversalOf?: string | null;
  /** Détenteur du stock mouvementé : `null` / absent = stock central (réceptions, BL, inventaires, imports). */
  holderUserId?: Holder;
  /** Transfert : identifiant partagé par ses deux lignes (posé par `transferMaterial()` seulement). */
  transferId?: string | null;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Stock en main d'une personne pour un article (somme de ses mouvements). */
async function heldQty(t: Tx, itemId: string, holderId: string): Promise<number> {
  const r = (await t.execute<{ q: number }>(sql`select coalesce(sum(quantity), 0)::int as q from inventory_movements where item_id = ${itemId}::uuid and holder_user_id = ${holderId}::uuid`)).rows[0];
  return Number(r?.q ?? 0);
}

/**
 * LA fonction qui change un stock. Refuse une sortie au-delà du disponible du détenteur (stock central ou stock d'une
 * personne), sauf `allowNegative` sur le stock central (BL en mode « alerte » :
 * `settings.gestion.marketingOutputs.insufficientStock = WARN`). Le stock d'une personne ne passe jamais sous zéro.
 */
export async function recordMovement(input: MovementInput, tx?: Tx, opts: { allowNegative?: boolean } = {}): Promise<{ id: string; stock: number }> {
  const run = async (t: Tx) => {
    const [item] = await t.select({ stock: inventoryItems.stock, unitCost: inventoryItems.unitCost, name: inventoryItems.name }).from(inventoryItems).where(eq(inventoryItems.id, input.itemId)).for("update");
    if (!item) throw new Error("Article introuvable.");
    const qty = Math.round(input.quantity);
    if (!qty) throw new Error("Quantité nulle.");
    if (input.type === "ENTREE" && qty < 0) throw new Error("Une entrée est positive.");
    if (input.type === "SORTIE" && qty > 0) throw new Error("Une sortie est négative.");
    if (input.type === "TRANSFERT" && !input.transferId) throw new Error("Un transfert passe par transferMaterial().");
    const holder = input.holderUserId ?? null;
    const available = holder ? await heldQty(t, input.itemId, holder) : item.stock;
    if (holder || !opts.allowNegative) {
      const holderLabel = holder ? (await t.execute<{ name: string }>(sql`select name from users where id = ${holder}::uuid`)).rows[0]?.name ?? "cette personne" : null;
      const refusal = heldStockRefusal({ available, quantity: qty, itemName: item.name, holderLabel });
      if (refusal) throw new Error(refusal);
    }
    const next = available + qty;
    const unitCost = input.unitCost ?? Number(item.unitCost);
    const [m] = await t.insert(inventoryMovements).values({
      itemId: input.itemId, type: input.type, quantity: qty, unitCost: String(unitCost), activationId: input.activationId ?? null, clientId: input.clientId ?? null,
      reason: input.reason ?? null, date: input.date, createdById: input.createdById ?? null, importId: input.importId ?? null,
      documentLineId: input.documentLineId ?? null, reversalOf: input.reversalOf ?? null, holderUserId: holder, transferId: input.transferId ?? null,
    }).returning({ id: inventoryMovements.id });
    // Une entrée avec un coût connu met à jour le coût unitaire de référence (dernier prix d'achat) ; un contre-mouvement, non.
    const newCost = input.type === "ENTREE" && !holder && !input.reversalOf && input.unitCost != null && input.unitCost > 0;
    await t.update(inventoryItems).set({ ...(holder ? {} : { stock: next }), updatedAt: new Date(), ...(newCost ? { unitCost: String(input.unitCost) } : {}) }).where(eq(inventoryItems.id, input.itemId));
    return { id: m.id, stock: next };
  };
  return tx ? run(tx) : db.transaction(run);
}

/**
 * Transfert de matériel d'un détenteur à un autre (stock central → animatrice, animatrice → collègue, retour au
 * central) : deux mouvements TRANSFERT dans la même transaction, refusé au-delà de ce que le donneur a en main.
 * Valeur inchangée : aucune dépense, le matériel a été chargé à l'achat.
 */
export async function transferMaterial(input: { itemId: string; from: Holder; to: Holder; quantity: number; date: string; createdById: string; reason?: string | null }, tx?: Tx): Promise<{ transferId: string; fromStock: number; toStock: number }> {
  const [out, inn] = transferMovements(input);
  const run = async (t: Tx) => {
    const transferId = randomUUID();
    const names = (await t.execute<{ id: string; name: string }>(sql`select id::text, name from users where id = any(array[${input.from ?? null}, ${input.to ?? null}]::uuid[])`)).rows;
    const label = (h: Holder) => (h ? names.find((n) => n.id === h)?.name ?? "?" : "stock central");
    if (input.to && !names.some((n) => n.id === input.to)) throw new Error("Destinataire introuvable.");
    const reason = input.reason?.trim() || `Transfert ${label(input.from)} → ${label(input.to)}`;
    const a = await recordMovement({ itemId: input.itemId, type: "TRANSFERT", quantity: out.quantity, holderUserId: out.holder, transferId, date: input.date, createdById: input.createdById, reason }, t);
    const b = await recordMovement({ itemId: input.itemId, type: "TRANSFERT", quantity: inn.quantity, holderUserId: inn.holder, transferId, date: input.date, createdById: input.createdById, reason }, t);
    return { transferId, fromStock: a.stock, toStock: b.stock };
  };
  return tx ? run(tx) : db.transaction(run);
}

/**
 * Sorties de matériel pour une activation : mouvements + lignes consommées dans UNE transaction (tout passe ou rien ne
 * sort), puis reflet budgétaire. `holderUserId` = stock d'où sortent les goodies (celui de l'animatrice qui les a
 * utilisés) ; absent = stock central.
 */
export async function consumeMaterials(input: { activationId: string; items: { itemId: string; quantity: number }[]; date: string; userId: string; holderUserId?: Holder }): Promise<string[]> {
  const list = input.items.map((m) => ({ itemId: m.itemId, qty: Math.round(m.quantity) }));
  if (!list.length || list.some((m) => m.qty <= 0)) throw new Error("Quantité invalide.");
  const ids = await db.transaction(async (tx) => {
    const out: string[] = [];
    for (const m of list) {
      const [item] = await tx.select({ unitCost: inventoryItems.unitCost }).from(inventoryItems).where(eq(inventoryItems.id, m.itemId));
      if (!item) throw new Error("Article introuvable.");
      const mv = await recordMovement({ itemId: m.itemId, type: "SORTIE", quantity: -m.qty, activationId: input.activationId, date: input.date, createdById: input.userId, reason: "Sortie pour opération", holderUserId: input.holderUserId ?? null }, tx);
      const [row] = await tx.insert(activationMaterials).values({ activationId: input.activationId, itemId: m.itemId, quantity: m.qty, unitCost: item.unitCost, movementId: mv.id, createdById: input.userId }).returning({ id: activationMaterials.id });
      out.push(row.id);
    }
    return out;
  });
  await syncActivationExpenses(input.activationId);
  return ids;
}

/** Une seule sortie de matériel pour une activation (fiche de l'opération). */
export async function consumeMaterial(input: { activationId: string; itemId: string; quantity: number; date: string; userId: string; holderUserId?: Holder }) {
  return (await consumeMaterials({ activationId: input.activationId, items: [{ itemId: input.itemId, quantity: input.quantity }], date: input.date, userId: input.userId, holderUserId: input.holderUserId }))[0];
}

/** Retour d'une consommation : le matériel revient dans le stock d'où il était sorti (entrée « retour »), la ligne disparaît. */
export async function removeMaterial(input: { activationId: string; materialId: string; date: string; userId: string }) {
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(activationMaterials).where(and(eq(activationMaterials.id, input.materialId), eq(activationMaterials.activationId, input.activationId)));
    if (!m) return;
    const holder = m.movementId ? (await tx.select({ h: inventoryMovements.holderUserId }).from(inventoryMovements).where(eq(inventoryMovements.id, m.movementId)))[0]?.h ?? null : null;
    await recordMovement({ itemId: m.itemId, type: "ENTREE", quantity: m.quantity, activationId: input.activationId, date: input.date, createdById: input.userId, reason: "Retour d'opération", holderUserId: holder }, tx);
    await tx.delete(activationMaterials).where(eq(activationMaterials.id, m.id));
  });
  await syncActivationExpenses(input.activationId);
}

/* ------------------------------ Lectures ------------------------------ */

export type InventoryItemRow = {
  id: string; name: string; sku: string | null; categoryKey: string; category: string; brandId: string | null; brand: string | null; color: string | null;
  productId: string | null; product: string | null; unit: string; unitCost: number;
  /** Stock central. */
  stock: number;
  /** En main chez l'équipe (somme des stocks des personnes). */
  held: number;
  alertThreshold: number | null; location: string | null; notes: string | null; active: boolean;
  value: number; lastOutAt: string | null; lastInAt: string | null; outQty90: number; photoId: string | null; createdAt: string;
  status: InventoryStatus;
};

/** Articles avec valeur, dernière sortie et statut (bas / dormant / ok). */
export async function listInventory(f: { brand?: string | null; category?: string | null; q?: string | null; includeInactive?: boolean } = {}, todayIso: string, dormantDays: number): Promise<InventoryItemRow[]> {
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null;
  const r = await db.execute<Omit<InventoryItemRow, "status">>(sql`
    select i.id, i.name, i.sku, i.category_key as "categoryKey", c.label as category, i.brand_id as "brandId", b.name as brand, b.color,
      i.product_id as "productId", p.name as product, i.unit, i.unit_cost::float8 as "unitCost", i.stock, i.alert_threshold as "alertThreshold", i.location, i.notes, i.active,
      (i.stock * i.unit_cost)::float8 as value,
      coalesce((select sum(m.quantity) from inventory_movements m where m.item_id = i.id and m.holder_user_id is not null), 0)::int as held,
      (select max(m.date)::text from inventory_movements m where m.item_id = i.id and m.type = 'SORTIE') as "lastOutAt",
      (select max(m.date)::text from inventory_movements m where m.item_id = i.id and m.type = 'ENTREE') as "lastInAt",
      coalesce((select -sum(m.quantity) from inventory_movements m where m.item_id = i.id and m.type = 'SORTIE' and m.date >= ${todayIso}::date - 90
        and not exists (select 1 from inventory_movements x where x.reversal_of = m.id)), 0)::int as "outQty90",
      (select x.id from content_assets x where x.inventory_item_id = i.id and x.kind = 'PHOTO' order by x.version desc limit 1) as "photoId",
      i.created_at::text as "createdAt"
    from inventory_items i join inventory_categories c on c.key = i.category_key
    left join brands b on b.id = i.brand_id left join products p on p.id = i.product_id
    where true
      ${f.includeInactive ? sql`` : sql`and i.active`}
      ${f.brand ? sql`and i.brand_id = ${f.brand}::uuid` : sql``}
      ${f.category ? sql`and i.category_key = ${f.category}` : sql``}
      ${q ? sql`and (i.name ilike ${q} or i.sku ilike ${q} or i.location ilike ${q})` : sql``}
    order by b.name nulls last, c.sort, i.name`);
  return r.rows.map((x) => ({ ...x, status: inventoryStatus({ stock: x.stock, alertThreshold: x.alertThreshold, lastOutAt: x.lastOutAt, createdAt: x.createdAt }, todayIso, dormantDays) }));
}

export async function getInventoryItem(id: string, todayIso: string, dormantDays: number): Promise<InventoryItemRow | null> {
  const rows = await listInventory({ includeInactive: true }, todayIso, dormantDays);
  return rows.find((x) => x.id === id) ?? null;
}

export type MovementRow = {
  id: string; type: string; quantity: number; unitCost: number | null; date: string; reason: string | null; activationId: string | null; activation: string | null;
  clientId: string | null; client: string | null; createdBy: string | null; createdAt: Date;
  /** Sortie par BL : pièce, client interne ou non, nature de la sortie (celle du client interne, sinon commercial). */
  documentId: string | null; documentNumber: string | null; nature: string | null; reversed: boolean;
  /** Détenteur du stock mouvementé (`null` = stock central). */
  holder: string | null;
};

export async function itemMovements(itemId: string, limit = 200): Promise<MovementRow[]> {
  const r = await db.execute<MovementRow>(sql`
    select m.id, m.type, m.quantity, m.unit_cost::float8 as "unitCost", m.date::text as date, m.reason, m.activation_id as "activationId", a.name as activation,
      m.client_id as "clientId", c.name as client, u.name as "createdBy", m.created_at as "createdAt",
      d.id as "documentId", d.number as "documentNumber",
      case when l.id is null then null when c.is_internal then c.output_nature_key else 'COMMERCIAL' end as nature,
      exists (select 1 from inventory_movements x where x.reversal_of = m.id) as reversed, h.name as holder
    from inventory_movements m left join activations a on a.id = m.activation_id left join clients c on c.id = m.client_id left join users u on u.id = m.created_by_id
      left join users h on h.id = m.holder_user_id
      left join sales_document_lines l on l.id = m.document_line_id left join sales_documents d on d.id = l.document_id
    where m.item_id = ${itemId}::uuid order by m.date desc, m.created_at desc limit ${limit}`);
  return r.rows;
}

/**
 * Consommation d'un article par nature de sortie (BL validés, contre-mouvements déduits) : quantité et valeur au coût
 * figé. Lecture seule — la charge du matériel est à l'achat, ceci est l'historique de consommation.
 */
export async function itemConsumptionByNature(itemId: string): Promise<{ nature: string; label: string; quantity: number; value: number }[]> {
  const r = await db.execute<{ nature: string; label: string | null; quantity: number; value: number }>(sql`
    with m as (
      select coalesce(case when c.is_internal then c.output_nature_key else 'COMMERCIAL' end, 'COMMERCIAL') as nature,
        -mv.quantity as qty, coalesce(mv.unit_cost, 0) as cost
      from inventory_movements mv join sales_document_lines l on l.id = mv.document_line_id left join clients c on c.id = mv.client_id
      where mv.item_id = ${itemId}::uuid
    )
    select m.nature, n.label, sum(m.qty)::float8 as quantity, sum(m.qty * m.cost)::float8 as value
    from m left join marketing_output_natures n on n.key = m.nature group by m.nature, n.label, n.sort order by n.sort nulls last`);
  return r.rows.map((x) => ({ nature: x.nature, label: x.label ?? x.nature, quantity: Number(x.quantity), value: Number(x.value) })).filter((x) => x.quantity !== 0);
}

/** Synthèse par marque : articles, valeur du stock, alertes, dormants. */
export function inventoryByBrand(items: InventoryItemRow[]) {
  const m = new Map<string, { brandId: string | null; brand: string; color: string | null; items: number; value: number; low: number; dormant: number; out90: number }>();
  for (const it of items) {
    const key = it.brandId ?? "—";
    const e = m.get(key) ?? { brandId: it.brandId, brand: it.brand ?? "Sans marque", color: it.color, items: 0, value: 0, low: 0, dormant: 0, out90: 0 };
    e.items++; e.value += it.value; e.out90 += it.outQty90;
    if (it.status === "BAS" || it.status === "RUPTURE") e.low++;
    if (it.status === "DORMANT") e.dormant++;
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

/* ------------------------------ Goodies par détenteur ------------------------------ */

export type HeldItem = { itemId: string; name: string; brandId: string | null; brand: string | null; category: string; unit: string; unitCost: number; held: number };

/** Goodies en main d'une personne (stock > 0), ou du stock central avec `holderId = null`. */
export async function holderStock(holderId: Holder): Promise<HeldItem[]> {
  const r = holderId
    ? await db.execute<HeldItem>(sql`
        select i.id as "itemId", i.name, i.brand_id::text as "brandId", b.name as brand, c.label as category, i.unit, i.unit_cost::float8 as "unitCost", sum(m.quantity)::int as held
        from inventory_movements m join inventory_items i on i.id = m.item_id join inventory_categories c on c.key = i.category_key left join brands b on b.id = i.brand_id
        where m.holder_user_id = ${holderId}::uuid group by i.id, b.name, c.label having sum(m.quantity) > 0 order by b.name nulls last, i.name`)
    : await db.execute<HeldItem>(sql`
        select i.id as "itemId", i.name, i.brand_id::text as "brandId", b.name as brand, c.label as category, i.unit, i.unit_cost::float8 as "unitCost", i.stock as held
        from inventory_items i join inventory_categories c on c.key = i.category_key left join brands b on b.id = i.brand_id
        where i.active and i.stock > 0 order by b.name nulls last, i.name`);
  return r.rows.map((x) => ({ ...x, unitCost: Number(x.unitCost), held: Number(x.held) }));
}

export type HolderOverview = { holderId: string; name: string; items: number; held: number; value: number; lastMoveAt: string | null; ledger: HolderLedger };

/**
 * Goodies chez l'équipe, par personne : reçu, donné, déclaré utilisé en opération, en main et sa valeur au coût de
 * référence. `holderLedger()` est la seule définition de ces quantités.
 */
export async function holdersOverview(): Promise<HolderOverview[]> {
  const agg = (await db.execute<{ holder: string; type: string; quantity: number; op: boolean }>(sql`
    select m.holder_user_id::text as holder, m.type, sum(m.quantity)::int as quantity, (m.activation_id is not null) as op
    from inventory_movements m where m.holder_user_id is not null
    group by m.holder_user_id, m.type, sign(m.quantity), (m.activation_id is not null)`)).rows;
  const heads = (await db.execute<{ holder: string; name: string; items: number; held: number; value: number; last: string | null }>(sql`
    with h as (select m.holder_user_id as holder, m.item_id, sum(m.quantity) as q, max(m.date) as last from inventory_movements m where m.holder_user_id is not null group by 1, 2)
    select h.holder::text as holder, u.name, count(*) filter (where h.q > 0)::int as items, coalesce(sum(h.q) filter (where h.q > 0), 0)::int as held,
      coalesce(sum(h.q * i.unit_cost) filter (where h.q > 0), 0)::float8 as value, max(h.last)::text as last
    from h join users u on u.id = h.holder join inventory_items i on i.id = h.item_id group by h.holder, u.name order by u.name`)).rows;
  return heads.map((x) => ({
    holderId: x.holder, name: x.name, items: Number(x.items), held: Number(x.held), value: Number(x.value), lastMoveAt: x.last,
    ledger: holderLedger(agg.filter((a) => a.holder === x.holder).map((a) => ({ type: a.type, quantity: Number(a.quantity), activationId: a.op ? "op" : null }))),
  }));
}

/** Pour une fiche article : qui a combien en main. */
export async function itemHolders(itemId: string): Promise<{ holderId: string; name: string; held: number }[]> {
  const r = await db.execute<{ holderId: string; name: string; held: number }>(sql`
    select m.holder_user_id::text as "holderId", u.name, sum(m.quantity)::int as held from inventory_movements m join users u on u.id = m.holder_user_id
    where m.item_id = ${itemId}::uuid and m.holder_user_id is not null group by m.holder_user_id, u.name having sum(m.quantity) <> 0 order by u.name`);
  return r.rows.map((x) => ({ ...x, held: Number(x.held) }));
}

export type HolderMovementRow = { id: string; date: string; itemName: string; type: string; quantity: number; reason: string | null; activation: string | null; createdBy: string | null };

/** Derniers mouvements d'une personne (son écran « Mes goodies »). */
export async function holderMovements(holderId: string, limit = 30): Promise<HolderMovementRow[]> {
  const r = await db.execute<HolderMovementRow>(sql`
    select m.id, m.date::text as date, i.name as "itemName", m.type, m.quantity, m.reason, a.name as activation, u.name as "createdBy"
    from inventory_movements m join inventory_items i on i.id = m.item_id left join activations a on a.id = m.activation_id left join users u on u.id = m.created_by_id
    where m.holder_user_id = ${holderId}::uuid order by m.date desc, m.created_at desc limit ${limit}`);
  return r.rows;
}

/** À qui distribuer : animatrices, personnes qui ont déjà des goodies, et le responsable des goodies. */
export async function goodiesRecipients(managerId: string | null): Promise<{ id: string; name: string }[]> {
  const r = await db.execute<{ id: string; name: string }>(sql`
    select u.id::text as id, u.name from users u
    where u.active and (
      (${ANIMATRICE_SQL})
      or exists (select 1 from inventory_movements m where m.holder_user_id = u.id)
      ${managerId ? sql`or u.id = ${managerId}::uuid` : sql``})
    order by u.name`);
  return r.rows;
}

/**
 * D'où sortent les goodies d'une opération déclarée depuis le téléphone : le stock de la personne dès qu'elle a des
 * goodies en main ; sinon le stock central si elle le gère (direction, responsable des goodies) ; sinon le sien (vide).
 */
export async function operationStockSource(userId: string, managesGoodies: boolean): Promise<Holder> {
  if (!managesGoodies) return userId;
  const r = (await db.execute<{ n: number }>(sql`select count(*)::int as n from (select item_id from inventory_movements where holder_user_id = ${userId}::uuid group by item_id having sum(quantity) > 0) x`)).rows[0];
  return Number(r?.n ?? 0) > 0 ? userId : null;
}
