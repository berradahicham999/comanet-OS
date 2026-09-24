import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { stockCountEntries, stockCountLines, stockCounts } from "@/db/schema";
import { audit, type AuditActor } from "@/lib/audit";
import { BUSINESS_TZ, iso, today } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { pgArray } from "@/lib/sql-array";
import { countLineKey, countStats, countedByLine, gapLeads, gapOverOutflows, lineGap, recurringGaps, type CountStatus, type GapLead } from "./counts-shared";
import { recordStockMovements, type LedgerInput } from "./ledger";
import { SCALE, formatScaled, parseDecimal } from "./money";
import { allocateNumber } from "./numbering";

/**
 * Inventaires — SEUL module qui écrit `stock_counts`, `stock_count_lines` et `stock_count_entries`
 * (garde-fou dans `tests/definitions-uniques.test.ts`). Cycle : préparation → comptage (théorique
 * et CMUP figés au démarrage, saisies par compteur) → validation (un mouvement
 * AJUSTEMENT_INVENTAIRE par écart, numéro INV) ou annulation. Un inventaire clos est figé par la base.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class CountError extends Error {}
const MODULE = "stock" as const;

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

export type CountLineView = {
  id: string; productId: string; product: string; ref: string | null; ean: string | null; brand: string | null; trackLots: boolean;
  lotNumber: string | null; expiryDate: string | null; theoreticalQty: string; cmup: string | null;
  counted: string | null; entries: number; gapQty: string | null; gapValue: string | null; gapPct: number | null;
  reasonKey: string | null; comment: string | null; addedDuringCount: boolean;
};
export type CountView = typeof stockCounts.$inferSelect & {
  lines: CountLineView[];
  counters: { name: string; entries: number; last: string }[];
  brands: { id: string; name: string }[];
};

export async function listCounts() {
  return (await db.execute<{ id: string; number: string | null; title: string; status: CountStatus; warehouse_key: string; count_date: string; blind: boolean; lines: number; entries: number; stats: Record<string, unknown> | null }>(sql`
    select c.id, c.number, c.title, c.status, c.warehouse_key, c.count_date::text, c.blind, c.stats,
      (select count(*)::int from stock_count_lines l where l.count_id = c.id) as lines,
      (select count(*)::int from stock_count_entries e where e.count_id = c.id) as entries
    from stock_counts c order by c.count_date desc, c.created_at desc limit 200`)).rows;
}

export async function getCount(id: string): Promise<CountView | null> {
  const [c] = await db.select().from(stockCounts).where(eq(stockCounts.id, id));
  if (!c) return null;
  const [lines, entries, counters, brands] = await Promise.all([
    db.execute<Record<string, string | boolean | null>>(sql`
      select l.id, l.product_id, p.name as product, coalesce(p.code, p.sku) as ref, p.ean, b.name as brand, p.track_lots, l.lot_number, l.expiry_date::text as expiry_date,
        l.theoretical_qty::text as theoretical_qty, l.cmup::text as cmup, l.counted_qty::text as counted_qty, l.reason_key, l.comment, l.added_during_count
      from stock_count_lines l join products p on p.id = l.product_id left join brands b on b.id = p.brand_id
      where l.count_id = ${id}::uuid order by b.name nulls last, p.name, l.lot_number nulls first`),
    db.execute<{ product_id: string; lot_number: string | null; quantity: string }>(sql`select product_id, lot_number, quantity::text from stock_count_entries where count_id = ${id}::uuid`),
    db.execute<{ name: string; entries: number; last: string }>(sql`
      select coalesce(counter_name, '—') as name, count(*)::int as entries, max(created_at)::text as last from stock_count_entries where count_id = ${id}::uuid group by 1 order by 1`),
    c.brandIds.length ? db.execute<{ id: string; name: string }>(sql`select id, name from brands where id = any(${pgArray(c.brandIds)}) order by name`) : Promise.resolve({ rows: [] as { id: string; name: string }[] }),
  ]);
  const counted = countedByLine(entries.rows.map((e) => ({ productId: e.product_id, lotNumber: e.lot_number, quantity: e.quantity })));
  const perLine = new Map<string, number>();
  for (const e of entries.rows) { const k = countLineKey(e.product_id, e.lot_number); perLine.set(k, (perLine.get(k) ?? 0) + 1); }
  const closed = c.status === "VALIDE";
  return {
    ...c,
    lines: lines.rows.map((r) => {
      const k = countLineKey(String(r.product_id), r.lot_number as string | null);
      const cnt = closed ? (r.counted_qty as string | null) : counted.get(k) ?? null;
      const g = cnt === null ? null : lineGap(String(r.theoretical_qty), cnt, r.cmup as string | null);
      return {
        id: String(r.id), productId: String(r.product_id), product: String(r.product), ref: r.ref as string | null, ean: r.ean as string | null, brand: r.brand as string | null,
        trackLots: !!r.track_lots, lotNumber: r.lot_number as string | null, expiryDate: r.expiry_date as string | null, theoreticalQty: String(r.theoretical_qty),
        cmup: r.cmup as string | null, counted: cnt, entries: perLine.get(k) ?? 0, gapQty: g?.gapQty ?? null, gapValue: g?.gapValue ?? null, gapPct: g?.gapPct ?? null,
        reasonKey: r.reason_key as string | null, comment: r.comment as string | null, addedDuringCount: !!r.added_during_count,
      };
    }),
    counters: counters.rows,
    brands: brands.rows,
  };
}

/** Saisies d'un compteur sur une session (ses propres lignes, pour les corriger). */
export async function myEntries(countId: string, userId: string) {
  return (await db.execute<{ id: string; product: string; ref: string | null; lot_number: string | null; quantity: string; created_at: string }>(sql`
    select e.id, p.name as product, coalesce(p.code, p.sku) as ref, e.lot_number, e.quantity::text, to_char(e.created_at at time zone ${BUSINESS_TZ}, 'HH24:MI') as created_at
    from stock_count_entries e join products p on p.id = e.product_id where e.count_id = ${countId}::uuid and e.counter_id = ${userId}::uuid order by e.created_at desc limit 200`)).rows;
}

