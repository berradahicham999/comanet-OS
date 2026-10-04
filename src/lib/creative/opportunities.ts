/**
 * Moteur d'opportunités créatives (logique PURE).
 *
 * DONNÉE → PRIORITÉ → OBJECTIF → PRODUIT → TENSION → TERRITOIRE / MÉCANIQUE. À partir du contexte lu par le serveur
 * (`CreativeData`) : les tensions activées par la fiche produit, la meilleure mécanique pour chacune (objectif, étape du
 * tunnel, convictions de la direction, apprentissages mesurés, fatigue), un score explicable, le « pourquoi maintenant »,
 * les territoires saturés et le budget du levier. Une opportunité est recalculée à chaque lecture, jamais stockée : sa
 * clé la rend rejouable.
 */
import { matchTensions, tensionOf, type TensionMatch } from "./consumer";
import { fatigueOf, saturatedTerritories } from "./fingerprint";
import { historicalFit } from "./learning";
import { AXIS_OF_TERRITORY, scoreOpportunity } from "./scoring";
import { MECHANICS, TERRITORY_LABELS, mechanicOf } from "./territories";
import type { AxisKey, Confidence, ConsumerTension, CreativeData, CreativeMechanic, CreativeOpportunity, CreativeThresholds, Fact, ObjectiveKey, ScoreItem, TerritoryKey } from "./types";

const mad = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} MAD`;

export type RankedMechanic = { mechanic: CreativeMechanic; points: number; why: string[]; fit: Omit<ScoreItem, "key" | "label" | "max">; fatigue: number };

/** Budget du levier d'un territoire (contenu, digital, influence), tel que lu par le serveur. */
export function budgetFor(data: CreativeData, territory: TerritoryKey): { axis: AxisKey; available: number | null; source: string } {
  const axis = AXIS_OF_TERRITORY[territory];
  const b = data.business.budgets[axis];
  return { axis, available: b?.available ?? null, source: b?.source ?? "AUCUN" };
}

/**
 * Classement des mécaniques pour une tension : objectif, étape du tunnel, adéquation de diffusion, convictions de la
 * direction (levier), apprentissage mesuré, fatigue, et garde-fous de fiche (pas de « zoom actif » sans actif, pas de
 * « preuve » sans allégation, pas d'« offre » hors écoulement).
 */
export function rankMechanics(data: CreativeData, tension: ConsumerTension, opts: { exclude?: string[]; territory?: TerritoryKey | null } = {}): RankedMechanic[] {
  const b = data.business, p = data.product;
  const out: RankedMechanic[] = [];
  for (const m of MECHANICS) {
    if (!m.productTypes.includes(p.category)) continue;
    if (opts.territory && m.territory !== opts.territory) continue;
    if (opts.exclude?.includes(m.key)) continue;
    const why: string[] = [];
    let pts = 0;
    const objFit = m.objectives.includes(b.objective);
    pts += objFit ? 10 : 2;
    why.push(objFit ? `sert l'objectif « ${b.objectiveLabel.toLowerCase()} »` : "objectif secondaire pour cette mécanique");
    pts += m.funnelStages.includes(b.funnelStage) ? 6 : 1;
    pts += tension.funnelStages.some((f) => m.funnelStages.includes(f)) ? 3 : 0;
    const dist = b.funnelStage === "CONVERSION" ? m.paidFit : b.funnelStage === "AWARENESS" ? m.organicFit : (m.paidFit + m.organicFit) / 2;
    pts += Math.round(dist * 8);
    const lever = data.playbookLevers[AXIS_OF_TERRITORY[m.territory]];
    if (lever !== undefined) { pts += Math.round(lever * 6); if (lever >= 0.7) why.push(`levier ${AXIS_OF_TERRITORY[m.territory].toLowerCase()} retenu par la direction pour ${b.brandName}`); }
    const fit = historicalFit(m, data.insights, p.productId);
    pts += fit.points;
    if (fit.tag !== "MISSING") why.push(fit.why);
    const fatigue = fatigueOf(m.key, data.usage);
    pts -= Math.round(fatigue * 12);
    if (fatigue >= 0.5) why.push("mécanique déjà très utilisée récemment");
    if (m.key === "ED_INGREDIENT" && !p.actives.length) { pts -= 8; why.push("aucun actif renseigné sur la fiche : zoom actif impossible"); }
    if (m.key === "PF_PROOF" && !p.claims.length) { pts -= 6; why.push("aucune allégation renseignée sur la fiche : preuve impossible"); }
    if (m.key === "PF_OFFER" && b.objective !== "ECOULEMENT") pts -= 5;
    if (m.key === "PF_BENEFIT_FIRST" && !p.benefits.length) { pts -= 6; why.push("aucun bénéfice renseigné sur la fiche"); }
    if (p.category === "SUPPLEMENT" && (m.key === "ST_TRANSFORMATION")) pts -= 2;
    out.push({ mechanic: m, points: pts, why, fit, fatigue });
  }
  return out.sort((a, b2) => b2.points - a.points || a.mechanic.name.localeCompare(b2.mechanic.name));
}

