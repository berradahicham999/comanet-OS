/**
 * Outils « marque » de l'Agent marketing : vue d'ensemble, objectifs et écart, recommandations du moteur
 * de décision. Toute la logique vit dans `src/lib/marketing-intel/` ; ici, uniquement le schéma, les
 * droits, la mise en forme compacte et les notes de fraîcheur.
 */
import { z } from "zod";
import { buildBrandOverview, buildRecommendations, buildSalesTargets } from "@/lib/marketing-intel/build";
import { ACTION_LABELS, CONFIDENCE_LABELS } from "@/lib/marketing-intel/decisions";
import { CATEGORY_LABELS } from "@/lib/marketing-intel/performance";
import { STOCK_RISK_LABELS, STOCK_STATUS_LABELS } from "@/lib/marketing-intel/inventory";
import type { Decision, ProductPerf, SalesTargets } from "@/lib/marketing-intel/types";
import type { AiTool, ToolResult } from "./types";
import { DATA_TAGS_LEGEND, customPeriodFields, freshnessNotes, intelContext, limitOf, marketingPeriodSchema, resolveBrand, round, scopeLabel, unavailable } from "./shared";

/* ------------------------------ Mise en forme partagée ------------------------------ */

export function productLine(p: ProductPerf) {
  return {
    product: p.name, sku: p.sku, revenue_mad: round(p.revenue), units: round(p.units), growth_pct: p.growthPct === null ? "pas encore comparable" : round(p.growthPct, 1),
    contribution_pct: round(p.contributionPct, 1), margin_pct: p.marginPct === null ? null : round(p.marginPct, 1),
    stock_units: p.stock?.stockKnown ? p.stock.stock : null, days_of_stock: p.stock?.daysOfStock ?? null, stock_status: p.stock ? STOCK_STATUS_LABELS[p.stock.status] : null, stock_risk: p.stock ? p.stock.risk : null,
    category: p.category, category_label: CATEGORY_LABELS[p.category], profile: p.profile, reasons: p.reasons, href: `/produits/${p.productId}`,
  };
}

export function targetsBlock(t: SalesTargets) {
  return {
    as_of: t.asOf,
    month: {
      label: `${t.month}/${t.year}`, objective_mad: round(t.monthly.objective), realized_mad: round(t.monthly.realized), completion_pct: round(t.monthly.pct, 1), gap_mad: round(t.monthly.gap),
      day_of_month: t.monthly.dayOfMonth, days_in_month: t.monthly.daysInMonth, progress_pct: round(t.monthly.progressPct, 1),
      forecast_run_rate_mad: round(t.monthly.forecastRunRate), forecast_completion_pct: round(t.monthly.forecastPct, 1), forecast_gap_mad: round(t.monthly.forecastGap),
      forecast_note: t.monthly.forecastRunRate === null ? null : "projection linéaire au rythme courant (CALCULATED), pas une prévision",
    },
    annual: {
      year: t.year, objective_mad: round(t.annual.objective), realized_ytd_mad: round(t.annual.realized), completion_pct: round(t.annual.pct, 1), gap_mad: round(t.annual.gap),
      elapsed_pct: round(t.annual.elapsedPct, 1), expected_at_pace_mad: round(t.annual.expectedAtPace), pace_gap_mad: round(t.annual.paceGap),
    },
    tags: { objective_mad: "CONFIRMED", realized_mad: "CONFIRMED", completion_pct: "CALCULATED", forecast_run_rate_mad: "CALCULATED", expected_at_pace_mad: "CALCULATED" },
  };
}

export function decisionLine(d: Decision) {
  return {
    priority: null as number | null, action: d.action, action_label: ACTION_LABELS[d.action], secondary_actions: d.secondaryActions, scope: d.scope, product: d.productName, brand: d.brandName,
    title: d.title, why: d.why, data: d.data.map((f) => `${f.label} : ${f.value} [${f.tag}]`), expected_impact: d.expectedImpact,
    confidence: d.confidence, confidence_label: CONFIDENCE_LABELS[d.confidence], confidence_why: d.confidenceWhy, href: d.productId ? `/produits/${d.productId}` : null,
  };
}

/* ------------------------------ get_brand_overview ------------------------------ */

