/**
 * Statistiques pures sur des séries journalières : tendance, stabilité, anomalies (z-score),
 * confiance. Aucun seuil de décision ici, seulement des mesures.
 */
import { resultCount, resultKindOf, type ResultKind } from "@/lib/ads";
import type { DailyPoint, Trend } from "./types";

export const pct = (cur: number | null, ref: number | null): number | null =>
  cur === null || ref === null || ref === 0 ? null : ((cur - ref) / ref) * 100;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function sum<T>(rows: T[], f: (r: T) => number): number {
  return rows.reduce((s, r) => s + f(r), 0);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Coefficient de variation (écart-type / moyenne), 0 = parfaitement stable. */
export function cv(xs: number[]): number | null {
  const m = mean(xs);
  if (!xs.length || m === 0) return null;
  return stddev(xs) / Math.abs(m);
}

/** Résultat officiel d'un point journalier, pour un objectif donné. */
export function dailyResults(p: DailyPoint, kind: ResultKind): number {
  return resultCount(kind, { purchases: p.purchases, leads: p.leads, messagingStarted: p.messagingStarted, landingPageViews: p.landingPageViews, linkClicks: p.linkClicks, clicks: p.clicks, reach: p.reach, videoViews: p.videoViews, postEngagement: p.postEngagement });
}

export function kindOfSeries(objective: string | null, series: DailyPoint[]): ResultKind {
  const agg = series.reduce((a, p) => ({
    purchases: a.purchases + p.purchases, leads: a.leads + p.leads, messagingStarted: a.messagingStarted + p.messagingStarted,
    landingPageViews: a.landingPageViews + p.landingPageViews, linkClicks: a.linkClicks + p.linkClicks, clicks: a.clicks + p.clicks,
    reach: a.reach + p.reach, videoViews: a.videoViews + p.videoViews, postEngagement: a.postEngagement + p.postEngagement,
  }), { purchases: 0, leads: 0, messagingStarted: 0, landingPageViews: 0, linkClicks: 0, clicks: 0, reach: 0, videoViews: 0, postEngagement: 0 });
  return resultKindOf(objective, agg);
}

export type Metric = "spend" | "cpm" | "cpc" | "ctr" | "results" | "costPerResult";

/** Valeur d'une métrique sur un lot de journées (ratio calculé sur les sommes, jamais moyenne de ratios). */
export function metricOf(points: DailyPoint[], metric: Metric, kind: ResultKind): number | null {
  const spend = sum(points, (p) => p.spend);
  const imp = sum(points, (p) => p.impressions);
  const clicks = sum(points, (p) => p.linkClicks || p.clicks);
  const results = sum(points, (p) => dailyResults(p, kind));
  switch (metric) {
    case "spend": return spend;
    case "cpm": return imp > 0 ? (spend / imp) * 1000 : null;
    case "cpc": return clicks > 0 ? spend / clicks : null;
    case "ctr": return imp > 0 ? (clicks / imp) * 100 : null;
    case "results": return results;
    case "costPerResult": return results > 0 ? (kind === "reach" ? (spend / results) * 1000 : spend / results) : null;
  }
}

/**
 * Tendance : seconde moitié de la série contre la première (robuste sur des séries courtes et
 * bruitées, contrairement à une pente). `flat` sous 8 % d'écart. Moins de 6 points : inconnue.
 */
export function trendOf(points: DailyPoint[], metric: Metric, kind: ResultKind, flatPct = 8): Trend {
  const closed = points.filter((p) => !("partial" in p) || !(p as { partial?: boolean }).partial);
  if (closed.length < 6) return { direction: "unknown", pct: null, points: closed.length };
  const half = Math.floor(closed.length / 2);
  const a = metricOf(closed.slice(0, half), metric, kind);
  const b = metricOf(closed.slice(half), metric, kind);
  const d = pct(b, a);
  if (d === null) return { direction: "unknown", pct: null, points: closed.length };
  return { direction: Math.abs(d) < flatPct ? "flat" : d > 0 ? "up" : "down", pct: d, points: closed.length };
}

/** Stabilité 0–1 : 1 − CV du coût par résultat journalier (ou de la dépense si aucun résultat). */
export function stabilityOf(points: DailyPoint[], kind: ResultKind): number | null {
  const closed = points.filter((p) => !(p as { partial?: boolean }).partial && p.spend > 0);
  if (closed.length < 4) return null;
  const costs = closed.map((p) => { const r = dailyResults(p, kind); return r > 0 ? p.spend / r : null; }).filter((v): v is number => v !== null);
  const c = costs.length >= 4 ? cv(costs) : cv(closed.map((p) => p.spend));
  return c === null ? null : clamp(1 - c, 0, 1);
}

/** z-score de chaque journée par rapport aux `window` journées précédentes. */
export function zScores(points: DailyPoint[], metric: Metric, kind: ResultKind, window = 28): { date: string; value: number; expected: number; z: number }[] {
  const out: { date: string; value: number; expected: number; z: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const cur = metricOf([points[i]], metric, kind);
    if (cur === null) continue;
    const prev = points.slice(Math.max(0, i - window), i).map((p) => metricOf([p], metric, kind)).filter((v): v is number => v !== null);
    if (prev.length < 7) continue;
    const m = mean(prev); const sd = stddev(prev);
    // Série parfaitement constante : tout écart est une anomalie franche (z borné à ±10).
    if (sd === 0) { if (cur === m) continue; out.push({ date: points[i].date, value: cur, expected: m, z: cur > m ? 10 : -10 }); continue; }
    out.push({ date: points[i].date, value: cur, expected: m, z: (cur - m) / sd });
  }
  return out;
}

/**
 * Confiance 0–100 d'une lecture : volume de dépense, nombre de jours, stabilité, benchmarks
 * disponibles, qualité des données. Chaque composante est expliquée.
 */
export function confidenceOf(input: {
  spend: number; days: number; stability: number | null; benchmarks: number; maxBenchmarks: number;
  closedOnly: boolean; objectiveKnown: boolean; productKnown: boolean; refSpend: number;
}): { score: number; why: string[] } {
  const why: string[] = [];
  const volume = clamp(input.spend / Math.max(1, input.refSpend * 3), 0, 1) * 35;
  why.push(`Volume : ${Math.round(input.spend).toLocaleString("fr-FR")} MAD (${Math.round(volume)}/35)`);
  const days = clamp(input.days / 14, 0, 1) * 20;
  why.push(`Durée : ${input.days} j (${Math.round(days)}/20)`);
  const stab = (input.stability ?? 0.4) * 20;
  why.push(input.stability === null ? "Stabilité : non mesurable (8/20)" : `Stabilité : ${Math.round(input.stability * 100)} % (${Math.round(stab)}/20)`);
  const bench = (input.maxBenchmarks ? input.benchmarks / input.maxBenchmarks : 0) * 15;
  why.push(`Références : ${input.benchmarks}/${input.maxBenchmarks} (${Math.round(bench)}/15)`);
  const quality = (input.closedOnly ? 4 : 0) + (input.objectiveKnown ? 3 : 0) + (input.productKnown ? 3 : 0);
  why.push(`Qualité des données : ${quality}/10`);
  return { score: Math.round(clamp(volume + days + stab + bench + quality, 0, 100)), why };
}
