/**
 * Outils « produits » de l'Agent marketing : statut de stock par SKU, risques (rupture / surstock),
 * top SKU et performance produit. Définitions : `stock.ts` / `stock-math.ts` (couverture, tension,
 * surstock), `analytics.ts` (ventes), `products.ts` (historique), assemblées par `src/lib/marketing-intel/`.
 */
import { z } from "zod";
import { buildInventory, buildProductPerformance } from "@/lib/marketing-intel/build";
import { STOCK_RISK_LABELS, STOCK_STATUS_LABELS } from "@/lib/marketing-intel/inventory";
import { CATEGORY_LABELS, topSkus } from "@/lib/marketing-intel/performance";
import type { InventoryRow, ProductCategory, StockRisk, StockStatus } from "@/lib/marketing-intel/types";
import type { AiTool, ToolResult } from "./types";
import { DATA_TAGS_LEGEND, customPeriodFields, freshnessNotes, intelContext, limitOf, marketingPeriodSchema, resolveBrand, round, scopeLabel, unavailable } from "./shared";
import { productLine } from "./marketing-brand";

const STATUSES = ["CRITICAL", "LOW", "HEALTHY", "OVERSTOCK", "NO_ROTATION", "UNKNOWN"] as const;
const CATEGORIES = ["STOCK_RISK", "OVERSTOCK", "STAR", "GROWTH", "CASH_COW", "UNDERPERFORMER", "STABLE", "INSUFFICIENT_DATA"] as const;

function inventoryLine(r: InventoryRow) {
  return {
    product: r.name, sku: r.sku, brand: r.brandName,
    stock_units: r.stock, available_units: r.stock, on_order_units: r.onOrder, stock_date: r.stockDate,
    avg_daily_sales: round(r.avgDailySales, 2), avg_monthly_sales: round(r.avgMonthly, 1), units_last_30d: round(r.unitsLast30), revenue_last_30d_mad: round(r.revenueLast30), last_sale: r.lastSale,
    days_of_stock: r.daysOfStock, coverage_months: round(r.coverageMonths, 1), stockout_date: r.stockoutDate, recommended_order_units: r.recommendedOrder,
    status: r.status, status_label: STOCK_STATUS_LABELS[r.status], risk: r.risk, risk_label: STOCK_RISK_LABELS[r.risk],
    trend_last_month_pct: round(r.trendPct, 1), margin_pct: round(r.marginPct, 1), stock_value_mad: round(r.stockValue), href: `/produits/${r.productId}`,
  };
}

async function inventoryFor(ctx: Parameters<typeof intelContext>[0], input: { brand?: string; product?: string }): Promise<{ rows: InventoryRow[]; brandName: string | null; brandId: string | null; stockDate: string | null; thresholds: unknown; summary: unknown } | ToolResult> {
  const { brand, error } = await resolveBrand(ctx, input.brand);
  if (error) return error;
  const inv = await buildInventory(intelContext(ctx), { brandId: brand?.id ?? null });
  let rows = inv.rows;
  if (input.product) {
    const p = await ctx.deps.findProduct(input.product);
    if (!p) return unavailable(`Produit « ${input.product} » introuvable.`, "Utiliser search_entities pour retrouver la référence exacte.");
    rows = rows.filter((r) => r.productId === p.id);
  }
  if (!rows.length) return unavailable(`Aucun produit actif dans ce périmètre${brand ? ` (${brand.name})` : ""}.`, "Importer le référentiel produits (Imports → Produits) puis une photo de stock (Imports → Stock).", "Photo de stock + ventes Sage");
  if (!rows.some((r) => r.stockKnown)) return unavailable(`Aucune photo de stock importée pour ${brand ? brand.name : "ces produits"} : le statut de stock n'est pas calculable.`, "Importer l'état de stock (Imports → Stock). Sans lui, aucune couverture n'est estimée.", "Photo de stock");
  return { rows, brandName: brand?.name ?? null, brandId: brand?.id ?? null, stockDate: inv.stockDate, thresholds: inv.thresholds, summary: inv.summary };
}

const isResult = (x: unknown): x is ToolResult => typeof x === "object" && x !== null && "available" in x;

/* ------------------------------ get_inventory_status ------------------------------ */

