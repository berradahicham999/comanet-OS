/**
 * Orchestration de la couche Marketing Intelligence — dépendances injectées, aucune requête ici.
 *
 * Chaque `build*()` lit la donnée par `MarketingIntelDeps` (fonctions officielles), assemble avec les
 * moteurs purs (`inventory.ts`, `performance.ts`, `targets.ts`, `decisions.ts`) et renvoie un objet
 * sérialisable, filtré et agrégé côté serveur : jamais plus de quelques dizaines de lignes.
 * Réutilisée par les outils du copilote, la page /marketing/agent et le pont CLI : une seule logique.
 */
import { addDays, iso } from "@/lib/format";
import { resolvePeriod, type PeriodParam } from "@/lib/periods";
import type { SalesFilter } from "@/lib/analytics";
import { COLLAB_STATUS } from "@/lib/marketing-shared";
import { inventoryRow, inventorySummary, stockThresholdsDays, type InventorySummary, type StockThresholdsDays } from "./inventory";
import { buildProductPerfRows } from "./performance";
import { computeTargets } from "./targets";
import { decide, type AdsSignal, type DecisionSet } from "./decisions";
import type { IntelContext, InventoryRow, MarketingActivity, PeriodInfo, ProductPerf, SalesTargets } from "./types";

/* ------------------------------ Périodes ------------------------------ */

export const MARKETING_PERIOD_KEYS = ["7d", "30d", "90d", "ytd", "month", "prevMonth", "quarter", "last12m", "custom"] as const;
export type MarketingPeriodKey = (typeof MARKETING_PERIOD_KEYS)[number];

const PERIOD_MAP: Record<MarketingPeriodKey, PeriodParam> = { "7d": "last7", "30d": "last30", "90d": "last90", ytd: "ytd", month: "month", prevMonth: "prevMonth", quarter: "quarter", last12m: "last12m", custom: "custom" };

/** Résout une période de l'agent (7d / 30d / 90d / ytd / custom…) sur la date de référence des ventes. */
export function marketingPeriod(key: MarketingPeriodKey | undefined, ref: Date, custom?: { start?: string; end?: string }): PeriodInfo {
  const p = resolvePeriod(PERIOD_MAP[key ?? "30d"], ref, custom);
  return { key: p.key, start: p.start, end: p.end, label: p.label, days: p.days, prev: p.prev, n1: p.n1 };
}

const brandFilterOf = (ctx: IntelContext, brandId: string | null): SalesFilter => ({
  ...(brandId ? { brandId } : ctx.scopeBrandIds ? { brandIds: ctx.scopeBrandIds } : {}),
  ...(ctx.scopeClientIds ? { clientIds: ctx.scopeClientIds } : {}),
});

const inScope = <T extends { brandId: string | null }>(ctx: IntelContext, rows: T[]) => (ctx.scopeBrandIds ? rows.filter((r) => r.brandId && ctx.scopeBrandIds!.includes(r.brandId)) : rows);

/* ------------------------------ Stock ------------------------------ */

export type InventoryResult = { rows: InventoryRow[]; summary: InventorySummary; thresholds: StockThresholdsDays; stockDate: string | null };

/** Statut de stock par référence : photo de stock + rotation sell-in + ventes 30 jours + dernière vente. */
export async function buildInventory(ctx: IntelContext, o: { brandId: string | null }): Promise<InventoryResult> {
  const { deps, settings, refDate, gates } = ctx;
  const d30 = iso(addDays(refDate, -29)), tomorrow = iso(addDays(refDate, 1));
  const f = brandFilterOf(ctx, o.brandId);
  const [stocks, last30, catalog] = await Promise.all([
    deps.productStocks(o.brandId ? { brandId: o.brandId } : {}, refDate),
    deps.salesByDim("product", d30, tomorrow, f, 1000),
    deps.productCatalog(refDate, o.brandId ? { brandId: o.brandId } : {}),
  ]);
  const l30 = new Map(last30.map((r) => [r.id, r]));
  const cat = new Map(catalog.map((p) => [p.id, p]));
  const rows = inScope(ctx, stocks).map((p) => inventoryRow(p, { unitsLast30: l30.get(p.productId)?.quantity ?? 0, revenueLast30: l30.get(p.productId)?.amount ?? 0, lastSale: cat.get(p.productId)?.lastSale ?? null }, settings, gates.internalCosts));
  const summary = inventorySummary(rows, gates.internalCosts);
  return { rows, summary, thresholds: stockThresholdsDays(settings), stockDate: summary.stockDate };
}

/* ------------------------------ Performance produit ------------------------------ */

