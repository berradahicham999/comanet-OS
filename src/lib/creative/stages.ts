/**
 * Étapes IA du studio créatif (serveur) : chacune reçoit un contexte compact (données COMANET), rend un objet validé
 * par un schéma Zod, et laisse la logique déterministe (scores, empreinte, KPI, budget, mentions, conformité) aux
 * moteurs purs. Aucune étape n'écrit en base : `server.ts` orchestre et persiste.
 *
 *   Contexte marketing + produit (context.ts) → consommateur → stratégie / concepts → revue créative et conformité
 *   → construction du contenu → variations.
 */
import "server-only";
import { z } from "zod";
import type { ComanetSettings } from "@/lib/settings";
import { checkPackage, mandatoryMentions } from "./compliance";
import { tensionOf, type TensionMatch } from "./consumer";
import { runStage, type StageResult, type StageRun } from "./llm";
import { draftPackage, finalizeConcept, kpisFor, paidTestBudget, type ConceptDraft } from "./rules";
import { FORMAT_LABELS, HOOK_LABELS, PERSONA_LABELS, TERRITORY_LABELS, mechanicOf } from "./territories";
import type { ConceptReview, ConsumerTension, ContentPackage, CreativeConcept, CreativeData, CreativeFormat, CreativeMechanic, CreatorPersona, Distribution, HookType, Scene, Shot, VariationDimension, VariationSet } from "./types";

export type StageEnv = { run: StageRun; settings: ComanetSettings };

const HOOKS = Object.keys(HOOK_LABELS) as [HookType, ...HookType[]];
const PERSONAS = Object.keys(PERSONA_LABELS) as [CreatorPersona, ...CreatorPersona[]];
const FORMATS = Object.keys(FORMAT_LABELS) as [CreativeFormat, ...CreativeFormat[]];
const DISTS: [Distribution, ...Distribution[]] = ["ORGANIC", "PAID", "BOTH"];
const DIMS: [VariationDimension, ...VariationDimension[]] = ["HOOK", "OPENING", "STRUCTURE", "PERSONA", "ANGLE", "CTA", "FORMAT"];

/* ------------------------------ Contexte compact ------------------------------ */

function compact(data: CreativeData) {
  const b = data.business, p = data.product;
  return {
    brand: { name: b.brandName, positioning: b.positioning, target: b.brandTarget, direction_conviction: data.playbookNote },
    business: { objective: b.objectiveLabel, funnel_stage: b.funnelStage, audience: b.audience, commercial_priority: b.commercialPriority, priority_action: b.priorityAction, season: b.season, meta_cost_per_result: b.adsCost ? `${b.adsCost.value.toFixed(1)} MAD par ${b.adsCost.label.replace(/s$/, "")} (90 jours)` : "non mesuré" },
    product: {
      name: p.name, hero: p.hero, category: p.categoryLabel, price_retail_mad: p.priceRetail, benefits: p.benefits, actives: p.actives, allowed_claims: p.claims, marketing_angle: p.marketingAngle, target: p.target,
      routine_role: p.routineRole, claim_discipline: p.claimDiscipline, sales_profile: p.profile, growth_pct_90d: p.growthPct, stock_risk: p.stockRisk, days_of_stock: p.daysOfStock, sheet_missing: p.missing,
    },
    learnings: data.insights.slice(0, 6).map((i) => ({ statement: i.statement, confidence: i.confidence, kind: "corrélation observée" })),
    recent_content: [...data.recentConcepts.slice(0, 8).map((c) => ({ title: c.title, mechanic: c.mechanic, date: c.date, kind: "concept généré" })), ...data.performances.slice(0, 8).map((x) => ({ title: x.label, mechanic: x.mechanic, date: x.publishedAt, kind: x.source }))],
    territory_usage: data.usage.filter((u) => u.mechanic === null).map((u) => ({ territory: TERRITORY_LABELS[u.territory], recent_count: u.count })),
  };
}

