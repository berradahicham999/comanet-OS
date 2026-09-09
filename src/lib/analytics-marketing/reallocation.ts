/**
 * Recommandations de réallocation mensuelles — logique PURE (testée sans base).
 *
 * Pour chaque marque : déplacer X MAD d'un canal STOP / OPTIMIZE vers un canal SCALE, avec le
 * raisonnement, le résultat attendu et un niveau de confiance. Les montants viennent de
 * `settings.analytics.reallocation` (part maximale déplaçable, montant minimal) ; le résultat
 * attendu est une extrapolation au coût par résultat constaté, présentée comme telle.
 * Aucun déplacement vers un canal dont un produit poussé est en tension de stock (le verdict
 * SCALE a déjà été rétrogradé en MAINTAIN dans ce cas).
 */
import type { AnalyticsSettings } from "@/lib/settings";
import type { ChannelVerdict } from "./diagnosis";
import type { ResultKey } from "./shared";

export type PairInput = {
  brandId: string; channelKey: string;
  spent: number; measurableRows: number; rows: number;
  /** Période précédente disponible (renforce la confiance). */
  hasPrev: boolean;
  verdict: ChannelVerdict;
};

export type Confidence = "HAUTE" | "MOYENNE" | "FAIBLE";

export type Reallocation = {
  key: string;
  brandId: string;
  fromChannel: string;
  toChannel: string;
  amount: number;
  /** Part de la dépense du canal source. */
  fromSharePct: number;
  reasoning: string;
  /** Résultat attendu : extrapolation au coût par résultat du canal cible. */
  expected: { key: ResultKey; value: number; costPerResult: number } | null;
  confidence: Confidence;
  confidenceWhy: string;
};

const fmt = (v: number) => Math.round(v).toLocaleString("fr-FR");

function confidenceOf(from: PairInput, to: PairInput, t: AnalyticsSettings): { level: Confidence; why: string } {
  const minSpend = t.channelDiagnosis.minSpend;
  const strong = from.spent >= minSpend * 3 && to.spent >= minSpend * 3;
  const comparable = from.hasPrev && to.hasPrev;
  const measured = from.measurableRows === from.rows && to.measurableRows === to.rows;
  if (strong && comparable && measured) return { level: "HAUTE", why: "dépenses significatives sur les deux canaux, période précédente comparable, coûts entièrement mesurés" };
  if ((strong || comparable) && measured) return { level: "MOYENNE", why: strong ? "dépenses significatives mais sans période précédente comparable" : "période précédente comparable mais volumes modestes" };
  return { level: "FAIBLE", why: !measured ? "une partie des coûts n'est pas mesurée" : "volumes faibles et pas de comparaison possible" };
}

/**
 * Propose au plus une réallocation par canal source et par marque. Les sources sont pris dans
 * l'ordre STOP puis OPTIMIZE (dépense décroissante), la cible est le canal SCALE de la marque au
 * coût par résultat le plus bas (à résultat comparable), sinon le SCALE le plus dépensé.
 */
export function proposeReallocations(pairs: PairInput[], settings: AnalyticsSettings, labels: { brand: (id: string) => string; channel: (key: string) => string }): Reallocation[] {
  const t = settings.reallocation;
  const out: Reallocation[] = [];
  const brands = [...new Set(pairs.map((p) => p.brandId))];
  for (const brandId of brands) {
    const mine = pairs.filter((p) => p.brandId === brandId);
    const targets = mine.filter((p) => p.verdict.verdict === "SCALE").sort((a, b) => (a.verdict.costPerResult?.value ?? Infinity) - (b.verdict.costPerResult?.value ?? Infinity) || b.spent - a.spent);
    if (!targets.length) continue;
    const sources = mine.filter((p) => p.verdict.verdict === "STOP" || p.verdict.verdict === "OPTIMIZE").sort((a, b) => (a.verdict.verdict === b.verdict.verdict ? b.spent - a.spent : a.verdict.verdict === "STOP" ? -1 : 1));
    for (const from of sources) {
      const to = targets.find((x) => x.channelKey !== from.channelKey);
      if (!to) continue;
      const sharePct = from.verdict.verdict === "STOP" ? Math.min(100, t.maxShiftPct * 2) : t.maxShiftPct;
      const amount = Math.round((from.spent * sharePct) / 100);
      if (amount < t.minShiftMad) continue;
      const cpr = to.verdict.costPerResult;
      const expected = cpr && cpr.value > 0 ? { key: cpr.key, value: Math.round(amount / cpr.value), costPerResult: cpr.value } : null;
      const conf = confidenceOf(from, to, settings);
      out.push({
        key: `realloc:${brandId}:${from.channelKey}:${to.channelKey}`,
        brandId, fromChannel: from.channelKey, toChannel: to.channelKey, amount, fromSharePct: sharePct,
        reasoning: `${labels.channel(from.channelKey)} : ${from.verdict.headline.toLowerCase()} (${from.verdict.why}) ${labels.channel(to.channelKey)} : ${to.verdict.headline.toLowerCase()} (${to.verdict.why})`,
        expected,
        confidence: conf.level,
        confidenceWhy: conf.why,
      });
    }
  }
  return out.sort((a, b) => b.amount - a.amount);
}

export function reallocationSentence(r: Reallocation, labels: { brand: (id: string) => string; channel: (key: string) => string; result: (key: ResultKey) => string }): string {
  const base = `Déplacer ${fmt(r.amount)} MAD (${r.fromSharePct} % du canal) de ${labels.channel(r.fromChannel)} vers ${labels.channel(r.toChannel)} pour ${labels.brand(r.brandId)}`;
  return r.expected ? `${base} — attendu : environ ${fmt(r.expected.value)} ${labels.result(r.expected.key).toLowerCase()} de plus au coût constaté de ${fmt(r.expected.costPerResult)} MAD.` : `${base}.`;
}