export type PerformanceResult = {
  period: PeriodInfo;
  rows: ProductPerf[];
  /** Totaux du périmètre sur la période et sur la période précédente. */
  totals: { revenue: number; units: number; orders: number; clients: number; lines: number };
  totalsPrev: { revenue: number; units: number; orders: number; clients: number; lines: number } | null;
  growthPct: number | null;
  comparable: boolean;
  inventory: InventoryResult | null;
};

export async function buildProductPerformance(ctx: IntelContext, o: { brandId: string | null; period?: MarketingPeriodKey; custom?: { start?: string; end?: string } }): Promise<PerformanceResult> {
  const { deps, settings, refDate, gates } = ctx;
  const p = marketingPeriod(o.period, refDate, o.custom);
  const f = brandFilterOf(ctx, o.brandId);
  const [cur, prev, tCur, tPrev, catalog, inventory] = await Promise.all([
    deps.salesByDim("product", p.start, p.end, f, 1000),
    deps.salesByDim("product", p.prev.start, p.prev.end, f, 1000),
    deps.salesTotals(p.start, p.end, f),
    deps.salesTotals(p.prev.start, p.prev.end, f),
    deps.productCatalog(refDate, o.brandId ? { brandId: o.brandId } : {}),
    gates.stock ? buildInventory(ctx, { brandId: o.brandId }) : Promise.resolve(null),
  ]);
  const comparable = tPrev.lines > 0;
  const rows = buildProductPerfRows({
    cur, prev: comparable ? prev : null, catalog: inScope(ctx, catalog), inventory: inventory ? new Map(inventory.rows.map((r) => [r.productId, r])) : null,
    scopeRevenue: tCur.amount, settings, internalCosts: gates.internalCosts,
  });
  const totals = { revenue: tCur.amount, units: tCur.quantity, orders: tCur.orders, clients: tCur.clients, lines: tCur.lines };
  const totalsPrev = comparable ? { revenue: tPrev.amount, units: tPrev.quantity, orders: tPrev.orders, clients: tPrev.clients, lines: tPrev.lines } : null;
  return { period: p, rows, totals, totalsPrev, growthPct: comparable && tPrev.amount > 0 ? ((tCur.amount - tPrev.amount) / tPrev.amount) * 100 : null, comparable, inventory };
}

/* ------------------------------ Objectifs ------------------------------ */

export async function buildSalesTargets(ctx: IntelContext, o: { brandId: string | null }): Promise<SalesTargets> {
  const { deps, refDate } = ctx;
  const y = refDate.getUTCFullYear(), m = refDate.getUTCMonth() + 1;
  const som = iso(new Date(Date.UTC(y, m - 1, 1))), soy = `${y}-01-01`, tomorrow = iso(addDays(refDate, 1));
  const f = brandFilterOf(ctx, o.brandId);
  const [monthly, annual, mtd, ytd] = await Promise.all([
    deps.salesObjective(y, m, o.brandId), deps.annualObjective(y, o.brandId), deps.salesTotals(som, tomorrow, f), deps.salesTotals(soy, tomorrow, f),
  ]);
  return computeTargets({ ref: refDate, monthlyObjective: monthly, annualObjective: annual, mtd: mtd.amount, ytd: ytd.amount });
}

/* ------------------------------ Contexte marketing ------------------------------ */

export type AdsSummary = {
  period: { start: string; end: string; label: string };
  campaigns: number;
  spend: number;
  results: { conversations: number; leads: number; purchases: number; measuredRevenue: number };
  verdicts: Record<string, number>;
  top: { campaign: string; spend: number; verdict: string; headline: string; resultKind: string; costPerResult: number | null }[];
};

export type MarketingContextResult = {
  brandId: string;
  now: string;
  windowDays: number;
  activity: MarketingActivity;
  counts: { activeCampaigns: number; plannedCampaigns: number; recentlyEnded: number; promotions: number; upcomingContents: number; lateContents: number; publishedRecently: number; runningActivations: number; upcomingActivations: number; collaborationsOpen: number; collaborationsDone: number };
  budget: { year: number; hasBudget: boolean; annual: number; consumed: number; spent: number; remaining: number | null; consumedPct: number | null } | null;
  ads: AdsSummary | null;
  /** Blocs non lus faute de droits. */
  notAccessible: string[];
};

const WINDOW_DAYS = 60;

