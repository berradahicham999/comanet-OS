import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems, inventoryMovements, activationMaterials } from "@/db/schema";
import { syncActivationExpenses } from "./budget";
import { inventoryStatus, type InventoryStatus } from "./shared";

/**
 * Inventaire matériel (PLV, échantillons, goodies, print) — pas un WMS.
 *
 * `inventory_items.stock` est le stock courant. Il n'est modifié QUE par `recordMovement()`,
 * dans la même transaction que le mouvement : le stock est toujours la somme des mouvements.
 * Une sortie liée à une activation passe par `consumeMaterial()`, qui crée la ligne
 * `activation_materials` (valorisée au coût unitaire du moment) puis synchronise le reflet
 * budgétaire de l'activation.
 */
export const MOVEMENT_TYPES = ["ENTREE", "SORTIE", "AJUSTEMENT"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const MOVEMENT_LABELS: Record<MovementType, string> = { ENTREE: "Entrée", SORTIE: "Sortie", AJUSTEMENT: "Ajustement" };

export type MovementInput = {
  itemId: string; type: MovementType;
  /** Quantité SIGNÉE : positive pour une entrée, négative pour une sortie, ± pour un ajustement. */
  quantity: number;
  unitCost?: number | null; activationId?: string | null; clientId?: string | null; reason?: string | null;
  date: string; createdById?: string | null; importId?: string | null;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** LA fonction qui change un stock. Refuse une sortie au-delà du disponible. */
export async function recordMovement(input: MovementInput, tx?: Tx): Promise<{ id: string; stock: number }> {
  const run = async (t: Tx) => {
    const [item] = await t.select({ stock: inventoryItems.stock, unitCost: inventoryItems.unitCost, name: inventoryItems.name }).from(inventoryItems).where(eq(inventoryItems.id, input.itemId)).for("update");
    if (!item) throw new Error("Article introuvable.");
    const qty = Math.round(input.quantity);
    if (!qty) throw new Error("Quantité nulle.");
    if (input.type === "ENTREE" && qty < 0) throw new Error("Une entrée est positive.");
    if (input.type === "SORTIE" && qty > 0) throw new Error("Une sortie est négative.");
    const next = item.stock + qty;
    if (next < 0) throw new Error(`Stock insuffisant pour « ${item.name} » : ${item.stock} disponible${item.stock > 1 ? "s" : ""}, ${-qty} demandé${-qty > 1 ? "s" : ""}.`);
    const unitCost = input.unitCost ?? Number(item.unitCost);
    const [m] = await t.insert(inventoryMovements).values({
      itemId: input.itemId, type: input.type, quantity: qty, unitCost: String(unitCost), activationId: input.activationId ?? null, clientId: input.clientId ?? null,
      reason: input.reason ?? null, date: input.date, createdById: input.createdById ?? null, importId: input.importId ?? null,
    }).returning({ id: inventoryMovements.id });
    // Une entrée avec un coût connu met à jour le coût unitaire de référence (dernier prix d'achat).
    await t.update(inventoryItems).set({ stock: next, updatedAt: new Date(), ...(input.type === "ENTREE" && input.unitCost != null && input.unitCost > 0 ? { unitCost: String(input.unitCost) } : {}) }).where(eq(inventoryItems.id, input.itemId));
    return { id: m.id, stock: next };
  };
  return tx ? run(tx) : db.transaction(run);
}

/** Sortie de matériel pour une activation : mouvement + ligne consommée + reflet budgétaire. */
export async function consumeMaterial(input: { activationId: string; itemId: string; quantity: number; date: string; userId: string }) {
  const qty = Math.round(input.quantity);
  if (qty <= 0) throw new Error("Quantité invalide.");
  const id = await db.transaction(async (tx) => {
    const [item] = await tx.select({ unitCost: inventoryItems.unitCost }).from(inventoryItems).where(eq(inventoryItems.id, input.itemId));
    if (!item) throw new Error("Article introuvable.");
    const mv = await recordMovement({ itemId: input.itemId, type: "SORTIE", quantity: -qty, activationId: input.activationId, date: input.date, createdById: input.userId, reason: "Sortie pour activation" }, tx);
    const [row] = await tx.insert(activationMaterials).values({ activationId: input.activationId, itemId: input.itemId, quantity: qty, unitCost: item.unitCost, movementId: mv.id, createdById: input.userId }).returning({ id: activationMaterials.id });
    return row.id;
  });
  await syncActivationExpenses(input.activationId);
  return id;
}

/** Retour d'une consommation : le matériel revient en stock (entrée « retour »), la ligne disparaît. */
export async function removeMaterial(input: { activationId: string; materialId: string; date: string; userId: string }) {
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(activationMaterials).where(and(eq(activationMaterials.id, input.materialId), eq(activationMaterials.activationId, input.activationId)));
    if (!m) return;
    await recordMovement({ itemId: m.itemId, type: "ENTREE", quantity: m.quantity, activationId: input.activationId, date: input.date, createdById: input.userId, reason: "Retour d'activation" }, tx);
    await tx.delete(activationMaterials).where(eq(activationMaterials.id, m.id));
  });
  await syncActivationExpenses(input.activationId);
}

/* ------------------------------ Lectures ------------------------------ */

export type InventoryItemRow = {
  id: string; name: string; sku: string | null; categoryKey: string; category: string; brandId: string | null; brand: string | null; color: string | null;
  productId: string | null; product: string | null; unit: string; unitCost: number; stock: number; alertThreshold: number | null; location: string | null; notes: string | null; active: boolean;
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
      (select max(m.date)::text from inventory_movements m where m.item_id = i.id and m.type = 'SORTIE') as "lastOutAt",
      (select max(m.date)::text from inventory_movements m where m.item_id = i.id and m.type = 'ENTREE') as "lastInAt",
      coalesce((select -sum(m.quantity) from inventory_movements m where m.item_id = i.id and m.type = 'SORTIE' and m.date >= ${todayIso}::date - 90), 0)::int as "outQty90",
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

export type MovementRow = { id: string; type: string; quantity: number; unitCost: number | null; date: string; reason: string | null; activationId: string | null; activation: string | null; client: string | null; createdBy: string | null; createdAt: Date };

export async function itemMovements(itemId: string, limit = 200): Promise<MovementRow[]> {
  const r = await db.execute<MovementRow>(sql`
    select m.id, m.type, m.quantity, m.unit_cost::float8 as "unitCost", m.date::text as date, m.reason, m.activation_id as "activationId", a.name as activation, c.name as client, u.name as "createdBy", m.created_at as "createdAt"
    from inventory_movements m left join activations a on a.id = m.activation_id left join clients c on c.id = m.client_id left join users u on u.id = m.created_by_id
    where m.item_id = ${itemId}::uuid order by m.date desc, m.created_at desc limit ${limit}`);
  return r.rows;
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