const inventorySchema = z.object({
  brand: z.string().optional().describe("Marque ; absente = tout le périmètre."),
  product: z.string().optional().describe("Un produit précis (nom ou référence)."),
  status: z.enum(STATUSES).optional().describe("Ne garder qu'un statut : CRITICAL, LOW, HEALTHY, OVERSTOCK, NO_ROTATION (pas de vente), UNKNOWN (pas de photo de stock)."),
  sort: z.enum(["days_asc", "days_desc", "sales_desc", "value_desc"]).default("days_asc").describe("Tri : couverture croissante (défaut), décroissante, ventes 30 j, valeur de stock."),
  limit: z.number().int().min(1).max(50).optional().describe("Nombre de lignes (défaut 20)."),
});

export const getInventoryStatus: AiTool<typeof inventorySchema> = {
  name: "get_inventory_status",
  description:
    "Stock par SKU : stock actuel et disponible (dernière photo ; aucune réservation n'est suivie, disponible = stock), commande fournisseur en cours, vente moyenne par jour et par mois (sell-in), unités et CA des 30 derniers jours, dernière vente, couverture en jours et date de rupture prévisible, commande conseillée, statut CRITICAL / LOW / HEALTHY / OVERSTOCK / NO_ROTATION / UNKNOWN selon les seuils Paramètres (renvoyés en jours). Un produit sans photo de stock est UNKNOWN, jamais estimé. Le dernier réassort n'est pas suivi.",
  module: "stock",
  action: "view",
  schema: inventorySchema,
  async run(input, ctx): Promise<ToolResult> {
    const r = await inventoryFor(ctx, input);
    if (isResult(r)) return r;
    let rows = input.status ? r.rows.filter((x) => x.status === input.status) : r.rows;
    const sorters: Record<string, (a: InventoryRow, b: InventoryRow) => number> = {
      days_asc: (a, b) => (a.daysOfStock ?? Infinity) - (b.daysOfStock ?? Infinity), days_desc: (a, b) => (b.daysOfStock ?? -1) - (a.daysOfStock ?? -1),
      sales_desc: (a, b) => (b.unitsLast30 ?? 0) - (a.unitsLast30 ?? 0), value_desc: (a, b) => (b.stockValue ?? 0) - (a.stockValue ?? 0),
    };
    rows = [...rows].sort(sorters[input.sort]).slice(0, limitOf(input.limit, 20));
    const summary = r.summary as { byStatus: Record<StockStatus, number>; totalUnits: number; stockValue: number | null; avgDaysOfStock: number | null; products: number; known: number };
    return {
      available: true,
      source: `Photo de stock du ${r.stockDate ?? "?"} + vente moyenne sell-in Sage (${ctx.settings.avgSalesMonths} mois) + ventes 30 jours`,
      scope: scopeLabel(ctx.access, [r.brandName ? `marque ${r.brandName}` : null]),
      data: {
        stock_date: r.stockDate, products: summary.products, with_snapshot: summary.known, total_units: round(summary.totalUnits), stock_value_mad: round(summary.stockValue), avg_days_of_stock: summary.avgDaysOfStock,
        by_status: Object.fromEntries(Object.entries(summary.byStatus).map(([k, v]) => [`${k} (${STOCK_STATUS_LABELS[k as StockStatus]})`, v])),
        thresholds_days: r.thresholds, filter: { status: input.status ?? null, matched: rows.length },
        rows: rows.map(inventoryLine),
        tags: { stock_units: "CONFIRMED", avg_daily_sales: "CALCULATED", days_of_stock: "CALCULATED", status: "INFERRED" }, legend: DATA_TAGS_LEGEND,
      },
      rowCount: rows.length,
      links: [{ label: "Ouvrir Stock & achats", href: `/stock${r.brandId ? `?brand=${r.brandId}` : ""}` }],
      notes: [...freshnessNotes(ctx, r.stockDate), ...(summary.known < summary.products ? [`${summary.products - summary.known} produit(s) sans photo de stock (UNKNOWN).`] : [])],
    };
  },
};

/* ------------------------------ get_stock_risk ------------------------------ */