export async function buildMarketingContext(ctx: IntelContext, o: { brandId: string }): Promise<MarketingContextResult> {
  const { deps, settings, now, gates } = ctx;
  const today = iso(now);
  const year = now.getUTCFullYear();
  const adsRange = { start: iso(addDays(now, -30)), end: iso(addDays(now, 1)) };
  const adsPrev = { start: iso(addDays(now, -60)), end: adsRange.start };
  const [activity, budget, adsCur, adsPrevRows] = await Promise.all([
    deps.marketingActivity({ brandId: o.brandId, now, windowDays: WINDOW_DAYS }),
    gates.budgets ? deps.budgetConsumption(year, o.brandId) : Promise.resolve(null),
    gates.marketing ? deps.adsByDim("campaign", adsRange, { brandId: o.brandId }) : Promise.resolve(null),
    gates.marketing ? deps.adsByDim("campaign", adsPrev, { brandId: o.brandId }) : Promise.resolve(null),
  ]);
  const notAccessible: string[] = [];
  if (!gates.budgets) notAccessible.push("budget marketing (module Budgets)");
  if (!gates.marketing) notAccessible.push("Digital Ads (module Marketing)");

  let ads: AdsSummary | null = null;
  if (adsCur && adsCur.length) {
    const cur = adsCur.map(deps.adKpis), prevMap = new Map((adsPrevRows ?? []).map((r) => [r.key, deps.adKpis(r)]));
    const avg = deps.adBrandAverages(cur);
    const verdicts: Record<string, number> = {};
    const scored = cur.map((k) => { const d = deps.adDiagnose(k, prevMap.get(k.key) ?? null, avg, settings.ads); verdicts[d.verdict] = (verdicts[d.verdict] ?? 0) + 1; return { k, d }; }).sort((a, b) => b.k.spend - a.k.spend);
    ads = {
      period: { ...adsRange, label: "30 derniers jours" }, campaigns: cur.length, spend: cur.reduce((s, k) => s + k.spend, 0),
      results: { conversations: cur.reduce((s, k) => s + k.messagingStarted, 0), leads: cur.reduce((s, k) => s + k.leads, 0), purchases: cur.reduce((s, k) => s + k.purchases, 0), measuredRevenue: cur.reduce((s, k) => s + k.revenue, 0) },
      verdicts, top: scored.slice(0, 5).map(({ k, d }) => ({ campaign: k.campaignName, spend: k.spend, verdict: d.verdict, headline: d.headline, resultKind: k.resultKind, costPerResult: k.costPerResult })),
    };
  }
  const a = activity;
  const ended = a.campaigns.filter((c) => (c.status === "DONE" || c.status === "ANALYZED") && c.endDate && c.endDate >= iso(addDays(now, -WINDOW_DAYS)));
  return {
    brandId: o.brandId, now: today, windowDays: WINDOW_DAYS, activity: a,
    counts: {
      activeCampaigns: a.campaigns.filter((c) => c.status === "ACTIVE").length,
      plannedCampaigns: a.campaigns.filter((c) => c.status === "PLANNED" || c.status === "DRAFT").length,
      recentlyEnded: ended.length,
      promotions: a.campaigns.filter((c) => c.type === "PROMOTION" || !!c.offer).length,
      upcomingContents: a.contents.filter((c) => !c.isPublished && c.date >= today).length,
      lateContents: a.contents.filter((c) => c.late).length,
      publishedRecently: a.contents.filter((c) => c.isPublished && c.date < today).length,
      runningActivations: a.activations.filter((x) => x.isRunning).length,
      upcomingActivations: a.activations.filter((x) => !x.isDone && !x.isRunning && x.date >= today).length,
      collaborationsOpen: a.collaborations.filter((c) => !c.done).length,
      collaborationsDone: a.collaborations.filter((c) => c.done).length,
    },
    budget: budget ? { year, hasBudget: budget.hasBudget, annual: budget.annual, consumed: budget.consumed, spent: budget.spent, remaining: budget.remaining, consumedPct: budget.consumedPct } : null,
    ads, notAccessible,
  };
}

/** Vrai si le statut d'une collaboration est terminé (référentiel `COLLAB_STATUS`). */
export const collabDone = (status: string) => COLLAB_STATUS[status]?.done ?? false;

/* ------------------------------ Recommandations ------------------------------ */

export type RecommendationResult = { period: PeriodInfo; comparable: boolean; adsSignal: "READ" | "UNAVAILABLE" | "NOT_ALLOWED"; targets: SalesTargets | null; set: DecisionSet; performance: PerformanceResult };