const overviewSchema = z.object({
  brand: z.string().describe("Nom de la marque (ex. « Gamarde »). Obligatoire."),
  period: marketingPeriodSchema,
  ...customPeriodFields,
});

export const getBrandOverview: AiTool<typeof overviewSchema> = {
  name: "get_brand_overview",
  description:
    "Vue d'ensemble d'une marque pour décider en marketing : CA sell-in (Sage, HT, MAD) et unités sur la période vs période précédente, objectif du mois et de l'année avec % atteint, écart et projection au rythme courant, marge brute pondérée si accessible, stock (unités, valeur, couverture moyenne en jours, répartition par statut, seuils en jours), top produits, produits à risque de rupture, surstock, activité marketing (campagnes, contenus, activations, influence), budget marketing consommé et Digital Ads 30 jours. Chaque bloc porte son étiquette CONFIRMED / CALCULATED / INFERRED / MISSING ; un bloc hors droits est « non accessible ». À appeler en premier pour toute question sur une marque.",
  module: "ventes",
  action: "view",
  schema: overviewSchema,
  async run(input, ctx): Promise<ToolResult> {
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    if (!brand) return unavailable("Préciser la marque.", "Indiquer le nom de la marque (search_entities si l'orthographe est incertaine).");
    const o = await buildBrandOverview(intelContext(ctx), { brandId: brand.id, brandName: brand.name, period: input.period, custom: { start: input.period_start, end: input.period_end } });
    if (o.sales.revenue === 0 && o.sales.revenuePrev === null && o.topProducts.length === 0) {
      return unavailable(`Aucune vente (sell-in) pour ${brand.name} sur ${o.period.label} ni sur la période précédente.`, "Importer l'export Sage de la période (Imports → Ventes) ou élargir la période.", "Sage — sell-in HT");
    }
    const notes = freshnessNotes(ctx, o.stock ? o.stock.stockDate : undefined);
    if (!o.sales.comparable) notes.push("Période précédente sans vente sell-in : croissance « pas encore comparable ».");
    if (o.margin && o.margin.coveragePct !== null && o.margin.coveragePct < 100) notes.push(`Marge calculée sur ${round(o.margin.coveragePct, 0)} % du CA (produits avec prix d'achat et prix COMANET connus).`);
    if (o.notAccessible.length) notes.push(`Non accessible avec vos droits : ${o.notAccessible.join(" ; ")}.`);
    return {
      available: true,
      source: "Sage — sell-in HT (MAD) · photo de stock · objectifs · modules marketing · régie (MAD converti)",
      period: { start: o.period.start, end: o.period.end, label: o.period.label },
      scope: scopeLabel(ctx.access, [`marque ${brand.name}`]),
      data: {
        brand: brand.name,
        sales: {
          revenue_mad: round(o.sales.revenue), units: round(o.sales.units), orders: o.sales.orders, active_clients: o.sales.clients,
          previous_period: o.sales.comparable ? { start: o.period.prev.start, end: o.period.prev.end, revenue_mad: round(o.sales.revenuePrev), units: round(o.sales.unitsPrev) } : null,
          growth_pct: o.sales.growthPct === null ? "pas encore comparable" : round(o.sales.growthPct, 1), tags: { revenue_mad: "CONFIRMED", growth_pct: "CALCULATED" },
        },
        objectives: targetsBlock(o.targets),
        margin: o.margin ? { weighted_gross_margin_pct: round(o.margin.weightedPct, 1), revenue_coverage_pct: round(o.margin.coveragePct, 0), tag: "CALCULATED" } : "non accessible",
        stock: o.stock ? {
          stock_date: o.stock.stockDate, products: o.stock.products, with_snapshot: o.stock.known, total_units: round(o.stock.totalUnits), stock_value_mad: round(o.stock.stockValue),
          avg_days_of_stock: o.stock.avgDaysOfStock, by_status: Object.fromEntries(Object.entries(o.stock.byStatus).map(([k, v]) => [`${k} (${STOCK_STATUS_LABELS[k as keyof typeof STOCK_STATUS_LABELS]})`, v])),
          by_risk: Object.fromEntries(Object.entries(o.stock.byRisk).map(([k, v]) => [`${k} (${STOCK_RISK_LABELS[k as keyof typeof STOCK_RISK_LABELS]})`, v])),
          thresholds_days: o.stock.thresholds, tags: { total_units: "CONFIRMED", avg_days_of_stock: "CALCULATED", by_status: "CALCULATED" },
        } : "non accessible",
        top_products: o.topProducts.map(productLine),
        risk_products: o.riskProducts.map(productLine),
        overstock_products: o.overstockProducts.map(productLine),
        marketing_activity: o.marketing ?? "non accessible",
        budget: o.budget ? { year: o.budget.year, has_budget: o.budget.hasBudget, annual_mad: round(o.budget.annual), consumed_mad: round(o.budget.consumed), remaining_mad: round(o.budget.remaining), consumed_pct: round(o.budget.consumedPct, 1) } : "non accessible",
        ads_30d: o.ads ? { campaigns: o.ads.campaigns, spend_mad: round(o.ads.spend), conversations: o.ads.results.conversations, leads: o.ads.results.leads, purchases: o.ads.results.purchases, measured_revenue_mad: round(o.ads.results.measuredRevenue), verdicts: o.ads.verdicts, top: o.ads.top.map((t) => ({ ...t, spend_mad: round(t.spend), spend: undefined, cost_per_result_mad: round(t.costPerResult, 1), costPerResult: undefined })) } : (o.notAccessible.some((x) => x.includes("Marketing")) ? "non accessible" : null),
        data_freshness: { sales_up_to: o.freshness.salesRefDate, stock_snapshot: o.freshness.stockDate, computed_at: o.freshness.computedAt },
        legend: DATA_TAGS_LEGEND,
      },
      rowCount: 1 + o.topProducts.length + o.riskProducts.length + o.overstockProducts.length,
      links: [{ label: "Ouvrir l'Agent marketing", href: `/marketing/agent?brand=${brand.id}&period=${o.period.key}` }, { label: "Fiche marque", href: `/marques/${brand.id}` }],
      notes,
    };
  },
};