const riskSchema = z.object({
  brand: z.string().optional().describe("Marque ; absente = tout le périmètre."),
  risk: z.enum(["RUPTURE_RISQUE", "SURSTOCK", "all"]).default("all").describe("RUPTURE_RISQUE (couverture critique ou tension), SURSTOCK, ou all (les deux)."),
  limit: z.number().int().min(1).max(50).optional().describe("Nombre de lignes par risque (défaut 10)."),
});

export const getStockRisk: AiTool<typeof riskSchema> = {
  name: "get_stock_risk",
  description:
    "Risques de stock d'un périmètre : RUPTURE_RISQUE (couverture sous le seuil critique ou produit « en tension » : couverture < seuil de tension avec rotation suffisante), SURSTOCK (couverture au-delà du seuil de surstock sur un volume qui compte), HEALTHY sinon ; UNKNOWN sans photo de stock, NO_ROTATION sans vente. Seuils Paramètres renvoyés en jours, CA mensuel à risque, commande conseillée. Un produit à risque de rupture ne doit jamais être poussé avant réassort.",
  module: "stock",
  action: "view",
  schema: riskSchema,
  async run(input, ctx): Promise<ToolResult> {
    const r = await inventoryFor(ctx, { brand: input.brand });
    if (isResult(r)) return r;
    const lim = limitOf(input.limit, 10);
    const pick = (risk: StockRisk) => [...r.rows.filter((x) => x.risk === risk)];
    const rupture = pick("RUPTURE_RISQUE").sort((a, b) => (a.daysOfStock ?? -1) - (b.daysOfStock ?? -1)).slice(0, lim);
    const surstock = pick("SURSTOCK").sort((a, b) => (b.daysOfStock ?? 0) - (a.daysOfStock ?? 0)).slice(0, lim);
    const summary = r.summary as { byRisk: Record<StockRisk, number>; products: number; known: number };
    const revenueAtRisk = pick("RUPTURE_RISQUE").reduce((s, x) => s + (x.revenueLast30 ?? 0), 0);
    const data: Record<string, unknown> = {
      stock_date: r.stockDate, products: summary.products, with_snapshot: summary.known,
      by_risk: Object.fromEntries(Object.entries(summary.byRisk).map(([k, v]) => [`${k} (${STOCK_RISK_LABELS[k as StockRisk]})`, v])),
      thresholds_days: r.thresholds, revenue_last_30d_at_rupture_risk_mad: round(revenueAtRisk),
      tags: { by_risk: "INFERRED", days_of_stock: "CALCULATED", stock_units: "CONFIRMED" }, legend: DATA_TAGS_LEGEND,
    };
    if (input.risk !== "SURSTOCK") data.rupture_risk = rupture.map(inventoryLine);
    if (input.risk !== "RUPTURE_RISQUE") data.overstock = surstock.map(inventoryLine);
    const rowCount = (input.risk !== "SURSTOCK" ? rupture.length : 0) + (input.risk !== "RUPTURE_RISQUE" ? surstock.length : 0);
    return {
      available: true,
      source: `Photo de stock du ${r.stockDate ?? "?"} + vente moyenne sell-in Sage (${ctx.settings.avgSalesMonths} mois) ; seuils Paramètres`,
      scope: scopeLabel(ctx.access, [r.brandName ? `marque ${r.brandName}` : null]),
      data, rowCount,
      links: [{ label: "Ouvrir Stock & achats", href: `/stock${r.brandId ? `?brand=${r.brandId}` : ""}` }],
      notes: [...freshnessNotes(ctx, r.stockDate), ...(summary.known < summary.products ? [`${summary.products - summary.known} produit(s) sans photo de stock : risque non mesurable pour eux.`] : [])],
    };
  },
};

/* ------------------------------ get_top_skus ------------------------------ */

const topSchema = z.object({
  brand: z.string().optional().describe("Marque ; absente = tout le périmètre."),
  period: marketingPeriodSchema,
  ...customPeriodFields,
  metric: z.enum(["revenue", "units", "growth", "margin"]).default("revenue").describe("Classement : CA sell-in (défaut), unités, croissance vs période précédente, marge brute (coûts internes requis)."),
  limit: z.number().int().min(1).max(50).optional().describe("Taille du top (défaut 10)."),
});