const mech = (m: CreativeMechanic) => ({ key: m.key, name: m.name, territory: TERRITORY_LABELS[m.territory], psychological_trigger: m.psychologicalTrigger, best_for: m.bestFor, hook_patterns: m.hookPatterns, narrative_structures: m.narrativeStructures, visual_patterns: m.visualPatterns, cta_patterns: m.ctaPatterns, formats: m.formats, personas: m.personas, default_hook: m.defaultHook, organic_fit: m.organicFit, paid_fit: m.paidFit });

/* ------------------------------ Consommateur ------------------------------ */

const consumerSchema = z.object({
  tensionKey: z.string(),
  problem: z.string(), frustration: z.string(), desire: z.string(), objection: z.string(), belief: z.string(), misconception: z.string(), question: z.string(), emotion: z.string(),
  insight: z.string(),
  reasons: z.array(z.string()).min(1).max(4),
});
export type ConsumerOut = z.infer<typeof consumerSchema>;

export async function stageConsumer(data: CreativeData, candidates: TensionMatch[], env: StageEnv): Promise<StageResult<ConsumerOut>> {
  const res = await runStage("consumer", {
    tier: env.settings.creative.conceptTier, schema: consumerSchema, effort: "medium", maxTokens: 2048, run: env.run,
    context: { ...compact(data), candidates: candidates.map((c) => ({ key: c.tension.key, label: c.tension.label, activated_by: c.hits, strength: c.score, problem: c.tension.problem, frustration: c.tension.frustration, desire: c.tension.desire, objection: c.tension.objection, belief: c.tension.belief, misconception: c.tension.misconception, question: c.tension.question, emotion: c.tension.emotion })) },
    instruction: `Choisis la tension la plus forte parmi \`candidates\` (clé exacte) pour ${data.product.hero} (${data.business.brandName}), objectif « ${data.business.objectiveLabel} », cible « ${data.business.audience} ». Reformule-la dans les mots de la cliente, donne l'insight, justifie en 2 à 3 raisons adossées aux données.`,
  });
  if (!candidates.some((c) => c.tension.key === res.data.tensionKey)) res.data.tensionKey = candidates[0].tension.key;
  return res;
}

/* ------------------------------ Concepts ------------------------------ */

const conceptSchema = z.object({
  mechanic: z.string(),
  title: z.string().max(90), bigIdea: z.string(), consumerTension: z.string(), insight: z.string(), coreMessage: z.string(), productRole: z.string(), desiredConsumerReaction: z.string(),
  storytellingStructure: z.array(z.string()).min(3).max(8), visualDirection: z.string(),
  recommendedFormat: z.enum(FORMATS), hookType: z.enum(HOOKS), persona: z.enum(PERSONAS), distribution: z.enum(DISTS),
  organicVersion: z.string(), paidVersion: z.string(),
  reasoning: z.array(z.string()).min(2).max(5),
  selfScores: z.object({ hook: z.number().int().min(0).max(10), scrollStop: z.number().int().min(0).max(10), emotionalTension: z.number().int().min(0).max(10) }),
  sheetGaps: z.array(z.string()).max(4),
});
const conceptsSchema = z.object({ concepts: z.array(conceptSchema).min(1).max(6) });

