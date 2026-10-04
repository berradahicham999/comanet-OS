/**
 * Moteur du générateur d'actions — logique PURE (testée sans base).
 *
 * Budget + objectif + marque + données COMANET → 3 à 5 actions marketing prêtes à exécuter, classées.
 *
 *  1. Filtre les modèles : levier, objectif compatible, type de produit, déjà au plan (exclu), hors budget (exclu).
 *  2. Adapte chaque modèle : budget proposé dans le disponible, détail poste par poste, rétroplanning daté avec
 *     responsables, contenus, portée et résultats attendus (hypothèses du modèle, ou coût par résultat Meta mesuré),
 *     KPI, nom et concept au produit, à la ville, à la cible, à la saison.
 *  3. Note la pertinence (objectif, budget, potentiel commercial, historique, saison, sell-out, cible, faisabilité,
 *     non-répétition) et classe. Les estimations sont des hypothèses (INFERRED), jamais présentées comme une mesure.
 */
import type { DataTag } from "@/lib/marketing-intel/types";
import { AXES, OBJECTIVES, TARGETS, COMPLEXITY_LABELS } from "./catalog";
import type {
  ActionProposal, ActionTemplate, AdaptCtx, AxisBudget, AxisKey, BudgetLineOut, Estimate, Excluded, GeneratorData, GeneratorInput,
  GeneratorResult, Level, ProductData, ProductKind, ScoreItem, StepOut, TemplateLine,
} from "./types";

