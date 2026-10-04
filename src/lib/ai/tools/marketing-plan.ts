/**
 * Outils Marketing OS de l'Agent marketing : plan (cadrage, allocation, axes, plan mensuel), actions
 * (qui fait quoi, pour quand, avec quel budget) et décisions unifiées (règles, intelligence Ads, intelligence
 * marketing : même structure POURQUOI / DONNÉES / IMPACT / CONFIANCE / ACTION). Lecture seule : l'agent
 * recommande, la personne approuve dans Priorités & actions. Toute la logique vit dans `src/lib/marketing-plan/`
 * et `src/lib/decisions/` ; ici seulement le schéma, les droits et la mise en forme compacte.
 */
import { z } from "zod";
import { BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import { ACTION_SOURCE_LABELS, actionLateDays, isOpenStatus } from "@/lib/marketing-plan/shared";
import { DECISION_STATUS, DOMAIN_LABELS } from "@/lib/decisions/types";
import { AXES, AXIS_KEYS, OBJECTIVES, OBJECTIVE_KEYS, TARGET_KEYS, COMPLEXITY_LABELS } from "@/lib/action-generator/catalog";
import { LEVEL_LABELS } from "@/lib/action-generator/engine";
import { generatorQuery } from "@/lib/action-generator/params";
import type { AxisKey, ObjectiveKey, TargetKey } from "@/lib/action-generator/types";
import type { AiTool, ToolResult } from "./types";
import { DATA_TAGS_LEGEND, freshnessNotes, intelContext, limitOf, marketingPeriodSchema, resolveBrand, round, scopeLabel, unavailable } from "./shared";

const noDeps = () => unavailable("Marketing OS non câblé sur cette surface.", "Utiliser le copilote de l'application.");
const iso = (d: Date) => d.toISOString().slice(0, 10);

/* ------------------------------ get_marketing_plan ------------------------------ */

const planSchema = z.object({
  brand: z.string().describe("Marque. Obligatoire."),
  year: z.number().int().min(2020).max(2100).optional().describe("Année de rattachement du plan ; défaut : année en cours, sinon le plan le plus récent."),
});

export const getMarketingPlan: AiTool<typeof planSchema> = {
  name: "get_marketing_plan",
  description:
    "Plan marketing d'une marque : CA objectif, budget, taux marketing, chaîne planifié → alloué → engagé → dépensé → reste (définition budget.ts), objectifs du plan, allocation par canal (alloué / engagé / dépensé par poste), axes stratégiques (budget, engagé, nombre d'actions), plan mensuel (produit prioritaire, objectif, budget du mois, budget des actions) et actions ouvertes. Répond à « pour quel objectif et avec quel budget ? ».",
  module: "marketing",
  action: "view",
  schema: planSchema,
  async run(input, ctx): Promise<ToolResult> {
    const mp = ctx.deps.marketingPlan; if (!mp) return noDeps();
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    if (!brand) return unavailable("Préciser la marque.", "Indiquer le nom de la marque.");
    const plans = await mp.listPlans([brand.id]);
    if (!plans.length) return unavailable(`Aucun plan marketing pour ${brand.name}.`, "Créer le plan dans Marketing → Plan marketing (CA objectif, budget, allocation par canal, axes, plan mensuel).", "Plan marketing COMANET OS");
    const year = input.year ?? ctx.now.getUTCFullYear();
    const pick = plans.find((p) => p.year === year && p.status === "ACTIVE") ?? plans.find((p) => p.year === year) ?? plans[0];
    const d = await mp.getPlan(pick.id);
    if (!d) return unavailable("Plan introuvable.", "Rafraîchir la page Plan marketing.");
    const todayIso = iso(ctx.now);
    const data = {
      plan: { name: d.plan.name, status: d.plan.status, period: `${d.plan.periodStart} → ${d.plan.periodEnd}`, year: d.plan.year, href: `/marketing/plan/${d.plan.id}` },
      framing: { revenue_target_mad: round(d.framing.revenueTarget), budget_mad: round(d.framing.budget), marketing_rate_pct: round(d.framing.marketingRatePct, 1), allocated_mad: round(d.framing.allocated), unallocated_mad: round(d.framing.unallocated), axes_total_mad: round(d.framing.axesTotal) },
      budget_chain: { planned_mad: round(d.chain.planned), allocated_mad: round(d.chain.allocated), committed_mad: round(d.chain.committed), spent_mad: round(d.chain.spent), remaining_mad: round(d.chain.remaining), committed_pct: round(d.chain.committedPct, 1), ad_spend_mad: round(d.consumption.adSpend), ad_source: d.consumption.adSource },
      objectives: d.objectives.map((o) => ({ kind: o.kind, label: o.label, target: o.target, unit: o.unit, product: o.productName })),
      allocation: d.allocation.filter((a) => a.planned > 0 || a.committed > 0).map((a) => ({ channel: a.label, allocated_mad: round(a.planned), committed_mad: round(a.committed), spent_mad: round(a.spent), over_budget: a.planned > 0 && a.committed > a.planned })),
      axes: d.axes.map((a) => ({ name: a.name, product: a.productName ?? a.productRange, budget_mad: round(a.budget), committed_mad: round(a.committed), actions: a.actions, period: a.periodStart ? `${a.periodStart} → ${a.periodEnd}` : "plan entier" })),
      months: d.months.map((m) => ({ month: m.month.slice(0, 7), focus_product: m.focusProductName, objective: m.objective, budget_mad: round(m.budget), actions: m.actions.length, actions_budget_mad: round(m.actionsBudget), open_actions: m.actions.filter((a) => isOpenStatus(a.status)).length })),
      open_actions: d.actions.filter((a) => isOpenStatus(a.status)).slice(0, 20).map((a) => ({ title: a.title, channel: a.category ? BUDGET_CATEGORY_LABELS[a.category] : null, budget_mad: round(a.budgetPlanned), committed_mad: round(a.committed), assignee: a.assigneeName, due: a.dueDate, status: a.status, priority: a.priority, late_days: actionLateDays(a, todayIso), href: `/marketing/priorites/${a.id}` })),
      tags: { revenue_target_mad: "CONFIRMED (objectif saisi)", budget_mad: "CONFIRMED (enveloppe saisie)", committed_mad: "CALCULATED (budget.ts : COMMITTED + SPENT + régie)", marketing_rate_pct: "CALCULATED" }, legend: DATA_TAGS_LEGEND,
    };
    const notes = freshnessNotes(ctx);
    if (d.framing.budget === null) notes.push("Aucun budget sur le plan : taux marketing, reste et allocation non mesurables.");
    if (d.framing.unallocated !== null && d.framing.unallocated < 0) notes.push("Allocation par canal au-delà du budget.");
    return { available: true, source: "Plan marketing COMANET OS · budgets · budget_lines · objectives · marketing_expenses", scope: scopeLabel(ctx.access, [`marque ${brand.name}`, `plan ${d.plan.name}`]), data, rowCount: 1 + d.axes.length + d.months.length, links: [{ label: "Ouvrir le plan", href: `/marketing/plan/${d.plan.id}` }], notes };
  },
};

/* ------------------------------ get_marketing_actions ------------------------------ */

const actionsSchema = z.object({
  brand: z.string().optional().describe("Marque (facultatif : toutes les marques de la portée sinon)."),
  status: z.enum(["open", "late", "all"]).default("open").describe("open = à faire / en cours / bloquées ; late = en retard ; all = y compris terminées."),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("Mois du plan (AAAA-MM)."),
  limit: z.number().int().min(1).max(50).optional(),
});

export const getMarketingActions: AiTool<typeof actionsSchema> = {
  name: "get_marketing_actions",
  description:
    "Actions marketing (Priorités & actions) : titre, marque, produit, canal, budget prévu, engagé, responsable, échéance, retard, priorité, statut, source (plan, décision, manuelle), objectif, justification et résultat attendu. Répond à « qui doit faire quoi et pour quand ? » et « quelles actions sont prioritaires cette semaine ? ».",
  module: "marketing",
  action: "view",
  schema: actionsSchema,
  async run(input, ctx): Promise<ToolResult> {
    const mp = ctx.deps.marketingPlan; if (!mp) return noDeps();
    let brandId: string | null = null, brandName: string | null = null;
    if (input.brand) { const { brand, error } = await resolveBrand(ctx, input.brand); if (error) return error; brandId = brand?.id ?? null; brandName = brand?.name ?? null; }
    const todayIso = iso(ctx.now);
    const rows = await mp.listActions({ brandId, brandIds: brandId ? null : ctx.access.brandIds, month: input.month ? `${input.month}-01` : null, includeDone: input.status === "all" });
    const list = (input.status === "late" ? rows.filter((a) => actionLateDays(a, todayIso) > 0) : rows).slice(0, limitOf(input.limit, 20));
    if (!list.length) return unavailable(`Aucune action marketing ${input.status === "late" ? "en retard" : input.status === "all" ? "" : "ouverte"}${brandName ? ` pour ${brandName}` : ""}${input.month ? ` en ${input.month}` : ""}.`, "Approuver une décision ou générer les actions d'un mois depuis le plan (Marketing → Plan marketing).", "Priorités & actions COMANET OS");
    const data = {
      as_of: todayIso, count: list.length, open_total: rows.filter((a) => isOpenStatus(a.status)).length, late_total: rows.filter((a) => actionLateDays(a, todayIso) > 0).length,
      budget_open_mad: round(rows.filter((a) => isOpenStatus(a.status)).reduce((s, a) => s + a.budgetPlanned, 0)),
      actions: list.map((a) => ({ title: a.title, brand: a.brandName, product: a.productName, channel: a.category ? BUDGET_CATEGORY_LABELS[a.category] : null, budget_mad: round(a.budgetPlanned), committed_mad: round(a.committed), assignee: a.assigneeName ?? "non assignée", due: a.dueDate, late_days: actionLateDays(a, todayIso), priority: a.priority, status: a.status, source: ACTION_SOURCE_LABELS[a.source], plan: a.planName, axis: a.axisName, month: a.month?.slice(0, 7) ?? null, objective: a.objective, why: a.why, expected_result: a.expectedResult, href: `/marketing/priorites/${a.id}` })),
      tags: { budget_mad: "CONFIRMED (prévu saisi)", committed_mad: "CALCULATED (dépenses rattachées, COMMITTED + SPENT)" },
    };
    return { available: true, source: "Priorités & actions COMANET OS (marketing_actions + tasks)", scope: scopeLabel(ctx.access, [brandName ? `marque ${brandName}` : null, input.month ? `mois ${input.month}` : null]), data, rowCount: list.length, links: [{ label: "Priorités & actions", href: `/marketing/priorites${brandId ? `?brand=${brandId}` : ""}` }] };
  },
};

/* ------------------------------ get_unified_decisions ------------------------------ */

const decisionsSchema = z.object({
  brand: z.string().describe("Marque. Obligatoire."),
  period: marketingPeriodSchema,
  include_decided: z.boolean().default(false).describe("Inclure les décisions déjà approuvées / refusées / exécutées."),
});

export const getUnifiedDecisions: AiTool<typeof decisionsSchema> = {
  name: "get_unified_decisions",
  description:
    "Décisions unifiées d'une marque : toutes les recommandations des moteurs (règles Action Center, intelligence Ads, intelligence marketing ventes × stock × marge) dans une structure commune — titre, POURQUOI, DONNÉES étiquetées (CONFIRMED / CALCULATED / INFERRED / MISSING), IMPACT, CONFIANCE, ACTION recommandée, canal suggéré, montant si réallocation, date de revue, statut humain (proposée, approuvée, refusée, exécutée, mesurée, expirée). Rangées « à pousser » et « à ne pas pousser ». Répond à « que dois-je pousser, pourquoi, où réallouer ? ».",
  module: "marketing",
  action: "view",
  schema: decisionsSchema,
  async run(input, ctx): Promise<ToolResult> {
    const mp = ctx.deps.marketingPlan; if (!mp) return noDeps();
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    if (!brand) return unavailable("Préciser la marque.", "Indiquer le nom de la marque.");
    const set = await mp.decisions({ ctx: intelContext(ctx), perms: ctx.access.perms, brands: [brand], period: input.period, includeDecided: input.include_decided });
    const line = (d: (typeof set.proposed)[number], rank: number | null) => ({
      rank, domain: DOMAIN_LABELS[d.domain], source: d.source, entity: d.entity.name, product: d.productId ? d.entity.name : null, title: d.title,
      recommendation: d.recommendation, recommendation_label: d.recommendationLabel, action: d.action, why: d.why, data: d.evidence.map((e) => `${e.label} : ${e.value} [${e.tag}]`),
      impact: d.impact, confidence: d.confidence.level, confidence_pct: d.confidence.pct, confidence_why: d.confidence.why, priority: d.priority, period: d.period?.label ?? null,
      suggested_channel: d.category ? BUDGET_CATEGORY_LABELS[d.category] : null, amount_mad: d.amount, review_date: d.expectedReviewDate, status: DECISION_STATUS[d.status].label, decided_by: d.state?.decidedBy ?? null, reason: d.state?.reason ?? null, href: d.entity.href,
    });
    const data = {
      brand: brand.name, computed_at: set.computedAt,
      to_push: set.proposed.slice(0, ctx.settings.marketingPlan.maxDecisions).map((d, i) => line(d, i + 1)),
      do_not_push: set.doNotPush.slice(0, 5).map((d) => line(d, null)),
      decided: input.include_decided ? set.decided.slice(0, 20).map((d) => line(d, null)) : undefined,
      notes: set.notes, legend: DATA_TAGS_LEGEND,
      rule: "Le moteur recommande ; la personne approuve (crée l'action et sa tâche) ou refuse dans Priorités & actions. Rien n'est exécuté automatiquement.",
    };
    const n = set.proposed.length + set.doNotPush.length;
    if (n === 0 && !set.decided.length) return unavailable(`Aucune décision pour ${brand.name} sur la période : ventes stables et stock sain, ou données insuffisantes.`, "Vérifier les imports de ventes et de stock, la synchronisation Meta et les objectifs.", "Couche de décision unifiée COMANET OS");
    const notes = freshnessNotes(ctx);
    notes.push(...set.notes);
    return { available: true, source: "Couche de décision unifiée (règles Action Center · intelligence Ads · intelligence marketing)", scope: scopeLabel(ctx.access, [`marque ${brand.name}`]), data, rowCount: n + set.decided.length, links: [{ label: "Command Center", href: `/marketing?brand=${brand.id}` }, { label: "Priorités & actions", href: `/marketing/priorites?brand=${brand.id}` }], notes };
  },
};

/* ------------------------------ generate_marketing_actions ------------------------------ */

const genSchema = z.object({
  brand: z.string().describe("Marque. Obligatoire."),
  objective: z.enum(OBJECTIVE_KEYS as [ObjectiveKey, ...ObjectiveKey[]]).default("SELL_OUT").describe(`Objectif : ${OBJECTIVE_KEYS.map((k) => `${k} (${OBJECTIVES[k]})`).join(", ")}.`),
  axis: z.enum(AXIS_KEYS as [AxisKey, ...AxisKey[]]).optional().describe(`Levier : ${AXIS_KEYS.map((k) => `${k} (${AXES[k].label})`).join(", ")} ; absent = tous les leviers.`),
  product: z.string().optional().describe("Produit à pousser (nom). Facultatif."),
  budget_mad: z.number().positive().optional().describe("Budget disponible saisi (MAD) ; absent = budget réellement disponible calculé (allocation − engagé − prévu)."),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("Période (AAAA-MM) ; défaut : mois en cours, ou suivant après le 20."),
  target: z.enum(TARGET_KEYS as [TargetKey, ...TargetKey[]]).default("FEMMES_25_45").describe("Cible."),
});

export const generateMarketingActions: AiTool<typeof genSchema> = {
  name: "generate_marketing_actions",
  description:
    "Générateur d'actions marketing : à partir d'une marque, d'un objectif, d'un levier (événementiel, trade, digital, influence, contenu), d'un produit et du budget disponible, propose 3 à 5 actions concrètes issues de la bibliothèque COMANET, adaptées aux données (ventes, stock, budget, historique, saison, villes, pharmacies, influenceuses, coût par résultat Meta) : nom, objectif chiffré, concept, budget détaillé, jour J et rétroplanning, KPI, résultat attendu (hypothèses), score de pertinence, raisons. Lecture seule : l'ajout au plan se fait par la personne (lien fourni). Répond à « quelle action faire, avec quel budget, pour quel résultat ? ».",
  module: "marketing",
  action: "view",
  schema: genSchema,
  async run(input, ctx): Promise<ToolResult> {
    const mp = ctx.deps.marketingPlan; if (!mp) return noDeps();
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    if (!brand) return unavailable("Préciser la marque.", "Indiquer le nom de la marque.");
    let productId: string | null = null;
    if (input.product) { const p = await ctx.deps.findProduct(input.product); if (!p) return unavailable(`Produit « ${input.product} » introuvable.`, "Donner le nom exact du produit."); productId = p.id; }
    const now = ctx.now;
    const month = input.month ? `${input.month}-01` : (now.getUTCDate() > 20 ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))).toISOString().slice(0, 10);
    const gi = { brandId: brand.id, objective: input.objective, axis: input.axis ?? null, budget: input.budget_mad ?? null, month, target: input.target, productId };
    const r = await mp.generateActions(intelContext(ctx), gi, brand.name);
    if (r.blocked) return unavailable(r.blocked, "Voir Stock & achats (rupture) ou saisir un budget.", "Générateur d'actions COMANET");
    if (!r.options.length) return unavailable("Aucune action finançable avec ces paramètres.", `Raisons : ${r.excluded.slice(0, 5).map((e) => `${e.name} — ${e.reason}`).join(" ; ") || "aucun modèle compatible"}.`, "Générateur d'actions COMANET");
    const data = {
      brand: brand.name, objective: OBJECTIVES[input.objective], axis: input.axis ? AXES[input.axis].label : "tous les leviers", month: month.slice(0, 7),
      budget_available_mad: r.available === null ? "non défini" : round(r.available), budget_basis_mad: round(r.budgetUsed), budget_source: r.budgetSource,
      options: r.options.map((p, i) => ({
        rank: i + 1, name: p.name, lever: AXES[p.axis].label, family: p.family, objective: p.objectiveText, concept: p.concept, target: p.target, channels: p.channels,
        budget_mad: p.budget, budget_lines: p.lines.map((l) => `${l.label} : ${l.amount} MAD`), day_j: p.eventDate, end: p.endDate,
        timeline: p.steps.map((s) => `${s.dayLabel} (${s.date}) ${s.label} — ${s.role.toLowerCase()}${s.assigneeName ? ` (${s.assigneeName})` : ""}`),
        kpis: p.kpis.map((k) => `${k.label} : ${k.target} [${k.tag}]`), assumptions: p.estimate.assumptions,
        impact: LEVEL_LABELS[p.impact], roi_potential: p.estimate.roi === null ? "non mesurable" : `${p.estimate.roi.toFixed(1)}× [INFERRED]`, complexity: COMPLEXITY_LABELS[p.complexity],
        relevance_score: p.score, why: p.why, warnings: p.warnings, compliance: p.compliance,
        suggestions: p.suggestions, add_to_plan_link: `/marketing/priorites/generer/${p.templateKey}?${generatorQuery({ ...gi, axis: gi.axis ?? p.axis, budget: gi.budget ?? p.budget })}`,
      })),
      excluded: r.excluded.slice(0, 10).map((e) => `${e.name} — ${e.reason}`), notes: r.notes,
      rule: "Les résultats attendus sont des hypothèses du modèle (INFERRED), jamais une mesure ; un CA n'est attribué que par code promo ou montant saisi. La personne choisit et ajoute au plan.",
    };
    return { available: true, source: "Générateur d'actions COMANET (bibliothèque d'actions × données de la marque)", scope: scopeLabel(ctx.access, [`marque ${brand.name}`]), data, rowCount: r.options.length, links: [{ label: "Ouvrir le générateur", href: `/marketing/priorites/generer?${generatorQuery(gi)}` }], notes: freshnessNotes(ctx) };
  },
};
