/**
 * Squelettes déterministes (logique PURE) : concept, package de contenu et variations SANS modèle de langage.
 *
 * Ils servent de repli quand le copilote n'est pas configuré ou indisponible (le studio reste utilisable, et le dit :
 * `generatedBy: "RULES"`), de base de test, et d'ossature que l'IA enrichit (structure, durées, KPI, mentions, budget
 * de test restent déterministes même avec l'IA). Tout texte vient des patrons de la mécanique, de la tension et de la
 * fiche produit : aucun bénéfice, actif ou chiffre n'est inventé.
 */
import { tensionOf } from "./consumer";
import { checkConcept, checkPackage, mandatoryMentions } from "./compliance";
import { creativeFingerprint, nearestRecent } from "./fingerprint";
import { pickDiverse, rankMechanics } from "./opportunities";
import { scoreConcept } from "./scoring";
import { FORMAT_LABELS, HOOK_LABELS, MECHANICS, PERSONA_LABELS, TERRITORY_LABELS, mechanicOf, mechanicsOf } from "./territories";
import type {
  ConsumerTension, ContentPackage, CreativeConcept, CreativeData, CreativeFormat, CreativeMechanic, CreativeOpportunity, CreativeThresholds, CreatorPersona,
  Distribution, DistributionVersion, Hook, HookType, KpiOut, Scene, ScriptVersion, Shot, Variation, VariationSet,
} from "./types";

/* ------------------------------ Textes à variables ------------------------------ */

/** `{clé}` et `{clé|repli}` avec des clés accentuées ; une variable vide prend le repli ou disparaît. */
export function fill(pattern: string, vars: Record<string, string | null | undefined>): string {
  return pattern.replace(/\{([\p{L}_]+)(?:\|([^}]*))?\}/gu, (_, k: string, fallback: string | undefined) => {
    const v = vars[k.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()];
    return v && v.trim() ? v.trim() : fallback ?? "";
  }).replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

const lower1 = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const strip = (s: string) => s.replace(/[.!?]+$/, "");

export function conceptVars(data: CreativeData, t: ConsumerTension, m: CreativeMechanic, persona: CreatorPersona): Record<string, string | null> {
  const p = data.product;
  return {
    produit: p.productId ? p.hero : p.brandName, marque: p.brandName, heros: p.hero, sujet: lower1(t.label), probleme: lower1(strip(t.problem)), frustration: lower1(strip(t.frustration)),
    desir: lower1(strip(t.desire)), objection: strip(t.objection), mythe: strip(t.belief), question: t.question, benefice: p.benefits[0] ? lower1(strip(p.benefits[0])) : null,
    actif: p.actives[0] ?? null, cible: data.business.audience.toLowerCase(), tension: lower1(t.label), moment: p.category === "SUPPLEMENT" ? "du matin" : "du soir",
    persona: PERSONA_LABELS[persona].split(" ")[0].toLowerCase(), experte: p.category === "SUPPLEMENT" ? "nutritionniste" : "dermatologue", duree: "7 jours", date: null, offre: null, situation: lower1(strip(t.problem)),
    contrainte: p.category === "SUPPLEMENT" ? "y penser" : "texture collante", compensation: p.category === "SUPPLEMENT" ? "café" : "fond de teint", geste: p.category === "SUPPLEMENT" ? "commencé ma cure" : "changé ma routine", detail: lower1(strip(t.frustration)),
    "produit a": p.hero, "produit b": "l'autre référence de la gamme",
  };
}

/* ------------------------------ Concept ------------------------------ */