/* ------------------------------ get_sales_targets ------------------------------ */

const targetsSchema = z.object({
  brand: z.string().optional().describe("Marque ; absente = objectif COMANET global."),
});

export const getSalesTargets: AiTool<typeof targetsSchema> = {
  name: "get_sales_targets",
  description:
    "Objectifs de vente sell-in (Sage, HT, MAD) : objectif du mois (ligne mensuelle, sinon annuel ÷ 12), CA réalisé à date, % atteint, écart, projection fin de mois au rythme courant (CALCULATED) ; objectif annuel, réalisé depuis le 1er janvier, écart et retard/avance sur le rythme linéaire. Un objectif absent est « non renseigné », jamais estimé. À lire avant de recommander d'augmenter ou de réduire une action.",
  module: "ventes",
  action: "view",
  schema: targetsSchema,
  async run(input, ctx): Promise<ToolResult> {
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    const t = await buildSalesTargets(intelContext(ctx), { brandId: brand?.id ?? null });
    if (t.monthly.objective === null && t.annual.objective === null) {
      return unavailable(`Aucun objectif ${t.year} renseigné${brand ? ` pour ${brand.name}` : ""}.`, "Saisir les objectifs (Paramètres → Objectifs) ou importer le fichier d'objectifs (Imports → Objectifs).", "Objectifs COMANET OS");
    }
    const notes = freshnessNotes(ctx);
    if (t.monthly.objective === null) notes.push("Objectif mensuel non renseigné : seul l'annuel est lu.");
    if (t.annual.objective === null) notes.push("Objectif annuel non renseigné.");
    return {
      available: true,
      source: "Objectifs saisis (COMANET OS) + Sage — sell-in HT (MAD)",
      period: { start: `${t.year}-01-01`, end: t.asOf, label: `Année ${t.year} à date` },
      scope: scopeLabel(ctx.access, [brand ? `marque ${brand.name}` : "COMANET global"]),
      data: { brand: brand?.name ?? "COMANET", ...targetsBlock(t), legend: DATA_TAGS_LEGEND },
      rowCount: 2,
      links: [{ label: "Ouvrir Ventes", href: `/ventes?period=month${brand ? `&brand=${brand.id}` : ""}` }],
      notes,
    };
  },
};

/* ------------------------------ get_marketing_recommendations ------------------------------ */

