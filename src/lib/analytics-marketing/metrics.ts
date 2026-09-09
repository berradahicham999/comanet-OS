/**
 * Dictionnaire de métriques — CALCUL (pure, testée sans base).
 *
 * `metrics_definitions` (base) porte libellé, unité, sens, seuils et mode d'attribution ;
 * ce module porte la formule de chaque clé. `tests/analytics-marketing.test.ts` échoue si une
 * clé de `METRIC_KEYS` n'a pas de formule ici, ou l'inverse.
 *
 * Chaque formule renvoie un `Measured` : soit une valeur avec sa complétude, soit
 * « données insuffisantes » avec la raison et le responsable. Aucune formule ne renvoie 0 pour
 * une donnée absente, et aucune ne divise par zéro.
 */
import type { AnalyticsSettings } from "@/lib/settings";
import { METRIC_KEYS, RESULT_KEYS, insufficient, measured, ratio, type Measured, type MetricKey, type ResultKey } from "./shared";

/** Agrégat d'un périmètre (période × filtres), tel que produit par `queries.ts`. */
export type Aggregate = {
  /** Dépenses (journées closes uniquement), MAD. */
  spend: { planned: number; committed: number; spent: number; /** Lignes avec un montant mesurable / total. */ measurableRows: number; rows: number; unmeasuredRows: number };
  /** Dépense portant un CA mesuré, et ce CA. */
  attributed: { spend: number; revenue: number };
  /** Enveloppe annuelle (null : pas de budget défini) et consommé officiel (`budgetConsumption()`). */
  budget: { annual: number | null; consumed: number | null };
  /** Ventes du même périmètre (sans filtre canal : les ventes n'ont pas de canal). */
  sales: { sellIn: number; sellInUnits: number; sellOut: number; sellOutUnits: number; margin: number | null; /** Part du CA dont la marge est calculable. */ marginCoverage: number | null; rows: number };
  /** Ventes de comparaison (null : fenêtre non disponible). */
  compare: { sellInPrev: number | null; sellInN1: number | null };
  /** Objectif de vente proratisé sur la période (null : aucun objectif). */
  objective: number | null;
  /** Résultats par clé (absents = 0 observé, pas « inconnu » : la présence de la source se lit dans `sources`). */
  results: Partial<Record<ResultKey, number>>;
  /** Sources présentes sur le périmètre (pour distinguer « 0 résultat » de « aucune donnée »). */
  sources: string[];
  /** Totaux du portefeuille pour les parts. */
  portfolio: { spend: number; sellIn: number };
};

export const EMPTY_AGGREGATE: Aggregate = {
  spend: { planned: 0, committed: 0, spent: 0, measurableRows: 0, rows: 0, unmeasuredRows: 0 },
  attributed: { spend: 0, revenue: 0 },
  budget: { annual: null, consumed: null },
  sales: { sellIn: 0, sellInUnits: 0, sellOut: 0, sellOutUnits: 0, margin: null, marginCoverage: null, rows: 0 },
  compare: { sellInPrev: null, sellInN1: null },
  objective: null,
  results: {},
  sources: [],
  portfolio: { spend: 0, sellIn: 0 },
};

export type MetricContext = {
  settings: AnalyticsSettings;
  /** Résultat propre du canal (coût par résultat) : clé principale et repli. */
  resultMetric?: { key: ResultKey | null; fallback: ResultKey | null };
  /** Composantes externes du score de santé, quand elles sont connues. */
  health?: { stockCoverageOk: number | null; dataQuality: number | null };
};

const OWNER_MARKETING = "Responsable marketing";
const OWNER_ADMIN = "Administrateur (Paramètres)";
const OWNER_SALES = "Direction commerciale (import Sage)";

const noSpend = (a: Aggregate) => a.spend.rows === 0;
/** Complétude d'une dépense : part des lignes dont le montant est mesurable. */
const spendCompleteness = (a: Aggregate) => (a.spend.rows ? a.spend.measurableRows / a.spend.rows : null);

type Formula = (a: Aggregate, ctx: MetricContext) => Measured<number>;

const resultFormula = (key: ResultKey): Formula => (a) => {
  if (!a.sources.length) return insufficient("aucune source marketing sur la période", ownerForResult(key));
  return measured(a.results[key] ?? 0);
};
function ownerForResult(key: ResultKey): string {
  if (["SELLOUT_AMOUNT", "SELLOUT_UNITS", "ANIMATION_DAYS", "CUSTOMERS_ADVISED"].includes(key)) return "Équipe terrain";
  if (["IMPRESSIONS", "REACH", "CLICKS", "LINK_CLICKS", "MESSAGES_STARTED", "LEADS", "PURCHASES"].includes(key)) return "Responsable Digital Ads";
  return OWNER_MARKETING;
}