export async function stageConcepts(data: CreativeData, tension: ConsumerTension, refined: ConsumerOut | null, mechanics: CreativeMechanic[], env: StageEnv): Promise<{ concepts: CreativeConcept[]; model: string; conversationId: string }> {
  const res = await runStage("concepts", {
    tier: env.settings.creative.conceptTier, schema: conceptsSchema, effort: "high", maxTokens: 8192, run: { ...env.run },
    context: {
      ...compact(data),
      tension: refined ? { key: tension.key, label: tension.label, ...refined } : { key: tension.key, label: tension.label, problem: tension.problem, frustration: tension.frustration, desire: tension.desire, objection: tension.objection, belief: tension.belief, misconception: tension.misconception, question: tension.question, emotion: tension.emotion, insight: null },
      mechanics: mechanics.map(mech),
      allowed_formats: data.formats.map((f) => f.key).filter((k) => (FORMATS as string[]).includes(k)),
    },
    instruction: `Rends exactement ${mechanics.length} concept(s), un par mécanique de \`mechanics\` et dans cet ordre (champ \`mechanic\` = clé exacte). Produit : ${data.product.hero}. Tension : « ${tension.label} ». Objectif : ${data.business.objectiveLabel}. Chaque concept doit être différencié des autres et du contenu récent listé ; le message central reprend un bénéfice de la fiche produit ou reste au ressenti ; \`sheetGaps\` liste ce que la fiche devrait préciser.`,
  });
  const t = env.settings.creative;
  const concepts: CreativeConcept[] = [];
  for (const c of res.data.concepts) {
    const m = mechanicOf(c.mechanic) ?? mechanics.find((x) => x.name.toLowerCase() === c.mechanic.toLowerCase()) ?? null;
    if (!m) continue;
    const draft: ConceptDraft = {
      title: c.title, bigIdea: c.bigIdea, consumerTension: c.consumerTension, tensionKey: tension.key, insight: c.insight, creativeTerritory: m.territory, mechanic: m.key, mechanicName: m.name,
      psychologicalTrigger: m.psychologicalTrigger, coreMessage: c.coreMessage, productRole: c.productRole, desiredConsumerReaction: c.desiredConsumerReaction, storytellingStructure: c.storytellingStructure,
      visualDirection: c.visualDirection, recommendedFormat: m.formats.includes(c.recommendedFormat) ? c.recommendedFormat : m.formats[0], funnelStage: data.business.funnelStage, hookType: c.hookType, persona: m.personas.includes(c.persona) ? c.persona : m.personas[0], distribution: c.distribution,
      organicVersion: c.organicVersion, paidVersion: c.paidVersion, reasoning: [...c.reasoning, ...c.sheetGaps.map((g) => `fiche produit à compléter : ${g}`)].slice(0, 6),
    };
    concepts.push(finalizeConcept(draft, data, t, { generatedBy: "AI", ai: c.selfScores }));
  }
  return { concepts, model: res.model, conversationId: res.conversationId };
}

/* ------------------------------ Revue ------------------------------ */

const axis = z.object({ ok: z.boolean(), note: z.string() });
const reviewSchema = z.object({
  reviews: z.array(z.object({
    index: z.number().int().min(0),
    axes: z.object({ strategic: axis, creative: axis, product: axis, audience: axis, brand: axis, production: axis, compliance: axis, repetition: axis }),
    verdict: z.enum(["PASS", "IMPROVE", "FAIL"]),
    improvements: z.array(z.string()).max(3),
  })).min(1),
});

export async function stageReview(data: CreativeData, concepts: CreativeConcept[], pkg: ContentPackage | null, env: StageEnv): Promise<{ reviews: (ConceptReview | null)[]; model: string }> {
  const res = await runStage("review", {
    tier: env.settings.creative.conceptTier, schema: reviewSchema, effort: "medium", maxTokens: 4096, run: env.run,
    context: {
      ...compact(data),
      concepts: concepts.map((c, index) => ({ index, title: c.title, bigIdea: c.bigIdea, coreMessage: c.coreMessage, productRole: c.productRole, mechanic: c.mechanicName, territory: TERRITORY_LABELS[c.creativeTerritory], hookType: c.hookType, persona: c.persona, format: c.recommendedFormat, similarity_to_recent: c.similarity, automatic_compliance_flags: c.compliance.map((f) => `${f.severity} ${f.code} : ${f.text}${f.excerpt ? ` « ${f.excerpt} »` : ""}`), organicVersion: c.organicVersion, paidVersion: c.paidVersion })),
      package: pkg ? { hooks: pkg.hooks.map((h) => h.text), caption: pkg.caption, cta: pkg.cta, scenes: pkg.storyboard.map((s) => `${s.n}. ${s.action}${s.dialogue ? ` « ${s.dialogue} »` : ""}`), automatic_compliance_flags: pkg.compliance.map((f) => `${f.severity} ${f.code} : ${f.text}`) } : null,
    },
    instruction: `Relis ${concepts.length} concept(s) (champ \`index\`) sur les huit axes et rends un verdict par concept. Les drapeaux de conformité automatiques sont des données à confirmer ou compléter.`,
  });
  const reviews: (ConceptReview | null)[] = concepts.map(() => null);
  for (const r of res.data.reviews) if (r.index < concepts.length) reviews[r.index] = { axes: r.axes, verdict: r.verdict, improvements: r.improvements };
  return { reviews, model: res.model };
}