/* ------------------------------------------------------------------ */
/* Préparation et démarrage                                            */
/* ------------------------------------------------------------------ */

export type CountInput = { title: string; warehouseKey: string; brandIds: string[]; blind: boolean; countDate: string; notes: string | null };

async function checkWarehouse(t: Tx | typeof db, key: string) {
  const w = (await t.execute<{ kind: string; active: boolean }>(sql`select kind, active from warehouses where key = ${key}`)).rows[0];
  if (!w || !w.active) throw new CountError("Dépôt introuvable.");
  if (w.kind !== "INTERNE") throw new CountError("On inventorie un dépôt interne ; Cospharma et Pharmafirst sont connus par leurs photos importées.");
}

export async function createCount(input: CountInput, actor: AuditActor): Promise<string> {
  if (!input.title.trim()) throw new CountError("Donnez un nom à l'inventaire (ex. « Inventaire annuel 2026 »).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.countDate)) throw new CountError("Date invalide.");
  await checkWarehouse(db, input.warehouseKey);
  const [row] = await db.insert(stockCounts).values({ title: input.title.trim(), warehouseKey: input.warehouseKey, brandIds: input.brandIds, blind: input.blind, countDate: input.countDate, notes: input.notes, createdById: actor.id }).returning({ id: stockCounts.id });
  await audit({ actor, action: "CREATE", module: MODULE, entity: "stock_count", entityId: row.id, label: input.title, after: { warehouse: input.warehouseKey, brands: input.brandIds.length, blind: input.blind } });
  return row.id;
}

export async function updateCount(id: string, input: CountInput, actor: AuditActor): Promise<void> {
  await checkWarehouse(db, input.warehouseKey);
  const [c] = await db.select({ status: stockCounts.status }).from(stockCounts).where(eq(stockCounts.id, id));
  if (!c) throw new CountError("Inventaire introuvable.");
  if (c.status !== "BROUILLON") throw new CountError("Le comptage a commencé : le périmètre ne change plus.");
  await db.update(stockCounts).set({ title: input.title.trim(), warehouseKey: input.warehouseKey, brandIds: input.brandIds, blind: input.blind, countDate: input.countDate, notes: input.notes, updatedAt: new Date() }).where(eq(stockCounts.id, id));
  await audit({ actor, action: "UPDATE", module: MODULE, entity: "stock_count", entityId: id, label: input.title });
}

export async function deleteCount(id: string, actor: AuditActor): Promise<void> {
  const [c] = await db.select().from(stockCounts).where(eq(stockCounts.id, id));
  if (!c) throw new CountError("Inventaire introuvable.");
  if (c.status !== "BROUILLON") throw new CountError("Un comptage commencé ne se supprime pas : annulez-le.");
  await db.delete(stockCounts).where(eq(stockCounts.id, id));
  await audit({ actor, action: "DELETE", module: MODULE, entity: "stock_count", entityId: id, label: c.title });
}

/**
 * Démarre le comptage : fige, pour chaque article stocké du périmètre, le théorique par lot dans le
 * dépôt (somme des mouvements à cet instant) et le CMUP. Un article sans stock a une ligne à 0 :
 * ce qu'on trouve en rayon se compte aussi.
 */
export async function startCount(id: string, actor: AuditActor): Promise<number> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(stockCounts).where(eq(stockCounts.id, id)).for("update");
    if (!c) throw new CountError("Inventaire introuvable.");
    if (c.status !== "BROUILLON") throw new CountError("Ce comptage a déjà démarré.");
    const scope = c.brandIds.length ? sql`and p.brand_id = any(${pgArray(c.brandIds)})` : sql``;
    const products = (await tx.execute<{ id: string }>(sql`select p.id from products p where p.active and p.kind = 'PRODUIT' ${scope} order by p.id`)).rows.map((r) => r.id);
    if (!products.length) throw new CountError("Aucun article stocké dans ce périmètre.");
    const balances = (await tx.execute<{ product_id: string; lot_number: string | null; expiry_date: string | null; qty: string }>(sql`
      select m.product_id, l.lot_number, l.expiry_date::text as expiry_date, sum(m.quantity)::text as qty
      from stock_movements m left join stock_lots l on l.id = m.lot_id
      where m.warehouse_key = ${c.warehouseKey} and m.product_id = any(${pgArray(products)})
      group by m.product_id, l.lot_number, l.expiry_date having sum(m.quantity) <> 0`)).rows;
    const cmups = new Map((await tx.execute<{ product_id: string; cmup: string }>(sql`
      select distinct on (product_id) product_id, cmup_after::text as cmup from stock_movements
      where product_id = any(${pgArray(products)}) and cmup_after is not null order by product_id, seq desc`)).rows.map((r) => [r.product_id, r.cmup]));
    const withStock = new Set(balances.map((b) => b.product_id));
    const rows = [
      ...balances.map((b) => ({ countId: id, productId: b.product_id, lotNumber: b.lot_number, expiryDate: b.expiry_date, theoreticalQty: b.qty, cmup: cmups.get(b.product_id) ?? null })),
      ...products.filter((p) => !withStock.has(p)).map((p) => ({ countId: id, productId: p, lotNumber: null, expiryDate: null, theoreticalQty: "0", cmup: cmups.get(p) ?? null })),
    ];
    for (let i = 0; i < rows.length; i += 500) await tx.insert(stockCountLines).values(rows.slice(i, i + 500));
    await tx.update(stockCounts).set({ status: "EN_COURS", startedAt: new Date(), startedById: actor.id, updatedAt: new Date() }).where(eq(stockCounts.id, id));
    await audit({ actor, action: "START", module: MODULE, entity: "stock_count", entityId: id, label: c.title, after: { lines: rows.length } }, tx);
    return rows.length;
  });
}

