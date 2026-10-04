/**
 * Notation explicable (logique PURE) — aide à la décision, pas une mesure.
 *
 * Une opportunité et un concept reçoivent un score sur 100 décomposé en critères, chacun avec ses points, son maximum,
 * sa raison et son étiquette (CONFIRMED / CALCULATED / INFERRED / MISSING). Les parts que l'IA estime (force de
 * l'accroche, arrêt du scroll, tension émotionnelle) sont INFERRED ; sans IA, une heuristique de la mécanique prend
 * le relais et le dit. Aucune fausse précision : les points sont entiers.
 */
import { historicalFit } from "./learning";
import type { AxisKey, CreativeInsight, CreativeMechanic, CreativeScores, Distribution, FunnelStage, MarketingAction, ObjectiveKey, ProductIntelligence, ScoreItem, ScoreKey, TerritoryKey } from "./types";

/** Levier budgétaire du générateur auquel un territoire créatif se rattache (budget disponible, convictions de la direction). */
export const AXIS_OF_TERRITORY: Record<TerritoryKey, AxisKey> = { EDUCATION: "CONTENU", STORYTELLING: "CONTENU", EMOTIONAL: "CONTENU", UGC: "INFLUENCE", PERFORMANCE: "DIGITAL" };

export function funnelOf(objective: ObjectiveKey): FunnelStage {
  switch (objective) {
    case "NOTORIETE": return "AWARENESS";
    case "LANCEMENT": case "ACQUISITION": return "CONSIDERATION";
    case "FIDELISATION": return "RETENTION";
    default: return "CONVERSION";
  }
}

const PRIORITY_POINTS: Partial<Record<MarketingAction, number>> = { PUSH: 20, BOOST_DIGITAL: 20, CREATE_CONTENT: 19, ACTIVATE_INFLUENCER: 18, FOCUS_SELL_OUT: 16, CREATE_PROMOTION: 15, MAINTAIN: 8, OPTIMIZE: 6 };
const PROFILE_POINTS: Record<string, number> = { STAR: 15, GROWTH: 14, CASH_COW: 11, STABLE: 8, UNDERPERFORMER: 5, INSUFFICIENT_DATA: 6 };

export type OpportunityScoreInput = {
  priorityAction: MarketingAction | null;
  prioritySignal: string;
  product: Pick<ProductIntelligence, "profile" | "growthPct" | "sheetCompleteness" | "missing" | "stockRisk" | "daysOfStock">;
  tensionScore: number;
  tensionLabel: string;
  budgetAvailable: number | null;
  budgetAxis: AxisKey;
  fit: Omit<ScoreItem, "key" | "label" | "max">;
  fatigue: number;
  season: string | null;
};

