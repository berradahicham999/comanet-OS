/**
 * Contexte commun des pages d'analyse : période résolue (avec période précédente et N-1),
 * portée des marques (droits), filtres d'URL, référentiels.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { brandFilter } from "@/lib/access";
import { getRefDate } from "@/lib/ref-date";
import { listBrands } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import { resolvePeriod, type PeriodParam, type ResolvedPeriod } from "@/lib/periods";
import { listChannels, listMetricDefinitions, type ChannelRef, type Filter, type MetricDef } from "./queries";
import { dataCompleteness } from "./quality";
import { normalizeCity } from "@/lib/animations-shared";

export type SearchParams = { period?: string; brand?: string; channel?: string; city?: string; product?: string };

export type PageContext = {
  period: ResolvedPeriod;
  periodKey: PeriodParam;
  ref: Date;
  staleDays: number;
  brands: { id: string; name: string; color: string }[];
  brandId: string | null;
  channelKey: string | null;
  city: string | null;
  channels: ChannelRef[];
  cities: string[];
  metrics: Map<string, MetricDef>;
  settings: Awaited<ReturnType<typeof getSettings>>;
  completeness: number | null;
  /** Filtre prêt pour `aggregate*()`. */
  filter: Filter;
  /** Même filtre sur la période précédente. */
  prevFilter: Filter;
};

export async function pageContext(sp: SearchParams): Promise<PageContext> {
  const [{ ref, staleDays }, scope, allBrands, channels, defs, settings, completeness, cityRows] = await Promise.all([
    getRefDate(), brandFilter(), listBrands(), listChannels(), listMetricDefinitions(), getSettings(), dataCompleteness(),
    db.execute<{ city: string }>(sql`select distinct initcap(city) as city from (select city from fact_marketing_spend where city is not null union select city from clients where city is not null) x order by 1 limit 60`),
  ]);
  const brands = allBrands.filter((b) => b.active && !b.mergedIntoId && (scope === null || scope.includes(b.id))).map((b) => ({ id: b.id, name: b.name, color: b.color }));
  const periodKey = (["month", "prevMonth", "quarter", "ytd", "year", "last30", "last90", "last12m"].includes(sp.period ?? "") ? sp.period : "month") as PeriodParam;
  const period = resolvePeriod(periodKey, ref);
  const brandId = sp.brand && brands.some((b) => b.id === sp.brand) ? sp.brand : null;
  const channelKey = sp.channel && channels.some((c) => c.key === sp.channel) ? sp.channel : null;
  const city = sp.city?.trim() || null;
  const brandIds = brandId ? [brandId] : scope;
  const base = { brandIds, channelKeys: channelKey ? [channelKey] : null, city };
  return {
    period, periodKey, ref, staleDays, brands, brandId, channelKey, city, channels,
    cities: [...new Set(cityRows.rows.map((r) => normalizeCity(r.city)).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "fr")), metrics: new Map(defs.map((d) => [d.key, d])), settings, completeness,
    filter: { ...base, range: { start: period.start, end: period.end }, prev: period.prev, n1: period.n1 },
    prevFilter: { ...base, range: period.prev, prev: null, n1: null },
  };
}

/** Conserve les filtres courants dans un lien. */
export function withFilters(href: string, ctx: Pick<PageContext, "periodKey" | "brandId" | "channelKey" | "city">, extra: Record<string, string | null | undefined> = {}) {
  const p = new URLSearchParams();
  const all: Record<string, string | null | undefined> = { period: ctx.periodKey, brand: ctx.brandId, channel: ctx.channelKey, city: ctx.city, ...extra };
  for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
  const q = p.toString();
  return q ? `${href}?${q}` : href;
}