/* ------------------------------------------------------------------ */
/* Comptage                                                            */
/* ------------------------------------------------------------------ */

export type EntryInput = { productId: string; lotNumber?: string | null; expiryDate?: string | null; quantity: string };

/** Une saisie d'un compteur. Un article ou un lot trouvé sans théorique ajoute sa ligne (théorique 0). */
export async function addEntry(countId: string, input: EntryInput, actor: AuditActor): Promise<void> {
  const qty = parseDecimal(input.quantity, SCALE.qty);
  if (qty === null || qty < 0n) throw new CountError("Quantité comptée invalide (0 ou plus).");
  if (input.expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate)) throw new CountError("Date de péremption invalide.");
  const lot = input.lotNumber?.trim() || null;
  await db.transaction(async (tx) => {
    const [c] = await tx.select({ status: stockCounts.status }).from(stockCounts).where(eq(stockCounts.id, countId)).for("share");
    if (!c) throw new CountError("Inventaire introuvable.");
    if (c.status !== "EN_COURS") throw new CountError("Le comptage n'est pas ouvert.");
    const p = (await tx.execute<{ name: string; kind: string; track_lots: boolean }>(sql`select name, kind, track_lots from products where id = ${input.productId}::uuid`)).rows[0];
    if (!p) throw new CountError("Article introuvable.");
    if (p.kind !== "PRODUIT") throw new CountError(`${p.name} n'est pas un article stocké.`);
    if (p.track_lots && !lot) throw new CountError(`${p.name} est suivi par lot : indiquez le lot compté.`);
    const exists = (await tx.execute<{ id: string }>(sql`
      select id from stock_count_lines where count_id = ${countId}::uuid and product_id = ${input.productId}::uuid and upper(coalesce(lot_number, '')) = ${(lot ?? "").toUpperCase()}`)).rows[0];
    if (!exists) {
      await tx.insert(stockCountLines).values({ countId, productId: input.productId, lotNumber: lot, expiryDate: input.expiryDate || null, theoreticalQty: "0", addedDuringCount: true,
        cmup: (await tx.execute<{ c: string | null }>(sql`select cmup_after::text as c from stock_movements where product_id = ${input.productId}::uuid and cmup_after is not null order by seq desc limit 1`)).rows[0]?.c ?? null });
    }
    await tx.insert(stockCountEntries).values({ countId, productId: input.productId, lotNumber: lot, expiryDate: input.expiryDate || null, quantity: formatScaled(qty, SCALE.qty), counterId: actor.id, counterName: actor.name });
  });
}

