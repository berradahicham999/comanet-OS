/**
 * Lecture de la couche de faits — agrégats par axe (marque, canal, produit, ville, mois).
 *
 * Toutes les pages d'analyse passent par ici : un `Aggregate` par périmètre, puis les formules
 * de `metrics.ts`. Aucune métrique n'est recalculée dans une page. Les dépenses excluent les
 * journées de régie non closes ; les montants NULL (non mesurables) ne comptent jamais pour 0,
 * ils sont comptés dans `unmeasuredRows` et abaissent la complétude affichée.
 */
import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { pgArray } from "@/lib/sql-array";
import { budgetConsumption } from "@/lib/budget";
import { RESULT_KEYS, type ResultKey } from "./shared";
import { EMPTY_AGGREGATE, type Aggregate } from "./metrics";

export type Range = { start: string; end: string };
export type Filter = {
  range: Range;
  /** Comparaisons (facultatives) : période précédente et même période N-1. */
  prev?: Range | null;
  n1?: Range | null;
  brandIds?: string[] | null;
  channelKeys?: string[] | null;
  productIds?: string[] | null;
  city?: string | null;
  campaignId?: string | null;
  /** Année de l'enveloppe budgétaire (défaut : année du début de période). */
  budgetYear?: number;
};

export type Dimension = "brand" | "channel" | "product" | "city" | "month" | "family" | "brand_channel";
/** Clé composite « marque|canal » de la dimension `brand_channel`. */
export const pairKey = (brandId: string, channelKey: string) => `${brandId}|${channelKey}`;

const cond = (parts: SQL[]) => (parts.length ? sql.join(parts, sql` and `) : sql`true`);

function spendWhere(f: Filter, range: Range = f.range): SQL {
  const p: SQL[] = [sql`s.day >= ${range.start}::date`, sql`s.day < ${range.end}::date`, sql`s.is_partial = false`];
  if (f.brandIds?.length) p.push(sql`s.brand_id = any(${pgArray(f.brandIds)})`);
  if (f.channelKeys?.length) p.push(sql`s.channel_key = any(${pgArray(f.channelKeys, "text")})`);
  if (f.productIds?.length) p.push(sql`s.product_id = any(${pgArray(f.productIds)})`);
  if (f.city) p.push(sql`lower(s.city) = lower(${f.city})`);
  if (f.campaignId) p.push(sql`s.campaign_id = ${f.campaignId}::uuid`);
  return cond(p);
}

/** Les ventes n'ont ni canal ni campagne : ces filtres sont ignorés (les pages l'affichent). */
function salesWhere(f: Filter, range: Range = f.range): SQL {
  const p: SQL[] = [sql`v.day >= ${range.start}::date`, sql`v.day < ${range.end}::date`];
  if (f.brandIds?.length) p.push(sql`v.brand_id = any(${pgArray(f.brandIds)})`);
  if (f.productIds?.length) p.push(sql`v.product_id = any(${pgArray(f.productIds)})`);
  if (f.city) p.push(sql`lower(v.city) = lower(${f.city})`);
  return cond(p);
}

const dimKey = (d: Dimension, alias: string): SQL => {
  switch (d) {
    case "brand": return sql`${sql.raw(alias)}.brand_id::text`;
    case "channel": return sql`${sql.raw(alias)}.channel_key`;
    case "family": return sql`(select c.family from dim_channel c where c.key = ${sql.raw(alias)}.channel_key)`;
    case "product": return sql`coalesce(${sql.raw(alias)}.product_id::text, '')`;
    case "city": return sql`coalesce(lower(${sql.raw(alias)}.city), '')`;
    case "month": return sql`to_char(${sql.raw(alias)}.day, 'YYYY-MM')`;
    case "brand_channel": return sql`${sql.raw(alias)}.brand_id::text || '|' || ${sql.raw(alias)}.channel_key`;
  }
};
/** Dimensions qui existent aussi sur les ventes. */
const salesDim = (d: Dimension): SQL | null => (d === "channel" || d === "family" || d === "brand_channel" ? null : dimKey(d, "v"));

type SpendAgg = { k: string; planned: number; committed: number; spent: number; rows: number; measurable: number; attr_spend: number; attr_revenue: number; sources: string[] };
type ResultAgg = { k: string; result_key: string; value: number };
type SalesAgg = { k: string; sell_in: number; sell_in_units: number; sell_out: number; sell_out_units: number; margin: number | null; margin_base: number; rows: number };

