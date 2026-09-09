/**
 * Bloc « Analytics marketing » de l'Executive Cockpit : les 30 derniers jours de ventes,
 * dépense, ROI mesuré (avec sa complétude), meilleur et pire couple marque × canal, nombre
 * de réallocations proposées et complétude des données.
 */
import "server-only";
import { iso, addDays } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { aggregate, aggregateBy, listChannels } from "./queries";
import { compute } from "./metrics";
import { rankPairs } from "./analysis";
import { channelVerdicts, reallocationsFrom } from "./decision";
import { dataCompleteness } from "./quality";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export type AnalyticsCockpit = {
  spend: number | null;
  roi: number | null; roiCoverage: number; roiReason: string;
  best: string | null; worst: string | null;
  reallocations: number;
  completeness: number | null;
};

export async function analyticsBlock(ref: Date, year: number): Promise<AnalyticsCockpit> {
  const range = { start: iso(addDays(ref, -29)), end: iso(addDays(ref, 1)) };
  const prev = { start: iso(addDays(ref, -59)), end: range.start };
  const settings = await getSettings();
  const [total, pairs, channels, brands, verdicts, completeness] = await Promise.all([
    aggregate({ range, prev, budgetYear: year }),
    aggregateBy("brand_channel", { range }),
    listChannels(),
    db.execute<{ id: string; name: string }>(sql`select id::text as id, name from brands where active and merged_into_id is null`),
    channelVerdicts({ range, prev, brandIds: null, ref, settings }),
    dataCompleteness(),
  ]);
  const mctx = { settings: settings.analytics };
  const spend = compute("SPEND_SPENT", total, mctx);
  const roi = compute("ROI_MEASURED", total, mctx);
  const labelOf = (brandId: string, channelKey: string) => `${brands.rows.find((b) => b.id === brandId)?.name ?? "?"} × ${channels.find((c) => c.key === channelKey)?.label ?? channelKey}`;
  const ranking = rankPairs(pairs.map((p) => { const [brandId, channelKey] = p.key.split("|"); const c = channels.find((x) => x.key === channelKey); return { brandId, channelKey, agg: p.aggregate, resultMetric: c?.resultMetric ?? null, fallback: c?.fallbackResultMetric ?? null }; }), settings.analytics);
  const reallocations = reallocationsFrom(verdicts, settings, { brand: (id) => brands.rows.find((b) => b.id === id)?.name ?? "?", channel: (k) => channels.find((c) => c.key === k)?.label ?? k });
  return {
    spend: spend.ok ? spend.value : null,
    roi: roi.ok ? roi.value : null,
    roiCoverage: roi.ok ? roi.completeness ?? 0 : 0,
    roiReason: roi.ok ? "" : roi.reason,
    best: ranking.best ? labelOf(ranking.best.brandId, ranking.best.channelKey) : null,
    worst: ranking.worst ? labelOf(ranking.worst.brandId, ranking.worst.channelKey) : null,
    reallocations: reallocations.length,
    completeness,
  };
}