/** Retire une saisie : la sienne, ou n'importe laquelle pour qui valide l'inventaire. */
export async function deleteEntry(entryId: string, actor: AuditActor, canValidate: boolean): Promise<void> {
  const e = (await db.execute<{ counter_id: string | null; status: string }>(sql`
    select e.counter_id, c.status from stock_count_entries e join stock_counts c on c.id = e.count_id where e.id = ${entryId}::uuid`)).rows[0];
  if (!e) throw new CountError("Saisie introuvable.");
  if (e.status !== "EN_COURS") throw new CountError("Le comptage n'est plus ouvert.");
  if (e.counter_id !== actor.id && !canValidate) throw new CountError("On ne retire que ses propres saisies.");
  await db.delete(stockCountEntries).where(eq(stockCountEntries.id, entryId));
}

/** Compte à zéro les lignes sans saisie (rayon vérifié vide), pour qu'elles soient ajustées à la validation. */
export async function zeroUncounted(countId: string, actor: AuditActor): Promise<number> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select({ status: stockCounts.status }).from(stockCounts).where(eq(stockCounts.id, countId)).for("update");
    if (!c || c.status !== "EN_COURS") throw new CountError("Le comptage n'est pas ouvert.");
    const lines = (await tx.execute<{ product_id: string; lot_number: string | null }>(sql`
      select l.product_id, l.lot_number from stock_count_lines l where l.count_id = ${countId}::uuid
        and not exists (select 1 from stock_count_entries e where e.count_id = l.count_id and e.product_id = l.product_id and upper(coalesce(e.lot_number, '')) = upper(coalesce(l.lot_number, '')))`)).rows;
    if (lines.length) await tx.insert(stockCountEntries).values(lines.map((l) => ({ countId, productId: l.product_id, lotNumber: l.lot_number, quantity: "0", counterId: actor.id, counterName: `${actor.name} (non compté → 0)` })));
    await audit({ actor, action: "ZERO_UNCOUNTED", module: MODULE, entity: "stock_count", entityId: countId, after: { lines: lines.length } }, tx);
    return lines.length;
  });
}

export async function setLineReason(lineId: string, reasonKey: string | null, comment: string | null): Promise<void> {
  const r = (await db.execute<{ status: string }>(sql`select c.status from stock_count_lines l join stock_counts c on c.id = l.count_id where l.id = ${lineId}::uuid`)).rows[0];
  if (!r) throw new CountError("Ligne introuvable.");
  if (r.status !== "EN_COURS") throw new CountError("Le comptage n'est plus ouvert.");
  await db.update(stockCountLines).set({ reasonKey: reasonKey || null, comment: comment?.trim() || null }).where(eq(stockCountLines.id, lineId));
}

/* ------------------------------------------------------------------ */
/* Validation, annulation                                              */
/* ------------------------------------------------------------------ */