async function spendBy(f: Filter, dim: Dimension | null, range?: Range): Promise<SpendAgg[]> {
  const k = dim ? dimKey(dim, "s") : sql`''`;
  const r = await db.execute<SpendAgg>(sql`
    select ${k} as k,
           coalesce(sum(s.planned), 0)::float8 as planned,
           coalesce(sum(s.committed), 0)::float8 as committed,
           coalesce(sum(s.spent), 0)::float8 as spent,
           count(*)::int as rows,
           count(*) filter (where s.spent is not null or s.committed is not null or s.planned is not null)::int as measurable,
           coalesce(sum(s.spent) filter (where s.attribution_mode = 'MEASURED'), 0)::float8 as attr_spend,
           coalesce(sum(s.attributed_revenue), 0)::float8 as attr_revenue,
           array_agg(distinct s.source_kind) as sources
    from fact_marketing_spend s where ${spendWhere(f, range)} group by 1`);
  return r.rows;
}

async function resultsBy(f: Filter, dim: Dimension | null): Promise<ResultAgg[]> {
  const k = dim ? dimKey(dim, "s") : sql`''`;
  const r = await db.execute<ResultAgg>(sql`
    select ${k} as k, s.result_key, coalesce(sum(s.value), 0)::float8 as value
    from fact_marketing_result s where ${spendWhere(f)} group by 1, 2`);
  return r.rows;
}

async function salesBy(f: Filter, dim: Dimension | null, range?: Range): Promise<SalesAgg[]> {
  const k = dim ? salesDim(dim) : sql`''`;
  if (dim && !k) return [];
  const r = await db.execute<SalesAgg>(sql`
    select ${k ?? sql`''`} as k,
           coalesce(sum(v.amount) filter (where v.kind = 'SELL_IN'), 0)::float8 as sell_in,
           coalesce(sum(v.quantity) filter (where v.kind = 'SELL_IN'), 0)::float8 as sell_in_units,
           coalesce(sum(v.amount) filter (where v.kind = 'SELL_OUT'), 0)::float8 as sell_out,
           coalesce(sum(v.quantity) filter (where v.kind = 'SELL_OUT'), 0)::float8 as sell_out_units,
           sum(v.margin) filter (where v.kind = 'SELL_IN')::float8 as margin,
           coalesce(sum(v.amount) filter (where v.kind = 'SELL_IN' and v.margin is not null), 0)::float8 as margin_base,
           count(*) filter (where v.kind = 'SELL_IN')::int as rows
    from fact_sales v where ${salesWhere(f, range)} group by 1`);
  return r.rows;
}

/** Objectif de vente proratisé sur la période : lignes mensuelles si elles existent, sinon annuel au prorata des jours. */
async function objectiveFor(range: Range, brandIds: string[] | null | undefined): Promise<Map<string, number>> {
  const scope = brandIds?.length ? sql`o.brand_id = any(${pgArray(brandIds)})` : sql`o.brand_id is not null`;
  const r = await db.execute<{ brand_id: string; amount: number }>(sql`
    with days as (select d.day, d.year, extract(month from d.day)::int as m, (select count(*) from dim_period x where x.month = d.month)::int as days_in_month from dim_period d where d.day >= ${range.start}::date and d.day < ${range.end}::date)
    select o.brand_id::text as brand_id,
           sum(case when o.month is not null then o.amount / days.days_in_month else o.amount / (case when (o.year % 4 = 0 and o.year % 100 <> 0) or o.year % 400 = 0 then 366 else 365 end) end)::float8 as amount
    from objectives o join days on days.year = o.year and (o.month is null or o.month = days.m)
    where o.product_id is null and ${scope}
      and not (o.month is null and exists (select 1 from objectives m where m.brand_id = o.brand_id and m.year = o.year and m.product_id is null and m.month = days.m))
    group by 1`);
  return new Map(r.rows.map((x) => [x.brand_id, Number(x.amount)]));
}

