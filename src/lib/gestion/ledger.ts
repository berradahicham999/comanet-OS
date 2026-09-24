import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { stockMovements } from "@/db/schema";
import type { DbLike } from "@/lib/events/emit";
import { pgArray } from "@/lib/sql-array";
import { SCALE, fmtQty, formatScaled, fromDb, nextCmup, parseDecimal, roundDiv, valueOf } from "./money";
import { COSTED_ENTRIES, MOVEMENT_META, balanceKey, movementError, type MovementType, type SourceType, type WarehouseLike } from "./ledger-shared";

/**
 * Journal de stock — SEUL module qui écrit `stock_movements` (garde-fou dans
 * `tests/definitions-uniques.test.ts`, et triggers en base qui refusent toute modification).
 *
 * `recordStockMovements()` verrouille les articles concernés (dans l'ordre de leurs identifiants,
 * pour éviter les interblocages), contrôle chaque mouvement, refuse un stock négatif selon la
 * politique, tient le CMUP à jour et écrit tout en une requête, dans une seule transaction.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type LedgerInput = {
  productId: string;
  type: MovementType;
  /** Quantité signée (texte décimal) : positive = entrée, négative = sortie. */
  quantity: string;
  warehouseKey?: string;
  counterpartWarehouseKey?: string | null;
  lotNumber?: string | null;
  expiryDate?: string | null;
  /** Coût unitaire (MAD HT) d'une entrée coûtée ; ignoré pour une sortie (valorisée au CMUP). */
  unitCost?: string | null;
  date: string;
  sourceType: SourceType;
  sourceId?: string | null;
  sourceLineId?: string | null;
  reversalOf?: string | null;
  comment?: string | null;
  importId?: string | null;
};

export class StockError extends Error {}

