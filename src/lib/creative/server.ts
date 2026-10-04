/**
 * Points d'entrée serveur du studio créatif : opportunités (par marque, rejouables), génération des concepts,
 * construction du package, variations, envoi au planning éditorial. Une seule logique : les moteurs purs sur les
 * données de `context.ts`, l'IA par étapes (`stages.ts`) quand le copilote est configuré, le squelette déterministe
 * (`rules.ts`) sinon ou en cas d'échec — toujours signalé (`generatedBy`).
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contentItems, contentProducts } from "@/db/schema";
import { defaultMonth } from "@/lib/action-generator/server";
import { OBJECTIVES } from "@/lib/action-generator/catalog";
import type { AuditActor } from "@/lib/audit";
import { contentRefs, defaultStatusKey } from "@/lib/content/refs";
import { shiftIso } from "@/lib/content/shared";
import { syncBriefTask } from "@/lib/content/tasks";
import { refreshAfterWrite } from "@/lib/analytics-marketing/refresh";
import type { UserDecisionScope } from "@/lib/decisions/server";
import { isAiConfigured } from "@/lib/ai/client";
import { isAdmin } from "@/lib/permissions-shared";
import { fmtDate } from "@/lib/format";
import { buildBrief } from "./brief";
import { matchTensions, tensionOf } from "./consumer";
import { brandContextSeeds, creativePerformances, loadCreativeData, type BrandRef, type CreativeContextSeed } from "./context";
import { CreativeAiError, creativeErrorMessage } from "./llm";
import { buildOpportunities, parseOpportunityKey, pickDiverse, rankMechanics } from "./opportunities";
import { draftPackage, draftVariations, rulesConcepts } from "./rules";
import { stageBuilder, stageConcepts, stageConsumer, stageReview, stageVariations, type StageEnv } from "./stages";
import { archiveProposed, getConcept, saveConcepts, savePackage, saveVariations, markSent, type ConceptDetail } from "./store";
import { TERRITORY_LABELS, mechanicOf } from "./territories";
import { AXIS_OF_TERRITORY } from "./scoring";
import { hasBlock } from "./compliance";
import type { CreativeConcept, CreativeData, CreativeInsight, CreativeOpportunity, ContentPackage, TerritoryKey } from "./types";

export type StudioScope = UserDecisionScope;

export type OpportunityBoard = {
  opportunities: CreativeOpportunity[];
  insights: CreativeInsight[];
  saturated: { brandName: string; territories: string[] }[];
  notes: string[];
  computedAt: string;
};

function env(scope: StudioScope, actor: AuditActor, title: string): StageEnv {
  return { run: { userId: actor.id ?? "", isAdmin: isAdmin(scope.perms), ai: scope.ctx.settings.ai, conversationId: null, title }, settings: scope.ctx.settings };
}

/**
 * Opportunités du moment : pour chaque marque de la portée, les contextes désignés par le moteur marketing (produit,
 * objectif, priorité), puis les opportunités de chacun. Toutes marques : un contexte par marque ; une marque : jusqu'à
 * trois. Les erreurs d'une marque n'empêchent pas les autres (journalisées).
 */