/** Choix diversifié dans un classement : au plus `perTerritory` mécaniques par territoire. */
export function pickDiverse(ranked: RankedMechanic[], n: number, perTerritory = 2): RankedMechanic[] {
  const out: RankedMechanic[] = [];
  const count = new Map<TerritoryKey, number>();
  for (const r of ranked) {
    if (out.length >= n) break;
    const c = count.get(r.mechanic.territory) ?? 0;
    if (c >= perTerritory) continue;
    count.set(r.mechanic.territory, c + 1);
    out.push(r);
  }
  return out;
}

export function opportunityKey(o: { brandId: string; productId: string | null; objective: ObjectiveKey; tensionKey: string; mechanic: string }): string {
  return [o.brandId, o.productId ?? "marque", o.objective, o.tensionKey, o.mechanic].join(":");
}

export function parseOpportunityKey(key: string): { brandId: string; productId: string | null; objective: ObjectiveKey; tensionKey: string; mechanic: string } | null {
  const [brandId, product, objective, tensionKey, mechanic] = key.split(":");
  if (!brandId || !product || !objective || !tensionKey || !mechanic) return null;
  if (!tensionOf(tensionKey) || !mechanicOf(mechanic)) return null;
  return { brandId, productId: product === "marque" ? null : product, objective: objective as ObjectiveKey, tensionKey, mechanic };
}

function confidenceOf(data: CreativeData, mt: TensionMatch): { confidence: Confidence; why: string[] } {
  const p = data.product;
  const missing: string[] = [];
  if (mt.score === 0) missing.push("aucune tension activée par la fiche produit (tension par défaut)");
  if (p.sheetCompleteness < 0.6) missing.push(`fiche marketing incomplète (${p.missing.join(", ")})`);
  if (!p.profile) missing.push("performance produit non lue");
  if (!data.insights.length) missing.push("aucun apprentissage créatif mesuré pour la marque");
  const confidence: Confidence = missing.length === 0 ? "HIGH" : missing.length <= 1 ? "MEDIUM" : "LOW";
  return { confidence, why: missing.length ? missing.map((m) => `donnée manquante : ${m}`) : ["tension, fiche produit, performance et apprentissages disponibles"] };
}

export type BlockReason = string | null;

/** Raison de ne pas produire : rupture de stock, ou diagnostic demandé par le moteur marketing. */
export function blockReason(data: CreativeData): BlockReason {
  const p = data.product, b = data.business;
  if (p.stockRisk === "RUPTURE_RISQUE") return `${p.name} est en risque de rupture${p.daysOfStock !== null ? ` (${p.daysOfStock} jours de couverture)` : ""} : créer de la demande maintenant transformerait les ventes en ruptures chez les clients. Réapprovisionner d'abord.`;
  if (b.priorityAction === "DO_NOT_PROMOTE") return "Le moteur marketing recommande de diagnostiquer avant toute action (ventes en baisse et stock court) : pas de contenu de demande tant que la cause n'est pas connue.";
  return null;
}

/**
 * Opportunités d'un contexte (marque × produit × objectif) : une par tension activée (3 au plus), chacune avec la
 * meilleure mécanique disponible, en évitant de répéter un territoire. Classées par score.
 */
