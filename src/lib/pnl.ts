import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pnlBulkSales, pnlCharges } from "@/db/schema";
import { audit, changedFields, type AuditActor } from "@/lib/audit";
import { budgetConsumptionByMonth } from "@/lib/budget";
import { getSettings, saveSettings, type PnlSettings } from "@/lib/settings";
import {
  buildPnl, chargeMonths, firstOfMonth, monthOf, previousMonth, RECURRENCES,
  type BulkAgg, type CategoryInput, type ChargeGroup, type ChargeInput, type MarketingAgg, type PnlStatement, type Recurrence, type SalesAgg,
} from "./pnl-shared";

/**
 * P&L de gestion — lecture des sources et écritures des saisies (charges, ventes en bloc).
 * Les calculs sont dans `pnl-shared.ts` (`buildPnl()`), seule définition du compte de résultat.
 */

/* ------------------------------------------------------------------ lecture */

/** Ventes de l'année agrégées mois × marque × site, avec coût d'achat et CA sans prix d'achat. */
async function salesAgg(year: number): Promise<SalesAgg[]> {
  const r = await db.execute<{ m: number; brand_id: string | null; site: string; amount: number; cogs: number; missing: number }>(sql`
    select extract(month from s.date)::int as m,
      coalesce(b.merged_into_id, b.id) as brand_id,
      upper(trim(coalesce(s.site, ''))) as site,
      coalesce(sum(s.amount), 0)::float8 as amount,
      coalesce(sum(case when p.cost_price is not null then (coalesce(s.quantity, 0) + coalesce(s.free_quantity, 0)) * p.cost_price else 0 end), 0)::float8 as cogs,
      coalesce(sum(case when p.cost_price is null then s.amount else 0 end), 0)::float8 as missing
    from sales s
    left join products p on p.id = s.product_id
    left join brands b on b.id = p.brand_id
    where s.date >= ${`${year}-01-01`}::date and s.date < ${`${year + 1}-01-01`}::date
    group by 1, 2, 3`);
  return r.rows.map((x) => ({ month: Number(x.m), brandId: x.brand_id, site: x.site, amount: Number(x.amount), cogs: Number(x.cogs), missingCostAmount: Number(x.missing) }));
}

async function bulkAgg(year: number): Promise<BulkAgg[]> {
  const r = await db.execute<{ date: string; brand_id: string; amount: number; cost: number | null }>(sql`
    select bs.date::text as date, coalesce(b.merged_into_id, b.id) as brand_id, bs.amount_ht::float8 as amount, bs.cost_amount::float8 as cost
    from pnl_bulk_sales bs join brands b on b.id = bs.brand_id
    where bs.date >= ${`${year}-01-01`}::date and bs.date < ${`${year + 1}-01-01`}::date`);
  return r.rows.map((x) => ({ month: monthOf(x.date, year) ?? 0, brandId: x.brand_id, amount: Number(x.amount), cost: x.cost === null ? null : Number(x.cost) }));
}

async function chargeInputs(year: number): Promise<ChargeInput[]> {
  const r = await db.execute<{ id: string; category_key: string; amount: number; recurrence: string; start_month: string; end_month: string | null; brand_id: string | null }>(sql`
    select c.id, c.category_key, c.amount::float8 as amount, c.recurrence, c.start_month::text, c.end_month::text, coalesce(b.merged_into_id, b.id) as brand_id
    from pnl_charges c left join brands b on b.id = c.brand_id
    where c.start_month < ${`${year + 1}-01-01`}::date and (c.end_month is null or c.end_month >= ${`${year}-01-01`}::date or c.recurrence = 'PONCTUELLE')`);
  return r.rows.map((x) => ({ id: x.id, categoryKey: x.category_key, amount: Number(x.amount), recurrence: x.recurrence, startMonth: x.start_month, endMonth: x.end_month, brandId: x.brand_id }));
}