const HOOK_TEMPLATES: Record<HookType, string[]> = {
  CURIOSITY: ["Personne ne m'avait dit ça sur {sujet}.", "Le détail que tout le monde rate avec {sujet}."],
  PROBLEM: ["Si vous aussi, {probleme}…", "Marre de {frustration} ? On en parle."],
  CONTRARIAN: ["« {mythe} » : faux. Voilà pourquoi.", "On vous a menti sur {sujet}."],
  PERSONAL: ["J'ai testé {produit} pendant {duree}. Voilà ce que j'en pense, sans filtre.", "Je n'en avais jamais parlé : {probleme}."],
  EXPERT: ["Ce qu'une {experte} regarde en premier sur {sujet}.", "En consultation, la question qui revient : {question}"],
};

const DEFAULT_FORMAT_BY_DIST: Record<Distribution, CreativeFormat[]> = { ORGANIC: ["REEL", "UGC", "CARROUSEL", "STORY", "POST", "VIDEO"], PAID: ["UGC", "REEL", "VIDEO", "CARROUSEL", "POST", "STORY"], BOTH: ["REEL", "UGC", "VIDEO", "CARROUSEL", "POST", "STORY"] };

export function distributionOf(data: CreativeData, m: CreativeMechanic): Distribution {
  const f = data.business.funnelStage;
  if (f === "CONVERSION" && m.paidFit >= 0.75) return m.organicFit >= 0.75 ? "BOTH" : "PAID";
  if (f === "AWARENESS" && m.organicFit >= 0.75) return m.paidFit >= 0.7 ? "BOTH" : "ORGANIC";
  return "BOTH";
}

export function formatOf(data: CreativeData, m: CreativeMechanic, dist: Distribution): CreativeFormat {
  const active = new Set(data.formats.map((f) => f.key));
  const pref = DEFAULT_FORMAT_BY_DIST[dist].filter((f) => m.formats.includes(f));
  return pref.find((f) => active.size === 0 || active.has(f)) ?? m.formats[0];
}

export type ConceptDraft = Omit<CreativeConcept, "scores" | "fingerprint" | "similarity" | "compliance" | "review" | "generatedBy">;

/** Concept déterministe : patrons de la mécanique × tension × fiche produit. */
export function draftConcept(data: CreativeData, m: CreativeMechanic, t: ConsumerTension, opts: { hookType?: HookType; persona?: CreatorPersona; distribution?: Distribution } = {}): ConceptDraft {
  const p = data.product, b = data.business;
  const persona = opts.persona ?? m.personas[0];
  const hookType = opts.hookType ?? m.defaultHook;
  const distribution = opts.distribution ?? distributionOf(data, m);
  const vars = conceptVars(data, t, m, persona);
  const benefit = p.benefits[0] ? lower1(strip(p.benefits[0])) : null;
  const hook = fill(m.hookPatterns[0] ?? HOOK_TEMPLATES[hookType][0], vars);
  const structure = (m.narrativeStructures[0] ?? "").split("→").map((s) => s.trim()).filter(Boolean);
  return {
    title: `${m.name} — ${p.hero} × ${t.label}`,
    bigIdea: `${strip(fill(hook, vars))} — ${m.name} autour de « ${lower1(t.label)} » (${lower1(strip(m.bestFor))}).`,
    consumerTension: `${t.problem} ${t.frustration}`,
    tensionKey: t.key,
    insight: `${t.belief} Pourtant : ${lower1(t.misconception)} ${t.desire}`,
    creativeTerritory: m.territory, mechanic: m.key, mechanicName: m.name, psychologicalTrigger: m.psychologicalTrigger,
    coreMessage: benefit ? `${p.hero} : ${benefit}${p.priceRetail ? ` — ${Math.round(p.priceRetail)} MAD en pharmacie` : ", en pharmacie"}.` : `${p.hero} : ${lower1(strip(t.desire))} (bénéfice à préciser sur la fiche produit).`,
    productRole: p.productId ? `${p.hero} est la réponse concrète à la tension, montré à l'étape « ${structure[Math.min(structure.length - 1, Math.max(1, structure.length - 2))] ?? "produit"} » ; ${lower1(p.routineRole)}.` : `La gamme ${p.brandName} est la réponse ; chaque référence a sa place dans la routine.`,
    desiredConsumerReaction: `« ${t.question.replace(/\?$/, "")} » trouve une réponse ; la personne ${b.funnelStage === "CONVERSION" ? "demande le produit en pharmacie" : b.funnelStage === "AWARENESS" ? "enregistre ou partage" : "veut en savoir plus et commente"}.`,
    storytellingStructure: structure.length ? structure : ["Accroche", "Tension", "Réponse (produit)", "Preuve d'usage", "CTA"],
    visualDirection: m.visualPatterns.join(" · "),
    recommendedFormat: formatOf(data, m, distribution), funnelStage: b.funnelStage, hookType, persona, distribution,
    organicVersion: `Version organique : ${lower1(m.bestFor)} ; priorité au temps de visionnage et aux partages, CTA doux (« ${fill(m.ctaPatterns[0] ?? "Enregistrez", vars)} »).`,
    paidVersion: `Version payante : accroche en 2 secondes, problème nommé, réponse produit, objection « ${strip(t.objection)} » levée, CTA « ${fill(m.ctaPatterns[m.ctaPatterns.length - 1] ?? "Disponible en pharmacie", vars)} ».`,
    reasoning: [
      `${m.name} : ${lower1(m.psychologicalTrigger)}`,
      `tension « ${t.label} » : ${lower1(strip(t.emotion))}`,
      benefit ? `bénéfice de la fiche produit repris tel quel : « ${benefit} »` : "fiche produit sans bénéfice : le concept reste au ressenti, à compléter",
    ],
  };
}