function assemble(k: string, sp: SpendAgg | undefined, res: ResultAgg[], sa: SalesAgg | undefined, prev: SalesAgg | undefined, n1: SalesAgg | undefined, objective: number | null, budget: Aggregate["budget"], portfolio: Aggregate["portfolio"], hasPrevWindow: boolean, hasN1Window: boolean): Aggregate {
  const results: Partial<Record<ResultKey, number>> = {};
  for (const r of res) if ((RESULT_KEYS as readonly string[]).includes(r.result_key)) results[r.result_key as ResultKey] = Number(r.value);
  const marginBase = sa ? Number(sa.margin_base) : 0;
  return {
    spend: sp ? { planned: sp.planned, committed: sp.committed, spent: sp.spent, rows: sp.rows, measurableRows: sp.measurable, unmeasuredRows: sp.rows - sp.measurable } : EMPTY_AGGREGATE.spend,
    attributed: sp ? { spend: sp.attr_spend, revenue: sp.attr_revenue } : EMPTY_AGGREGATE.attributed,
    budget,
    sales: sa ? { sellIn: sa.sell_in, sellInUnits: sa.sell_in_units, sellOut: sa.sell_out, sellOutUnits: sa.sell_out_units, margin: sa.margin === null ? null : Number(sa.margin), marginCoverage: sa.sell_in > 0 ? marginBase / sa.sell_in : null, rows: sa.rows } : EMPTY_AGGREGATE.sales,
    compare: { sellInPrev: hasPrevWindow && prev && prev.rows > 0 ? prev.sell_in : null, sellInN1: hasN1Window && n1 && n1.rows > 0 ? n1.sell_in : null },
    objective,
    results,
    sources: sp?.sources ?? [],
    portfolio,
  };
}

/** Agrégat global du périmètre filtré. */
export async function aggregate(f: Filter): Promise<Aggregate> {
  const rows = await aggregateBy(null, f);
  return rows[0]?.aggregate ?? { ...EMPTY_AGGREGATE };
}

export type AggregateRow = { key: string; aggregate: Aggregate };

/**
 * Un agrégat par valeur de la dimension (clé vide : « sans produit » / « sans ville »).
 * `null` : un seul agrégat pour tout le périmètre.
 */
export async function aggregateBy(dim: Dimension | null, f: Filter): Promise<AggregateRow[]> {
  const year = f.budgetYear ?? Number(f.range.start.slice(0, 4));
  const [spend, results, sales, prev, n1, objectives, portfolioSpend, portfolioSales, budgetAll] = await Promise.all([
    spendBy(f, dim), resultsBy(f, dim), salesBy(f, dim),
    f.prev ? salesBy(f, dim, f.prev) : Promise.resolve([] as SalesAgg[]),
    f.n1 ? salesBy(f, dim, f.n1) : Promise.resolve([] as SalesAgg[]),
    objectiveFor(f.range, f.brandIds),
    spendBy({ range: f.range }, null), salesBy({ range: f.range }, null),
    budgetConsumption(year, f.brandIds?.length === 1 ? f.brandIds[0] : null),
  ]);
  const portfolio = { spend: portfolioSpend[0]?.spent ?? 0, sellIn: portfolioSales[0]?.sell_in ?? 0 };
  const keys = new Set<string>([...spend.map((x) => x.k), ...results.map((x) => x.k), ...sales.map((x) => x.k)]);
  if (!dim) keys.add("");
  const byRes = new Map<string, ResultAgg[]>();
  for (const r of results) byRes.set(r.k, [...(byRes.get(r.k) ?? []), r]);
  const budgetOf = async (k: string): Promise<Aggregate["budget"]> => {
    if (dim === "brand" && k) { const b = await budgetConsumption(year, k); return { annual: b.hasBudget ? b.annual : null, consumed: b.hasBudget ? b.consumed : null }; }
    if (dim === null) return { annual: budgetAll.hasBudget ? budgetAll.annual : null, consumed: budgetAll.hasBudget ? budgetAll.consumed : null };
    return { annual: null, consumed: null };
  };
  const objectiveOf = (k: string): number | null => {
    if (dim === "brand") return objectives.get(k) ?? null;
    if (dim === null) { const total = [...objectives.values()].reduce((s, v) => s + v, 0); return objectives.size ? total : null; }
    return null;
  };
  const out: AggregateRow[] = [];
  for (const k of keys) {
    out.push({
      key: k,
      aggregate: assemble(k, spend.find((x) => x.k === k), byRes.get(k) ?? [], sales.find((x) => x.k === k), prev.find((x) => x.k === k), n1.find((x) => x.k === k), objectiveOf(k), await budgetOf(k), portfolio, !!f.prev, !!f.n1),
    });
  }
  return out.sort((a, b) => b.aggregate.spend.spent - a.aggregate.spend.spent || b.aggregate.sales.sellIn - a.aggregate.sales.sellIn);
}

