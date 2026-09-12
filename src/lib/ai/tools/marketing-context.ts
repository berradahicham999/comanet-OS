/**
 * `get_marketing_context` — ce qui est en cours et prévu en marketing pour une marque : campagnes, promotions,
 * planning éditorial, influence, activations, objectifs marketing, budget consommé (définition : `budget.ts`),
 * Digital Ads 30 jours (verdicts : `ads.ts` → `diagnose()`). Lecture par `src/lib/marketing-intel/`.
 */
import { z } from "zod";
import { buildMarketingContext } from "@/lib/marketing-intel/build";
import { CAMPAIGN_STATUS, campaignTypeLabel } from "@/lib/marketing-shared";
import type { AiTool, ToolResult } from "./types";
import { DATA_TAGS_LEGEND, freshnessNotes, intelContext, resolveBrand, round, scopeLabel, unavailable } from "./shared";

const schema = z.object({
  brand: z.string().describe("Marque. Obligatoire."),
});

const N = 10;

export const getMarketingContext: AiTool<typeof schema> = {
  name: "get_marketing_context",
  description:
    "Contexte marketing d'une marque sur ± 60 jours : campagnes actives, planifiées et terminées récemment (type, canal, dates, budget, dépensé, produits poussés, KPI cible / réel), promotions (campagnes PROMOTION ou avec offre), planning éditorial (contenus à venir, en retard, publiés récemment), influence (collaborations ouvertes et terminées, code promo, CA attribué mesuré), activations et événements (en cours, à venir, terminés), objectifs marketing de la fiche marque, budget marketing annuel consommé et Digital Ads 30 jours avec verdicts. Un CA n'est « attribué » que s'il est mesuré ; tout le reste est une corrélation observée.",
  module: "marketing",
  action: "view",
  schema,
  async run(input, ctx): Promise<ToolResult> {
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    if (!brand) return unavailable("Préciser la marque.", "Indiquer le nom de la marque.");
    const c = await buildMarketingContext(intelContext(ctx), { brandId: brand.id });
    const a = c.activity;
    const empty = !a.campaigns.length && !a.contents.length && !a.collaborations.length && !a.activations.length && !c.budget?.hasBudget && !c.ads;
    if (empty) return unavailable(`Aucune activité marketing enregistrée pour ${brand.name} sur ± ${c.windowDays} jours (ni campagne, ni contenu, ni collaboration, ni activation, ni budget, ni journée publicitaire).`, "Créer les campagnes (Marketing → Campagnes), le planning (Marketing → Planning éditorial), les activations, importer les budgets (Imports → Budgets) ou synchroniser Meta (Marketing → Digital Ads).", "Modules marketing COMANET OS");
    const today = c.now;
    const campaign = (x: (typeof a.campaigns)[number]) => ({ name: x.name, type: campaignTypeLabel(x.type), channel: x.channel, status: CAMPAIGN_STATUS[x.status]?.label ?? x.status, objective: x.objective, offer: x.offer, start: x.startDate, end: x.endDate, budget_mad: round(x.budget), spent_mad: round(x.spent), ad_spend_mad: round(x.adSpend), products: x.products, kpi_target: x.kpiTarget, kpi_actual: x.kpiActual, href: `/marketing/campagnes/${x.id}` });
    const content = (x: (typeof a.contents)[number]) => ({ title: x.title, date: x.date, deadline: x.deadline, platform: x.platform, format: x.format, status: x.statusLabel, awaiting_validation: x.awaitingValidation, in_production: x.inProduction, late: x.late, product: x.product, href: `/marketing/planning/${x.id}` });
    const collab = (x: (typeof a.collaborations)[number]) => ({ influencer: x.influencer, date: x.date, status: x.status, done: x.done, content_type: x.contentType, product: x.product, cost_mad: round(x.fee + x.productValue), promo_code: x.promoCode, attributed_revenue_mad: x.attributedRevenue === null ? "non mesuré" : round(x.attributedRevenue), reach: x.reach });
    const activation = (x: (typeof a.activations)[number]) => ({ name: x.name, type: x.type, date: x.date, end: x.endDate, status: x.statusLabel, running: x.isRunning, done: x.isDone, awaiting_validation: x.awaitingValidation, city: x.city, budget_planned_mad: round(x.budgetPlanned), attributed_revenue_mad: x.attributedRevenue === null ? "non mesuré" : round(x.attributedRevenue), product: x.product, href: `/marketing/activations/${x.id}` });
    const ended = a.campaigns.filter((x) => x.status === "DONE" || x.status === "ANALYZED");
    const data = {
      brand: brand.name, as_of: today, window_days: c.windowDays, counts: c.counts,
      campaigns: {
        active: a.campaigns.filter((x) => x.status === "ACTIVE").slice(0, N).map(campaign),
        paused: a.campaigns.filter((x) => x.status === "PAUSED").slice(0, N).map(campaign),
        planned: a.campaigns.filter((x) => x.status === "PLANNED" || x.status === "DRAFT").slice(0, N).map(campaign),
        recently_ended: ended.slice(0, N).map(campaign),
      },
      promotions: a.campaigns.filter((x) => x.type === "PROMOTION" || !!x.offer).slice(0, N).map(campaign),
      editorial_calendar: {
        upcoming: a.contents.filter((x) => !x.isPublished && x.date >= today).slice(0, N).map(content),
        late: a.contents.filter((x) => x.late).slice(0, N).map(content),
        published_recently: a.contents.filter((x) => x.isPublished).slice(-N).map(content),
      },
      influence: { open: a.collaborations.filter((x) => !x.done).slice(0, N).map(collab), done: a.collaborations.filter((x) => x.done).slice(0, N).map(collab) },
      activations_and_events: {
        running: a.activations.filter((x) => x.isRunning).slice(0, N).map(activation),
        upcoming: a.activations.filter((x) => !x.isDone && !x.isRunning && x.date >= today).slice(0, N).map(activation),
        done: a.activations.filter((x) => x.isDone).slice(0, N).map(activation),
      },
      brand_marketing_objectives: a.brandObjectives ?? "non renseignés sur la fiche marque",
      budget: c.budget ? { year: c.budget.year, has_budget: c.budget.hasBudget, annual_mad: round(c.budget.annual), consumed_mad: round(c.budget.consumed), spent_mad: round(c.budget.spent), remaining_mad: round(c.budget.remaining), consumed_pct: round(c.budget.consumedPct, 1) } : "non accessible",
      ads_30d: c.ads ? { campaigns: c.ads.campaigns, spend_mad: round(c.ads.spend), conversations: c.ads.results.conversations, leads: c.ads.results.leads, purchases: c.ads.results.purchases, measured_revenue_mad: round(c.ads.results.measuredRevenue), verdicts: c.ads.verdicts, top: c.ads.top.map((t) => ({ campaign: t.campaign, spend_mad: round(t.spend), verdict: t.verdict, headline: t.headline, result_kind: t.resultKind, cost_per_result_mad: round(t.costPerResult, 1) })) } : "aucune journée publicitaire close sur 30 jours",
      tags: { campaigns: "CONFIRMED", budget: "CALCULATED (définition budget.ts)", ads_30d: "CONFIRMED (régie, MAD converti)", attributed_revenue_mad: "CONFIRMED uniquement si mesuré" }, legend: DATA_TAGS_LEGEND,
    };
    const rowCount = a.campaigns.length + a.contents.length + a.collaborations.length + a.activations.length;
    const notes = freshnessNotes(ctx);
    if (c.notAccessible.length) notes.push(`Non accessible avec vos droits : ${c.notAccessible.join(" ; ")}.`);
    if (c.budget && !c.budget.hasBudget) notes.push("Aucune enveloppe annuelle saisie : restant et taux non mesurables.");
    return {
      available: true,
      source: "Modules marketing COMANET OS (campagnes, planning, influence, activations) · budget.ts · régie publicitaire (MAD converti)",
      period: { start: c.now, end: c.now, label: `± ${c.windowDays} jours autour du ${c.now}` },
      scope: scopeLabel(ctx.access, [`marque ${brand.name}`]),
      data, rowCount,
      links: [{ label: "Ouvrir Marketing", href: `/marketing?brand=${brand.id}` }, { label: "Planning éditorial", href: `/marketing/planning?brand=${brand.id}` }],
      notes,
    };
  },
};