/** Finalise un brouillon : empreinte, proximité au récent, score explicable, conformité. */
export function finalizeConcept(draft: ConceptDraft, data: CreativeData, t: CreativeThresholds, opts: { generatedBy: "AI" | "RULES"; ai?: Parameters<typeof scoreConcept>[0]["ai"]; review?: CreativeConcept["review"] } ): CreativeConcept {
  const m = mechanicOf(draft.mechanic)!;
  const tension = tensionOf(draft.tensionKey)!;
  const parts = { territory: m.territory, mechanic: m.key, tensionKey: tension.key, hookType: draft.hookType, productId: data.product.productId };
  const near = nearestRecent(parts, data.recentConcepts);
  const tensionScore = data.tensions.find((x) => x.key === tension.key) ? Math.max(1, 6 - data.tensions.findIndex((x) => x.key === tension.key) * 2) : 0;
  const posHit = !!data.business.positioning && data.business.positioning.split(/[\s,;.]+/).filter((w) => w.length > 5).some((w) => draft.bigIdea.toLowerCase().includes(w.toLowerCase()));
  const scores = scoreConcept({ mechanic: m, tensionScore, product: data.product, text: draft, playbookLevers: data.playbookLevers, positioningHit: posHit, similarity: near.score, distribution: draft.distribution, funnelStage: draft.funnelStage, insights: data.insights, ai: opts.ai ?? null });
  const compliance = checkConcept(draft, { category: data.product.category, product: data.product });
  return { ...draft, scores, fingerprint: creativeFingerprint(parts), similarity: { score: near.score, to: near.to?.title ?? null }, compliance, review: opts.review ?? null, generatedBy: opts.generatedBy };
}

/** Jeu de concepts déterministe pour une opportunité : la mécanique recommandée d'abord, puis des territoires différents. */
export function rulesConcepts(data: CreativeData, o: Pick<CreativeOpportunity, "tensionKey" | "recommendedMechanic">, t: CreativeThresholds, n = t.maxConcepts): CreativeConcept[] {
  const tension = tensionOf(o.tensionKey)!;
  const first = mechanicOf(o.recommendedMechanic)!;
  const ranked = rankMechanics(data, tension, { exclude: [first.key] }).filter((r) => r.mechanic.territory !== first.territory || r.mechanic.defaultHook !== first.defaultHook);
  const picks = [first, ...pickDiverse(ranked, n - 1, 1).map((r) => r.mechanic)];
  const hooks: HookType[] = [];
  return picks.map((m) => {
    // Chaque concept change au moins l'accroche quand deux mécaniques partagent le même type par défaut.
    let hookType = m.defaultHook;
    if (hooks.includes(hookType)) hookType = (Object.keys(HOOK_LABELS) as HookType[]).find((h) => !hooks.includes(h)) ?? hookType;
    hooks.push(hookType);
    return finalizeConcept(draftConcept(data, m, tension, { hookType }), data, t, { generatedBy: "RULES" });
  }).sort((a, b) => b.scores.overall - a.scores.overall);
}

