/**
 * Recommendation Engine — la couche « décision » au-dessus du verdict officiel.
 *
 * Le verdict (SCALE / MAINTAIN / OPTIMIZE / STOP / WATCH) vient de `diagnose()` (`lib/ads.ts`),
 * seule définition. Ici on ajoute : la CAUSE (créative, offre/page, audience/enchère, fatigue,
 * suivi, volume), la DÉCISION (douze types dont DO_NOTHING), les DONNÉES qui la justifient,
 * l'ACTION concrète et la CONFIANCE. Une recommandation n'est jamais produite pour remplir
 * l'écran : « ne rien faire » est une sortie normale.
 */
import { diagnose, RESULT_LABELS, type Diagnosis } from "@/lib/ads";
import type { AdsIntelSettings, AdThresholds } from "@/lib/settings";
import { confidenceOf, pct } from "./metrics";
import type { Benchmark, Cause, DecisionType, EntityPerf, Fatigue, Recommendation, Trend, WinnerVerdict } from "./types";

export const DECISION_META: Record<DecisionType, { label: string; tone: Recommendation["tone"]; priority: number }> = {
  PAUSE_REVIEW: { label: "REVOIR / PAUSE", tone: "red", priority: 100 },
  REDUCE_BUDGET: { label: "RÉDUIRE LE BUDGET", tone: "red", priority: 95 },
  CHANGE_AUDIENCE: { label: "CHANGER L'AUDIENCE", tone: "orange", priority: 80 },
  CREATE_NEW_CREATIVE: { label: "NOUVELLE CRÉATIVE", tone: "orange", priority: 80 },
  CHANGE_ANGLE: { label: "CHANGER L'ANGLE", tone: "orange", priority: 78 },
  OPTIMIZE: { label: "OPTIMISER", tone: "orange", priority: 75 },
  SCALE: { label: "SCALER", tone: "green", priority: 90 },
  INCREASE_BUDGET: { label: "AUGMENTER LE BUDGET", tone: "green", priority: 88 },
  REUSE_WINNER: { label: "RÉUTILISER UN WINNER", tone: "blue", priority: 60 },
  TEST: { label: "TESTER", tone: "blue", priority: 55 },
  MAINTAIN: { label: "MAINTENIR", tone: "gray", priority: 20 },
  DO_NOTHING: { label: "NE RIEN FAIRE", tone: "gray", priority: 10 },
};

export type RecommendInput = {
  entity: EntityPerf;
  previous: EntityPerf | null;
  brandAvg: { cpa: number | null; roas: number | null; ctr: number | null; costPerResult?: number | null } | null;
  benchmark: Benchmark | null;
  fatigue: Fatigue | null;
  trend: Trend;
  stability: number | null;
  winner: WinnerVerdict;
  /** Produit rattaché en tension de stock (couverture courte) : bloque un SCALE. */
  stockTight: string | null;
  isActive: boolean;
};

/**
 * Cause probable : lit les signaux de `diagnose()` et la fatigue.
 *  CTR bas / en baisse → créative ; CTR bon + résultats bas → offre, page ou produit ;
 *  CTR bon + CPC élevé → enchère / audience ; coût qui monte avec la fréquence → fatigue.
 */
export function causeOf(d: Diagnosis, e: EntityPerf, prev: EntityPerf | null, fatigue: Fatigue | null, t: AdThresholds): Cause {
  if (d.verdict === "WATCH") return "VOLUME";
  if (e.results === 0) return "TRACKING";
  const dCtr = pct(e.ctr, prev?.ctr ?? null);
  const dCpc = pct(e.cpc, prev?.cpc ?? null);
  const dRate = pct(e.resultRate, prev?.resultRate ?? null);
  if (fatigue?.status === "FATIGUING") return "FATIGUE";
  if (d.verdict === "SCALE" || d.verdict === "MAINTAIN") return "NONE";
  if (dCtr !== null && dCtr < -t.ctrDropPct) return "CREATIVE";
  if (e.ctr !== null && e.ctr < 0.5 && dCtr === null) return "CREATIVE";
  if (dRate !== null && dRate < -t.convDropPct) return "OFFER_OR_PAGE";
  if (dCpc !== null && dCpc > t.cpmRisePct) return "AUDIENCE_OR_AUCTION";
  if (e.frequency !== null && e.frequency > t.frequencyMax) return "FATIGUE";
  return "VOLUME";
}

