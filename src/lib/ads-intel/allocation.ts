/**
 * « Où mettre mon argent ? » — matrice par marque : dépense, performance vs son propre
 * historique, tendance, opportunité. Une marque sans référence est « inconnue », pas « moyenne ».
 */
import type { AdsIntelSettings, AdThresholds } from "@/lib/settings";
import type { MonthRow } from "./data";
import { historicalRef } from "./benchmark";
import { clamp, pct } from "./metrics";
import type { BrandAllocation, EntityPerf, Trend } from "./types";

export function allocationOf(
  brands: EntityPerf[],
  prevBrands: EntityPerf[],
  historyByBrand: Map<string, MonthRow[]>,
  trends: Map<string, Trend>,
  s: AdsIntelSettings,
  t: AdThresholds,
): BrandAllocation[] {
  const total = brands.reduce((a, b) => a + b.spend, 0);
  const prev = new Map(prevBrands.map((b) => [b.key, b]));
  return brands.map((b) => {
    const hist = historicalRef("Historique", historyByBrand.get(b.key) ?? [], b.resultKind);
    const p = prev.get(b.key) ?? null;
    const vsHist = pct(b.costPerResult, hist.costPerResult);
    const vsPrev = pct(b.costPerResult, p && p.resultKind === b.resultKind ? p.costPerResult : null);
    const ref = vsHist ?? vsPrev;
    const trend = trends.get(b.key) ?? { direction: "unknown", pct: null, points: 0 };
    let performance: BrandAllocation["performance"] = "UNKNOWN";
    let why = "Aucune référence historique";
    if (b.spend < t.minSpend || b.days < t.minDays) { why = `Sous le seuil d'analyse (${t.minSpend} MAD, ${t.minDays} j)`; }
    else if (b.results === 0) { performance = "WEAK"; why = "Aucun résultat mesuré"; }
    else if (ref !== null) {
      performance = ref <= -25 ? "EXCELLENT" : ref <= -8 ? "STRONG" : ref < 15 ? "AVERAGE" : "WEAK";
      why = `Coût par résultat ${ref > 0 ? "+" : ""}${Math.round(ref)} % vs ${vsHist !== null ? "historique" : "période précédente"}`;
    }
    let opportunity: BrandAllocation["opportunity"] = "INSUFFICIENT";
    if (performance !== "UNKNOWN" && b.spend >= t.minSpend) {
      if ((performance === "EXCELLENT" || performance === "STRONG") && trend.direction !== "up") opportunity = "SCALE";
      else if (performance === "WEAK" && (trend.direction === "up" || b.results === 0)) opportunity = "REVIEW";
      else if (performance === "WEAK" || (performance === "AVERAGE" && trend.direction === "up")) opportunity = "OPTIMIZE";
      else opportunity = "MAINTAIN";
    }
    const confidence = Math.round(clamp(clamp(b.spend / (s.winnerMinSpend * 3), 0, 1) * 50 + clamp(b.days / 14, 0, 1) * 25 + (ref !== null ? 25 : 0), 0, 100));
    return {
      brandId: b.brandId, brandName: b.campaignName, brandColor: b.brandColor, spend: b.spend,
      sharePct: total > 0 ? (b.spend / total) * 100 : 0, resultKind: b.resultKind, results: b.results, costPerResult: b.costPerResult,
      performance, performanceWhy: why, trend, opportunity, confidence,
    };
  });
}