export function scoreOpportunity(i: OpportunityScoreInput): { score: number; items: ScoreItem[] } {
  const items: ScoreItem[] = [];
  const pr = i.priorityAction ? PRIORITY_POINTS[i.priorityAction] ?? 10 : 10;
  items.push({ key: "priorite", label: "Priorité commerciale", points: pr, max: 20, why: i.priorityAction ? `décision du moteur marketing : ${i.priorityAction} — ${i.prioritySignal}` : i.prioritySignal, tag: i.priorityAction ? "INFERRED" : "CALCULATED" });
  const prof = i.product.profile;
  items.push({ key: "produit", label: "Potentiel du produit", points: prof ? PROFILE_POINTS[prof] ?? 8 : 7, max: 15, why: prof ? `profil ${prof.toLowerCase().replace("_", " ")}${i.product.growthPct !== null ? `, sell-in ${i.product.growthPct >= 0 ? "+" : ""}${Math.round(i.product.growthPct)} % sur 90 jours` : ""}` : "performance produit non lue : neutre", tag: prof ? "CALCULATED" : "MISSING" });
  const tp = i.tensionScore >= 6 ? 15 : i.tensionScore >= 3 ? 11 : i.tensionScore > 0 ? 8 : 4;
  items.push({ key: "tension", label: "Tension consommateur", points: tp, max: 15, why: i.tensionScore > 0 ? `« ${i.tensionLabel} » activée par la fiche produit (force ${i.tensionScore})` : `aucune tension activée par la fiche : tension par défaut de la catégorie (« ${i.tensionLabel} »)`, tag: i.tensionScore > 0 ? "CALCULATED" : "MISSING" });
  const sheet = Math.round(i.product.sheetCompleteness * 10);
  items.push({ key: "fiche", label: "Fiche produit exploitable", points: sheet, max: 10, why: i.product.missing.length ? `à compléter : ${i.product.missing.join(", ")}` : "bénéfices, actifs, allégations, angle, cible et prix renseignés", tag: sheet >= 8 ? "CONFIRMED" : "MISSING" });
  const bp = i.budgetAvailable === null ? 5 : i.budgetAvailable > 0 ? 10 : 2;
  items.push({ key: "budget", label: `Budget ${i.budgetAxis.toLowerCase()} disponible`, points: bp, max: 10, why: i.budgetAvailable === null ? "aucun budget défini pour ce levier : production possible en interne, diffusion payante non financée" : i.budgetAvailable > 0 ? `${Math.round(i.budgetAvailable).toLocaleString("fr-FR")} MAD disponibles` : "levier déjà consommé", tag: i.budgetAvailable === null ? "MISSING" : "CALCULATED" });
  items.push({ key: "apprentissage", label: "Apprentissage créatif", points: i.fit.points, max: 10, why: i.fit.why, tag: i.fit.tag });
  const fat = Math.max(0, 10 - Math.round(i.fatigue * 10));
  items.push({ key: "fraicheur", label: "Fraîcheur du territoire", points: fat, max: 10, why: i.fatigue >= 0.6 ? "territoire ou mécanique très utilisés récemment" : i.fatigue > 0.2 ? "déjà utilisé récemment, encore de la place" : "angle peu ou pas exploré récemment", tag: "CALCULATED" });
  const risk = i.product.stockRisk;
  const sp = risk === "HEALTHY" || risk === "SURSTOCK" ? 10 : risk === null || risk === "UNKNOWN" ? 5 : risk === "NO_ROTATION" ? 4 : 0;
  items.push({ key: "stock", label: "Stock pour absorber la demande", points: sp, max: 10, why: risk === "SURSTOCK" ? `surstock (${i.product.daysOfStock ?? "—"} jours) : le contenu sert aussi à écouler` : risk === "HEALTHY" ? `stock sain${i.product.daysOfStock ? ` (${i.product.daysOfStock} jours)` : ""}` : risk === null || risk === "UNKNOWN" ? "stock non renseigné : neutre" : `stock : ${risk.toLowerCase()}`, tag: risk === null || risk === "UNKNOWN" ? "MISSING" : "CALCULATED" });
  if (i.season) items.push({ key: "saison", label: "Saisonnalité", points: 0, max: 0, why: `période : ${i.season}`, tag: "INFERRED" });
  const total = items.reduce((s, x) => s + x.points, 0);
  return { score: Math.max(0, Math.min(100, total)), items };
}

export type ConceptScoreInput = {
  mechanic: CreativeMechanic;
  tensionScore: number;
  product: ProductIntelligence;
  text: { coreMessage: string; productRole: string; bigIdea: string };
  playbookLevers: Partial<Record<AxisKey, number>>;
  positioningHit: boolean;
  similarity: number;
  distribution: Distribution;
  funnelStage: FunnelStage;
  insights: CreativeInsight[];
  /** Estimations de l'IA (0 à 10) ; absentes sans IA. */
  ai?: Partial<Record<"hook" | "scrollStop" | "emotionalTension", number>> | null;
};