/* ------------------------------ Construction ------------------------------ */

const sceneSchema = z.object({ n: z.number().int().min(1), durationSec: z.number().int().min(1).max(60), visual: z.string(), framing: z.string(), action: z.string(), dialogue: z.string().nullable(), voiceOver: z.string().nullable(), onScreenText: z.string().nullable(), productVisible: z.boolean(), transition: z.string().nullable() });
const distSchema = z.object({ goal: z.string(), hook: z.string(), structure: z.array(z.string()).min(3).max(8), cta: z.string(), durationSec: z.number().int().min(5).max(90), notes: z.array(z.string()).max(5) });
const builderSchema = z.object({
  hooks: z.array(z.object({ type: z.enum(HOOKS), text: z.string(), onScreen: z.string().nullable() })).min(5).max(5),
  scripts: z.array(z.object({ label: z.string(), angle: z.string(), scenes: z.array(sceneSchema).min(3).max(10), cta: z.string() })).min(2).max(2),
  visual: z.object({ lighting: z.string(), environment: z.string(), cameraStyle: z.string(), framing: z.string(), movement: z.string(), pacing: z.string(), editing: z.string(), subtitles: z.string(), productVisibility: z.string(), creatorDirection: z.string() }),
  performance: z.object({ tone: z.string(), emotionalTone: z.string(), pacing: z.string(), expression: z.string(), authenticity: z.string(), avoid: z.array(z.string()).min(2).max(6) }),
  organic: distSchema, paid: distSchema,
  paidHookVariants: z.array(z.string()).min(3).max(3), ctaVariants: z.array(z.string()).min(3).max(3), storyIdeas: z.array(z.string()).min(3).max(3),
  thumbnail: z.string(), caption: z.string(), hashtags: z.array(z.string()).min(4).max(10), onScreenTexts: z.array(z.string()).min(3).max(12),
  assets: z.array(z.string()).min(3).max(10), productionNotes: z.array(z.string()).min(2).max(8),
});

export async function stageBuilder(c: CreativeConcept, data: CreativeData, env: StageEnv): Promise<{ pkg: ContentPackage; model: string; conversationId: string }> {
  const t = env.settings.creative;
  const skeleton = draftPackage(c, data, t);
  const m = mechanicOf(c.mechanic)!;
  const budget = paidTestBudget(data.business.budgets[c.creativeTerritory === "UGC" ? "INFLUENCE" : c.creativeTerritory === "PERFORMANCE" ? "DIGITAL" : "CONTENU"]?.available ?? null, t);
  const res = await runStage("builder", {
    tier: env.settings.creative.builderTier, schema: builderSchema, effort: "medium", maxTokens: 12_000, run: env.run,
    context: {
      ...compact(data),
      concept: { title: c.title, bigIdea: c.bigIdea, consumerTension: c.consumerTension, insight: c.insight, coreMessage: c.coreMessage, productRole: c.productRole, desiredConsumerReaction: c.desiredConsumerReaction, structure: c.storytellingStructure, visualDirection: c.visualDirection, hookType: c.hookType, persona: PERSONA_LABELS[c.persona], distribution: c.distribution, format: FORMAT_LABELS[c.recommendedFormat], organicVersion: c.organicVersion, paidVersion: c.paidVersion },
      mechanic: mech(m),
      constraints: { durationSec: skeleton.organic.durationSec || 30, maxScenes: 7, paid_duration_sec: skeleton.paid.durationSec, mandatory_mentions: mandatoryMentions(data.product.category), test_budget_mad: budget, kpis_organic: kpisFor(data, "ORGANIC").map((k) => `${k.label} : ${k.target}`), kpis_paid: kpisFor(data, "PAID").map((k) => `${k.label} : ${k.target}`) },
    },
    instruction: `Construis le package complet du concept « ${c.title} » pour ${data.product.hero} (${FORMAT_LABELS[c.recommendedFormat]}, ${c.distribution === "BOTH" ? "organique et payant" : c.distribution.toLowerCase()}). Deux versions de script : la version A suit la mécanique « ${m.name} », la version B inverse l'entrée (problème d'abord ou bénéfice d'abord). La légende se termine par la mention obligatoire. Les textes à l'écran sont courts (≤ 8 mots).`,
  });
  const d = res.data;
  const norm = (scenes: z.infer<typeof sceneSchema>[]): Scene[] => scenes.map((s, i) => ({ ...s, n: i + 1 }));
  const scripts = d.scripts.map((s) => { const scenes = norm(s.scenes); return { label: s.label, angle: s.angle, scenes, cta: s.cta, durationSec: scenes.reduce((a, x) => a + x.durationSec, 0) }; });
  const storyboard = scripts[0].scenes;
  const shotList: Shot[] = storyboard.map((s) => ({ n: s.n, visual: s.visual, durationSec: s.durationSec, framing: s.framing, product: s.productVisible, notes: s.onScreenText ? `Texte : ${s.onScreenText}` : null }));
  const base: Omit<ContentPackage, "compliance" | "claims" | "generatedBy"> = {
    strategy: skeleton.strategy, hooks: d.hooks, scripts, storyboard, shotList, visual: d.visual, performance: d.performance,
    organic: { ...d.organic, testBudgetMad: null, kpis: skeleton.organic.kpis }, paid: { ...d.paid, testBudgetMad: budget, kpis: skeleton.paid.kpis },
    paidHookVariants: d.paidHookVariants, ctaVariants: d.ctaVariants, storyIdeas: d.storyIdeas, thumbnail: d.thumbnail, caption: d.caption, hashtags: d.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)), cta: d.ctaVariants[0] ?? skeleton.cta,
    onScreenTexts: d.onScreenTexts, kpis: skeleton.kpis, assets: d.assets, productionNotes: [...d.productionNotes, ...skeleton.productionNotes.filter((n) => /Validation réglementaire|Rôle du produit/.test(n))],
  };
  const compliance = checkPackage(base, { category: data.product.category, product: data.product });
  return { pkg: { ...base, claims: skeleton.claims, compliance, generatedBy: "AI" }, model: res.model, conversationId: res.conversationId };
}