export async function findOpportunities(scope: StudioScope, opts: { max?: number } = {}): Promise<OpportunityBoard> {
  const settings = scope.ctx.settings;
  const month = defaultMonth(scope.ctx.now);
  const perBrand = scope.selectedBrandId ? 3 : 1;
  const brands: BrandRef[] = scope.selectedBrandId ? scope.allBrands.filter((b) => b.id === scope.selectedBrandId) : scope.allBrands.slice(0, 8);
  const notes: string[] = [];
  const all: CreativeOpportunity[] = [];
  const insights: CreativeInsight[] = [];
  const saturated: OpportunityBoard["saturated"] = [];
  await Promise.all(brands.map(async (brand) => {
    try {
      const [{ seeds, performance }, perfs] = await Promise.all([brandContextSeeds(scope.ctx, brand, month, perBrand), creativePerformances(scope.ctx, brand.id)]);
      let firstData: CreativeData | null = null;
      for (const seed of seeds) {
        const data = await loadCreativeData(scope.ctx, { brand, seed, month, settings, performance, performances: perfs });
        firstData ??= data;
        all.push(...buildOpportunities(data, settings.creative, { max: 2 }));
      }
      if (firstData) {
        insights.push(...firstData.insights.filter((i) => !insights.some((x) => x.key === i.key)));
        const sat = [...new Set(all.filter((o) => o.brandId === brand.id).flatMap((o) => o.saturated))];
        if (sat.length) saturated.push({ brandName: brand.name, territories: sat });
      }
    } catch (e) {
      console.error(`Studio créatif — opportunités ${brand.name}`, e);
      notes.push(`${brand.name} : opportunités non calculées (${e instanceof Error ? e.message : "erreur"}).`);
    }
  }));
  const ranked = all.sort((a, b) => Number(!!a.blocked) - Number(!!b.blocked) || b.opportunityScore - a.opportunityScore);
  // Toutes marques : éviter de proposer la même mécanique à deux marques (sinon la liste redevient générique).
  const out: CreativeOpportunity[] = [];
  const used = new Set<string>();
  for (const o of ranked) {
    if (!scope.selectedBrandId && used.has(o.recommendedMechanic) && ranked.some((x) => x.brandId === o.brandId && x !== o && !used.has(x.recommendedMechanic))) continue;
    used.add(o.recommendedMechanic);
    out.push(o);
  }
  if (!isAiConfigured()) notes.push("Copilote non configuré : les concepts et packages seront des squelettes déterministes (sans rédaction IA).");
  return { opportunities: out.slice(0, opts.max ?? settings.creative.maxOpportunities), insights: insights.sort((a, b) => b.confidence - a.confidence).slice(0, 8), saturated, notes, computedAt: new Date().toISOString() };
}

/** Rejoue une opportunité à partir de sa clé (marque, produit, objectif, tension, mécanique). */
export async function opportunityByKey(scope: StudioScope, key: string): Promise<{ opportunity: CreativeOpportunity; data: CreativeData } | null> {
  const k = parseOpportunityKey(key);
  if (!k) return null;
  const brand = scope.allBrands.find((b) => b.id === k.brandId);
  if (!brand) return null;
  const settings = scope.ctx.settings;
  const month = defaultMonth(scope.ctx.now);
  const { seeds, performance } = await brandContextSeeds(scope.ctx, brand, month, 4);
  const seed: CreativeContextSeed = seeds.find((s) => s.productId === k.productId) ?? { productId: k.productId, objective: k.objective, priorityAction: null, signal: k.productId ? "produit choisi" : "contenu de marque" };
  const data = await loadCreativeData(scope.ctx, { brand, seed: { ...seed, objective: k.objective }, month, settings, performance });
  const [opportunity] = buildOpportunities(data, settings.creative, { max: 1, forced: { tensionKey: k.tensionKey, mechanic: k.mechanic } });
  return opportunity ? { opportunity: { ...opportunity, key }, data } : null;
}

export type GenerateResult = { ids: string[]; generatedBy: "AI" | "RULES"; warning: string | null; dropped: number };

/**
 * Génère les concepts d'une opportunité (3 à 5, territoires variés) : consommateur → concepts → revue, puis score,
 * empreinte et conformité déterministes ; un concept FAIL ou bloquant est écarté s'il en reste assez. Sans copilote
 * ou sur échec : squelettes déterministes, signalés.
 */