export async function listChargeCategories(opts: { includeInactive?: boolean } = {}): Promise<(CategoryInput & { active: boolean })[]> {
  const r = await db.execute<{ key: string; label: string; grp: ChargeGroup; sort: number; active: boolean }>(sql`
    select key, label, grp, sort, active from pnl_charge_categories ${opts.includeInactive ? sql`` : sql`where active`} order by grp, sort, label`);
  return r.rows.map((x) => ({ key: x.key, label: x.label, grp: x.grp, sort: Number(x.sort), active: x.active }));
}

async function marketingAgg(year: number): Promise<MarketingAgg[]> {
  const [rows, merged] = await Promise.all([
    budgetConsumptionByMonth(year),
    db.execute<{ id: string; target: string }>(sql`select id, merged_into_id as target from brands where merged_into_id is not null`),
  ]);
  const map = new Map(merged.rows.map((m) => [m.id, m.target]));
  return rows.map((r) => ({ month: r.month, brandId: map.get(r.brandId) ?? r.brandId, consumed: r.consumed }));
}

async function pnlBrands() {
  const r = await db.execute<{ id: string; name: string; color: string }>(sql`select id, name, color from brands where merged_into_id is null order by name`);
  return r.rows;
}

/** Dernière date de vente par nature de site : sert à dire « données à jour au … ». */
async function freshness(year: number, rules: PnlSettings) {
  const r = await db.execute<{ site: string; last: string }>(sql`
    select upper(trim(coalesce(site, ''))) as site, max(date)::text as last from sales
    where date >= ${`${year}-01-01`}::date and date < ${`${year + 1}-01-01`}::date group by 1`);
  const norm = (s: string) => s.trim().toUpperCase();
  const lastOf = (sites: string[]) => r.rows.filter((x) => sites.map(norm).includes(x.site)).map((x) => x.last).sort().at(-1) ?? null;
  return {
    direct: lastOf(rules.directSites),
    prestations: rules.prestations.map((p) => ({ label: p.label, last: lastOf([p.site]) })),
    distributor: lastOf(rules.distributorSites),
  };
}

export type PnlView = PnlStatement & {
  previous: PnlStatement;
  rules: PnlSettings;
  freshness: Awaited<ReturnType<typeof freshness>>;
  brandList: { id: string; name: string; color: string }[];
};

/**
 * Compte de résultat d'une année jusqu'au mois `lastMonth` (inclus), et la même période de l'année
 * précédente pour comparaison. `brandId` restreint à une marque.
 */
export async function pnlStatement(year: number, lastMonth: number, brandId?: string | null): Promise<PnlView> {
  const settings = await getSettings();
  const rules = settings.pnl;
  const load = async (y: number) => {
    const [sales, bulk, charges, marketing] = await Promise.all([salesAgg(y), bulkAgg(y), chargeInputs(y), marketingAgg(y)]);
    return { sales, bulk, charges, marketing };
  };
  const [cur, prev, categories, brands, fresh] = await Promise.all([load(year), load(year - 1), listChargeCategories({ includeInactive: true }), pnlBrands(), freshness(year, rules)]);
  const base = { rules, categories, brands, brandId: brandId ?? null, lastMonth };
  return {
    ...buildPnl({ ...base, year, ...cur }),
    previous: buildPnl({ ...base, year: year - 1, ...prev }),
    rules,
    freshness: fresh,
    brandList: brands,
  };
}

/* ---------------------------------------------------------------- charges */

export type ChargeRow = {
  id: string; categoryKey: string; categoryLabel: string; grp: ChargeGroup; label: string; amount: number;
  recurrence: Recurrence; startMonth: string; endMonth: string | null; brandId: string | null; brandName: string | null; notes: string | null;
  /** Montant qui tombe dans l'année demandée. */
  yearAmount: number;
};