/* ------------------------------ KPI et budget ------------------------------ */

export function paidTestBudget(available: number | null, t: CreativeThresholds): number | null {
  if (available === null || available <= 0) return null;
  return Math.min(available, t.paidTestBudgetMad);
}

/** KPI : organique (vues, rétention, enregistrements, partages) ; payant (coût par résultat Meta mesuré de la marque si connu). */
export function kpisFor(data: CreativeData, dist: "ORGANIC" | "PAID"): KpiOut[] {
  const ads = data.business.adsCost;
  if (dist === "ORGANIC") return [
    { label: "Vues sur 7 jours", target: "à comparer à la médiane des 10 derniers réels de la marque", tag: "MISSING" },
    { label: "Rétention à 3 secondes", target: "≥ 60 % (repère de format, pas une mesure)", tag: "INFERRED" },
    { label: "Enregistrements + partages", target: "≥ 2 % des vues (repère)", tag: "INFERRED" },
    { label: "Commentaires qualifiés", target: "questions sur le produit ou la pharmacie", tag: "INFERRED" },
  ];
  return [
    { label: ads ? `Coût par ${ads.label.replace(/s$/, "")}` : "Coût par résultat", target: ads ? `≤ ${ads.value.toFixed(1)} MAD (coût mesuré de la marque sur 90 jours)` : "non mesurable : aucun coût par résultat Meta mesuré pour la marque", tag: ads ? "CALCULATED" : "MISSING" },
    { label: "Taux de clic", target: "à comparer au benchmark de la marque (Digital Ads)", tag: "MISSING" },
    { label: "Rétention à 3 secondes", target: "≥ 50 % (repère)", tag: "INFERRED" },
    { label: "Fréquence", target: "≤ seuil de fatigue de Paramètres (Digital Ads)", tag: "CALCULATED" },
  ];
}

/* ------------------------------ Package ------------------------------ */

const FORMAT_DURATION: Record<CreativeFormat, number> = { REEL: 30, UGC: 35, VIDEO: 45, STORY: 15, CARROUSEL: 0, POST: 0 };
const FRAMINGS = ["Plan moyen, face caméra", "Gros plan produit", "Macro texture / geste", "Plan moyen, produit en main", "Plan serré regard caméra"];

function scenesFrom(steps: string[], total: number, hook: string, m: CreativeMechanic, vars: Record<string, string | null>, p: CreativeData["product"]): Scene[] {
  const n = Math.max(3, steps.length);
  const base = Math.max(2, Math.round(total / n));
  const list = steps.length ? steps : ["Accroche", "Tension", "Réponse (produit)", "CTA"];
  return list.map((step, i) => {
    const last = i === list.length - 1;
    const productStep = /produit|réponse|solution|démonstration|texture|application|routine|offre|preuve|verdict/i.test(step) || i >= list.length - 2;
    return {
      n: i + 1, durationSec: i === 0 ? Math.min(3, base) : last ? Math.max(2, total - base * (list.length - 1)) : base,
      visual: m.visualPatterns[i % m.visualPatterns.length] ?? "Face caméra", framing: FRAMINGS[i % FRAMINGS.length], action: step,
      dialogue: i === 0 ? hook : last ? fill(m.ctaPatterns[m.ctaPatterns.length - 1] ?? "Disponible en pharmacie.", vars) : productStep ? `${p.hero} : ${p.benefits[0] ? lower1(strip(p.benefits[0])) : lower1(p.routineRole)}.` : fill(step, vars),
      voiceOver: null, onScreenText: i === 0 ? strip(hook).slice(0, 60) : last ? "Disponible en pharmacie" : productStep ? p.hero : step.slice(0, 40),
      productVisible: productStep, transition: last ? null : i === 0 ? "cut sec" : "cut",
    };
  });
}

