/**
 * Ads Health : un score /100 qui résume performance vs historique, tendance, budget,
 * stabilité, volume, fatigue, anomalies et qualité des données. Chaque composante est
 * expliquée ; sans données, le score est gris, pas « 0/100 ».
 */
import type { Anomaly, BrandAllocation, BudgetStatus, EntityPerf, Fatigue, HealthScore, Recommendation, Trend } from "./types";
import { clamp } from "./metrics";

export function healthOf(input: {
  brands: BrandAllocation[];
  totalSpend: number;
  trend: Trend;
  budget: BudgetStatus;
  stability: number | null;
  winners: number;
  fatiguing: number;
  anomalies: Anomaly[];
  recs: Recommendation[];
  closedRows: number;
  minSpend: number;
  creatives: (EntityPerf & { fatigue: Fatigue })[];
}): HealthScore {
  if (input.totalSpend < input.minSpend) {
    return { score: 0, tone: "gray", why: ["Pas assez de dépense sur la période pour noter la santé du compte."], components: [] };
  }
  const c: HealthScore["components"] = [];
  const why: string[] = [];
  // Performance (30) : moyenne pondérée par la dépense de la performance de marque.
  const perfPts = { EXCELLENT: 30, STRONG: 24, AVERAGE: 15, WEAK: 5, UNKNOWN: 15 } as const;
  const spend = input.brands.reduce((a, b) => a + b.spend, 0) || 1;
  const perf = input.brands.reduce((a, b) => a + perfPts[b.performance] * b.spend, 0) / spend;
  c.push({ label: "Performance vs historique", score: Math.round(perf), max: 30, note: input.brands.map((b) => `${b.brandName} ${b.performance.toLowerCase()}`).join(", ") });
  const strong = input.brands.filter((b) => b.performance === "EXCELLENT" || b.performance === "STRONG");
  if (strong.length) why.push(`Coût par résultat sous l'historique pour ${strong.map((b) => b.brandName).join(", ")}`);
  const weak = input.brands.filter((b) => b.performance === "WEAK");
  if (weak.length) why.push(`${weak.map((b) => b.brandName).join(", ")} sous la référence`);
  // Tendance (15)
  const tr = input.trend.direction === "down" ? 15 : input.trend.direction === "flat" ? 11 : input.trend.direction === "up" ? 4 : 8;
  c.push({ label: "Tendance du coût par résultat", score: tr, max: 15, note: input.trend.pct === null ? "non mesurable" : `${input.trend.pct > 0 ? "+" : ""}${Math.round(input.trend.pct)} %` });
  if (input.trend.direction === "down") why.push(`Coût par résultat en baisse (${Math.round(input.trend.pct ?? 0)} %)`);
  if (input.trend.direction === "up") why.push(`Coût par résultat en hausse (+${Math.round(input.trend.pct ?? 0)} %)`);
  // Budget (10)
  const bud = input.budget.status === "ON_TRACK" ? 10 : input.budget.status === "WATCH" ? 6 : input.budget.status === "OVERSPENDING" ? 2 : 7;
  c.push({ label: "Budget", score: bud, max: 10, note: input.budget.status === "UNDEFINED" ? "budget mensuel non défini" : input.budget.status.toLowerCase() });
  // Stabilité (10)
  const stab = input.stability === null ? 5 : Math.round(input.stability * 10);
  c.push({ label: "Stabilité", score: stab, max: 10, note: input.stability === null ? "non mesurable" : `${Math.round(input.stability * 100)} %` });
  // Winners (10)
  const win = clamp(input.winners * 4, 0, 10);
  c.push({ label: "Winners actifs", score: win, max: 10, note: `${input.winners}` });
  if (input.winners) why.push(`${input.winners} winner(s) actif(s)`);
  // Fatigue (10)
  const fat = clamp(10 - input.fatiguing * 4, 0, 10);
  c.push({ label: "Fatigue créative", score: fat, max: 10, note: `${input.fatiguing} créative(s) en fatigue` });
  if (input.fatiguing) why.push(`${input.fatiguing} créative(s) en fatigue`);
  // Anomalies (5)
  const an = clamp(5 - input.anomalies.filter((a) => a.severity === "high").length * 2 - input.anomalies.filter((a) => a.severity === "medium").length, 0, 5);
  c.push({ label: "Anomalies", score: an, max: 5, note: `${input.anomalies.length}` });
  if (input.anomalies.length) why.push(`${input.anomalies.length} anomalie(s) sur 7 jours`);
  // Décisions urgentes (5)
  const urgent = input.recs.filter((r) => r.tone === "red").length;
  c.push({ label: "Urgences", score: clamp(5 - urgent * 2, 0, 5), max: 5, note: `${urgent} décision(s) rouge(s)` });
  // Qualité des données (5)
  const dq = input.closedRows > 100 ? 5 : input.closedRows > 20 ? 3 : 1;
  c.push({ label: "Qualité des données", score: dq, max: 5, note: `${input.closedRows} journées closes` });

  const score = Math.round(clamp(c.reduce((a, x) => a + x.score, 0), 0, 100));
  return { score, tone: score >= 70 ? "green" : score >= 45 ? "orange" : "red", why: why.slice(0, 5), components: c };
}
