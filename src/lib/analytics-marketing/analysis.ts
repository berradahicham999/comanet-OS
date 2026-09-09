/**
 * Analyses transverses — logique PURE (testée sans base) : classification d'investissement
 * d'une marque, mix de canaux comparé au portefeuille, classement des couples marque × canal.
 */
import type { AnalyticsSettings } from "@/lib/settings";
import type { Aggregate } from "./metrics";
import { ratio, type ResultKey } from "./shared";

export type InvestmentClass = "SUR_INVESTI" | "SOUS_INVESTI" | "ALIGNE" | "NON_CLASSABLE";
export const INVESTMENT_LABELS: Record<InvestmentClass, { label: string; tone: "red" | "orange" | "green" | "gray" }> = {
  SUR_INVESTI: { label: "sur-investie", tone: "orange" },
  SOUS_INVESTI: { label: "sous-investie", tone: "red" },
  ALIGNE: { label: "alignée", tone: "green" },
  NON_CLASSABLE: { label: "non classable", tone: "gray" },
};

/** Part du budget − part du CA (points) → classe, selon le seuil de Paramètres. */
export function classifyInvestment(spendShare: number | null, salesShare: number | null, thresholdPts: number): { cls: InvestmentClass; balancePts: number | null } {
  if (spendShare === null || salesShare === null) return { cls: "NON_CLASSABLE", balancePts: null };
  const d = (spendShare - salesShare) * 100;
  return { cls: d > thresholdPts ? "SUR_INVESTI" : d < -thresholdPts ? "SOUS_INVESTI" : "ALIGNE", balancePts: d };
}

export type MixRow = { key: string; share: number; portfolioShare: number | null; deltaPts: number | null; spent: number };

/** Répartition des dépenses d'une entité par canal, comparée à celle du portefeuille (points d'écart). */
export function channelMix(entity: { key: string; spent: number }[], portfolio: { key: string; spent: number }[]): MixRow[] {
  const total = entity.reduce((s, r) => s + r.spent, 0);
  const pTotal = portfolio.reduce((s, r) => s + r.spent, 0);
  const pMap = new Map(portfolio.map((r) => [r.key, r.spent]));
  return entity
    .filter((r) => r.spent > 0)
    .map((r) => {
      const share = total > 0 ? r.spent / total : 0;
      const portfolioShare = pTotal > 0 ? (pMap.get(r.key) ?? 0) / pTotal : null;
      return { key: r.key, share, portfolioShare, deltaPts: portfolioShare === null ? null : (share - portfolioShare) * 100, spent: r.spent };
    })
    .sort((a, b) => b.spent - a.spent);
}

export type PairScore = { brandId: string; channelKey: string; spent: number; costPerResult: number | null; resultKey: ResultKey | null; /** Coût rapporté à la médiane du canal (1 = médiane). */ relative: number | null };

/**
 * Classe les couples marque × canal par coût par résultat relatif à la médiane du canal :
 * comparable entre canaux qui ne mesurent pas la même chose. Ne retient que les couples
 * dont la dépense atteint le seuil d'analyse et dont le résultat propre est mesuré.
 */
export function rankPairs(pairs: { brandId: string; channelKey: string; agg: Aggregate; resultMetric: ResultKey | null; fallback: ResultKey | null }[], settings: AnalyticsSettings): { best: PairScore | null; worst: PairScore | null; all: PairScore[] } {
  const scored: PairScore[] = pairs.map((p) => {
    const key = p.resultMetric && (p.agg.results[p.resultMetric] ?? 0) > 0 ? p.resultMetric : p.fallback && (p.agg.results[p.fallback] ?? 0) > 0 ? p.fallback : null;
    const cpr = key ? ratio(p.agg.spend.spent, p.agg.results[key]) : null;
    return { brandId: p.brandId, channelKey: p.channelKey, spent: p.agg.spend.spent, costPerResult: cpr, resultKey: key, relative: null };
  });
  const byChannel = new Map<string, number[]>();
  for (const s of scored) if (s.costPerResult !== null && s.spent >= settings.channelDiagnosis.minSpend) byChannel.set(s.channelKey, [...(byChannel.get(s.channelKey) ?? []), s.costPerResult]);
  const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const medians = new Map([...byChannel].map(([k, xs]) => [k, median(xs)]));
  for (const s of scored) {
    const med = medians.get(s.channelKey);
    const members = byChannel.get(s.channelKey)?.length ?? 0;
    s.relative = s.costPerResult !== null && med !== undefined && med > 0 && members >= 2 && s.spent >= settings.channelDiagnosis.minSpend ? s.costPerResult / med : null;
  }
  const eligible = scored.filter((s) => s.relative !== null);
  const sorted = [...eligible].sort((a, b) => (a.relative as number) - (b.relative as number));
  return { best: sorted[0] ?? null, worst: sorted.length > 1 ? sorted[sorted.length - 1] : null, all: scored };
}