export async function generateConceptsFor(scope: StudioScope, key: string, actor: AuditActor, opts: { regenerate?: boolean } = {}): Promise<GenerateResult> {
  const found = await opportunityByKey(scope, key);
  if (!found) throw new Error("Opportunité introuvable ou hors périmètre.");
  const { opportunity: o, data } = found;
  if (o.blocked) throw new Error(o.blocked);
  const t = scope.ctx.settings.creative;
  if (opts.regenerate) await archiveProposed(key, actor);
  const tension = tensionOf(o.tensionKey)!;
  const first = mechanicOf(o.recommendedMechanic)!;
  const ranked = rankMechanics(data, tension, { exclude: [first.key] });
  const mechanics = [first, ...pickDiverse(ranked, t.maxConcepts - 1, 1).map((r) => r.mechanic)];

  let concepts: CreativeConcept[] = [];
  let generatedBy: "AI" | "RULES" = "RULES";
  let warning: string | null = null;
  let model: string | null = null;
  let dropped = 0;
  if (isAiConfigured()) {
    try {
      const e = env(scope, actor, `Studio créatif — ${o.brandName}${o.productName ? ` · ${o.productName}` : ""}`);
      const candidates = matchTensions(data.product);
      const consumer = await stageConsumer(data, candidates.length ? candidates : [{ tension, score: 0, hits: [] }], e).catch((err) => { console.error("Étape consommateur", err); return null; });
      e.run.conversationId = consumer?.conversationId ?? null;
      const chosen = consumer && consumer.data.tensionKey !== tension.key ? tensionOf(consumer.data.tensionKey) ?? tension : tension;
      const gen = await stageConcepts(data, chosen, consumer?.data ?? null, mechanics, e);
      e.run.conversationId = gen.conversationId;
      model = gen.model;
      let list = gen.concepts;
      try {
        const rev = await stageReview(data, list, null, e);
        list = list.map((c, i) => ({ ...c, review: rev.reviews[i] }));
      } catch (err) { console.error("Étape revue", err); }
      const keep = list.filter((c) => !(c.review?.verdict === "FAIL" || hasBlock(c.compliance)));
      dropped = list.length - keep.length;
      concepts = keep.length >= 2 ? keep : list;
      generatedBy = "AI";
    } catch (e) {
      console.error("Studio créatif — génération IA", e);
      warning = `${creativeErrorMessage(e)} Les concepts affichés sont des squelettes déterministes.`;
    }
  } else warning = "Copilote non configuré : concepts déterministes (sans rédaction IA).";
  if (!concepts.length) { concepts = rulesConcepts(data, o, t); generatedBy = "RULES"; }
  concepts.sort((a, b) => b.scores.overall - a.scores.overall);
  const ids = await saveConcepts(concepts.map((c) => ({ brandId: o.brandId, productId: o.productId, opportunityKey: key, objective: o.objective, concept: c, model })), actor);
  return { ids, generatedBy, warning, dropped };
}

/** Données du studio pour un concept stocké (rejouées depuis sa clé d'opportunité). */
export async function dataForConcept(scope: StudioScope, c: ConceptDetail): Promise<{ data: CreativeData; opportunity: CreativeOpportunity } | null> {
  return opportunityByKey(scope, c.opportunityKey);
}

export type BuildResult = { packageId: string; generatedBy: "AI" | "RULES"; warning: string | null; blocked: boolean };

export async function buildPackageFor(scope: StudioScope, conceptId: string, actor: AuditActor): Promise<BuildResult> {
  const c = await getConcept(conceptId);
  if (!c || !scope.allBrands.some((b) => b.id === c.brandId)) throw new Error("Concept introuvable ou hors périmètre.");
  const found = await dataForConcept(scope, c);
  if (!found) throw new Error("Contexte du concept introuvable (produit ou marque retirés).");
  const { data, opportunity } = found;
  const t = scope.ctx.settings.creative;
  let pkg: ContentPackage | null = null;
  let review: CreativeConcept["review"] = null;
  let model: string | null = null;
  let warning: string | null = null;
  if (isAiConfigured()) {
    try {
      const e = env(scope, actor, `Studio créatif — package « ${c.concept.title} »`);
      const built = await stageBuilder(c.concept, data, e);
      e.run.conversationId = built.conversationId;
      pkg = built.pkg; model = built.model;
      try { review = (await stageReview(data, [c.concept], pkg, e)).reviews[0]; } catch (err) { console.error("Revue du package", err); }
    } catch (e) {
      console.error("Studio créatif — construction IA", e);
      warning = `${creativeErrorMessage(e)} Le package affiché est un squelette déterministe.`;
    }
  } else warning = "Copilote non configuré : package déterministe (structure, durées, KPI et mentions ; textes à rédiger).";
  if (!pkg) pkg = draftPackage(c.concept, data, t);
  const brief = buildBrief(c.concept, pkg, { brandName: c.brandName, productName: c.productName, audience: data.business.audience, objective: OBJECTIVES[opportunity.objective], generatedAt: fmtDate(new Date()), budgetAxisLabel: AXIS_OF_TERRITORY[c.concept.creativeTerritory].toLowerCase() });
  const packageId = await savePackage(conceptId, { pkg, briefMd: brief.markdown, review, model }, actor);
  return { packageId, generatedBy: pkg.generatedBy, warning, blocked: hasBlock(pkg.compliance) };
}