export async function buildRecommendations(ctx: IntelContext, o: { brandId: string; brandName: string; period?: MarketingPeriodKey; custom?: { start?: string; end?: string }; /** Résultats déjà calculés (page /marketing/agent) : évite de relire la même donnée. */ performance?: PerformanceResult; targets?: SalesTargets }): Promise<RecommendationResult> {
  const [performance, targets] = await Promise.all([o.performance ?? buildProductPerformance(ctx, o), o.targets ?? buildSalesTargets(ctx, { brandId: o.brandId })]);
  let ads: Map<string, AdsSignal> | null = null;
  let adsSignal: RecommendationResult["adsSignal"] = "NOT_ALLOWED";
  if (ctx.gates.marketing) {
    try {
      const push = await ctx.deps.adsProductsToPush({ brandId: o.brandId });
      ads = new Map(push.filter((x) => x.productId).map((x) => [x.productId as string, { decision: x.decision, costPerResult: x.costPerResult, why: x.why }]));
      adsSignal = "READ";
    } catch { adsSignal = "UNAVAILABLE"; ads = null; }
  }
  const set = decide({ rows: performance.rows, settings: ctx.settings, brandName: o.brandName, ads, targets, comparable: performance.comparable, periodLabel: performance.period.label });
  return { period: performance.period, comparable: performance.comparable, adsSignal, targets, set, performance };
}

/* ------------------------------ Vue marque ------------------------------ */

export type BrandOverview = {
  brand: { id: string; name: string };
  period: PeriodInfo;
  sales: { revenue: number; units: number; orders: number; clients: number; revenuePrev: number | null; unitsPrev: number | null; growthPct: number | null; comparable: boolean };
  targets: SalesTargets;
  /** Marge brute pondérée par le CA des produits dont la marge est connue ; `coveragePct` = part du CA couverte. */
  margin: { weightedPct: number | null; coveragePct: number | null } | null;
  stock: (InventorySummary & { thresholds: StockThresholdsDays }) | null;
  topProducts: ProductPerf[];
  riskProducts: ProductPerf[];
  overstockProducts: ProductPerf[];
  marketing: MarketingContextResult["counts"] | null;
  budget: MarketingContextResult["budget"];
  ads: AdsSummary | null;
  freshness: { salesRefDate: string; stockDate: string | null; computedAt: string };
  notAccessible: string[];
  /** Détail produit ayant servi à la vue (réutilisable par `buildRecommendations`). */
  performance: PerformanceResult;
};

export async function buildBrandOverview(ctx: IntelContext, o: { brandId: string; brandName: string; period?: MarketingPeriodKey; custom?: { start?: string; end?: string } }): Promise<BrandOverview> {
  const [perf, targets, mkt] = await Promise.all([
    buildProductPerformance(ctx, o), buildSalesTargets(ctx, { brandId: o.brandId }),
    ctx.gates.marketing ? buildMarketingContext(ctx, { brandId: o.brandId }) : Promise.resolve(null),
  ]);
  const withMargin = perf.rows.filter((r) => r.marginPct !== null && r.revenue > 0);
  const covered = withMargin.reduce((s, r) => s + r.revenue, 0);
  const margin = ctx.gates.internalCosts ? { weightedPct: covered > 0 ? withMargin.reduce((s, r) => s + (r.marginPct as number) * r.revenue, 0) / covered : null, coveragePct: perf.totals.revenue > 0 ? (covered / perf.totals.revenue) * 100 : null } : null;
  const notAccessible: string[] = [];
  if (!ctx.gates.stock) notAccessible.push("stock (module Stock)");
  if (!ctx.gates.marketing) notAccessible.push("activité marketing et Digital Ads (module Marketing)");
  if (!ctx.gates.budgets) notAccessible.push("budget marketing (module Budgets)");
  if (!ctx.gates.internalCosts) notAccessible.push("marge et valeur de stock (coûts internes)");
  return {
    brand: { id: o.brandId, name: o.brandName }, period: perf.period,
    sales: { revenue: perf.totals.revenue, units: perf.totals.units, orders: perf.totals.orders, clients: perf.totals.clients, revenuePrev: perf.totalsPrev?.revenue ?? null, unitsPrev: perf.totalsPrev?.units ?? null, growthPct: perf.growthPct, comparable: perf.comparable },
    targets, margin,
    stock: perf.inventory ? { ...perf.inventory.summary, thresholds: perf.inventory.thresholds } : null,
    topProducts: perf.rows.slice(0, 5),
    riskProducts: perf.rows.filter((r) => r.stock?.risk === "RUPTURE_RISQUE").slice(0, 5),
    overstockProducts: perf.rows.filter((r) => r.stock?.risk === "SURSTOCK").sort((a, b) => (b.stock?.daysOfStock ?? 0) - (a.stock?.daysOfStock ?? 0)).slice(0, 5),
    marketing: mkt?.counts ?? null, budget: mkt?.budget ?? null, ads: mkt?.ads ?? null,
    freshness: { salesRefDate: iso(ctx.refDate), stockDate: perf.inventory?.stockDate ?? null, computedAt: new Date().toISOString() },
    notAccessible,
    performance: perf,
  };
}