export const getTopSkus: AiTool<typeof topSchema> = {
  name: "get_top_skus",
  description:
    "Top SKU d'une marque ou du périmètre sur la période : CA sell-in, unités, croissance vs période précédente, contribution au CA, marge brute, stock et couverture en jours, catégorie (STAR, GROWTH, CASH_COW, UNDERPERFORMER, STABLE, STOCK_RISK, OVERSTOCK, INSUFFICIENT_DATA). Classement par CA, unités, croissance ou marge. Un produit sans période comparable a une croissance « pas encore comparable » et n'entre pas dans le top croissance.",
  module: "ventes",
  action: "view",
  schema: topSchema,
  async run(input, ctx): Promise<ToolResult> {
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    const ictx = intelContext(ctx);
    if (input.metric === "margin" && !ictx.gates.internalCosts) return unavailable("La marge n'est pas accessible avec vos droits (coûts internes masqués).", "Demander l'interrupteur « voir les coûts internes » à un administrateur, ou classer par CA / unités / croissance.");
    const perf = await buildProductPerformance(ictx, { brandId: brand?.id ?? null, period: input.period, custom: { start: input.period_start, end: input.period_end } });
    if (!perf.rows.some((r) => r.revenue > 0)) return unavailable(`Aucune vente Sage sur ${perf.period.label}${brand ? ` pour ${brand.name}` : ""}.`, "Importer l'export Sage de la période (Imports → Ventes) ou élargir la période.", "Sage — sell-in HT");
    const rows = topSkus(perf.rows, input.metric, limitOf(input.limit, 10));
    if (!rows.length) return unavailable(`Aucun produit classable par ${input.metric} sur ${perf.period.label} (croissance ou marge non mesurables).`, "Choisir un autre critère ou élargir la période.", "Sage — sell-in HT");
    return {
      available: true,
      source: `Sage — sell-in HT (MAD)${perf.inventory ? ` · photo de stock du ${perf.inventory.stockDate ?? "?"}` : ""}`,
      period: { start: perf.period.start, end: perf.period.end, label: perf.period.label },
      scope: scopeLabel(ctx.access, [brand ? `marque ${brand.name}` : null]),
      data: {
        metric: input.metric, scope_revenue_mad: round(perf.totals.revenue), scope_growth_pct: perf.growthPct === null ? "pas encore comparable" : round(perf.growthPct, 1), comparable_period: perf.comparable,
        top: rows.map((p, i) => ({ rank: i + 1, ...productLine(p) })),
        tags: { revenue_mad: "CONFIRMED", growth_pct: "CALCULATED", contribution_pct: "CALCULATED", days_of_stock: "CALCULATED", category: "INFERRED" }, legend: DATA_TAGS_LEGEND,
      },
      rowCount: rows.length,
      links: [{ label: "Ouvrir Produits", href: `/produits${brand ? `?brand=${brand.id}` : ""}` }],
      notes: [...freshnessNotes(ctx, perf.inventory ? perf.inventory.stockDate : undefined), ...(perf.comparable ? [] : ["Période précédente sans vente Sage : croissances non mesurables."]), ...(ictx.gates.stock ? [] : ["Stock non accessible avec vos droits : couverture et catégories de stock absentes."])],
    };
  },
};

/* ------------------------------ get_product_performance ------------------------------ */

const perfSchema = z.object({
  brand: z.string().optional().describe("Marque ; absente = tout le périmètre."),
  product: z.string().optional().describe("Un produit précis (nom ou référence)."),
  period: marketingPeriodSchema,
  ...customPeriodFields,
  category: z.enum(CATEGORIES).optional().describe("Ne garder qu'une catégorie : STOCK_RISK, OVERSTOCK, STAR, GROWTH, CASH_COW, UNDERPERFORMER, STABLE, INSUFFICIENT_DATA."),
  limit: z.number().int().min(1).max(50).optional().describe("Nombre de produits (défaut 20, triés par CA)."),
});