export async function listCharges(year: number): Promise<ChargeRow[]> {
  const r = await db.execute<{ id: string; category_key: string; category_label: string; grp: ChargeGroup; label: string; amount: number; recurrence: Recurrence; start_month: string; end_month: string | null; brand_id: string | null; brand_name: string | null; notes: string | null }>(sql`
    select c.id, c.category_key, k.label as category_label, k.grp, c.label, c.amount::float8 as amount, c.recurrence, c.start_month::text, c.end_month::text,
      c.brand_id, b.name as brand_name, c.notes
    from pnl_charges c join pnl_charge_categories k on k.key = c.category_key left join brands b on b.id = c.brand_id
    order by k.grp, k.sort, c.start_month desc, c.label`);
  return r.rows
    .map((x) => {
      const months = chargeMonths({ recurrence: x.recurrence, startMonth: x.start_month, endMonth: x.end_month }, year);
      return {
        id: x.id, categoryKey: x.category_key, categoryLabel: x.category_label, grp: x.grp, label: x.label, amount: Number(x.amount),
        recurrence: x.recurrence, startMonth: x.start_month, endMonth: x.end_month, brandId: x.brand_id, brandName: x.brand_name, notes: x.notes,
        yearAmount: months.length * Number(x.amount),
      };
    });
}

export async function getCharge(id: string) {
  const [c] = await db.select().from(pnlCharges).where(eq(pnlCharges.id, id));
  return c ?? null;
}

export type ChargeInputForm = {
  categoryKey: string; label: string; amount: string; recurrence: Recurrence; startMonth: string; endMonth: string | null; brandId: string | null; notes: string | null;
};

function checkCharge(i: ChargeInputForm) {
  if (!i.label.trim()) throw new Error("Le libellé est obligatoire.");
  if (!(i.recurrence in RECURRENCES)) throw new Error("Récurrence inconnue.");
  const start = firstOfMonth(i.startMonth);
  if (!start) throw new Error("Mois de début invalide (AAAA-MM).");
  const end = i.recurrence === "MENSUELLE" && i.endMonth ? firstOfMonth(i.endMonth) : null;
  if (i.recurrence === "MENSUELLE" && i.endMonth && !end) throw new Error("Mois de fin invalide (AAAA-MM).");
  if (end && end < start) throw new Error("Le mois de fin précède le mois de début.");
  if (!/^-?\d+(\.\d{1,2})?$/.test(i.amount)) throw new Error("Montant invalide (ex. 15000 ou 15000.50).");
  return {
    categoryKey: i.categoryKey, label: i.label.trim(), amount: i.amount, recurrence: i.recurrence,
    startMonth: start, endMonth: end, brandId: i.brandId, notes: i.notes,
  };
}

export async function createCharge(i: ChargeInputForm, actor: AuditActor): Promise<string> {
  const v = checkCharge(i);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(pnlCharges).values({ ...v, createdById: actor.id }).returning({ id: pnlCharges.id });
    await audit({ actor, action: "PNL_CHARGE_CREATE", module: "administration", entity: "pnl_charge", entityId: row.id, label: v.label, after: v }, tx);
    return row.id;
  });
}

export async function updateCharge(id: string, i: ChargeInputForm, actor: AuditActor) {
  const v = checkCharge(i);
  const before = await getCharge(id);
  if (!before) throw new Error("Charge introuvable.");
  await db.transaction(async (tx) => {
    await tx.update(pnlCharges).set({ ...v, updatedAt: new Date() }).where(eq(pnlCharges.id, id));
    const diff = changedFields(before as unknown as Record<string, unknown>, v as unknown as Record<string, unknown>);
    if (diff) await audit({ actor, action: "PNL_CHARGE_UPDATE", module: "administration", entity: "pnl_charge", entityId: id, label: v.label, before: diff.before, after: diff.after }, tx);
  });
}

/**
 * Révision d'une charge mensuelle à partir d'un mois (augmentation de salaire, nouveau loyer) :
 * l'ancienne ligne est close au mois précédent, une nouvelle part du mois donné. L'historique reste juste.
 */
