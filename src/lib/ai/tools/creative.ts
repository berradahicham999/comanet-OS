/**
 * `get_creative_opportunities` — le studio créatif en lecture seule : opportunités du moment (produit désigné par le
 * moteur marketing, tension consommateur, territoire et mécanique recommandés, score explicable, budget du levier),
 * apprentissages créatifs (corrélations observées) et territoires saturés. Toute la logique vit dans
 * `src/lib/creative/` ; ici, le schéma, les droits, la mise en forme compacte et les liens.
 */
import { z } from "zod";
import { FUNNEL_LABELS, TERRITORY_LABELS } from "@/lib/creative/territories";
import type { AiTool, ToolResult } from "./types";
import { DATA_TAGS_LEGEND, freshnessNotes, intelContext, limitOf, resolveBrand, round, scopeLabel, unavailable } from "./shared";

const schema = z.object({
  brand: z.string().optional().describe("Marque (facultatif : toutes les marques du périmètre sinon)."),
  limit: z.number().int().min(1).max(10).optional().describe("Nombre d'opportunités (défaut 5)."),
});

export const getCreativeOpportunities: AiTool<typeof schema> = {
  name: "get_creative_opportunities",
  description:
    "Studio créatif (Intelligence contenu) : quel contenu produire maintenant, pour quel produit, quelle tension consommateur et par quelle mécanique créative (éducation, UGC, storytelling, performance, émotion). Pour chaque opportunité : produit désigné par le moteur de décision marketing, objectif, étape du tunnel, tension (problème, désir, objection), territoire et mécanique recommandés, pourquoi maintenant, score explicable (0 à 100, aide à la décision), budget disponible du levier, produits à ne pas pousser. Renvoie aussi les apprentissages créatifs mesurés (corrélations observées : quelles mécaniques ou accroches coûtent moins cher par résultat, engagent plus) et les territoires saturés. Lecture seule : la génération des concepts et du package se fait dans Marketing → Studio créatif (lien fourni).",
  module: "marketing",
  action: "view",
  schema,
  async run(input, ctx): Promise<ToolResult> {
    const cr = ctx.deps.creative;
    if (!cr) return unavailable("Studio créatif non disponible sur cette surface.", "Ouvrir Marketing → Studio créatif.");
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    const board = await cr.board({ ctx: intelContext(ctx), perms: ctx.access.perms, brandIds: ctx.access.brandIds, selectedBrandId: brand?.id ?? null });
    const n = limitOf(input.limit, 5);
    const line = (o: (typeof board.opportunities)[number]) => ({
      brand: o.brandName, product: o.productName ?? `gamme ${o.brandName}`, objective: o.businessObjective, funnel_stage: FUNNEL_LABELS[o.funnelStage], audience: o.audience,
      commercial_priority: o.commercialPriority, priority_action: o.priorityAction, consumer_tension: o.consumerTension, problem: o.consumerProblem, desire: o.consumerDesire, objection: o.consumerObjection,
      territory: TERRITORY_LABELS[o.recommendedTerritory], mechanic: o.mechanicName, why_now: o.reasoning, score: o.opportunityScore, score_detail: o.scoreItems.map((s) => `${s.label} : ${s.points}/${s.max} — ${s.why} [${s.tag}]`),
      confidence: o.confidence, confidence_why: o.confidenceWhy, priority: o.priority, budget_axis: o.budget.axis, budget_available_mad: o.budget.available === null ? "non défini" : round(o.budget.available),
      saturated_territories: o.saturated, learnings: o.learning, blocked: o.blocked, data: o.data.map((f) => `${f.label} : ${f.value} [${f.tag}]`), href: `/marketing/studio/opportunite/${encodeURIComponent(o.key)}`,
    });
    const active = board.opportunities.filter((o) => !o.blocked).slice(0, n);
    const blocked = board.opportunities.filter((o) => o.blocked).slice(0, 3);
    if (!active.length && !blocked.length) return unavailable(`Aucune opportunité créative calculable${brand ? ` pour ${brand.name}` : ""}.`, "Importer les ventes et une photo de stock, renseigner les fiches marketing des produits (bénéfices, actifs, allégations), synchroniser Meta ou saisir la performance des contenus publiés.", "Studio créatif COMANET");
    const data = {
      computed_at: board.computedAt, opportunities: active.map(line), do_not_push: blocked.map(line),
      creative_learnings: board.insights.map((i) => ({ statement: i.statement, direction: i.direction, confidence: i.confidence, evidence: i.evidence.map((e) => `${e.label} : ${e.value} [${e.tag}]`), kind: "corrélation observée" })),
      saturated: board.saturated, notes: board.notes, legend: DATA_TAGS_LEGEND,
      rule: "Les scores sont des aides à la décision, jamais des mesures ; un apprentissage est une corrélation observée. Les concepts, scripts et briefs se génèrent dans Marketing → Studio créatif ; rien n'est publié automatiquement.",
    };
    return {
      available: true, source: "Studio créatif COMANET (moteur de décision marketing × fiche produit × mémoire créative : Meta étiqueté, contenus publiés, influence)",
      scope: scopeLabel(ctx.access, [brand ? `marque ${brand.name}` : null]), data, rowCount: active.length + blocked.length,
      links: [{ label: "Ouvrir le Studio créatif", href: `/marketing/studio${brand ? `?brand=${brand.id}` : ""}` }], notes: freshnessNotes(ctx),
    };
  },
};