/**
 * Valide l'inventaire : compté = somme des saisies ; chaque ligne comptée en écart devient un
 * mouvement AJUSTEMENT_INVENTAIRE (quantité = écart, sur son lot, à la date du comptage) ; une ligne
 * sans saisie n'est pas ajustée (non comptée ≠ zéro). Tout écart exige un motif. Numéro INV.
 */
export async function validateCount(id: string, actor: AuditActor): Promise<{ number: string; adjustments: number }> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(stockCounts).where(eq(stockCounts.id, id)).for("update");
    if (!c) throw new CountError("Inventaire introuvable.");
    if (c.status !== "EN_COURS") throw new CountError("Seul un comptage en cours se valide.");
    if (c.countDate > iso(today())) throw new CountError("Un inventaire ne se valide pas à une date future.");
    const view = (await getCount(id))!;
    const counted = view.lines.filter((l) => l.counted !== null);
    if (!counted.length) throw new CountError("Aucune ligne comptée.");
    const missingReason = counted.filter((l) => (parseDecimal(l.gapQty, SCALE.qty) ?? 0n) !== 0n && !l.reasonKey);
    if (missingReason.length) throw new CountError(`Motif manquant pour ${missingReason.length} écart(s) : ${missingReason.slice(0, 3).map((l) => l.product + (l.lotNumber ? ` (lot ${l.lotNumber})` : "")).join(", ")}${missingReason.length > 3 ? "…" : ""}.`);
    for (const l of view.lines) {
      await tx.update(stockCountLines).set({ countedQty: l.counted, gapQty: l.gapQty, gapValue: l.gapValue }).where(eq(stockCountLines.id, l.id));
    }
    const moves: LedgerInput[] = counted.filter((l) => (parseDecimal(l.gapQty, SCALE.qty) ?? 0n) !== 0n).map((l) => ({
      productId: l.productId, type: "AJUSTEMENT_INVENTAIRE", quantity: l.gapQty!, warehouseKey: c.warehouseKey, lotNumber: l.lotNumber, expiryDate: l.expiryDate,
      unitCost: l.cmup, date: c.countDate, sourceType: "INVENTAIRE", sourceId: id, sourceLineId: l.id, comment: [l.reasonKey, l.comment].filter(Boolean).join(" — ") || null,
    }));
    if (moves.length) await recordStockMovements(moves, { id: actor.id }, { tx, allowNegative: false });
    const { number, year } = await allocateNumber(tx, "INV", c.countDate);
    const stats = countStats(view.lines.map((l) => ({ theoreticalQty: l.theoreticalQty, countedQty: l.counted, cmup: l.cmup })));
    await tx.update(stockCounts).set({ status: "VALIDE", number, seriesKey: "INV", fiscalYear: year, validatedAt: new Date(), validatedById: actor.id, stats, updatedAt: new Date() }).where(eq(stockCounts.id, id));
    await audit({ actor, action: "VALIDATE", module: MODULE, entity: "stock_count", entityId: id, label: `${number} — ${c.title}`, after: { ...stats, adjustments: moves.length } }, tx);
    return { number, adjustments: moves.length };
  });
}

export async function cancelCount(id: string, reason: string, actor: AuditActor): Promise<void> {
  if (!reason.trim()) throw new CountError("Indiquez le motif de l'annulation.");
  const [c] = await db.select().from(stockCounts).where(eq(stockCounts.id, id));
  if (!c) throw new CountError("Inventaire introuvable.");
  if (c.status !== "EN_COURS") throw new CountError("Seul un comptage en cours s'annule (en préparation, il se supprime).");
  await db.update(stockCounts).set({ status: "ANNULE", cancelledAt: new Date(), cancelReason: reason.trim(), updatedAt: new Date() }).where(eq(stockCounts.id, id));
  await audit({ actor, action: "CANCEL", module: MODULE, entity: "stock_count", entityId: id, label: c.title, after: { reason } });
}

/* ------------------------------------------------------------------ */
/* Analyse des écarts                                                  */
/* ------------------------------------------------------------------ */

export type GapAnalysisRow = { lineId: string; productId: string; product: string; lotNumber: string | null; gapQty: string; gapValue: string | null; outflows: string; gapOverOutflows: number | null; recurring: number; leads: GapLead[] };