/* ------------------------------ Référentiels & fraîcheur ------------------------------ */

export type ChannelRef = { key: string; label: string; family: string; resultMetric: ResultKey | null; fallbackResultMetric: ResultKey | null; color: string; sort: number; active: boolean };
export async function listChannels(): Promise<ChannelRef[]> {
  const r = await db.execute<{ key: string; label: string; family: string; result_metric: string | null; fallback_result_metric: string | null; color: string; sort: number; active: boolean }>(sql`select * from dim_channel order by sort, label`);
  return r.rows.map((c) => ({ key: c.key, label: c.label, family: c.family, resultMetric: c.result_metric as ResultKey | null, fallbackResultMetric: c.fallback_result_metric as ResultKey | null, color: c.color, sort: c.sort, active: c.active }));
}

export type MetricDef = { key: string; label: string; description: string | null; formula: string; unit: string; direction: string; attribution: string; source: string; family: string; warnThreshold: number | null; alertThreshold: number | null; sort: number; active: boolean };
export async function listMetricDefinitions(): Promise<MetricDef[]> {
  const r = await db.execute<{ key: string; label: string; description: string | null; formula: string; unit: string; direction: string; attribution: string; source: string; family: string; warn_threshold: number | null; alert_threshold: number | null; sort: number; active: boolean }>(sql`select * from metrics_definitions order by sort, key`);
  return r.rows.map((m) => ({ ...m, warnThreshold: m.warn_threshold === null ? null : Number(m.warn_threshold), alertThreshold: m.alert_threshold === null ? null : Number(m.alert_threshold) }));
}

export type Freshness = { sourceKind: string; lastOk: string | null; lastError: string | null; lastAttempt: string | null; spendRows: number; resultRows: number; triggeredBy: string | null };
/** Dernier rafraîchissement réussi (et dernière erreur) par source. */
export async function freshness(): Promise<Freshness[]> {
  const r = await db.execute<{ source_kind: string; last_ok: string | null; last_error: string | null; last_attempt: string | null; spend_rows: number; result_rows: number; triggered_by: string | null }>(sql`
    select l.source_kind,
           max(l.finished_at) filter (where l.ok)::text as last_ok,
           (array_agg(l.error order by l.started_at desc) filter (where not l.ok and l.error is not null))[1] as last_error,
           max(l.started_at)::text as last_attempt,
           (array_agg(l.spend_rows order by l.started_at desc) filter (where l.ok))[1] as spend_rows,
           (array_agg(l.result_rows order by l.started_at desc) filter (where l.ok))[1] as result_rows,
           (array_agg(l.triggered_by order by l.started_at desc))[1] as triggered_by
    from analytics_refresh_log l group by 1 order by 1`);
  return r.rows.map((x) => ({ sourceKind: x.source_kind, lastOk: x.last_ok, lastError: x.last_error, lastAttempt: x.last_attempt, spendRows: x.spend_rows ?? 0, resultRows: x.result_rows ?? 0, triggeredBy: x.triggered_by }));
}

/* ------------------------------ Séries mensuelles ------------------------------ */

export type MonthPoint = { month: string; spent: number; measurableRows: number; rows: number; sellIn: number; sellOut: number; salesRows: number };

/** Dépense et ventes par mois sur N mois glissants (jusqu'à `endExclusive`), pour les tendances. */
export async function monthlySeries(f: Omit<Filter, "range" | "prev" | "n1">, endExclusive: string, months = 13): Promise<MonthPoint[]> {
  const end = new Date(endExclusive + "T12:00:00Z");
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 1));
  const range = { start: start.toISOString().slice(0, 10), end: endExclusive };
  const rows = await aggregateBy("month", { ...f, range });
  const out: MonthPoint[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const month = d.toISOString().slice(0, 7);
    const a = rows.find((r) => r.key === month)?.aggregate;
    out.push({ month, spent: a?.spend.spent ?? 0, measurableRows: a?.spend.measurableRows ?? 0, rows: a?.spend.rows ?? 0, sellIn: a?.sales.sellIn ?? 0, sellOut: a?.sales.sellOut ?? 0, salesRows: a?.sales.rows ?? 0 });
  }
  return out;
}