export async function recordStockMovements(
  inputs: LedgerInput[],
  actor: { id: string | null },
  opts: { tx?: Tx; allowNegative?: boolean } = {},
): Promise<string[]> {
  if (!inputs.length) return [];
  const run = async (t: Tx): Promise<string[]> => {
    const productIds = [...new Set(inputs.map((i) => i.productId))].sort();
    const prods = (await t.execute<{ id: string; name: string; kind: string; track_lots: boolean }>(sql`
      select id, name, kind, track_lots from products where id = any(${pgArray(productIds)}) order by id for update`)).rows;
    const products = new Map(prods.map((p) => [p.id, { id: p.id, name: p.name, kind: p.kind, trackLots: p.track_lots }]));
    const whRows = (await t.execute<WarehouseLike>(sql`select key, kind, active from warehouses`)).rows;
    const warehouses = new Map(whRows.map((w) => [w.key, w]));

    // 1. Contrôles de recevabilité (type, sens, dépôt, lot, coût).
    for (const i of inputs) {
      const err = movementError(
        { productId: i.productId, type: i.type, quantity: i.quantity, warehouseKey: i.warehouseKey ?? "PRINCIPAL", counterpartWarehouseKey: i.counterpartWarehouseKey, lotNumber: i.lotNumber, unitCost: i.unitCost, isReversal: !!i.reversalOf },
        products.get(i.productId), warehouses,
      );
      if (err) throw new StockError(err);
    }

    // 2. Lots : créés à la première entrée ; une péremption déjà connue ne se contredit pas.
    const lotIds = new Map<string, string>();
    for (const i of inputs) {
      const num = i.lotNumber?.trim();
      if (!num) continue;
      const k = `${i.productId}|${num}`;
      if (lotIds.has(k)) continue;
      const r = (await t.execute<{ id: string; expiry_date: string | null }>(sql`
        insert into stock_lots (product_id, lot_number, expiry_date) values (${i.productId}::uuid, ${num}, ${i.expiryDate ?? null}::date)
        on conflict (product_id, lot_number) do update set expiry_date = coalesce(stock_lots.expiry_date, excluded.expiry_date)
        returning id, expiry_date::text`)).rows[0];
      if (i.expiryDate && r.expiry_date && r.expiry_date !== i.expiryDate) {
        throw new StockError(`Le lot ${num} de ${products.get(i.productId)?.name} est déjà enregistré avec la péremption ${r.expiry_date}, pas ${i.expiryDate}.`);
      }
      lotIds.set(k, r.id);
    }

    // 3. État courant : soldes (article × dépôt × lot), stock interne total et CMUP par article.
    const bal = new Map<string, bigint>();
    for (const b of (await t.execute<{ product_id: string; warehouse_key: string; lot_id: string | null; qty: string }>(sql`
      select product_id, warehouse_key, lot_id, sum(quantity)::text as qty from stock_movements
      where product_id = any(${pgArray(productIds)}) group by product_id, warehouse_key, lot_id`)).rows) {
      bal.set(balanceKey(b.product_id, b.warehouse_key, b.lot_id), fromDb(b.qty, SCALE.qty) ?? 0n);
    }
    const total = new Map<string, bigint>();
    for (const [k, v] of bal) { const p = k.split("|")[0]; total.set(p, (total.get(p) ?? 0n) + v); }
    const cmup = new Map<string, bigint | null>();
    for (const c of (await t.execute<{ product_id: string; cmup: string }>(sql`
      select distinct on (product_id) product_id, cmup_after::text as cmup from stock_movements
      where product_id = any(${pgArray(productIds)}) and cmup_after is not null order by product_id, seq desc`)).rows) {
      cmup.set(c.product_id, fromDb(c.cmup, SCALE.cost));
    }
    const reversedCost = new Map<string, bigint | null>();
    const reversalIds = inputs.map((i) => i.reversalOf).filter((x): x is string => !!x);
    if (reversalIds.length) {
      for (const r of (await t.execute<{ id: string; unit_cost: string | null; reversed: boolean }>(sql`
        select m.id, m.unit_cost::text as unit_cost, exists (select 1 from stock_movements x where x.reversal_of = m.id) as reversed
        from stock_movements m where m.id = any(${pgArray(reversalIds)})`)).rows) {
        if (r.reversed) throw new StockError("Ce mouvement a déjà été annulé.");
        reversedCost.set(r.id, fromDb(r.unit_cost, SCALE.cost));
      }
      if (reversedCost.size !== new Set(reversalIds).size) throw new StockError("Mouvement à annuler introuvable.");
    }

    // 4. Calcul ligne à ligne, dans l'ordre fourni.
    const rows: (typeof stockMovements.$inferInsert)[] = [];
    const push = (i: LedgerInput, warehouseKey: string, q: bigint, counterpart: string | null) => {
      const lotId = i.lotNumber?.trim() ? lotIds.get(`${i.productId}|${i.lotNumber.trim()}`) ?? null : null;
      const name = products.get(i.productId)!.name;
      const tot = total.get(i.productId) ?? 0n;
      let cm = cmup.get(i.productId) ?? null;
      let unitCost: bigint | null;
      if (COSTED_ENTRIES.includes(i.type) && q > 0n && !i.reversalOf) {
        unitCost = parseDecimal(i.unitCost ?? null, SCALE.cost);
        cm = nextCmup(tot, cm, q, unitCost!);
      } else if (i.reversalOf && COSTED_ENTRIES.includes(i.type) && q < 0n) {
        // Annuler une entrée coûtée la retire de la moyenne pondérée au coût où elle était entrée.
        unitCost = reversedCost.get(i.reversalOf) ?? cm;
        const rest = tot + q;
        if (rest > 0n && cm !== null && unitCost !== null) cm = roundDiv(tot * cm + q * unitCost, rest);
      } else {
        unitCost = q < 0n ? cm : (parseDecimal(i.unitCost ?? null, SCALE.cost) ?? cm);
      }
      const k = balanceKey(i.productId, warehouseKey, lotId);
      const next = (bal.get(k) ?? 0n) + q;
      if (next < 0n && !opts.allowNegative) {
        const have = bal.get(k) ?? 0n;
        throw new StockError(`Stock insuffisant pour ${name}${i.lotNumber ? ` (lot ${i.lotNumber})` : ""} dans ${warehouseKey} : ${fmtQty(formatScaled(have, SCALE.qty))} disponible(s), ${fmtQty(formatScaled(-q, SCALE.qty))} demandé(s).`);
      }
      bal.set(k, next);
      total.set(i.productId, tot + q);
      cmup.set(i.productId, cm);
      rows.push({
        productId: i.productId, lotId, warehouseKey, counterpartWarehouseKey: counterpart, type: i.type,
        quantity: formatScaled(q, SCALE.qty), unitCost: unitCost === null ? null : formatScaled(unitCost, SCALE.cost),
        cmupAfter: cm === null ? null : formatScaled(cm, SCALE.cost), date: i.date, sourceType: i.sourceType,
        sourceId: i.sourceId ?? null, sourceLineId: i.sourceLineId ?? null, reversalOf: i.reversalOf ?? null,
        comment: i.comment ?? null, importId: i.importId ?? null, createdById: actor.id,
      });
    };
    for (const i of inputs) {
      const q = parseDecimal(i.quantity, SCALE.qty)!;
      const from = i.warehouseKey ?? "PRINCIPAL";
      if (i.type === "TRANSFERT" && !i.reversalOf) {
        // Un transfert sort toujours du dépôt indiqué ; l'entrée n'est écrite que si le dépôt d'arrivée est interne.
        const to = i.counterpartWarehouseKey!;
        const out = q < 0n ? q : -q;
        push(i, from, out, to);
        if (warehouses.get(to)?.kind === "INTERNE") push(i, to, -out, from);
      } else {
        push(i, from, q, i.counterpartWarehouseKey ?? null);
      }
    }
    const inserted = await t.insert(stockMovements).values(rows).returning({ id: stockMovements.id });
    return inserted.map((r) => r.id);
  };
  return opts.tx ? run(opts.tx) : db.transaction(run);
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

export type StockLotRow = { lotId: string; lotNumber: string; expiryDate: string | null; warehouseKey: string; qty: string };
export type StockStateRow = {
  productId: string;
  name: string;
  code: string | null;
  brandId: string | null;
  brand: string | null;
  brandColor: string | null;
  trackLots: boolean;
  /** Quantité par dépôt interne (texte décimal, échelle 3). */
  byWarehouse: Record<string, string>;
  /** Stock interne disponible à la vente (dépôts internes « vendables »). */
  available: string;
  /** Stock interne total (y compris « non vendable ») : base du CMUP et de la valeur. */
  internalTotal: string;
  /** Dernières photos des dépôts externes (Cospharma, Pharmafirst). */
  external: { warehouseKey: string; qty: string; date: string }[];
  cmup: string | null;
  /** Valeur du stock interne au CMUP (MAD, échelle 2), null si le CMUP est inconnu. */
  value: string | null;
  lots: StockLotRow[];
  lastIn: string | null;
  lastOut: string | null;
  movements: number;
};

/**
 * État du stock à une date (incluse) : dépôts internes par le journal, dépôts externes par leur
 * dernière photo importée, CMUP et valeur, lots encore en stock. `at` absent = aujourd'hui.
 */
export async function stockState(opts: { at?: string; brandId?: string | null; productIds?: string[] | null; brandIds?: string[] | null } = {}): Promise<StockStateRow[]> {
  const at = opts.at ?? new Date().toISOString().slice(0, 10);
  const productFilter = sql`p.kind = 'PRODUIT'
    ${opts.brandId ? sql`and p.brand_id = ${opts.brandId}::uuid` : sql``}
    ${opts.productIds ? (opts.productIds.length ? sql`and p.id = any(${pgArray(opts.productIds)})` : sql`and false`) : sql``}
    ${opts.brandIds ? (opts.brandIds.length ? sql`and p.brand_id = any(${pgArray(opts.brandIds)})` : sql`and false`) : sql``}`;
  const [base, byWh, lots, cmups, ext, whs] = await Promise.all([
    db.execute<{ id: string; name: string; code: string | null; brand_id: string | null; brand: string | null; color: string | null; track_lots: boolean; active: boolean; last_in: string | null; last_out: string | null; n: number }>(sql`
      select p.id, p.name, p.code, p.brand_id, b.name as brand, b.color, p.track_lots, p.active,
        (select max(m.date)::text from stock_movements m where m.product_id = p.id and m.quantity > 0 and m.date <= ${at}::date) as last_in,
        (select max(m.date)::text from stock_movements m where m.product_id = p.id and m.quantity < 0 and m.date <= ${at}::date) as last_out,
        (select count(*)::int from stock_movements m where m.product_id = p.id and m.date <= ${at}::date) as n
      from products p left join brands b on b.id = p.brand_id
      where ${productFilter}
      order by b.name nulls last, p.name`),
    db.execute<{ product_id: string; warehouse_key: string; qty: string }>(sql`
      select m.product_id, m.warehouse_key, sum(m.quantity)::text as qty from stock_movements m join products p on p.id = m.product_id
      where m.date <= ${at}::date and ${productFilter} group by m.product_id, m.warehouse_key`),
    db.execute<{ product_id: string; lot_id: string; lot_number: string; expiry_date: string | null; warehouse_key: string; qty: string }>(sql`
      select m.product_id, l.id as lot_id, l.lot_number, l.expiry_date::text, m.warehouse_key, sum(m.quantity)::text as qty
      from stock_movements m join stock_lots l on l.id = m.lot_id join products p on p.id = m.product_id
      where m.date <= ${at}::date and ${productFilter}
      group by m.product_id, l.id, l.lot_number, l.expiry_date, m.warehouse_key having sum(m.quantity) <> 0
      order by l.expiry_date nulls last, l.lot_number`),
    db.execute<{ product_id: string; cmup: string }>(sql`
      select distinct on (m.product_id) m.product_id, m.cmup_after::text as cmup from stock_movements m join products p on p.id = m.product_id
      where m.cmup_after is not null and m.date <= ${at}::date and ${productFilter} order by m.product_id, m.seq desc`),
    db.execute<{ product_id: string; warehouse_key: string; qty: string; date: string }>(sql`
      select distinct on (s.product_id, s.warehouse_key) s.product_id, s.warehouse_key, s.quantity::text as qty, s.date::text
      from stock_snapshots s join warehouses w on w.key = s.warehouse_key and w.kind = 'EXTERNE' join products p on p.id = s.product_id
      where s.date <= ${at}::date and ${productFilter}
      order by s.product_id, s.warehouse_key, s.date desc, s.created_at desc`),
    db.execute<{ key: string; kind: string; sellable: boolean }>(sql`select key, kind, sellable from warehouses`),
  ]);
  const sellable = new Map(whs.rows.map((w) => [w.key, w.kind === "INTERNE" && w.sellable]));
  const out = new Map<string, StockStateRow>();
  for (const p of base.rows) {
    out.set(p.id, {
      productId: p.id, name: p.name, code: p.code, brandId: p.brand_id, brand: p.brand, brandColor: p.color, trackLots: p.track_lots,
      byWarehouse: {}, available: "0.000", internalTotal: "0.000", external: [], cmup: null, value: null, lots: [],
      lastIn: p.last_in, lastOut: p.last_out, movements: p.n,
    });
  }
  const sums = new Map<string, { avail: bigint; total: bigint }>();
  for (const r of byWh.rows) {
    const row = out.get(r.product_id);
    if (!row) continue;
    row.byWarehouse[r.warehouse_key] = r.qty;
    const q = fromDb(r.qty, SCALE.qty) ?? 0n;
    const s = sums.get(r.product_id) ?? { avail: 0n, total: 0n };
    s.total += q;
    if (sellable.get(r.warehouse_key)) s.avail += q;
    sums.set(r.product_id, s);
  }
  for (const [id, s] of sums) {
    const row = out.get(id)!;
    row.available = formatScaled(s.avail, SCALE.qty);
    row.internalTotal = formatScaled(s.total, SCALE.qty);
  }
  for (const c of cmups.rows) {
    const row = out.get(c.product_id);
    if (!row) continue;
    row.cmup = c.cmup;
    const total = fromDb(row.internalTotal, SCALE.qty) ?? 0n;
    const cm = fromDb(c.cmup, SCALE.cost);
    row.value = cm === null ? null : formatScaled(valueOf(total, cm), SCALE.money);
  }
  for (const l of lots.rows) out.get(l.product_id)?.lots.push({ lotId: l.lot_id, lotNumber: l.lot_number, expiryDate: l.expiry_date, warehouseKey: l.warehouse_key, qty: l.qty });
  for (const e of ext.rows) out.get(e.product_id)?.external.push({ warehouseKey: e.warehouse_key, qty: e.qty, date: e.date });
  return [...out.values()];
}

export type MovementRow = {
  id: string; seq: number; date: string; type: MovementType; productId: string; product: string; warehouseKey: string; counterpartWarehouseKey: string | null;
  lotNumber: string | null; expiryDate: string | null; quantity: string; unitCost: string | null; cmupAfter: string | null;
  sourceType: string; sourceId: string | null; reversalOf: string | null; reversed: boolean; comment: string | null; importId: string | null; createdBy: string | null; createdAt: Date;
};

/** Derniers mouvements (tous articles ou un seul), du plus récent au plus ancien. */
export async function listMovements(opts: { productId?: string; type?: string; importId?: string; limit?: number } = {}): Promise<MovementRow[]> {
  const r = await db.execute<MovementRow>(sql`
    select m.id, m.seq, m.date::text as date, m.type, m.product_id as "productId", p.name as product, m.warehouse_key as "warehouseKey",
      m.counterpart_warehouse_key as "counterpartWarehouseKey", l.lot_number as "lotNumber", l.expiry_date::text as "expiryDate",
      m.quantity::text as quantity, m.unit_cost::text as "unitCost", m.cmup_after::text as "cmupAfter", m.source_type as "sourceType",
      m.source_id as "sourceId", m.reversal_of as "reversalOf", exists (select 1 from stock_movements x where x.reversal_of = m.id) as reversed,
      m.comment, m.import_id as "importId", u.name as "createdBy", m.created_at as "createdAt"
    from stock_movements m join products p on p.id = m.product_id left join stock_lots l on l.id = m.lot_id left join users u on u.id = m.created_by_id
    where true
      ${opts.productId ? sql`and m.product_id = ${opts.productId}::uuid` : sql``}
      ${opts.type ? sql`and m.type = ${opts.type}` : sql``}
      ${opts.importId ? sql`and m.import_id = ${opts.importId}::uuid` : sql``}
    order by m.seq desc limit ${opts.limit ?? 200}`);
  return r.rows;
}

/**
 * Annule les mouvements d'un import par contre-mouvements (le journal ne s'efface jamais).
 * Refusé si le stock a été consommé depuis : les contre-mouvements rendraient un solde négatif.
 */
export async function reverseImportMovements(importId: string, actor: { id: string | null }, date: string): Promise<number> {
  return db.transaction(async (tx) => {
    const r = await tx.execute<{ id: string; product_id: string; type: MovementType; quantity: string; warehouse_key: string; lot_number: string | null; unit_cost: string | null }>(sql`
      select m.id, m.product_id, m.type, m.quantity::text as quantity, m.warehouse_key, l.lot_number, m.unit_cost::text as unit_cost
      from stock_movements m left join stock_lots l on l.id = m.lot_id
      where m.import_id = ${importId}::uuid and m.reversal_of is null
        and not exists (select 1 from stock_movements x where x.reversal_of = m.id)
      order by m.seq`);
    if (!r.rows.length) return 0;
    const inputs: LedgerInput[] = r.rows.map((m) => ({
      productId: m.product_id, type: m.type, quantity: formatScaled(-(parseDecimal(m.quantity, SCALE.qty) ?? 0n), SCALE.qty),
      warehouseKey: m.warehouse_key, lotNumber: m.lot_number, unitCost: m.unit_cost, date, sourceType: "IMPORT", sourceId: importId,
      reversalOf: m.id, comment: `Annulation de l'import (${MOVEMENT_META[m.type].label.toLowerCase()})`, importId,
    }));
    const ids = await recordStockMovements(inputs, actor, { tx, allowNegative: false });
    return ids.length;
  });
}

/** Nombre de mouvements dans le journal : sert aux garde-fous (réinitialisation, fusion, suppression). */
export async function movementCount(opts: { productId?: string; tx?: DbLike } = {}): Promise<number> {
  const q = opts.tx ?? db;
  const r = await q.execute<{ n: number }>(sql`select count(*)::int as n from stock_movements ${opts.productId ? sql`where product_id = ${opts.productId}::uuid` : sql``}`);
  return r.rows[0]?.n ?? 0;
}