export const FORMULAS: Record<MetricKey, Formula> = {
  /* ---- Argent ---- */
  SPEND_PLANNED: (a) => (noSpend(a) ? insufficient("aucune dépense enregistrée sur la période", OWNER_MARKETING) : measured(a.spend.planned, spendCompleteness(a))),
  SPEND_COMMITTED: (a) => (noSpend(a) ? insufficient("aucune dépense enregistrée sur la période", OWNER_MARKETING) : measured(a.spend.committed, spendCompleteness(a))),
  SPEND_SPENT: (a) => (noSpend(a) ? insufficient("aucune dépense enregistrée sur la période", OWNER_MARKETING) : measured(a.spend.spent, spendCompleteness(a))),
  BUDGET_ANNUAL: (a) => (a.budget.annual === null || a.budget.annual <= 0 ? insufficient("pas d'enveloppe annuelle définie", OWNER_ADMIN, "/marketing/budgets") : measured(a.budget.annual)),
  BUDGET_CONSUMED_PCT: (a) => {
    if (a.budget.annual === null || a.budget.annual <= 0) return insufficient("pas d'enveloppe annuelle définie", OWNER_ADMIN, "/marketing/budgets");
    const r = ratio(a.budget.consumed, a.budget.annual);
    return r === null ? insufficient("consommé indisponible", OWNER_MARKETING) : measured(r * 100);
  },
  SPEND_SHARE: (a) => {
    if (noSpend(a)) return insufficient("aucune dépense enregistrée sur la période", OWNER_MARKETING);
    const r = ratio(a.spend.spent, a.portfolio.spend);
    return r === null ? insufficient("aucune dépense sur le portefeuille", OWNER_MARKETING) : measured(r * 100, spendCompleteness(a));
  },
  MARKETING_INTENSITY: (a) => {
    if (noSpend(a)) return insufficient("aucune dépense enregistrée sur la période", OWNER_MARKETING);
    if (!a.sales.rows) return insufficient("aucune vente Sage sur la période", OWNER_SALES, "/imports");
    const r = ratio(a.spend.spent, a.sales.sellIn);
    return r === null ? insufficient("CA nul sur la période", OWNER_SALES) : measured(r * 100, spendCompleteness(a));
  },

  /* ---- Ventes ---- */
  SELL_IN: (a) => (a.sales.rows ? measured(a.sales.sellIn) : insufficient("aucune vente Sage importée sur la période", OWNER_SALES, "/imports")),
  SELL_IN_UNITS: (a) => (a.sales.rows ? measured(a.sales.sellInUnits) : insufficient("aucune vente Sage importée sur la période", OWNER_SALES, "/imports")),
  SELL_OUT: (a) => (a.sources.includes("ANIMATION") || a.sales.sellOut > 0 ? measured(a.sales.sellOut) : insufficient("aucune animation terrain sur la période", "Équipe terrain", "/terrain")),
  SELL_OUT_UNITS: (a) => (a.sources.includes("ANIMATION") || a.sales.sellOut > 0 ? measured(a.sales.sellOutUnits) : insufficient("aucune animation terrain sur la période", "Équipe terrain", "/terrain")),
  MARGIN: (a) => {
    if (!a.sales.rows) return insufficient("aucune vente Sage importée sur la période", OWNER_SALES, "/imports");
    if (a.sales.margin === null || (a.sales.marginCoverage ?? 0) === 0) return insufficient("prix d'achat manquant sur les produits du périmètre", "Responsable produits", "/produits");
    return measured(a.sales.margin, a.sales.marginCoverage, (a.sales.marginCoverage ?? 1) < 1 ? "marge calculée sur les produits dont le prix d'achat est connu" : undefined);
  },
  SALES_SHARE: (a) => {
    if (!a.sales.rows) return insufficient("aucune vente Sage importée sur la période", OWNER_SALES, "/imports");
    const r = ratio(a.sales.sellIn, a.portfolio.sellIn);
    return r === null ? insufficient("CA du portefeuille nul", OWNER_SALES) : measured(r * 100);
  },
  OBJECTIVE_ATTAINMENT: (a) => {
    if (a.objective === null || a.objective <= 0) return insufficient("pas d'objectif de vente sur la période", "Direction (objectifs)", "/imports/nouveau?type=OBJECTIVES");
    if (!a.sales.rows) return insufficient("aucune vente Sage importée sur la période", OWNER_SALES, "/imports");
    return measured((a.sales.sellIn / a.objective) * 100);
  },
  SALES_GROWTH_PREV: (a) => {
    if (!a.sales.rows) return insufficient("aucune vente Sage importée sur la période", OWNER_SALES, "/imports");
    if (a.compare.sellInPrev === null) return insufficient("période précédente non couverte par un import Sage", OWNER_SALES, "/imports");
    if (a.compare.sellInPrev <= 0) return insufficient("CA nul ou négatif (avoirs) sur la période précédente : pas comparable", OWNER_SALES);
    return measured(((a.sales.sellIn - a.compare.sellInPrev) / a.compare.sellInPrev) * 100);
  },
  SALES_GROWTH_N1: (a) => {
    if (!a.sales.rows) return insufficient("aucune vente Sage importée sur la période", OWNER_SALES, "/imports");
    if (a.compare.sellInN1 === null) return insufficient("même période N-1 non couverte par un import Sage", OWNER_SALES, "/imports");
    if (a.compare.sellInN1 <= 0) return insufficient("CA nul ou négatif (avoirs) sur la période N-1 : pas comparable", OWNER_SALES);
    return measured(((a.sales.sellIn - a.compare.sellInN1) / a.compare.sellInN1) * 100);
  },

  /* ---- Résultats ---- */
  ...(Object.fromEntries(RESULT_KEYS.map((k) => [k, resultFormula(k)])) as Record<ResultKey, Formula>),
  COST_PER_RESULT: (a, ctx) => {
    if (noSpend(a)) return insufficient("aucune dépense enregistrée sur la période", OWNER_MARKETING);
    if (a.spend.measurableRows === 0) return insufficient("dépense non mesurable (coût non renseigné)", OWNER_ADMIN, "/parametres/analytics");
    const key = ctx.resultMetric?.key ?? null;
    if (!key) return insufficient("aucun résultat propre défini pour ce canal", OWNER_ADMIN, "/parametres/analytics");
    const primary = a.results[key] ?? 0;
    const fallback = ctx.resultMetric?.fallback ?? null;
    const use = primary > 0 ? key : fallback && (a.results[fallback] ?? 0) > 0 ? fallback : null;
    if (!use) return insufficient(`aucun résultat « ${key} » mesuré sur la période`, ownerForResult(key));
    return measured(a.spend.spent / a.results[use]!, spendCompleteness(a), use === key ? undefined : `résultat de repli : ${use}`);
  },
  CTR: (a) => {
    const imp = a.results.IMPRESSIONS ?? 0;
    const clicks = (a.results.LINK_CLICKS ?? 0) || (a.results.CLICKS ?? 0);
    return imp > 0 ? measured((clicks / imp) * 100) : insufficient("aucune impression mesurée", "Responsable Digital Ads", "/marketing/ads");
  },
  CPM: (a) => {
    const imp = a.results.IMPRESSIONS ?? 0;
    return imp > 0 && a.spend.spent > 0 ? measured((a.spend.spent / imp) * 1000) : insufficient("aucune impression mesurée", "Responsable Digital Ads", "/marketing/ads");
  },
  CPC: (a) => {
    const clicks = (a.results.LINK_CLICKS ?? 0) || (a.results.CLICKS ?? 0);
    return clicks > 0 && a.spend.spent > 0 ? measured(a.spend.spent / clicks) : insufficient("aucun clic mesuré", "Responsable Digital Ads", "/marketing/ads");
  },

  /* ---- Retour ---- */
  ATTRIBUTED_REVENUE: (a) => (a.attributed.spend > 0 || a.attributed.revenue > 0 ? measured(a.attributed.revenue, ratio(a.attributed.spend, a.spend.spent)) : insufficient("aucun CA mesuré (régie, code promo ou saisie) sur la période", OWNER_MARKETING)),
  ATTRIBUTION_COVERAGE: (a) => {
    if (noSpend(a) || a.spend.spent <= 0) return insufficient("aucune dépense enregistrée sur la période", OWNER_MARKETING);
    return measured((a.attributed.spend / a.spend.spent) * 100);
  },
  ROI_MEASURED: (a) => {
    if (a.attributed.spend <= 0) return insufficient("aucune dépense avec CA mesuré : ROI non calculable", OWNER_MARKETING);
    const coverage = ratio(a.attributed.spend, a.spend.spent);
    return measured((a.attributed.revenue - a.attributed.spend) / a.attributed.spend, coverage, `basé sur ${Math.round((coverage ?? 0) * 100)} % des dépenses attribuées`);
  },
  SALES_LIFT_CORRELATED: (a) => {
    if (!a.sales.rows) return insufficient("aucune vente Sage importée sur la période", OWNER_SALES, "/imports");
    if (a.compare.sellInPrev === null) return insufficient("fenêtre « avant » non couverte : pas encore comparable", OWNER_SALES, "/imports");
    return measured(a.sales.sellIn - a.compare.sellInPrev, null, "corrélation observée, pas une causalité");
  },
  ROI_CORRELATED: (a) => {
    if (noSpend(a) || a.spend.spent <= 0) return insufficient("aucune dépense enregistrée sur la période", OWNER_MARKETING);
    if (!a.sales.rows || a.compare.sellInPrev === null) return insufficient("fenêtre « avant » non couverte : pas encore comparable", OWNER_SALES, "/imports");
    return measured((a.sales.sellIn - a.compare.sellInPrev) / a.spend.spent, spendCompleteness(a), "corrélation observée, pas une causalité");
  },
  CORRELATION_R: () => insufficient("calculé sur une série mensuelle (voir la tendance)", OWNER_MARKETING),

  /* ---- Composites ---- */
  HEALTH_SCORE: (a, ctx) => healthScore(a, ctx),
  INVESTMENT_BALANCE: (a) => {
    const spendShare = ratio(a.spend.spent, a.portfolio.spend);
    const salesShare = ratio(a.sales.sellIn, a.portfolio.sellIn);
    if (spendShare === null) return insufficient("aucune dépense sur le portefeuille", OWNER_MARKETING);
    if (salesShare === null) return insufficient("aucune vente Sage sur le portefeuille", OWNER_SALES, "/imports");
    return measured((spendShare - salesShare) * 100);
  },
  DATA_COMPLETENESS: (a, ctx) => (ctx.health?.dataQuality === null || ctx.health?.dataQuality === undefined ? insufficient("complétude non calculée", OWNER_ADMIN) : measured(ctx.health.dataQuality * 100)),
};