export async function variationsFor(scope: StudioScope, conceptId: string, actor: AuditActor): Promise<{ generatedBy: "AI" | "RULES"; warning: string | null }> {
  const c = await getConcept(conceptId);
  if (!c || !c.package || !c.packageId || !scope.allBrands.some((b) => b.id === c.brandId)) throw new Error("Construire d'abord le contenu.");
  const found = await dataForConcept(scope, c);
  if (!found) throw new Error("Contexte du concept introuvable.");
  let set = null as Awaited<ReturnType<typeof stageVariations>>["set"] | null;
  let warning: string | null = null;
  if (isAiConfigured()) {
    try { set = (await stageVariations(c.concept, c.package, found.data, env(scope, actor, `Studio créatif — variations « ${c.concept.title} »`))).set; }
    catch (e) { console.error("Studio créatif — variations IA", e); warning = `${creativeErrorMessage(e)} Variations déterministes affichées.`; }
  } else warning = "Copilote non configuré : variations déterministes.";
  if (!set) set = draftVariations(c.concept, c.package, found.data);
  await saveVariations(c.packageId, set);
  return { generatedBy: set.generatedBy, warning };
}

export type SendInput = { date: string; deadline: string | null; responsibleId: string | null; platform: string | null };

/**
 * Envoi en production : crée le contenu du planning éditorial avec le brief complet (accroche, message, légende,
 * hashtags, CTA, contraintes, mentions, livrables), rattache le produit, ouvre la tâche du responsable, et marque le
 * concept SENT — une seule transaction. Refusé si la conformité automatique porte un drapeau bloquant.
 */
export async function sendToPlanning(scope: StudioScope, conceptId: string, actor: AuditActor & { id: string }, input: SendInput): Promise<{ contentItemId: string }> {
  const c = await getConcept(conceptId);
  if (!c || !c.package || !scope.allBrands.some((b) => b.id === c.brandId)) throw new Error("Construire d'abord le contenu.");
  if (c.status === "SENT" && c.contentItemId) return { contentItemId: c.contentItemId };
  if (hasBlock(c.package.compliance)) throw new Error("Le package porte une allégation bloquante : corriger le texte (régénérer) avant l'envoi en production.");
  const refs = await contentRefs();
  const p = c.package, k = c.concept;
  const format = refs.formats.some((f) => f.key === k.recommendedFormat && f.active) ? k.recommendedFormat : null;
  const platform = input.platform && refs.platforms.some((x) => x.key === input.platform) ? input.platform : refs.platforms.find((x) => x.active && /insta/i.test(x.key))?.key ?? refs.platforms.find((x) => x.active)?.key ?? null;
  const status = await defaultStatusKey();
  const id = await db.transaction(async (tx) => {
    const [row] = await tx.insert(contentItems).values({
      brandId: c.brandId, productId: c.productId, title: k.title, date: input.date, deadline: input.deadline ?? shiftIso(input.date, -5), platform, format, status, createdById: actor.id, responsibleId: input.responsibleId,
      brief: c.briefMd ?? buildBrief(k, p, { brandName: c.brandName, productName: c.productName, audience: p.strategy.audience, objective: p.strategy.objective, generatedAt: fmtDate(new Date()), budgetAxisLabel: null }).markdown,
      keyMessage: k.coreMessage, angle: `${TERRITORY_LABELS[k.creativeTerritory]} · ${k.mechanicName}`, hook: p.hooks[0]?.text ?? null, caption: p.caption, hashtags: p.hashtags.join(" "), cta: p.cta,
      constraints: p.productionNotes.join("\n"), mandatoryMentions: p.claims.mandatory.join("\n"), forbiddenClaims: p.claims.forbidden.join("\n"), deliverables: p.assets.join("\n"),
    }).returning({ id: contentItems.id });
    if (c.productId) await tx.insert(contentProducts).values({ contentId: row.id, productId: c.productId }).onConflictDoNothing();
    await markSent(conceptId, row.id, actor, tx);
    return row.id;
  });
  await syncBriefTask({ id, title: k.title, brandId: c.brandId, responsibleId: input.responsibleId, deadline: input.deadline ?? shiftIso(input.date, -5), date: input.date, createdById: actor.id }).catch((e) => console.error("Tâche du brief", e));
  await refreshAfterWrite(["CONTENT"]).catch(() => undefined);
  return { contentItemId: id };
}

/** Lien de retour vers le contenu du planning d'un concept envoyé. */
export const contentHref = (contentItemId: string) => `/marketing/planning/${contentItemId}`;

export { CreativeAiError };
export type { TerritoryKey };
void eq;