export function draftPackage(c: CreativeConcept, data: CreativeData, t: CreativeThresholds): ContentPackage {
  const m = mechanicOf(c.mechanic)!, tension = tensionOf(c.tensionKey)!, p = data.product, b = data.business;
  const vars = conceptVars(data, tension, m, c.persona);
  const hooks: Hook[] = (Object.keys(HOOK_LABELS) as HookType[]).map((type) => ({ type, text: fill(type === c.hookType && m.hookPatterns[0] ? m.hookPatterns[0] : HOOK_TEMPLATES[type][0], vars), onScreen: null }))
    .map((h) => ({ ...h, onScreen: strip(h.text).slice(0, 50) }))
    .sort((a, b2) => Number(b2.type === c.hookType) - Number(a.type === c.hookType));
  const total = FORMAT_DURATION[c.recommendedFormat] || 30;
  const mainHook = hooks[0].text;
  const scenesA = scenesFrom(c.storytellingStructure, total, mainHook, m, vars, p);
  const altMech = m.key === "PF_PROBLEM_FIRST" ? mechanicOf("PF_BENEFIT_FIRST")! : mechanicOf("PF_PROBLEM_FIRST")!;
  const altSteps = (altMech.narrativeStructures[0] ?? "").split("→").map((s) => s.trim()).filter(Boolean);
  const scenesB = scenesFrom(altSteps, total, fill(altMech.hookPatterns[0], vars), altMech, vars, p);
  const cta = fill(m.ctaPatterns[m.ctaPatterns.length - 1] ?? "Disponible en pharmacie.", vars);
  const scripts: ScriptVersion[] = [
    { label: `Version A — ${m.name}`, angle: c.hookType === "PROBLEM" ? "problème d'abord" : HOOK_LABELS[c.hookType].toLowerCase(), scenes: scenesA, cta, durationSec: scenesA.reduce((s, x) => s + x.durationSec, 0) },
    { label: `Version B — ${altMech.name}`, angle: altMech.key === "PF_PROBLEM_FIRST" ? "problème d'abord" : "bénéfice d'abord", scenes: scenesB, cta, durationSec: scenesB.reduce((s, x) => s + x.durationSec, 0) },
  ];
  const shotList: Shot[] = scenesA.map((s) => ({ n: s.n, visual: s.visual, durationSec: s.durationSec, framing: s.framing, product: s.productVisible, notes: s.onScreenText ? `Texte : ${s.onScreenText}` : null }));
  const isSupp = p.category === "SUPPLEMENT";
  const visual = {
    lighting: c.persona === "EXPERTE" || c.persona === "PHARMACIENNE" ? "Lumière neutre et nette (comptoir, cabinet), pas de contre-jour" : "Lumière naturelle de fenêtre, douce, visage éclairé de face",
    environment: c.persona === "PHARMACIENNE" ? "Comptoir ou rayon de pharmacie, produit en linéaire" : isSupp ? "Cuisine ou salle de bain le matin, verre d'eau, boîte visible" : "Salle de bain ou coiffeuse, produit posé dans le cadre",
    cameraStyle: c.recommendedFormat === "UGC" ? "Téléphone tenu à la main, vertical 9:16, légèrement imparfait" : "Téléphone sur trépied, vertical 9:16, stable",
    framing: "Buste face caméra pour la parole, gros plan produit et macro texture pour la preuve",
    movement: "Fixe sur la parole, lents mouvements sur le produit, aucun zoom numérique",
    pacing: b.funnelStage === "CONVERSION" ? "Rapide : un plan toutes les 2 à 3 secondes, accroche avant la seconde 2" : "Posé : un plan toutes les 3 à 4 secondes, respiration sur la preuve",
    editing: "Cuts secs, pas de transition animée ; son d'ambiance réel ; musique discrète sous la voix",
    subtitles: "Sous-titres intégrés, blanc sur bande sombre, 2 lignes au plus, police sans empattement",
    productVisibility: `${p.hero} visible dès la scène 2, face étiquette lisible au moins 2 secondes, jamais caché par le texte`,
    creatorDirection: `${PERSONA_LABELS[c.persona]} : parle à une amie, pas à une caméra ; nomme le produit une fois clairement ; montre le geste réel (${lower1(p.routineRole)})`,
  };
  const performance = {
    tone: c.persona === "EXPERTE" ? "Précis, calme, phrases courtes, aucun jargon non expliqué" : "Naturel, direct, phrases courtes, tutoiement ou vouvoiement cohérent avec la marque",
    emotionalTone: tension.emotion.replace(/\.$/, ""),
    pacing: "Accroche en moins de 2 secondes ; une idée par phrase ; pause avant le produit",
    expression: "Regard caméra sur l'accroche et le CTA ; sourire au moment du soulagement, jamais forcé",
    authenticity: "Aucune lecture de prompteur ; reformuler avec ses mots ; garder une hésitation naturelle",
    avoid: ["Promesse chiffrée ou délai de résultat absent de la fiche", "Vocabulaire médical (traiter, guérir, soigner)", "Comparaison avec une autre marque", "Produit filmé sans étiquette lisible", isSupp ? "Oublier la mention « ne se substitue pas à une alimentation variée et équilibrée »" : "Avant / après retouché"],
  };
  const budget = paidTestBudget(data.business.budgets[c.creativeTerritory === "UGC" ? "INFLUENCE" : c.creativeTerritory === "PERFORMANCE" ? "DIGITAL" : "CONTENU"]?.available ?? null, t);
  const organic: DistributionVersion = { goal: "Attention, temps de visionnage, enregistrements et partages, conversation en commentaires", hook: mainHook, structure: c.storytellingStructure, cta: fill(m.ctaPatterns[0] ?? "Enregistrez", vars), durationSec: total, notes: ["Publier à l'heure de plus forte activité de la marque", "Répondre aux commentaires dans l'heure", "Épingler un commentaire « disponible en pharmacie »"], testBudgetMad: null, kpis: kpisFor(data, "ORGANIC") };
  const paidHooks = hooks.filter((h) => h.type === "PROBLEM" || h.type === "CONTRARIAN" || h.type === "PERSONAL").slice(0, 3).map((h) => h.text);
  const paid: DistributionVersion = { goal: "Accroche, problème, preuve d'usage, objection levée, bénéfice (fiche), CTA vers la pharmacie", hook: paidHooks[0] ?? mainHook, structure: ["Accroche (2 s)", `Problème : ${lower1(strip(tension.problem))}`, `Preuve d'usage : ${p.hero} en situation`, `Objection levée : « ${strip(tension.objection)} »`, p.benefits[0] ? `Bénéfice (fiche) : ${lower1(strip(p.benefits[0]))}` : "Bénéfice : à préciser sur la fiche produit", `CTA : ${cta}`], cta, durationSec: Math.min(total, 25), notes: [budget !== null ? `Budget de test proposé : ${Math.round(budget).toLocaleString("fr-FR")} MAD (borné par le disponible du levier)` : "Budget de test non défini : aucun budget disponible sur le levier", "Objectif Meta aligné sur le résultat officiel de la marque", "Couper après 3 jours si le coût par résultat dépasse la référence de la marque"], testBudgetMad: budget, kpis: kpisFor(data, "PAID") };
  const ctaVariants = [...new Set([cta, ...m.ctaPatterns.map((x) => fill(x, vars)), "Écrivez-nous « pharmacie » pour le point de vente le plus proche"])].slice(0, 3);
  const mandatory = mandatoryMentions(p.category);
  const caption = `${strip(mainHook)}\n\n${c.coreMessage}\n\n${cta}\n\n${mandatory[0]}`;
  const tag = (s: string) => "#" + s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]/g, "");
  const hashtags = [...new Set([tag(p.brandName), tag(p.hero), "#pharmacie", "#parapharmacie", "#maroc", isSupp ? "#complementalimentaire" : "#skincare", tag(tension.label.split(" ")[0])])].filter((h) => h.length > 2).slice(0, 8);
  const draft: Omit<ContentPackage, "compliance" | "claims" | "generatedBy"> = {
    strategy: { objective: b.objectiveLabel, funnelStage: c.funnelStage, audience: b.audience, product: p.name, consumerTension: c.consumerTension, coreMessage: c.coreMessage, concept: c.bigIdea },
    hooks, scripts, storyboard: scenesA, shotList, visual, performance, organic, paid,
    paidHookVariants: paidHooks, ctaVariants,
    storyIdeas: [`Story 1 — sondage : « ${tension.question} »`, `Story 2 — coulisses du tournage, ${p.hero} en main`, `Story 3 — réponse à la question la plus posée en commentaire, lien « pharmacie la plus proche »`],
    thumbnail: `Visage ${c.persona === "EXPERTE" ? "de l'experte" : "de la créatrice"} regard caméra + ${p.hero} à hauteur d'épaule, texte « ${strip(hooks[0].onScreen ?? mainHook).slice(0, 36)} », fond uni clair`,
    caption, hashtags, cta,
    onScreenTexts: scenesA.map((s) => s.onScreenText).filter((x): x is string => !!x),
    kpis: [...kpisFor(data, c.distribution === "PAID" ? "PAID" : "ORGANIC")],
    assets: [`${p.hero} : packshot face étiquette (fond clair)`, "3 plans macro texture / geste (10 s chacun)", `Plan séquence ${PERSONA_LABELS[c.persona].toLowerCase()} face caméra (version A et B)`, "Logo de la marque vectoriel", "Musique libre de droits (discrète)", `Fichier final ${c.recommendedFormat === "CARROUSEL" ? "carrousel 1080×1350, 5 à 7 cartes" : "vertical 1080×1920, sous-titres intégrés"}`],
    productionNotes: [`Format : ${FORMAT_LABELS[c.recommendedFormat]} · durée cible ${total ? `${total} s` : "n/a"} · ${c.distribution === "BOTH" ? "déclinaison organique + payante" : c.distribution === "PAID" ? "payant" : "organique"}`, `Persona : ${PERSONA_LABELS[c.persona]}`, `Territoire : ${TERRITORY_LABELS[c.creativeTerritory]} · mécanique : ${m.name}`, `Rôle du produit dans la routine : ${p.routineRole}`, "Validation réglementaire avant diffusion (allégations, mentions)"],
  };
  const compliance = checkPackage(draft, { category: p.category, product: p });
  return { ...draft, claims: { allowed: p.claims.length ? p.claims : [p.claimDiscipline.allowed], forbidden: p.claimDiscipline.restricted, mandatory }, compliance, generatedBy: "RULES" };
}