export async function reviseCharge(id: string, fromMonth: string, amount: string, actor: AuditActor): Promise<string> {
  const c = await getCharge(id);
  if (!c) throw new Error("Charge introuvable.");
  if (c.recurrence !== "MENSUELLE") throw new Error("Seule une charge mensuelle se révise ; modifiez directement une charge ponctuelle.");
  const from = firstOfMonth(fromMonth);
  if (!from) throw new Error("Mois de révision invalide (AAAA-MM).");
  if (from <= c.startMonth) throw new Error("La révision doit partir d'un mois postérieur au début de la charge ; sinon, modifiez-la.");
  if (c.endMonth && from > c.endMonth) throw new Error("La charge est déjà close avant ce mois.");
  if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) throw new Error("Montant invalide.");
  return db.transaction(async (tx) => {
    await tx.update(pnlCharges).set({ endMonth: previousMonth(from), updatedAt: new Date() }).where(eq(pnlCharges.id, id));
    const [row] = await tx.insert(pnlCharges).values({
      categoryKey: c.categoryKey, label: c.label, amount, recurrence: "MENSUELLE", startMonth: from, endMonth: c.endMonth, brandId: c.brandId, notes: c.notes, createdById: actor.id,
    }).returning({ id: pnlCharges.id });
    await audit({ actor, action: "PNL_CHARGE_REVISE", module: "administration", entity: "pnl_charge", entityId: row.id, label: c.label, before: { id, amount: c.amount }, after: { from, amount } }, tx);
    return row.id;
  });
}

/** Arrête une charge mensuelle à un mois (inclus). */
export async function stopCharge(id: string, lastMonth: string, actor: AuditActor) {
  const c = await getCharge(id);
  if (!c) throw new Error("Charge introuvable.");
  const end = firstOfMonth(lastMonth);
  if (!end || end < c.startMonth) throw new Error("Mois de fin invalide.");
  await db.transaction(async (tx) => {
    await tx.update(pnlCharges).set({ endMonth: end, updatedAt: new Date() }).where(eq(pnlCharges.id, id));
    await audit({ actor, action: "PNL_CHARGE_STOP", module: "administration", entity: "pnl_charge", entityId: id, label: c.label, before: { endMonth: c.endMonth }, after: { endMonth: end } }, tx);
  });
}

export async function deleteCharge(id: string, actor: AuditActor) {
  const c = await getCharge(id);
  if (!c) return;
  await db.transaction(async (tx) => {
    await tx.delete(pnlCharges).where(eq(pnlCharges.id, id));
    await audit({ actor, action: "PNL_CHARGE_DELETE", module: "administration", entity: "pnl_charge", entityId: id, label: c.label, before: c }, tx);
  });
}

/* ------------------------------------------------------------ ventes en bloc */

export type BulkRow = {
  id: string; date: string; brandId: string; brandName: string; brandColor: string; clientId: string | null; clientName: string | null;
  label: string; quantity: number | null; amountHt: number; costAmount: number | null; discountPct: number | null; notes: string | null;
};

export async function listBulkSales(year: number): Promise<BulkRow[]> {
  const r = await db.execute<{ id: string; date: string; brand_id: string; brand_name: string; brand_color: string; client_id: string | null; client_name: string | null; label: string; quantity: number | null; amount_ht: number; cost_amount: number | null; discount_pct: number | null; notes: string | null }>(sql`
    select bs.id, bs.date::text, bs.brand_id, b.name as brand_name, b.color as brand_color, bs.client_id, c.name as client_name, bs.label,
      bs.quantity::float8 as quantity, bs.amount_ht::float8 as amount_ht, bs.cost_amount::float8 as cost_amount, bs.discount_pct::float8 as discount_pct, bs.notes
    from pnl_bulk_sales bs join brands b on b.id = bs.brand_id left join clients c on c.id = bs.client_id
    where bs.date >= ${`${year}-01-01`}::date and bs.date < ${`${year + 1}-01-01`}::date
    order by bs.date desc`);
  return r.rows.map((x) => ({
    id: x.id, date: x.date, brandId: x.brand_id, brandName: x.brand_name, brandColor: x.brand_color, clientId: x.client_id, clientName: x.client_name, label: x.label,
    quantity: x.quantity === null ? null : Number(x.quantity), amountHt: Number(x.amount_ht), costAmount: x.cost_amount === null ? null : Number(x.cost_amount),
    discountPct: x.discount_pct === null ? null : Number(x.discount_pct), notes: x.notes,
  }));
}