export function recommend(input: RecommendInput, s: AdsIntelSettings, t: AdThresholds): Recommendation {
  const { entity: e, previous, brandAvg, benchmark, fatigue, trend, stability, winner, stockTight, isActive } = input;
  const d = diagnose(e, previous, brandAvg, t);
  const cause = causeOf(d, e, previous, fatigue, t);
  const cost = RESULT_LABELS[e.resultKind].cost;
  const why: string[] = [];
  let decision: DecisionType;
  let action: string;

  const vsBrand = benchmark?.vsBrandPct ?? null;
  const vsHist = benchmark?.vsHistoryPct ?? null;
  if (vsBrand !== null) why.push(`${cost} ${vsBrand > 0 ? "+" : ""}${Math.round(vsBrand)} % vs moyenne ${e.brandName ?? "marque"}`);
  if (vsHist !== null) why.push(`${cost} ${vsHist > 0 ? "+" : ""}${Math.round(vsHist)} % vs historique`);
  const dCost = pct(e.costPerResult, previous?.costPerResult ?? null);
  if (dCost !== null) why.push(`${cost} ${dCost > 0 ? "+" : ""}${Math.round(dCost)} % vs période précédente`);
  if (trend.direction !== "unknown") why.push(trend.direction === "flat" ? `Stable depuis ${trend.points} j` : `${cost} en ${trend.direction === "up" ? "hausse" : "baisse"} (${trend.pct! > 0 ? "+" : ""}${Math.round(trend.pct!)} %) sur ${trend.points} j`);
  if (fatigue && fatigue.status !== "INSUFFICIENT" && fatigue.status !== "OK") why.push(`Fatigue : ${fatigue.reasons.slice(0, 2).join(", ")}`);

  switch (d.verdict) {
    case "WATCH":
      decision = "DO_NOTHING";
      action = `Laisser tourner jusqu'à ${t.minSpend} MAD et ${t.minDays} jours avant d'arbitrer.`;
      why.unshift(d.diagnostic);
      break;
    case "STOP":
      decision = e.results === 0 ? "PAUSE_REVIEW" : "REDUCE_BUDGET";
      action = e.results === 0
        ? "Vérifier le suivi des résultats (événements, destination) ; si le suivi est bon, mettre en pause et réallouer."
        : `Réduire le budget et basculer sur la campagne au meilleur ${cost} de la marque ; revoir l'offre et l'audience avant toute relance.`;
      why.unshift(d.diagnostic);
      break;
    case "OPTIMIZE":
      if (cause === "CREATIVE") { decision = "CREATE_NEW_CREATIVE"; action = "Produire 2 à 3 créatives avec une accroche différente (l'accroche ne capte plus) ; garder l'audience."; }
      else if (cause === "OFFER_OR_PAGE") { decision = "CHANGE_ANGLE"; action = "Les gens cliquent mais ne vont pas au résultat : revoir l'offre, la promesse ou la destination avant de toucher aux créatives."; }
      else if (cause === "AUDIENCE_OR_AUCTION") { decision = "CHANGE_AUDIENCE"; action = "CTR intact, diffusion plus chère : élargir ou changer l'audience, vérifier la pression d'enchères."; }
      else if (cause === "FATIGUE") { decision = "CREATE_NEW_CREATIVE"; action = `Fréquence ${e.frequency?.toFixed(1) ?? "élevée"} et coût en hausse : renouveler la créative (nouvel angle ou nouveau format), pas l'audience.`; }
      else { decision = "OPTIMIZE"; action = d.actions[0] ?? "Comparer avec les autres campagnes de la marque avant d'arbitrer."; }
      why.unshift(d.diagnostic);
      break;
    case "SCALE":
      if (stockTight) { decision = "MAINTAIN"; action = `Performance forte, mais ${stockTight} est en tension de stock : sécuriser l'approvisionnement avant d'augmenter le budget.`; why.unshift(d.diagnostic); }
      else if (fatigue?.status === "FATIGUING") { decision = "REUSE_WINNER"; action = "Bonne performance mais fatigue visible : dupliquer l'angle gagnant dans une nouvelle créative avant de scaler."; why.unshift(d.diagnostic); }
      else { decision = winner.cls === "WINNER" ? "SCALE" : "INCREASE_BUDGET"; action = `Augmenter le budget par paliers de ${t.scaleStepPct} % tous les ${t.scaleStepDays} jours, en surveillant le ${cost}.`; why.unshift(d.diagnostic); }
      break;
    default:
      if (fatigue?.status === "FATIGUING") { decision = "CREATE_NEW_CREATIVE"; action = "Performance conforme mais créative en fatigue : préparer la relève maintenant, avant la dérive du coût."; }
      else if (winner.cls === "WINNER" && !isActive) { decision = "REUSE_WINNER"; action = "Cet élément a été un winner et ne diffuse plus : réutiliser son angle sur une nouvelle campagne."; }
      else { decision = "DO_NOTHING"; action = "Performance stable, aucune action requise cette semaine. Surveiller la fréquence et le coût par résultat."; }
      why.unshift(d.diagnostic);
  }

  const benchmarksAvailable = benchmark ? [benchmark.previous, benchmark.brand, benchmark.historical, benchmark.best, benchmark.product].filter((b) => b.costPerResult !== null).length : 0;
  const conf = confidenceOf({
    spend: e.spend, days: e.days, stability, benchmarks: benchmarksAvailable, maxBenchmarks: 5,
    closedOnly: !e.hasPartial, objectiveKnown: Boolean(e.objective), productKnown: Boolean(e.productId), refSpend: s.winnerMinSpend,
  });
  // Une décision forte (scaler, couper) exige plus de certitude qu'un « ne rien faire ».
  const confidence = decision === "DO_NOTHING" || decision === "MAINTAIN" ? Math.min(100, conf.score + 10) : conf.score;
  const meta = DECISION_META[decision];
  return {
    id: `${e.level}:${e.externalId ?? e.key}`,
    decision, tone: meta.tone, level: e.level, externalId: e.externalId, brandId: e.brandId, brandName: e.brandName,
    title: `${(e.brandName ?? "SANS MARQUE").toUpperCase()} — ${e.productName ?? e.campaignName}`,
    headline: d.headline,
    why: why.slice(0, 5),
    data: d.signals.map((sg) => ({ label: sg.label, value: sg.value, delta: sg.delta, good: sg.good })),
    action, cause, confidence, confidenceWhy: conf.why, verdict: d.verdict,
    priority: meta.priority + Math.min(20, e.spend / 500) + (isActive ? 10 : 0),
  };
}

/**
 * Sélection pour l'Action Center : au plus `max` recommandations qui méritent l'attention,
 * priorisées par gravité puis dépense ; les DO_NOTHING n'y figurent que s'il ne reste rien
 * d'autre — et alors c'est la bonne nouvelle à afficher.
 */
export function topActions(recs: Recommendation[], max = 5, minConfidence = 35): Recommendation[] {
  const worth = recs.filter((r) => r.decision !== "DO_NOTHING" && r.decision !== "MAINTAIN" && r.confidence >= minConfidence);
  const sorted = [...worth].sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  const out = sorted.slice(0, max);
  if (out.length < max) {
    const calm = recs.filter((r) => (r.decision === "DO_NOTHING" || r.decision === "MAINTAIN") && r.confidence >= minConfidence).sort((a, b) => b.priority - a.priority);
    out.push(...calm.slice(0, Math.min(2, max - out.length)));
  }
  return out;
}