const recoSchema = z.object({
  brand: z.string().describe("Marque. Obligatoire."),
  period: marketingPeriodSchema,
  ...customPeriodFields,
  limit: z.number().int().min(1).max(10).optional().describe("Nombre de recommandations (défaut : réglage Paramètres, 5)."),
});

export const getMarketingRecommendations: AiTool<typeof recoSchema> = {
  name: "get_marketing_recommendations",
  description:
    "Moteur de décision marketing d'une marque : croise ventes sell-in (croissance, contribution) × stock (couverture en jours, risque de rupture, surstock) × marge × signal Ads, et rend des recommandations ACTION (PUSH, MAINTAIN, OPTIMIZE, RESTOCK, DO_NOT_PROMOTE, CREATE_PROMOTION, FOCUS_SELL_OUT, BOOST_DIGITAL, CREATE_CONTENT…) avec POURQUOI, DONNÉES étiquetées, IMPACT ATTENDU et CONFIANCE, plus la liste « à ne pas pousser » et l'écart à l'objectif. Il recommande, il n'exécute rien : la décision revient à la personne. À appeler pour « que pousser cette semaine ».",
  module: "ventes",
  action: "view",
  schema: recoSchema,
  async run(input, ctx): Promise<ToolResult> {
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    if (!brand) return unavailable("Préciser la marque.", "Indiquer le nom de la marque.");
    const ictx = intelContext(ctx);
    if (input.limit) ictx.settings = { ...ictx.settings, marketingIntel: { ...ictx.settings.marketingIntel, maxDecisions: limitOf(input.limit, 5) } };
    const r = await buildRecommendations(ictx, { brandId: brand.id, brandName: brand.name, period: input.period, custom: { start: input.period_start, end: input.period_end } });
    if (r.performance.rows.length === 0) return unavailable(`Aucune vente (sell-in) ni stock connu pour ${brand.name} sur ${r.period.label}.`, "Importer les ventes (Imports → Ventes) et une photo de stock (Imports → Stock).", "Sage — sell-in HT + photo de stock");
    const notes = [...freshnessNotes(ctx, r.performance.inventory ? r.performance.inventory.stockDate : undefined), ...r.set.notes];
    if (!ictx.gates.stock) notes.push("Stock non accessible avec vos droits : aucune décision ne peut vérifier la couverture, la confiance est abaissée.");
    if (r.adsSignal === "UNAVAILABLE") notes.push("Signal Ads indisponible (aucune donnée de régie sur la marque).");
    const decisions = r.set.decisions.map((d, i) => ({ ...decisionLine(d), priority: i + 1 }));
    const doNotPush = r.set.doNotPush.map((d) => ({ ...decisionLine(d), priority: null }));
    return {
      available: true,
      source: "Moteur de décision marketing — sell-in Sage × stock × marge × Ads (règles Paramètres)",
      period: { start: r.period.start, end: r.period.end, label: r.period.label },
      scope: scopeLabel(ctx.access, [`marque ${brand.name}`]),
      data: {
        brand: brand.name, products_considered: r.set.considered, comparable_period: r.comparable, ads_signal: r.adsSignal,
        thresholds: { growth_pct: ctx.settings.analytics.productCases.sellingGrowthPct, star_contribution_pct: ctx.settings.marketingIntel.starContributionPct, low_margin_pct: ctx.settings.marketingIntel.lowMarginPct, min_period_revenue_mad: ctx.settings.marketingIntel.minPeriodRevenueMad, stock_days: r.performance.inventory?.thresholds ?? "non accessible" },
        objective_gap: r.targets ? { month_objective_mad: round(r.targets.monthly.objective), realized_mad: round(r.targets.monthly.realized), completion_pct: round(r.targets.monthly.pct, 1), forecast_run_rate_mad: round(r.targets.monthly.forecastRunRate), forecast_gap_mad: round(r.targets.monthly.forecastGap) } : null,
        recommendations: decisions,
        do_not_push: doNotPush,
        legend: DATA_TAGS_LEGEND,
      },
      rowCount: decisions.length + doNotPush.length,
      links: [{ label: "Ouvrir l'Agent marketing", href: `/marketing/agent?brand=${brand.id}&period=${r.period.key}` }],
      notes,
    };
  },
};
