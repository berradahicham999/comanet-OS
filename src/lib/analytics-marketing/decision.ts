/**
 * Décision : verdicts canal × marque et réallocations sur une période — point d'entrée unique
 * pour la page Par canal, les règles Action Center, le cockpit et la revue mensuelle.
 * Les calculs eux-mêmes sont dans `diagnosis.ts` et `reallocation.ts` (purs, testés).
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSettings, type ComanetSettings } from "@/lib/settings";
import { productStocks } from "@/lib/stock";
import { isUnderTension } from "@/lib/stock-math";
import { pgArray } from "@/lib/sql-array";
import { aggregateBy, listChannels, pairKey, type ChannelRef, type Range } from "./queries";
import { diagnoseChannel, type ChannelVerdict } from "./diagnosis";
import { proposeReallocations, type Reallocation } from "./reallocation";
import type { Aggregate } from "./metrics";
import { ratio, type ResultKey } from "./shared";
export { isDegrading } from "./decision-shared";

export type PairVerdict = {
  brandId: string; channelKey: string; channel: ChannelRef;
  agg: Aggregate; prev: Aggregate | null;
  verdict: ChannelVerdict;
  stockTension: string[];
};

export type DecisionScope = { range: Range; prev: Range; brandIds: string[] | null; ref: Date; settings?: ComanetSettings };

/** Verdict de chaque couple marque × canal ayant une dépense ou un résultat sur la période. */
export async function channelVerdicts(scope: DecisionScope): Promise<PairVerdict[]> {
  const settings = scope.settings ?? (await getSettings());
  const base = { brandIds: scope.brandIds, channelKeys: null, city: null };
  const [channels, pairs, prevPairs, portfolio, stocks, pushed] = await Promise.all([
    listChannels(),
    aggregateBy("brand_channel", { ...base, range: scope.range }),
    aggregateBy("brand_channel", { ...base, range: scope.prev }),
    aggregateBy("channel", { range: scope.range }),
    productStocks({}, scope.ref),
    db.execute<{ k: string; product_ids: string[] }>(sql`
      select brand_id::text || '|' || channel_key as k, array_agg(distinct product_id::text) as product_ids
      from fact_marketing_spend where product_id is not null and day >= ${scope.range.start}::date and day < ${scope.range.end}::date
      ${scope.brandIds?.length ? sql`and brand_id = any(${pgArray(scope.brandIds)})` : sql``} group by 1`),
  ]);
  const tension = new Set(stocks.filter((s) => isUnderTension(s, settings)).map((s) => s.productId));
  const pushedMap = new Map(pushed.rows.map((r) => [r.k, r.product_ids]));
  const days = Math.max(1, Math.round((new Date(scope.range.end + "T12:00:00Z").getTime() - new Date(scope.range.start + "T12:00:00Z").getTime()) / 86_400_000));
  const out: PairVerdict[] = [];
  for (const p of pairs) {
    const [brandId, channelKey] = p.key.split("|");
    const channel = channels.find((c) => c.key === channelKey);
    if (!channel) continue;
    const prev = prevPairs.find((x) => x.key === p.key)?.aggregate ?? null;
    const stockTension = (pushedMap.get(pairKey(brandId, channelKey)) ?? []).filter((id) => tension.has(id));
    const verdict = diagnoseChannel({ cur: p.aggregate, prev, portfolio: portfolio.find((x) => x.key === channelKey)?.aggregate ?? null, channel: { key: channel.key, family: channel.family, resultMetric: channel.resultMetric, fallbackResultMetric: channel.fallbackResultMetric }, days, stockTension }, settings.analytics, settings.ads);
    out.push({ brandId, channelKey, channel, agg: p.aggregate, prev, verdict, stockTension });
  }
  return out;
}

/** Réallocations proposées à partir des verdicts. */
export function reallocationsFrom(verdicts: PairVerdict[], settings: ComanetSettings, labels: { brand: (id: string) => string; channel: (key: string) => string }): Reallocation[] {
  return proposeReallocations(verdicts.map((v) => ({ brandId: v.brandId, channelKey: v.channelKey, spent: v.agg.spend.spent, measurableRows: v.agg.spend.measurableRows, rows: v.agg.spend.rows, hasPrev: !!v.prev && v.prev.spend.rows > 0, verdict: v.verdict })), settings.analytics, labels);
}

export type WeeklyPoint = { brandId: string; channelKey: string; week: string; spent: number; result: number | null; costPerResult: number | null };

/**
 * Coût par résultat hebdomadaire par couple marque × canal sur les N dernières semaines ISO closes
 * (la semaine en cours est exclue). Sert à détecter une dégradation sur plusieurs semaines.
 */
export async function weeklyCostPerResult(weeks: number, ref: Date, brandIds: string[] | null): Promise<WeeklyPoint[]> {
  const channels = await listChannels();
  const rows = await db.execute<{ brand_id: string; channel_key: string; week: string; spent: number; results: Record<string, number> | null }>(sql`
    with w as (select iso_week, min(day) as start from dim_period where day < date_trunc('week', ${ref.toISOString().slice(0, 10)}::date) group by iso_week order by start desc limit ${weeks}),
    sp as (select s.brand_id, s.channel_key, d.iso_week as week, sum(s.spent)::float8 as spent
           from fact_marketing_spend s join dim_period d on d.day = s.day join w on w.iso_week = d.iso_week
           where s.is_partial = false ${brandIds?.length ? sql`and s.brand_id = any(${pgArray(brandIds)})` : sql``} group by 1, 2, 3),
    rs as (select r.brand_id, r.channel_key, d.iso_week as week, jsonb_object_agg(r.result_key, r.v) as results
           from (select brand_id, channel_key, day, result_key, sum(value)::float8 as v from fact_marketing_result where is_partial = false group by 1, 2, 3, 4) r
           join dim_period d on d.day = r.day join w on w.iso_week = d.iso_week group by 1, 2, 3)
    select coalesce(sp.brand_id, rs.brand_id)::text as brand_id, coalesce(sp.channel_key, rs.channel_key) as channel_key, coalesce(sp.week, rs.week) as week, coalesce(sp.spent, 0) as spent, rs.results
    from sp full join rs on rs.brand_id = sp.brand_id and rs.channel_key = sp.channel_key and rs.week = sp.week
    order by 1, 2, 3`);
  return rows.rows.map((r) => {
    const c = channels.find((x) => x.key === r.channel_key);
    const res = r.results ?? {};
    const key = (c?.resultMetric && (res[c.resultMetric] ?? 0) > 0 ? c.resultMetric : c?.fallbackResultMetric && (res[c.fallbackResultMetric] ?? 0) > 0 ? c.fallbackResultMetric : null) as ResultKey | null;
    const result = key ? res[key] : null;
    return { brandId: r.brand_id, channelKey: r.channel_key, week: r.week, spent: Number(r.spent), result, costPerResult: r.spent > 0 && result ? ratio(Number(r.spent), result) : null };
  });
}