const MS_DAY = 86_400_000;
const round100 = (v: number) => Math.round(v / 100) * 100;
const floor100 = (v: number) => Math.floor(v / 100) * 100;
const mad = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} MAD`;
const isoAdd = (iso: string, days: number) => new Date(new Date(iso + "T00:00:00Z").getTime() + days * MS_DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / MS_DAY);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* ------------------------------ Produit ------------------------------ */

const STOP_WORDS = new Set(["creme", "gel", "tube", "flacon", "pouch", "spray", "soin", "pump", "bottle", "foamer", "roll", "on", "ml", "gr", "le", "la", "les", "de", "des", "du", "et", "pour", "avec", "au", "aux", "en", "un", "une", "fluide", "masque", "nettoyant", "lait", "huile", "serum", "sérum", "boite", "boîte", "x", "p", "peau", "seche", "grasse", "mixte"]);

/** Mot-héros d'un produit pour nommer une action (« Pro Collagenium 30 sachets » → « Collagenium »). */
export function heroWord(p: { name: string; shortName?: string | null } | null, brandName: string): string {
  if (!p) return brandName;
  const brandTokens = new Set(norm(brandName).split(/[\s-]+/));
  const source = (p.shortName && p.shortName.trim()) || p.name;
  const tokens = source.split(/\s+/).map((t) => t.replace(/[(),.;:+]/g, "")).filter(Boolean);
  for (const t of tokens) {
    const n = norm(t);
    if (brandTokens.has(n) || STOP_WORDS.has(n)) continue;
    if (/^\d/.test(n) || n.length < 4) continue;
    return t.split("-").map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join("-");
  }
  return brandName;
}

const SUPPLEMENT_KW = ["gelule", "comprim", "sachet", "complement", "capsule", "poudre", "stick", "ampoule", "collag", "vitamin", "magnes", "omega", "probiot", "fer ", "zinc"];
const SUN_KW = ["solaire", "spf", "sun", "ecran", "apres-soleil", "uv"];

export function productKind(p: { name: string; category: string | null } | null): ProductKind | null {
  if (!p) return null;
  const hay = norm(`${p.name} ${p.category ?? ""}`);
  if (SUN_KW.some((k) => hay.includes(k))) return "SOLAIRE";
  if (SUPPLEMENT_KW.some((k) => hay.includes(k))) return "COMPLEMENT";
  return "DERMO";
}

/* ------------------------------ Textes à variables ------------------------------ */

/** Rend `{variable}` et `{variable|texte de repli}` ; une variable vide prend le repli (ou disparaît). */
export function renderPattern(pattern: string, vars: Record<string, string | null | undefined>): string {
  return pattern.replace(/\{([a-z]+)(?:\|([^}]*))?\}/gi, (_, k: string, fallback: string | undefined) => {
    const v = vars[k.toLowerCase()];
    return v && v.trim() ? v.trim() : fallback ?? "";
  }).replace(/\s{2,}/g, " ").replace(/\(\s*\)/g, "").trim();
}

/** Premier élément d'un champ de fiche produit (bénéfices, actifs, angle), en minuscule initiale, ≤ 90 caractères. */
export function firstItem(text: string | null | undefined): string | null {
  if (!text) return null;
  const first = text.split(/\n|;|•|\. |\|/).map((x) => x.replace(/^[-–*\s]+/, "").trim()).find((x) => x.length >= 3);
  if (!first) return null;
  const cut = first.length > 90 ? first.slice(0, 90).replace(/\s+\S*$/, "") : first.replace(/\.$/, "");
  return /^[A-ZÀ-Ý][a-zà-ÿ]/.test(cut) ? cut[0].toLowerCase() + cut.slice(1) : cut;
}

export function adaptVars(c: AdaptCtx): Record<string, string | null> {
  return { heros: c.hero, produit: c.product, marque: c.brand, ville: c.city, cible: c.target.toLowerCase(), benefice: c.benefit, actif: c.active, angle: c.angle, saison: c.season };
}

/** Valeur d'un KPI propre au modèle : fixe, ou budget × facteur ÷ coût unitaire. */
export function extraKpiValue(k: { value?: number | string; per?: number; factor?: number }, budget: number): string {
  if (k.value !== undefined) return String(k.value);
  if (k.per && k.per > 0) return Math.round((budget * (k.factor ?? 1)) / k.per).toLocaleString("fr-FR");
  return "—";
}

/* ------------------------------ Budget ------------------------------ */

/**
 * Budget disponible d'un levier : alloué − engagé − réservé (actions ouvertes non encore engagées). Sans allocation
 * sur le levier : disponible de l'enveloppe de la marque. Sans budget du tout : non défini (`null`).
 */
export function axisAvailable(i: { axis: AxisKey; allocated: number; committed: number; reserved: number; brandAvailable: number | null }): AxisBudget {
  if (i.allocated > 0) return { axis: i.axis, allocated: i.allocated, committed: i.committed, reserved: i.reserved, available: i.allocated - i.committed - i.reserved, source: "AXE" };
  if (i.brandAvailable !== null) return { axis: i.axis, allocated: 0, committed: i.committed, reserved: i.reserved, available: i.brandAvailable, source: "MARQUE" };
  return { axis: i.axis, allocated: 0, committed: i.committed, reserved: i.reserved, available: null, source: "AUCUN" };
}

/** Budget proposé pour un modèle : l'idéal du modèle s'il tient dans le disponible, sinon le disponible (≥ minimum). */
export function proposedBudget(t: Pick<ActionTemplate, "budget">, available: number): number | null {
  if (available < t.budget.min) return null;
  return available >= t.budget.typical ? t.budget.typical : Math.max(t.budget.min, floor100(available));
}

/** Détail poste par poste, arrondi à 100 MAD, somme exacte (l'écart d'arrondi va au plus gros poste). */
export function splitBudget(budget: number, lines: TemplateLine[]): BudgetLineOut[] {
  const out = lines.map((l) => ({ label: l.label, category: l.category, costItem: l.costItem ?? null, amount: round100(budget * l.share) }));
  const diff = budget - out.reduce((s, l) => s + l.amount, 0);
  if (diff !== 0 && out.length) { const big = out.reduce((m, l) => (l.amount > m.amount ? l : m), out[0]); big.amount += diff; }
  return out;
}

/* ------------------------------ Calendrier ------------------------------ */

export const dayLabel = (offset: number) => (offset === 0 ? "J" : offset < 0 ? `J${offset}` : `J+${offset}`);

/**
 * Jour J : milieu du mois pour un événement d'un jour, début du mois pour une opération longue ; jamais avant
 * aujourd'hui + délai de préparation. Renvoie aussi l'éventuel report.
 */
export function scheduleJ(t: Pick<ActionTemplate, "prepDays" | "durationDays">, month: string, today: string): { j: string; shifted: boolean } {
  const preferred = t.durationDays <= 3 ? isoAdd(month, 14) : month;
  const earliest = isoAdd(today, t.prepDays);
  return preferred >= earliest ? { j: preferred, shifted: false } : { j: earliest, shifted: true };
}

/* ------------------------------ Estimation ------------------------------ */

export function estimate(t: ActionTemplate, budget: number, product: ProductData | null, adsCost: GeneratorData["adsCost"]): Estimate {
  const r = t.reach;
  const mediaShare = t.lines.filter((l) => l.category === "META" || l.category === "TIKTOK" || l.category === "GOOGLE").reduce((s, l) => s + l.share, 0);
  const useAds = !!r.usesAdsCost && !!adsCost && adsCost.value > 0 && mediaShare > 0;
  const contacts = useAds ? Math.round((budget * mediaShare) / adsCost!.value) : Math.round(budget / r.costPerContact);
  const trials = Math.round(contacts * r.trialRate);
  const buyers = Math.round(trials * r.conversionRate);
  const units = Math.round(buyers * r.unitsPerBuyer);
  const price = product?.priceRetail ?? null;
  const revenue = price !== null && price > 0 ? Math.round(units * price) : null;
  const assumptions = [
    useAds ? `${Math.round(mediaShare * 100)} % du budget en diffusion au coût par ${adsCost!.label} mesuré de la marque (${adsCost!.value.toFixed(1)} MAD, 90 jours)` : `coût complet par ${r.contactLabel.replace(/s$/, "")} : ${r.costPerContact} MAD (modèle)`,
    `${Math.round(r.trialRate * 100)} % d'essai, ${Math.round(r.conversionRate * 100)} % d'achat après essai, ${r.unitsPerBuyer} unité(s) par achat (modèle)`,
    price !== null && price > 0 ? `prix public TTC du produit : ${mad(price)} (fiche produit)` : "prix public du produit inconnu : CA non mesurable",
  ];
  return { contacts, contactLabel: useAds ? adsCost!.label : r.contactLabel, trials, buyers, units, revenue, roi: revenue !== null && budget > 0 ? revenue / budget : null, costPerContact: useAds ? adsCost!.value : r.costPerContact, costSource: useAds ? "META" : "MODELE", assumptions };
}

export function impactLevel(e: Estimate): Level {
  if (e.buyers >= 100) return "TRES_ELEVE";
  if (e.buyers >= 40) return "ELEVE";
  if (e.buyers >= 15) return "MOYEN";
  return "FAIBLE";
}
export function roiLevel(e: Estimate): Level {
  if (e.roi === null) return "NON_MESURABLE";
  if (e.roi >= 3) return "TRES_ELEVE";
  if (e.roi >= 1.5) return "ELEVE";
  if (e.roi >= 0.8) return "MOYEN";
  return "FAIBLE";
}
export const LEVEL_LABELS: Record<Level, string> = { TRES_ELEVE: "très élevé", ELEVE: "élevé", MOYEN: "moyen", FAIBLE: "faible", NON_MESURABLE: "non mesurable" };

function objectiveText(input: GeneratorInput, e: Estimate, hero: string): string {
  const n = (v: number) => v.toLocaleString("fr-FR");
  switch (input.objective) {
    case "SELL_OUT": return `Générer ${n(e.trials)} essais et ${n(e.buyers)} ventes de ${hero}`;
    case "SELL_IN": return e.contactLabel === "officines" ? `Engager ${n(e.contacts)} officines et ${n(e.units)} unités commandées` : `Créer la demande : ${n(e.buyers)} ventes pour soutenir les commandes des pharmacies`;
    case "LANCEMENT": return `Faire essayer ${hero} à ${n(e.trials)} personnes et obtenir ${n(e.buyers)} premiers achats`;
    case "NOTORIETE": return `Toucher ${n(e.contacts)} ${e.contactLabel} et générer ${n(e.trials)} essais`;
    case "ACQUISITION": return `Recruter ${n(e.buyers)} nouvelles clientes (${n(e.trials)} essais)`;
    case "FIDELISATION": return `Faire racheter ${n(e.buyers)} clientes (${n(e.units)} unités)`;
    case "ECOULEMENT": return `Écouler ${n(e.units)} unités de ${hero}`;
  }
}

/* ------------------------------ Score ------------------------------ */

const PROFILE_POINTS: Record<string, number> = { STAR: 15, GROWTH: 14, CASH_COW: 11, STABLE: 9, UNDERPERFORMER: 6, INSUFFICIENT_DATA: 7 };

export function scoreTemplate(t: ActionTemplate, i: { input: GeneratorInput; data: GeneratorData; budget: number; j: string; kind: ProductKind | null; recentSame: { date: string; label: string } | null; recentType: { date: string; label: string } | null }): { score: number; items: ScoreItem[] } {
  const { input, data } = i;
  const items: ScoreItem[] = [];
  const fit = t.objectives[input.objective] ?? 0;
  items.push({ key: "objectif", label: "Cohérence avec l'objectif", points: Math.round(15 * fit), max: 15, why: `affinité ${Math.round(fit * 100)} % avec « ${OBJECTIVES[input.objective]} »`, tag: "INFERRED" });

  const budgetFit = Math.min(1, i.budget / t.budget.typical);
  items.push({ key: "budget", label: "Budget", points: Math.round(10 * budgetFit), max: 10, why: budgetFit >= 1 ? `budget idéal du modèle (${mad(t.budget.typical)}) finançable` : `budget ramené à ${mad(i.budget)} (idéal ${mad(t.budget.typical)})`, tag: "CALCULATED" });

  const p = data.product;
  const prof = p?.profile ?? null;
  const commercial = prof ? PROFILE_POINTS[prof] ?? 8 : 7;
  items.push({ key: "commercial", label: "Potentiel commercial", points: commercial, max: 15, why: prof ? `profil ${prof.toLowerCase().replace("_", " ")}${p?.growthPct !== null && p?.growthPct !== undefined ? `, sell-in ${p.growthPct >= 0 ? "+" : ""}${Math.round(p.growthPct)} % sur 90 jours` : ""}` : "performance produit non lue : neutre", tag: prof ? "CALCULATED" : "MISSING" });

  const pb = data.playbook;
  const favorite = !!pb && pb.favorites.includes(t.key);
  const avoided = !!pb && pb.avoid.includes(t.key);
  const lever = pb?.levers[t.axis];
  // Favori 10 ; levier pondéré jusqu'à 7 (un favori passe toujours devant les autres modèles de son levier) ; levier non retenu 3.
  const pbPoints = !pb ? 5 : avoided ? 0 : favorite ? 10 : lever !== undefined ? Math.round(7 * lever) : 3;
  items.push({ key: "marque", label: "Ce qui marche pour la marque", points: pbPoints, max: 10,
    why: !pb ? "aucune conviction saisie pour la marque (Bibliothèque d'actions → Ce qui marche par marque) : neutre" : avoided ? "modèle écarté pour cette marque par la direction" : favorite ? `modèle favori de la marque${pb.note ? ` — ${pb.note}` : ""}` : lever !== undefined ? `levier ${AXES[t.axis].label.toLowerCase()} pondéré à ${Math.round(lever * 100)} % pour la marque${pb.note ? ` — ${pb.note}` : ""}` : `levier non retenu pour la marque${pb.note ? ` — ${pb.note}` : ""}`,
    tag: pb ? "INFERRED" : "MISSING" });

  const verdict = data.verdicts[AXES[t.axis].mainCategory] ?? null;
  const hist = verdict === "SCALE" ? 10 : verdict === "MAINTAIN" ? 7 : verdict === "OPTIMIZE" ? 4 : verdict === "STOP" ? 1 : 5;
  items.push({ key: "historique", label: "Historique de performance", points: hist, max: 10, why: verdict ? `verdict du canal ${AXES[t.axis].label.toLowerCase()} sur 12 mois : ${verdict}` : "pas de verdict mesuré sur ce canal : neutre", tag: verdict ? "CALCULATED" : "MISSING" });

  const seasonHits = data.seasonEvents.map((e) => ({ e, v: t.seasons[e.key] ?? 0 }));
  const plus = seasonHits.filter((s) => s.v > 0), minus = seasonHits.filter((s) => s.v < 0);
  const season = plus.length && !minus.length ? 10 : minus.length && !plus.length ? 2 : 5;
  items.push({ key: "saison", label: "Saisonnalité", points: season, max: 10, why: plus.length ? `période favorable : ${plus.map((s) => s.e.label).join(", ")}` : minus.length ? `période peu favorable : ${minus.map((s) => s.e.label).join(", ")}` : "aucun événement saisonnier marquant sur la période", tag: "INFERRED" });

  const risk = p?.stockRisk ?? null;
  const sell = risk === "SURSTOCK" ? 10 : risk === "HEALTHY" ? 9 : risk === "NO_ROTATION" ? 5 : risk === null || risk === "UNKNOWN" ? 5 : 0;
  items.push({ key: "sellout", label: "Potentiel de sell-out (stock)", points: sell, max: 10, why: risk === "SURSTOCK" ? `surstock (${p?.daysOfStock ?? "—"} jours) : action d'écoulement pertinente` : risk === "HEALTHY" ? `stock sain${p?.daysOfStock ? ` (${p.daysOfStock} jours)` : ""}` : risk === null || risk === "UNKNOWN" ? "stock non renseigné : neutre" : `stock : ${risk.toLowerCase()}`, tag: risk === null || risk === "UNKNOWN" ? "MISSING" : "CALCULATED" });

  const targetOk = t.targets.includes(input.target);
  const kindOk = t.productKinds === "ANY" || !i.kind || t.productKinds.includes(i.kind);
  const brandFit = (targetOk ? 7 : 2) + (kindOk ? 3 : 0);
  items.push({ key: "adequation", label: "Adéquation cible et produit", points: brandFit, max: 10, why: `${targetOk ? "cible du modèle" : "cible secondaire pour ce modèle"} : ${TARGETS[input.target].toLowerCase()}`, tag: "INFERRED" });

  const lead = daysBetween(data.today, i.j);
  const feas = Math.max(0, Math.min(10, Math.round(10 * Math.min(1, lead / Math.max(1, t.prepDays))) - (t.complexity === "HIGH" ? 2 : 0)));
  items.push({ key: "faisabilite", label: "Faisabilité", points: feas, max: 10, why: `${lead} jours de préparation pour ${t.prepDays} nécessaires · complexité ${COMPLEXITY_LABELS[t.complexity]}`, tag: "CALCULATED" });

  if (i.recentSame) { items.push({ key: "repetition", label: "Non-répétition", points: -25, max: 0, why: `même action déjà réalisée le ${i.recentSame.date} (${i.recentSame.label})`, tag: "CONFIRMED" }); }
  else if (i.recentType) { items.push({ key: "repetition", label: "Non-répétition", points: -10, max: 0, why: `action de même type sur ce produit le ${i.recentType.date} (${i.recentType.label})`, tag: "CONFIRMED" }); }
  const total = items.reduce((s, x) => s + x.points, 0);
  return { score: Math.max(0, Math.min(100, total)), items };
}