/** Calcule une métrique. */
export function compute(key: MetricKey, a: Aggregate, ctx: MetricContext): Measured<number> {
  return FORMULAS[key](a, ctx);
}

/**
 * Score de santé marketing (0-100). Chaque composante vaut 0-1 ; une composante non mesurable
 * sort du dénominateur et le score dit sur combien de composantes il repose.
 *  - objectif : atteinte plafonnée à 120 % → 0-1
 *  - retour : ROI mesuré (0 → 0, ≥ 2× → 1) sinon retour observé (corrélation) sur la même échelle
 *  - intensité : 1 si ≤ 5 % du CA, 0 si ≥ 25 %, linéaire entre
 *  - couverture de stock des produits poussés : part des produits poussés hors tension (fournie)
 *  - qualité des données : complétude (fournie)
 */
export function healthScore(a: Aggregate, ctx: MetricContext): Measured<number> {
  const w = ctx.settings.healthWeights;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const parts: { weight: number; value: number | null; label: string }[] = [];
  const obj = compute("OBJECTIVE_ATTAINMENT", a, ctx);
  parts.push({ weight: w.objective, value: obj.ok ? clamp(obj.value / 120) : null, label: "objectif" });
  const roi = compute("ROI_MEASURED", a, ctx);
  const roiC = roi.ok ? roi : compute("ROI_CORRELATED", a, ctx);
  parts.push({ weight: w.roi, value: roiC.ok ? clamp(roiC.value / 2) : null, label: "retour" });
  const intensity = compute("MARKETING_INTENSITY", a, ctx);
  parts.push({ weight: w.intensity, value: intensity.ok ? clamp(1 - (intensity.value - 5) / 20) : null, label: "intensité" });
  parts.push({ weight: w.stockCoverage, value: ctx.health?.stockCoverageOk ?? null, label: "stock" });
  parts.push({ weight: w.dataQuality, value: ctx.health?.dataQuality ?? null, label: "données" });
  const used = parts.filter((p) => p.value !== null && p.weight > 0);
  const denom = used.reduce((s, p) => s + p.weight, 0);
  if (!used.length || denom === 0) return insufficient("aucune composante du score n'est mesurable", OWNER_MARKETING);
  const score = used.reduce((s, p) => s + p.weight * (p.value as number), 0) / denom;
  return measured(Math.round(score * 100), used.length / parts.length, `sur ${used.length} composante${used.length > 1 ? "s" : ""} mesurée${used.length > 1 ? "s" : ""} : ${used.map((p) => p.label).join(", ")}`);
}

/** Vérification d'alignement : chaque clé du dictionnaire a une formule (utilisé par les tests). */
export function formulaKeys(): MetricKey[] {
  return Object.keys(FORMULAS) as MetricKey[];
}
export { METRIC_KEYS };