/* ------------------------------ Variations ------------------------------ */

const variationsSchema = z.object({
  variations: z.array(z.object({ dimension: z.enum(DIMS), label: z.string(), changed: z.string(), content: z.string(), steps: z.array(z.string()).nullable(), format: z.enum(FORMATS).nullable() })).min(10).max(26),
});

export async function stageVariations(c: CreativeConcept, pkg: ContentPackage, data: CreativeData, env: StageEnv): Promise<{ set: VariationSet; model: string }> {
  const m = mechanicOf(c.mechanic)!;
  const res = await runStage("variations", {
    tier: env.settings.creative.builderTier, schema: variationsSchema, effort: "medium", maxTokens: 8192, run: env.run,
    context: {
      ...compact(data),
      concept: { title: c.title, bigIdea: c.bigIdea, coreMessage: c.coreMessage, hookType: c.hookType, persona: c.persona, format: c.recommendedFormat, structure: c.storytellingStructure },
      base_package: { hooks: pkg.hooks, opening_scene: pkg.storyboard[0] ?? null, structure: pkg.organic.structure, cta: pkg.cta, caption: pkg.caption },
      mechanic: mech(m), allowed_formats: m.formats, allowed_personas: m.personas,
    },
    instruction: "Rends : 5 variations HOOK (une par type d'accroche), 3 OPENING, 3 STRUCTURE (avec `steps`), 2 à 3 PERSONA (parmi `allowed_personas`), 2 à 3 ANGLE, 2 à 3 CTA, et jusqu'à 3 FORMAT (avec `format` parmi `allowed_formats`). Chaque variation dit ce qui change.",
  });
  const variations = res.data.variations.map((v) => ({ dimension: v.dimension, label: v.label, changed: v.changed, content: v.content, ...(v.steps ? { steps: v.steps } : {}), ...(v.format ? { format: v.format } : {}) }));
  return { set: { baseLabel: `${m.name} · ${HOOK_LABELS[c.hookType]} · ${PERSONA_LABELS[c.persona]} · ${FORMAT_LABELS[c.recommendedFormat]}`, variations, generatedBy: "AI" }, model: res.model };
}

export { tensionOf };
