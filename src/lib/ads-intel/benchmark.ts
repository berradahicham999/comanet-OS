/**
 * Historical Benchmark Engine : situe une entité par rapport à sa période précédente, à sa
 * marque, à son objectif, à l'historique complet, au meilleur mois historique et à l'historique
 * du même produit. Une référence absente est `null` et le dit ; elle n'est jamais estimée.
 */
import { RESULT_LABELS, type ResultKind } from "@/lib/ads";
import type { MonthRow } from "./data";
import { dailyResults, pct } from "./metrics";
import type { Benchmark, BenchmarkRef, EntityPerf } from "./types";

function refOf(label: string, rows: EntityPerf[], kind: ResultKind, note: string | null = null): BenchmarkRef {
  const same = rows.filter((r) => r.resultKind === kind);
  const spend = same.reduce((s, r) => s + r.spend, 0);
  const results = same.reduce((s, r) => s + r.results, 0);
  const imp = same.reduce((s, r) => s + r.impressions, 0);
  const clicks = same.reduce((s, r) => s + (r.linkClicks || r.clicks), 0);
  const revenue = same.reduce((s, r) => s + r.revenue, 0);
  if (!same.length || spend === 0) return { label, costPerResult: null, roas: null, ctr: null, note: note ?? "aucune référence" };
  return {
    label,
    costPerResult: results > 0 ? (kind === "reach" ? (spend / results) * 1000 : spend / results) : null,
    roas: revenue > 0 ? revenue / spend : null,
    ctr: imp > 0 ? (clicks / imp) * 100 : null,
    note,
  };
}

function monthCost(m: MonthRow, kind: ResultKind): number | null {
  const results = dailyResults({ ...m, date: m.month }, kind);
  return results > 0 && m.spend > 0 ? (kind === "reach" ? (m.spend / results) * 1000 : m.spend / results) : null;
}

/** Meilleur mois historique (coût par résultat le plus bas parmi les mois à dépense significative). */
export function bestMonth(history: MonthRow[], kind: ResultKind, minSpend: number): { month: string; cost: number } | null {
  let best: { month: string; cost: number } | null = null;
  for (const m of history) {
    if (m.spend < minSpend) continue;
    const c = monthCost(m, kind);
    if (c !== null && (!best || c < best.cost)) best = { month: m.month, cost: c };
  }
  return best;
}

export function historicalRef(label: string, history: MonthRow[], kind: ResultKind, note: string | null = null): BenchmarkRef {
  const spend = history.reduce((s, m) => s + m.spend, 0);
  const results = history.reduce((s, m) => s + dailyResults({ ...m, date: m.month }, kind), 0);
  const imp = history.reduce((s, m) => s + m.impressions, 0);
  const clicks = history.reduce((s, m) => s + (m.linkClicks || m.clicks), 0);
  const revenue = history.reduce((s, m) => s + m.revenue, 0);
  if (!history.length || spend === 0) return { label, costPerResult: null, roas: null, ctr: null, note: note ?? "aucun historique" };
  return {
    label, costPerResult: results > 0 ? (kind === "reach" ? (spend / results) * 1000 : spend / results) : null,
    roas: revenue > 0 ? revenue / spend : null, ctr: imp > 0 ? (clicks / imp) * 100 : null,
    note: note ?? `${history.length} mois`,
  };
}

export type BenchmarkContext = {
  previous: EntityPerf | null;
  brandRows: EntityPerf[];
  objectiveRows: EntityPerf[];
  brandHistory: MonthRow[];
  productHistory: MonthRow[];
  minSpend: number;
};

export function benchmarkFor(e: EntityPerf, ctx: BenchmarkContext): Benchmark {
  const kind = e.resultKind;
  const prev = ctx.previous;
  const previous: BenchmarkRef = prev && prev.spend > 0
    ? { label: "Période précédente", costPerResult: prev.resultKind === kind ? prev.costPerResult : null, roas: prev.roas, ctr: prev.ctr, note: prev.resultKind === kind ? null : "résultat différent" }
    : { label: "Période précédente", costPerResult: null, roas: null, ctr: null, note: "pas encore comparable" };
  const brand = refOf(e.brandName ? `Moyenne ${e.brandName}` : "Moyenne marque", ctx.brandRows.filter((r) => r.key !== e.key || r.level !== e.level), kind);
  const objective = refOf("Moyenne objectif", ctx.objectiveRows.filter((r) => r.key !== e.key || r.level !== e.level), kind);
  const historical = historicalRef("Historique marque", ctx.brandHistory, kind);
  const bm = bestMonth(ctx.brandHistory, kind, ctx.minSpend);
  const best: BenchmarkRef = bm
    ? { label: "Meilleur mois historique", costPerResult: bm.cost, roas: null, ctr: null, note: bm.month }
    : { label: "Meilleur mois historique", costPerResult: null, roas: null, ctr: null, note: "aucun mois significatif" };
  const product = e.productId
    ? historicalRef(e.productName ? `Historique ${e.productName}` : "Historique produit", ctx.productHistory, kind)
    : { label: "Historique produit", costPerResult: null, roas: null, ctr: null, note: "produit non identifié" };

  const vsBrandPct = pct(e.costPerResult, brand.costPerResult);
  const vsHistoryPct = pct(e.costPerResult, historical.costPerResult);
  const vsBestPct = pct(e.costPerResult, best.costPerResult);
  const cost = RESULT_LABELS[kind].cost;
  let verdict: string;
  if (e.costPerResult === null) verdict = `Aucun résultat mesuré : ${cost} non calculable.`;
  else if (vsHistoryPct === null && vsBrandPct === null) verdict = "Aucune référence historique ni de marque : lecture isolée.";
  else {
    const parts: string[] = [];
    if (vsBrandPct !== null) parts.push(`${vsBrandPct <= -10 ? "meilleur" : vsBrandPct >= 10 ? "moins bon" : "au niveau"} que la marque (${vsBrandPct > 0 ? "+" : ""}${Math.round(vsBrandPct)} %)`);
    if (vsHistoryPct !== null) parts.push(`${vsHistoryPct <= -10 ? "meilleur" : vsHistoryPct >= 10 ? "moins bon" : "au niveau"} que l'historique (${vsHistoryPct > 0 ? "+" : ""}${Math.round(vsHistoryPct)} %)`);
    const strong = (vsBrandPct ?? vsHistoryPct ?? 0) <= -10;
    const atBest = vsBestPct !== null && vsBestPct <= 5;
    verdict = strong
      ? atBest ? `Performance forte, au niveau du meilleur historique (${cost}).` : `Performance forte, mais pas encore au meilleur historique${vsBestPct !== null ? ` (+${Math.round(vsBestPct)} % vs ${best.note})` : ""}.`
      : `${cost} ${parts.join(", ")}.`;
  }
  return { resultKind: kind, previous, brand, objective, historical, best, product, verdict, vsBrandPct, vsHistoryPct, vsBestPct };
}