/* ------------------------------ Génération ------------------------------ */

export function generate(input: GeneratorInput, data: GeneratorData, templates: ActionTemplate[], opts: { maxOptions?: number } = {}): GeneratorResult {
  const notes: string[] = [];
  const excluded: Excluded[] = [];
  const product = data.product;
  const kind = productKind(product);
  const hero = heroWord(product, data.brand.name);
  const axisBudget = input.axis ? data.budgets[input.axis] : null;
  const available = axisBudget ? axisBudget.available : data.brandAvailable;
  const budgetUsed = input.budget !== null && input.budget > 0 ? input.budget : available;
  const budgetSource: GeneratorResult["budgetSource"] = input.budget !== null && input.budget > 0 ? "SAISI" : axisBudget ? (axisBudget.source === "AUCUN" ? "AUCUN" : axisBudget.source) : data.brandAvailable !== null ? "MARQUE" : "AUCUN";
  const base = { input, budgetUsed: budgetUsed ?? null, budgetSource, available: available ?? null, axisBudget, excluded, notes };

  if (product && product.stockRisk === "RUPTURE_RISQUE") {
    return { ...base, options: [], blocked: `${product.name} est en risque de rupture${product.daysOfStock !== null ? ` (${product.daysOfStock} jours de couverture)` : ""} : toute action créerait des ruptures chez les clients. Réapprovisionner d'abord (Stock & achats → Prévision & commandes), puis revenir ici.` };
  }
  if (budgetUsed === null || budgetUsed <= 0) {
    return { ...base, options: [], blocked: budgetUsed !== null && budgetUsed <= 0 ? `Budget disponible épuisé (${mad(budgetUsed)}). Saisir un budget, réallouer depuis le plan ou attendre la prochaine enveloppe.` : "Aucun budget défini pour cette marque ou ce levier : saisir le budget disponible pour générer des actions." };
  }
  if (input.budget !== null && available !== null && input.budget > available) notes.push(`Le budget saisi (${mad(input.budget)}) dépasse le disponible calculé (${mad(available)}) : l'ajout au plan dépassera l'enveloppe.`);

  const openKeys = new Set(data.history.filter((h) => h.open && h.templateKey).map((h) => h.templateKey as string));
  const candidates: ActionProposal[] = [];
  for (const t of templates) {
    if (input.axis && t.axis !== input.axis) continue;
    const fit = t.objectives[input.objective];
    if (!fit) continue;
    const sheet = { benefit: firstItem(product?.benefits), active: firstItem(product?.actives), angle: firstItem(product?.marketingAngle) };
    const name = renderPattern(t.name, adaptVars({ hero, brand: data.brand.name, product: product?.name ?? null, target: TARGETS[input.target], city: data.topCity, season: null, month: input.month, ...sheet }));
    if (t.onlyWhen) {
      const m = Number(input.month.slice(5, 7));
      const ok = (t.onlyWhen.seasons ?? []).some((k) => data.seasonEvents.some((e) => e.key === k)) || (t.onlyWhen.months ?? []).includes(m);
      if (!ok) { excluded.push({ templateKey: t.key, name, reason: `réservé à : ${t.onlyWhen.label}` }); continue; }
    }
    if (data.playbook?.avoid.includes(t.key)) { excluded.push({ templateKey: t.key, name, reason: "écarté pour cette marque (ce qui marche par marque)" }); continue; }
    if (t.productKinds !== "ANY" && kind && !t.productKinds.includes(kind)) { excluded.push({ templateKey: t.key, name, reason: kind === "COMPLEMENT" ? "non adapté à un complément alimentaire" : "non adapté à ce type de produit" }); continue; }
    if (openKeys.has(t.key)) { const h = data.history.find((x) => x.open && x.templateKey === t.key)!; excluded.push({ templateKey: t.key, name, reason: `déjà au plan : « ${h.label} »` }); continue; }
    // Sans levier imposé ni budget saisi, chaque modèle est borné par le disponible de SON levier quand une allocation existe.
    const ab0 = data.budgets[t.axis];
    const cap = input.axis || (input.budget !== null && input.budget > 0) || ab0.source !== "AXE" || ab0.available === null ? budgetUsed : Math.min(budgetUsed, ab0.available);
    if (cap <= 0) { excluded.push({ templateKey: t.key, name, reason: `budget ${AXES[t.axis].label.toLowerCase()} épuisé` }); continue; }
    const budget = proposedBudget(t, cap);
    if (budget === null) { excluded.push({ templateKey: t.key, name, reason: `hors budget (minimum ${mad(t.budget.min)}, disponible ${mad(cap)})` }); continue; }
    const { j, shifted } = scheduleJ(t, input.month, data.today);
    const cutoffSame = isoAdd(data.today, -t.cooldownDays);
    const recentSame = data.history.filter((h) => !h.open && h.templateKey === t.key && h.date >= cutoffSame).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
    const actType = t.execution.kind === "ACTIVATION" ? t.execution.activationType : null;
    const recentType = actType && product ? data.history.filter((h) => h.kind === "ACTIVATION" && h.activationType === actType && h.productId === product.id && h.date >= isoAdd(data.today, -90)).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null : null;
    const { score, items } = scoreTemplate(t, { input, data, budget, j, kind, recentSame, recentType });
    const est = estimate(t, budget, product, data.adsCost);
    const seasonLabel = data.seasonEvents.find((e) => (t.seasons[e.key] ?? 0) > 0)?.label ?? null;
    const ctx: AdaptCtx = { hero, brand: data.brand.name, product: product?.name ?? null, target: TARGETS[input.target], city: t.cityBased ? data.topCity : null, season: seasonLabel, month: input.month, ...sheet };
    const vars = adaptVars(ctx);
    const end = isoAdd(j, Math.max(0, t.durationDays - 1));
    const steps: StepOut[] = t.steps.map((s) => {
      const who = data.team[s.role] ?? null;
      return { offset: s.offset, dayLabel: dayLabel(s.offset), date: isoAdd(j, s.offset), label: s.label, role: s.role, assigneeId: who?.id ?? null, assigneeName: who?.name ?? null };
    }).sort((a, b) => a.offset - b.offset);
    const warnings: string[] = [];
    if (shifted) warnings.push(`Délai de préparation de ${t.prepDays} jours : jour J reporté au ${j}.`);
    if (t.cityBased && !data.topCity) warnings.push("Ville à choisir : aucune vente rattachée à une ville pour cette marque.");
    if (t.posBased && !data.topPos.length) warnings.push("Pharmacies à choisir : aucun client avec des ventes récentes de la marque.");
    if (t.key === "DG_RETARGETING" && !data.adsCost) warnings.push("Reciblage : nécessite une audience Meta existante (aucune donnée publicitaire récente pour la marque).");
    if (input.objective === "ECOULEMENT" && product?.stockRisk !== "SURSTOCK") warnings.push("Écoulement demandé alors que le stock n'est pas qualifié de surstock.");
    if (est.revenue === null) warnings.push("Prix public du produit manquant : CA et ROI non mesurables (compléter la fiche produit).");
    const kpis = [
      { label: est.contactLabel[0].toUpperCase() + est.contactLabel.slice(1), target: est.contacts.toLocaleString("fr-FR"), tag: "INFERRED" as DataTag },
      { label: "Essais", target: est.trials.toLocaleString("fr-FR"), tag: "INFERRED" as DataTag },
      { label: "Ventes", target: `${est.buyers.toLocaleString("fr-FR")} (${est.units.toLocaleString("fr-FR")} unités)`, tag: "INFERRED" as DataTag },
      { label: "CA sell-out (TTC)", target: est.revenue === null ? "non mesurable" : mad(est.revenue), tag: (est.revenue === null ? "MISSING" : "INFERRED") as DataTag },
      { label: "Coût par essai", target: est.trials > 0 ? mad(budget / est.trials) : "—", tag: "CALCULATED" as DataTag },
      { label: "ROI (CA ÷ budget)", target: est.roi === null ? "non mesurable" : `${est.roi.toFixed(1)}×`, tag: (est.roi === null ? "MISSING" : "INFERRED") as DataTag },
      ...t.extraKpis.map((k) => ({ label: k.label, target: extraKpiValue(k, budget), tag: (k.value === "mesuré" ? "CONFIRMED" : "INFERRED") as DataTag })),
    ];
    const ab = data.budgets[t.axis];
    const whyNow: string[] = [];
    if (product?.growthPct !== null && product?.growthPct !== undefined) whyNow.push(`${hero} : sell-in ${product.growthPct >= 0 ? "+" : ""}${Math.round(product.growthPct)} % sur 90 jours`);
    else if (product?.profile) whyNow.push(`${hero} : profil ${product.profile.toLowerCase().replace("_", " ")}`);
    if (product?.stockRisk === "SURSTOCK") whyNow.push(`surstock de ${product.daysOfStock ?? "—"} jours à écouler`);
    if (ab.available !== null) whyNow.push(`${mad(ab.available)} disponibles en ${AXES[t.axis].label.toLowerCase()}${ab.source === "MARQUE" ? " (enveloppe de la marque)" : ""}`);
    if (seasonLabel) whyNow.push(`période favorable : ${seasonLabel}`);
    if (data.playbook && (data.playbook.favorites.includes(t.key) || (data.playbook.levers[t.axis] ?? 0) >= 0.7)) whyNow.push(`ce qui marche pour ${data.brand.name} : ${AXES[t.axis].label.toLowerCase()}${data.playbook.note ? ` (${data.playbook.note})` : ""}`);
    if (t.axis === "MEDICAL" && data.prescribers && data.prescribers.total > 0) whyNow.push(`${data.prescribers.a + data.prescribers.b} médecins de potentiel A ou B liés à la marque dans la base médicale`);
    if (!recentSame && !recentType) whyNow.push("aucune action de ce type récente pour la marque");
    const facts = [
      ...(product ? [
        { label: "Produit", value: product.name, tag: "CONFIRMED" as DataTag },
        { label: "CA sell-in 90 jours", value: product.revenue90 === null ? "non lu" : mad(product.revenue90), tag: (product.revenue90 === null ? "MISSING" : "CONFIRMED") as DataTag },
        { label: "Croissance 90 jours", value: product.growthPct === null ? "pas encore comparable" : `${product.growthPct >= 0 ? "+" : ""}${Math.round(product.growthPct)} %`, tag: (product.growthPct === null ? "MISSING" : "CALCULATED") as DataTag },
        { label: "Couverture de stock", value: product.daysOfStock === null ? "non mesurable" : `${product.daysOfStock} jours`, tag: (product.daysOfStock === null ? "MISSING" : "CALCULATED") as DataTag },
        { label: "Prix public TTC", value: product.priceRetail === null ? "non renseigné" : mad(product.priceRetail), tag: (product.priceRetail === null ? "MISSING" : "CONFIRMED") as DataTag },
        { label: "Bénéfice (fiche produit)", value: sheet.benefit ?? "fiche marketing à compléter", tag: (sheet.benefit ? "CONFIRMED" : "MISSING") as DataTag },
      ] : []),
      { label: `Budget ${AXES[t.axis].label.toLowerCase()} disponible`, value: ab.available === null ? "non défini" : mad(ab.available), tag: (ab.available === null ? "MISSING" : "CALCULATED") as DataTag },
      ...(est.costSource === "META" ? [{ label: "Coût par résultat Meta (90 j)", value: `${est.costPerContact.toFixed(1)} MAD`, tag: "CALCULATED" as DataTag }] : []),
    ];
    candidates.push({
      key: `${t.key}:${input.brandId}:${input.productId ?? "marque"}:${input.month}`,
      templateKey: t.key, axis: t.axis, family: t.family, name: renderPattern(t.name, vars), objectiveText: objectiveText(input, est, hero), concept: renderPattern(t.concept, vars), target: TARGETS[input.target],
      products: product ? [product.name] : [], channels: t.channels, budget, lines: splitBudget(budget, t.lines), eventDate: j, endDate: end, steps,
      contents: t.contents.map((c) => ({ format: c.format, count: c.count, title: c.title, date: isoAdd(j, c.offset) })),
      kpis, estimate: est, impact: impactLevel(est), roiLevel: roiLevel(est), complexity: t.complexity, score, scoreItems: items,
      why: whyNow.slice(0, 4), warnings,
      suggestions: { pos: t.posBased ? data.topPos.slice(0, 8).map((p) => `${p.name}${p.city ? ` (${p.city})` : ""}`) : [], influencers: t.influencerBased ? data.influencers.filter((x) => x.usualRate === null || x.usualRate <= budget * 0.5).slice(0, 5).map((x) => `${x.name}${x.followers ? ` · ${Math.round(x.followers / 1000)} k abonnés` : ""}${x.collabs ? ` · ${x.collabs} collab. avec la marque` : ""}`) : [], city: t.cityBased ? data.topCity : null },
      execution: t.execution, compliance: t.compliance ?? null, data: facts,
    });
  }
  const fav = (c: ActionProposal) => (data.playbook?.favorites.includes(c.templateKey) ? 1 : 0);
  candidates.sort((a, b) => b.score - a.score || fav(b) - fav(a) || (b.estimate.revenue ?? 0) - (a.estimate.revenue ?? 0) || a.budget - b.budget);
  const max = Math.max(1, opts.maxOptions ?? 5);
  // Diversité : sans levier imposé, au plus 2 options par levier dans le premier choix.
  let options: ActionProposal[];
  if (input.axis) options = candidates.slice(0, max);
  else {
    options = [];
    const perAxis = new Map<AxisKey, number>();
    for (const c of candidates) { if (options.length >= max) break; const n = perAxis.get(c.axis) ?? 0; if (n >= 2) continue; perAxis.set(c.axis, n + 1); options.push(c); }
  }
  if (!candidates.length && !excluded.length) notes.push(`Aucun modèle de la bibliothèque ne répond à « ${OBJECTIVES[input.objective]} »${input.axis ? ` en ${AXES[input.axis].label.toLowerCase()}` : ""}.`);
  return { ...base, options, blocked: null };
}

/** Budget restant après l'ajout d'une action (affiché « 45 000 → 30 000 MAD »). */
export function remainingAfter(available: number | null, budget: number): number | null {
  return available === null ? null : available - budget;
}