/* ------------------------------ Variations ------------------------------ */

export function draftVariations(c: CreativeConcept, pkg: ContentPackage, data: CreativeData): VariationSet {
  const m = mechanicOf(c.mechanic)!, tension = tensionOf(c.tensionKey)!;
  const vars = conceptVars(data, tension, m, c.persona);
  const out: Variation[] = [];
  for (const h of pkg.hooks) out.push({ dimension: "HOOK", label: `Accroche ${HOOK_LABELS[h.type].toLowerCase()}`, changed: h.type === c.hookType ? "accroche de base" : `l'entrée passe de « ${HOOK_LABELS[c.hookType].toLowerCase()} » à « ${HOOK_LABELS[h.type].toLowerCase()} »`, content: h.text });
  const openings = [`Produit d'abord : ${data.product.hero} en macro, puis le visage`, `Situation d'abord : ${lower1(strip(tension.problem))}, sans produit pendant 3 secondes`, "Texte d'abord : l'accroche plein écran sur fond uni, voix en off"];
  openings.forEach((o, i) => out.push({ dimension: "OPENING", label: `Ouverture ${i + 1}`, changed: "seule la première scène change", content: o }));
  const alts = mechanicsOf(c.creativeTerritory).filter((x) => x.key !== m.key).slice(0, 2);
  const structures = [m, ...alts, ...MECHANICS.filter((x) => x.territory !== c.creativeTerritory && x.productTypes.includes(data.product.category)).slice(0, 1)].slice(0, 3);
  structures.forEach((x, i) => out.push({ dimension: "STRUCTURE", label: i === 0 ? `Structure de base — ${x.name}` : `Structure — ${x.name}`, changed: i === 0 ? "structure de base" : `l'ordre des scènes suit « ${x.name} » au lieu de « ${m.name} »`, content: (x.narrativeStructures[0] ?? "").replace(/→/g, " → "), steps: (x.narrativeStructures[0] ?? "").split("→").map((s) => s.trim()).filter(Boolean) }));
  const personas = m.personas.filter((p) => p !== c.persona).slice(0, 2);
  personas.forEach((p) => out.push({ dimension: "PERSONA", label: PERSONA_LABELS[p], changed: `la voix passe de « ${PERSONA_LABELS[c.persona].toLowerCase()} » à « ${PERSONA_LABELS[p].toLowerCase()} »`, content: p === "EXPERTE" ? `L'experte explique le mécanisme en 15 secondes, ${data.product.hero} comme exemple` : p === "PHARMACIENNE" ? `Au comptoir : ce que la pharmacienne répond quand on lui demande « ${tension.question} »` : p === "MARQUE" ? "Voix de la marque, packshot et texte, sans visage" : `${PERSONA_LABELS[p]} raconte son usage réel, sans script` }));
  const angles = [tension.emotion, tension.frustration, tension.desire].map((x) => strip(x)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3);
  angles.forEach((a, i) => out.push({ dimension: "ANGLE", label: `Angle émotionnel ${i + 1}`, changed: i === 0 ? "angle de base (émotion de la tension)" : i === 1 ? "on part de la frustration plutôt que de l'émotion" : "on part du désir plutôt que du problème", content: a }));
  pkg.ctaVariants.forEach((cta, i) => out.push({ dimension: "CTA", label: `CTA ${i + 1}`, changed: i === 0 ? "CTA de base" : "seule la fin change", content: cta }));
  const formats = m.formats.filter((f) => f !== c.recommendedFormat).slice(0, 3);
  formats.forEach((f) => out.push({ dimension: "FORMAT", label: FORMAT_LABELS[f], changed: `même concept décliné en ${FORMAT_LABELS[f].toLowerCase()} au lieu de ${FORMAT_LABELS[c.recommendedFormat].toLowerCase()}`, content: f === "CARROUSEL" ? "Une carte par étape de la structure, dernière carte CTA" : f === "STORY" ? "3 stories de 15 s : accroche + sondage, preuve, CTA avec lien" : f === "POST" ? "Visuel unique : accroche + produit + mention, légende longue" : `${FORMAT_LABELS[f]} : même script, cadrage adapté`, format: f }));
  void vars;
  return { baseLabel: `${m.name} · ${HOOK_LABELS[c.hookType]} · ${PERSONA_LABELS[c.persona]} · ${FORMAT_LABELS[c.recommendedFormat]}`, variations: out, generatedBy: "RULES" };
}