const clamp10 = (v: number) => Math.max(0, Math.min(10, Math.round(v)));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function scoreConcept(i: ConceptScoreInput): CreativeScores {
  const m = i.mechanic;
  const items: (ScoreItem & { key: ScoreKey })[] = [];
  const push = (key: ScoreKey, label: string, points: number, why: string, tag: ScoreItem["tag"]) => items.push({ key, label, points: clamp10(points), max: 10, why, tag });

  const aiHook = i.ai?.hook;
  push("hook", "Force de l'accroche", aiHook ?? (m.defaultHook === "PROBLEM" || m.defaultHook === "CONTRARIAN" ? 7 : 6), aiHook !== undefined ? "estimation de la revue créative (IA)" : `heuristique : accroche ${m.defaultHook.toLowerCase()} de la mécanique, non évaluée par l'IA`, "INFERRED");
  push("consumerRelevance", "Pertinence consommateur", i.tensionScore >= 6 ? 10 : i.tensionScore >= 3 ? 8 : i.tensionScore > 0 ? 6 : 4, i.tensionScore > 0 ? `tension activée par la fiche produit (force ${i.tensionScore})` : "tension par défaut de la catégorie : la fiche produit n'en active aucune", i.tensionScore > 0 ? "CALCULATED" : "MISSING");

  const heroHit = norm(`${i.text.coreMessage} ${i.text.productRole} ${i.text.bigIdea}`).includes(norm(i.product.hero));
  const benefitHit = i.product.benefits.some((b) => norm(i.text.coreMessage).includes(norm(b).slice(0, 18)));
  const pr = i.product.sheetCompleteness * 6 + (heroHit ? 2 : 0) + (benefitHit ? 2 : 0);
  push("productRelevance", "Pertinence produit", pr, `${heroHit ? "le produit est au centre du message" : "le produit n'est pas nommé dans le message"} · ${benefitHit ? "bénéfice de la fiche repris" : "aucun bénéfice de la fiche cité"} · fiche ${Math.round(i.product.sheetCompleteness * 100)} % renseignée`, i.product.sheetCompleteness >= 0.8 ? "CALCULATED" : "MISSING");

  const lever = i.playbookLevers[AXIS_OF_TERRITORY[m.territory]];
  const hasPlaybook = Object.keys(i.playbookLevers).length > 0;
  push("brandFit", "Adéquation marque", hasPlaybook ? (lever !== undefined ? lever * 7 : 2) + (i.positioningHit ? 3 : 1) : 5 + (i.positioningHit ? 2 : 0), hasPlaybook ? (lever !== undefined ? `levier ${AXIS_OF_TERRITORY[m.territory].toLowerCase()} pondéré à ${Math.round(lever * 100)} % par la direction` : "levier non retenu par la direction pour cette marque") + (i.positioningHit ? " · cohérent avec le positionnement de la marque" : "") : "aucune conviction saisie pour la marque (Bibliothèque d'actions → Ce qui marche par marque) : neutre", hasPlaybook ? "INFERRED" : "MISSING");

  push("differentiation", "Différenciation", 10 * (1 - i.similarity), i.similarity >= 0.75 ? "très proche d'un contenu ou concept récent" : i.similarity >= 0.5 ? "partage la mécanique ou la tension d'un contenu récent" : "angle distinct du contenu récent", "CALCULATED");

  const fitDist = i.distribution === "PAID" ? m.paidFit : i.distribution === "ORGANIC" ? m.organicFit : (m.paidFit + m.organicFit) / 2;
  const aiStop = i.ai?.scrollStop;
  push("scrollStop", "Potentiel d'arrêt du scroll", aiStop ?? fitDist * 10, aiStop !== undefined ? "estimation de la revue créative (IA)" : `heuristique : adéquation ${i.distribution === "PAID" ? "payante" : i.distribution === "ORGANIC" ? "organique" : "mixte"} de la mécanique ${Math.round(fitDist * 100)} %`, "INFERRED");

  const aiEmo = i.ai?.emotionalTension;
  const emoBase = m.territory === "EMOTIONAL" || m.territory === "STORYTELLING" ? 8 : m.territory === "UGC" ? 7 : 5;
  push("emotionalTension", "Tension émotionnelle", aiEmo ?? emoBase, aiEmo !== undefined ? "estimation de la revue créative (IA)" : `heuristique : territoire ${m.territory.toLowerCase()}`, "INFERRED");

  const conv = i.funnelStage === "CONVERSION" ? m.paidFit * 10 : i.funnelStage === "CONSIDERATION" ? m.paidFit * 7 + 2 : m.paidFit * 5 + 2;
  push("conversionPotential", "Potentiel de conversion", conv, `étape ${i.funnelStage.toLowerCase()} · adéquation payante de la mécanique ${Math.round(m.paidFit * 100)} %`, "INFERRED");

  const feas = (m.complexity === "LOW" ? 9 : m.complexity === "MEDIUM" ? 7 : 4) - (m.personas[0] === "EXPERTE" ? 1 : 0);
  push("productionFeasibility", "Faisabilité de production", feas, `complexité ${m.complexity.toLowerCase()}${m.personas[0] === "EXPERTE" ? " · exige une experte à l'image" : ""}`, "CALCULATED");

  const hf = historicalFit(m, i.insights, i.product.productId);
  push("historicalFit", "Adéquation historique", hf.points, hf.why, hf.tag);

  return { overall: Math.max(0, Math.min(100, items.reduce((s, x) => s + x.points, 0))), items };
}

export const SCORE_LABELS: Record<ScoreKey, string> = {
  hook: "Force de l'accroche", consumerRelevance: "Pertinence consommateur", productRelevance: "Pertinence produit", brandFit: "Adéquation marque", differentiation: "Différenciation",
  scrollStop: "Arrêt du scroll", emotionalTension: "Tension émotionnelle", conversionPotential: "Potentiel de conversion", productionFeasibility: "Faisabilité", historicalFit: "Adéquation historique",
};