export async function getBulkSale(id: string) {
  const [b] = await db.select().from(pnlBulkSales).where(eq(pnlBulkSales.id, id));
  return b ?? null;
}

export type BulkInputForm = {
  date: string; brandId: string; clientId: string | null; label: string; quantity: string | null; amountHt: string; costAmount: string | null; discountPct: string | null; notes: string | null;
};

const DEC2 = /^-?\d+(\.\d{1,2})?$/;
function checkBulk(i: BulkInputForm) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new Error("Date invalide.");
  if (!i.brandId) throw new Error("La marque est obligatoire.");
  if (!DEC2.test(i.amountHt)) throw new Error("Montant HT facturé invalide.");
  if (i.costAmount !== null && !DEC2.test(i.costAmount)) throw new Error("Coût d'achat invalide.");
  if (i.discountPct !== null && (!DEC2.test(i.discountPct) || Number(i.discountPct) < 0 || Number(i.discountPct) > 100)) throw new Error("Remise : entre 0 et 100 %.");
  if (i.quantity !== null && !/^\d+(\.\d{1,3})?$/.test(i.quantity)) throw new Error("Quantité invalide.");
  return { ...i, label: i.label.trim() || "Vente en bloc" };
}

export async function createBulkSale(i: BulkInputForm, actor: AuditActor): Promise<string> {
  const v = checkBulk(i);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(pnlBulkSales).values({ ...v, createdById: actor.id }).returning({ id: pnlBulkSales.id });
    await audit({ actor, action: "PNL_BULK_CREATE", module: "administration", entity: "pnl_bulk_sale", entityId: row.id, label: v.label, after: v }, tx);
    return row.id;
  });
}

export async function updateBulkSale(id: string, i: BulkInputForm, actor: AuditActor) {
  const v = checkBulk(i);
  const before = await getBulkSale(id);
  if (!before) throw new Error("Vente introuvable.");
  await db.transaction(async (tx) => {
    await tx.update(pnlBulkSales).set({ ...v, updatedAt: new Date() }).where(eq(pnlBulkSales.id, id));
    const diff = changedFields(before as unknown as Record<string, unknown>, v as unknown as Record<string, unknown>);
    if (diff) await audit({ actor, action: "PNL_BULK_UPDATE", module: "administration", entity: "pnl_bulk_sale", entityId: id, label: v.label, before: diff.before, after: diff.after }, tx);
  });
}

export async function deleteBulkSale(id: string, actor: AuditActor) {
  const b = await getBulkSale(id);
  if (!b) return;
  await db.transaction(async (tx) => {
    await tx.delete(pnlBulkSales).where(eq(pnlBulkSales.id, id));
    await audit({ actor, action: "PNL_BULK_DELETE", module: "administration", entity: "pnl_bulk_sale", entityId: id, label: b.label, before: b }, tx);
  });
}

/** Clients proposés pour une vente en bloc : grossistes / distributeurs en tête. */
export async function distributorClients() {
  const r = await db.execute<{ id: string; name: string }>(sql`
    select id, name from clients where name ilike any (array['%cospharma%', '%pharmafirst%']) or type::text = 'GROSSISTE' order by name limit 50`);
  return r.rows;
}

/* ------------------------------------------------------------------ règles */

export async function savePnlRules(rules: PnlSettings, actor: AuditActor) {
  const s = await getSettings();
  const before = s.pnl;
  await saveSettings({ ...s, pnl: rules });
  await audit({ actor, action: "PNL_RULES_UPDATE", module: "administration", entity: "settings", entityId: null, label: "Règles du P&L", before: before, after: rules });
}