/**
 * Pour chaque ligne en écart : les pistes (donnée + hypothèse), l'écart rapporté aux sorties de la
 * période (depuis l'inventaire précédent, sinon la fenêtre réglée) et le nombre d'inventaires où
 * l'article était déjà en écart.
 */
export async function gapAnalysis(id: string): Promise<GapAnalysisRow[]> {
  const g = (await getSettings()).gestion.inventory;
  const c = await getCount(id);
  if (!c || !c.startedAt) return [];
  const gapLines = c.lines.filter((l) => l.counted !== null && (parseDecimal(l.gapQty, SCALE.qty) ?? 0n) !== 0n);
  if (!gapLines.length) return [];
  const pids = [...new Set(gapLines.map((l) => l.productId))];
  const prev = (await db.execute<{ d: string | null }>(sql`
    select max(count_date)::text as d from stock_counts where status = 'VALIDE' and warehouse_key = ${c.warehouseKey} and count_date < ${c.countDate}::date and id <> ${id}::uuid`)).rows[0]?.d;
  const from = prev ?? iso(new Date(new Date(`${c.countDate}T12:00:00Z`).getTime() - g.analysisWindowDays * 86400000));
  const started = c.startedAt.toISOString();
  const byProduct = <T extends { product_id: string }>(rows: T[]) => new Map(rows.map((r) => [r.product_id, r]));
  const [blAfter, lateBls, recAfter, openOrders, credits, samples, sampleMoves, outflows, since, history] = await Promise.all([
    db.execute<{ product_id: string; n: number; qty: string }>(sql`
      select l.product_id, count(distinct d.id)::int as n, sum(l.quantity + l.free_quantity)::text as qty from sales_document_lines l join sales_documents d on d.id = l.document_id
      where d.type = 'BL' and d.status <> 'BROUILLON' and d.date <= ${c.countDate}::date and d.validated_at > ${started}::timestamptz and l.product_id = any(${pgArray(pids)}) group by 1`),
    db.execute<{ product_id: string; n: number }>(sql`
      select l.product_id, count(distinct d.id)::int as n from sales_document_lines l join sales_documents d on d.id = l.document_id
      where d.type = 'BL' and d.status <> 'BROUILLON' and d.date between ${from}::date and ${c.countDate}::date
        and d.validated_at > (d.date::timestamp + make_interval(hours => ${g.lateEntryHours + 24})) and l.product_id = any(${pgArray(pids)}) group by 1`),
    db.execute<{ product_id: string; n: number; qty: string }>(sql`
      select l.product_id, count(distinct d.id)::int as n, sum(l.quantity)::text as qty from purchase_document_lines l join purchase_documents d on d.id = l.document_id
      where d.type = 'RECEPTION' and d.status <> 'BROUILLON' and d.date <= ${c.countDate}::date and d.validated_at > ${started}::timestamptz and l.product_id = any(${pgArray(pids)}) group by 1`),
    db.execute<{ product_id: string; qty: string }>(sql`
      select l.product_id, sum(l.quantity - l.received_qty)::text as qty from purchase_document_lines l join purchase_documents d on d.id = l.document_id
      where d.type = 'COMMANDE' and d.status in ('VALIDE', 'PARTIELLE') and l.product_id = any(${pgArray(pids)}) group by 1`),
    db.execute<{ product_id: string; qty: string }>(sql`
      select l.product_id, sum(l.quantity)::text as qty from sales_document_lines l join sales_documents d on d.id = l.document_id join credit_reasons r on r.key = d.reason_key
      where d.type = 'AVOIR' and d.status <> 'BROUILLON' and not r.with_return and d.date between ${from}::date and ${c.countDate}::date and l.product_id = any(${pgArray(pids)}) group by 1`),
    db.execute<{ product_id: string; qty: string }>(sql`
      select product_id, sum(quantity)::text as qty from sample_movements where type = 'ENTREE' and date between ${from}::date and ${c.countDate}::date and product_id = any(${pgArray(pids)}) group by 1`),
    db.execute<{ product_id: string; qty: string }>(sql`
      select product_id, (-sum(quantity))::text as qty from stock_movements where type = 'ECHANTILLON_MARKETING' and date between ${from}::date and ${c.countDate}::date and product_id = any(${pgArray(pids)}) group by 1`),
    db.execute<{ product_id: string; qty: string }>(sql`
      select product_id, (-sum(quantity))::text as qty from stock_movements where quantity < 0 and warehouse_key = ${c.warehouseKey} and type not in ('TRANSFERT', 'AJUSTEMENT_INVENTAIRE')
        and date between ${from}::date and ${c.countDate}::date and product_id = any(${pgArray(pids)}) group by 1`),
    db.execute<{ product_id: string; n: number }>(sql`
      select product_id, count(*)::int as n from stock_movements where created_at > ${started}::timestamptz and warehouse_key = ${c.warehouseKey}
        and not (source_type = 'INVENTAIRE' and source_id = ${id}::uuid) and product_id = any(${pgArray(pids)}) group by 1`),
    db.execute<{ product_id: string; count_id: string; gap_qty: string }>(sql`
      select l.product_id, l.count_id, l.gap_qty::text from stock_count_lines l join stock_counts c on c.id = l.count_id
      where c.status = 'VALIDE' and l.gap_qty is not null and l.gap_qty <> 0 and l.product_id = any(${pgArray(pids)})`),
  ]);
  const m = { blAfter: byProduct(blAfter.rows), lateBls: byProduct(lateBls.rows), recAfter: byProduct(recAfter.rows), openOrders: byProduct(openOrders.rows), credits: byProduct(credits.rows), samples: byProduct(samples.rows), sampleMoves: byProduct(sampleMoves.rows), outflows: byProduct(outflows.rows), since: byProduct(since.rows) };
  const recurring = recurringGaps([...history.rows.map((h) => ({ productId: h.product_id, countId: h.count_id, gapQty: h.gap_qty })), ...(c.status === "VALIDE" ? [] : gapLines.map((l) => ({ productId: l.productId, countId: id, gapQty: l.gapQty! })))], 1);
  const sub = (a: string | undefined, b: string | undefined) => formatScaled((parseDecimal(a ?? "0", SCALE.qty) ?? 0n) - (parseDecimal(b ?? "0", SCALE.qty) ?? 0n), SCALE.qty);
  return gapLines.map((l) => {
    const out = m.outflows.get(l.productId)?.qty ?? "0";
    const expired = l.lotNumber && l.expiryDate && l.expiryDate < c.countDate ? { lot: l.lotNumber, expiry: l.expiryDate } : null;
    return {
      lineId: l.id, productId: l.productId, product: l.product, lotNumber: l.lotNumber, gapQty: l.gapQty!, gapValue: l.gapValue, outflows: out,
      gapOverOutflows: gapOverOutflows(l.gapQty!, out), recurring: recurring.get(l.productId) ?? 0,
      leads: gapLeads({
        gapQty: l.gapQty!, blAfterStart: { count: m.blAfter.get(l.productId)?.n ?? 0, qty: m.blAfter.get(l.productId)?.qty ?? "0" },
        lateBls: { count: m.lateBls.get(l.productId)?.n ?? 0, hours: g.lateEntryHours },
        receptionsAfterStart: { count: m.recAfter.get(l.productId)?.n ?? 0, qty: m.recAfter.get(l.productId)?.qty ?? "0" },
        openOrdersQty: m.openOrders.get(l.productId)?.qty ?? "0", creditsWithoutReturnQty: m.credits.get(l.productId)?.qty ?? "0",
        samplesWithoutMovementQty: (() => { const v = sub(m.samples.get(l.productId)?.qty, m.sampleMoves.get(l.productId)?.qty); return (parseDecimal(v, SCALE.qty) ?? 0n) > 0n ? v : "0"; })(),
        expiredLot: expired, movementsSinceStart: m.since.get(l.productId)?.n ?? 0,
      }),
    };
  });
}

/** Articles en écart dans plusieurs inventaires validés (seuil réglé), pour l'Action Center. */
export async function recurringGapProducts(min: number) {
  const rows = (await db.execute<{ product_id: string; count_id: string; gap_qty: string }>(sql`
    select l.product_id, l.count_id, l.gap_qty::text from stock_count_lines l join stock_counts c on c.id = l.count_id
    where c.status = 'VALIDE' and l.gap_qty is not null and l.gap_qty <> 0`)).rows;
  return recurringGaps(rows.map((r) => ({ productId: r.product_id, countId: r.count_id, gapQty: r.gap_qty })), min);
}