export function buildOpportunities(data: CreativeData, t: CreativeThresholds, opts: { max?: number; forced?: { tensionKey: string; mechanic: string } | null } = {}): CreativeOpportunity[] {
  const b = data.business, p = data.product;
  const matched = matchTensions(p);
  // Une seule tension activée : on propose quand même deux angles (deux territoires) sur cette tension.
  const matches = opts.forced ? [{ tension: tensionOf(opts.forced.tensionKey)!, score: matched.find((m) => m.tension.key === opts.forced!.tensionKey)?.score ?? 0, hits: matched.find((m) => m.tension.key === opts.forced!.tensionKey)?.hits ?? [] }] : matched.length >= 2 ? matched.slice(0, 3) : [matched[0], matched[0]];
  const saturated = saturatedTerritories(data.usage, t.saturationMinCount);
  const blocked = blockReason(data);
  const usedMech = new Set<string>();
  const usedTerr = new Map<TerritoryKey, number>();
  const out: CreativeOpportunity[] = [];
  for (const mt of matches) {
    const ranked = rankMechanics(data, mt.tension, { exclude: [...usedMech] });
    const pick = opts.forced ? ranked.find((r) => r.mechanic.key === opts.forced!.mechanic) ?? ranked[0] : ranked.find((r) => (usedTerr.get(r.mechanic.territory) ?? 0) < 1 && !saturated.includes(r.mechanic.territory)) ?? ranked.find((r) => (usedTerr.get(r.mechanic.territory) ?? 0) < 1) ?? ranked[0];
    if (!pick) continue;
    const m = pick.mechanic;
    usedMech.add(m.key);
    usedTerr.set(m.territory, (usedTerr.get(m.territory) ?? 0) + 1);
    const budget = budgetFor(data, m.territory);
    const { score, items } = scoreOpportunity({ priorityAction: b.priorityAction, prioritySignal: b.commercialPriority, product: p, tensionScore: mt.score, tensionLabel: mt.tension.label, budgetAvailable: budget.available, budgetAxis: budget.axis, fit: pick.fit, fatigue: pick.fatigue, season: b.season });
    const learning = data.insights.filter((i) => i.mechanic === m.key || (i.territory === m.territory && !i.mechanic) || i.hookType === m.defaultHook).slice(0, 3).map((i) => i.statement);
    const reasoning = [
      b.commercialPriority,
      mt.score > 0 ? `tension « ${mt.tension.label} » activée par la fiche produit${mt.hits.length ? ` (${mt.hits.slice(0, 3).join(", ")})` : ""}` : `tension par défaut de la catégorie « ${mt.tension.label} » : la fiche produit n'en active aucune`,
      `${m.name} (${TERRITORY_LABELS[m.territory].toLowerCase()}) : ${pick.why[0]}`,
      ...(learning.length ? [learning[0]] : []),
      ...(pick.fatigue < 0.2 ? ["angle peu ou pas exploré récemment"] : saturated.length ? [`territoires saturés récemment : ${saturated.map((s) => TERRITORY_LABELS[s].toLowerCase()).join(", ")}`] : []),
      ...(budget.available !== null && budget.available > 0 ? [`${mad(budget.available)} disponibles en ${budget.axis.toLowerCase()}`] : []),
    ].slice(0, 5);
    const facts: Fact[] = [
      ...(p.productId ? [
        { label: "CA sell-in 90 jours", value: p.revenue90 === null ? "non lu" : mad(p.revenue90), tag: (p.revenue90 === null ? "MISSING" : "CONFIRMED") as Fact["tag"] },
        { label: "Croissance 90 jours", value: p.growthPct === null ? "pas encore comparable" : `${p.growthPct >= 0 ? "+" : ""}${Math.round(p.growthPct)} %`, tag: (p.growthPct === null ? "MISSING" : "CALCULATED") as Fact["tag"] },
        { label: "Couverture de stock", value: p.daysOfStock === null ? "non mesurable" : `${p.daysOfStock} jours`, tag: (p.daysOfStock === null ? "MISSING" : "CALCULATED") as Fact["tag"] },
        { label: "Prix public TTC", value: p.priceRetail === null ? "non renseigné" : mad(p.priceRetail), tag: (p.priceRetail === null ? "MISSING" : "CONFIRMED") as Fact["tag"] },
      ] : []),
      { label: "Fiche marketing", value: `${Math.round(p.sheetCompleteness * 100)} % renseignée`, tag: (p.sheetCompleteness >= 0.8 ? "CONFIRMED" : "MISSING") as Fact["tag"] },
      { label: `Budget ${budget.axis.toLowerCase()}`, value: budget.available === null ? "non défini" : mad(budget.available), tag: (budget.available === null ? "MISSING" : "CALCULATED") as Fact["tag"] },
      { label: "Contenus récents (fenêtre de fatigue)", value: String(data.usage.filter((u) => u.mechanic === null).reduce((s, u) => s + u.count, 0)), tag: "CONFIRMED" as Fact["tag"] },
    ];
    const c = confidenceOf(data, mt);
    out.push({
      key: opportunityKey({ brandId: b.brandId, productId: p.productId, objective: b.objective, tensionKey: mt.tension.key, mechanic: m.key }),
      brandId: b.brandId, brandName: b.brandName, brandColor: b.brandColor, productId: p.productId, productName: p.productId ? p.name : null, category: p.category,
      objective: b.objective, businessObjective: b.objectiveLabel, commercialPriority: b.commercialPriority, priorityAction: b.priorityAction, funnelStage: b.funnelStage, audience: b.audience,
      tensionKey: mt.tension.key, consumerProblem: mt.tension.problem, consumerTension: mt.tension.label, consumerDesire: mt.tension.desire, consumerObjection: mt.tension.objection,
      recommendedTerritory: m.territory, recommendedMechanic: m.key, mechanicName: m.name,
      reasoning, opportunityScore: blocked ? Math.min(score, 30) : score, scoreItems: items, confidence: c.confidence, confidenceWhy: c.why,
      priority: blocked ? "LOW" : score >= 70 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW",
      saturated: saturated.map((s) => TERRITORY_LABELS[s]), learning, data: facts, budget, blocked,
    });
  }
  return out.sort((a, b2) => b2.opportunityScore - a.opportunityScore).slice(0, opts.max ?? t.maxOpportunities);
}