export const getProductPerformance: AiTool<typeof perfSchema> = {
  name: "get_product_performance",
  description:
    "Performance de chaque produit : ventes sell-in de la période (CA, unités, commandes, clients), croissance vs période précédente, contribution au CA du périmètre, marge brute, historique 12 mois et tendance 3 mois vs 3 mois précédents, dernière vente, stock (unités, couverture en jours, statut, risque) et catégorie INFERRED : STAR (gros contributeur en croissance), GROWTH, CASH_COW (gros contributeur stable), UNDERPERFORMER (en baisse), STABLE, INSUFFICIENT_DATA ; le stock prime : STOCK_RISK ou OVERSTOCK. Seuils Paramètres renvoyés. Aucune catégorie n'est forcée quand la donnée manque.",
  module: "ventes",
  action: "view",
  schema: perfSchema,
  async run(input, ctx): Promise<ToolResult> {
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    const ictx = intelContext(ctx);
    const perf = await buildProductPerformance(ictx, { brandId: brand?.id ?? null, period: input.period, custom: { start: input.period_start, end: input.period_end } });
    let rows = perf.rows;
    if (input.product) {
      const p = await ctx.deps.findProduct(input.product);
      if (!p) return unavailable(`Produit « ${input.product} » introuvable.`, "Utiliser search_entities pour retrouver la référence exacte.");
      rows = rows.filter((r) => r.productId === p.id);
      if (!rows.length) return unavailable(`Aucune vente Sage ni stock connu pour « ${p.name} » sur ${perf.period.label}.`, "Élargir la période ou vérifier l'import des ventes (Imports → Ventes).", "Sage — sell-in HT");
    }
    if (!rows.length) return unavailable(`Aucune vente Sage ni stock connu sur ${perf.period.label}${brand ? ` pour ${brand.name}` : ""}.`, "Importer l'export Sage de la période (Imports → Ventes).", "Sage — sell-in HT");
    const counts: Partial<Record<ProductCategory, number>> = {};
    for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1;
    const shown = (input.category ? rows.filter((r) => r.category === input.category) : rows).slice(0, limitOf(input.limit, 20));
    return {
      available: true,
      source: `Sage — sell-in HT (MAD)${perf.inventory ? ` · photo de stock du ${perf.inventory.stockDate ?? "?"}` : ""} · historique produits à la date de référence`,
      period: { start: perf.period.start, end: perf.period.end, label: perf.period.label },
      scope: scopeLabel(ctx.access, [brand ? `marque ${brand.name}` : null]),
      data: {
        products: rows.length, scope_revenue_mad: round(perf.totals.revenue), scope_growth_pct: perf.growthPct === null ? "pas encore comparable" : round(perf.growthPct, 1), comparable_period: perf.comparable,
        by_category: Object.fromEntries(Object.entries(counts).map(([k, v]) => [`${k} (${CATEGORY_LABELS[k as ProductCategory]})`, v])),
        thresholds: { growth_pct: ctx.settings.analytics.productCases.sellingGrowthPct, star_contribution_pct: ctx.settings.marketingIntel.starContributionPct, min_period_revenue_mad: ctx.settings.marketingIntel.minPeriodRevenueMad, stock_days: perf.inventory?.thresholds ?? "non accessible" },
        filter: { category: input.category ?? null, matched: shown.length },
        rows: shown.map((p) => ({
          ...productLine(p), orders: p.orders, clients: p.clients, units_growth_pct: round(p.unitsGrowthPct, 1),
          history: { revenue_12m_mad: round(p.revenue12), units_12m: round(p.units12), clients_12m: p.clients12, units_3m: round(p.units3), units_prev_3m: round(p.unitsPrev3), trend_3m_pct: round(p.trend3Pct, 1), last_sale: p.lastSale },
          stockout_date: p.stock?.stockoutDate ?? null, recommended_order_units: p.stock?.recommendedOrder ?? null,
        })),
        tags: { revenue_mad: "CONFIRMED", growth_pct: "CALCULATED", contribution_pct: "CALCULATED", trend_3m_pct: "CALCULATED", days_of_stock: "CALCULATED", category: "INFERRED" }, legend: DATA_TAGS_LEGEND,
      },
      rowCount: shown.length,
      links: [{ label: "Ouvrir Analytics par produit", href: `/marketing/analytics/produits${brand ? `?brand=${brand.id}` : ""}` }],
      notes: [...freshnessNotes(ctx, perf.inventory ? perf.inventory.stockDate : undefined), ...(perf.comparable ? [] : ["Période précédente sans vente Sage : croissances non mesurables, catégories limitées à CASH_COW / STABLE."]), ...(ictx.gates.stock ? [] : ["Stock non accessible avec vos droits."])],
    };
  },
};
