/** `get_stock_coverage` — couverture en mois, niveau, ruptures prévisibles, commande conseillée (définition : `stock-math.ts`). */
import { z } from "zod";
import { LEVEL_LABEL, type CoverageLevel } from "@/lib/stock-math";
import type { AiTool, ToolResult } from "./types";
import { limitOf, resolveBrand, round, scopeLabel, unavailable } from "./shared";

const schema = z.object({
  brand: z.string().optional().describe("Marque."),
  product: z.string().optional().describe("Produit précis (nom ou référence)."),
  level: z.enum(["red", "orange", "yellow", "green", "none", "unknown"]).optional().describe("Ne garder qu'un niveau : red (rupture / < seuil orange), orange, yellow, green, none (pas de ventes), unknown (stock jamais importé)."),
  sort: z.enum(["coverage_asc", "stock_value_desc", "recommended_order_desc"]).default("coverage_asc"),
  limit: z.number().int().min(1).max(50).optional().describe("Taille de la liste (défaut 15)."),
});

const EMOJI: Record<CoverageLevel, string> = { green: "🟢", yellow: "🟡", orange: "🟠", red: "🔴", none: "⚪", unknown: "⚪" };

export const getStockCoverage: AiTool<typeof schema> = {
  name: "get_stock_coverage",
  description:
    "Stock : couverture en mois par référence (stock ÷ vente moyenne mensuelle sell-in), niveau 🟢🟡🟠🔴 selon les seuils Paramètres, date de rupture prévisible, commande conseillée, valeur de stock. Une référence sans photo de stock est « unknown », jamais estimée.",
  module: "stock",
  action: "view",
  schema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access, settings } = ctx;
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    let list = await deps.productStocks(brand ? { brandId: brand.id } : {}, ctx.refDate);
    if (access.brandIds) { const set = new Set(access.brandIds); list = list.filter((p) => p.brandId && set.has(p.brandId)); }
    if (input.product) {
      const prod = await deps.findProduct(input.product);
      if (!prod) return unavailable(`Produit « ${input.product} » introuvable.`, "Utiliser search_entities pour retrouver la référence.");
      list = list.filter((p) => p.productId === prod.id);
    }
    if (!list.length) return unavailable("Aucun produit dans ce périmètre.", "Importer le référentiel produits puis une photo de stock (Imports → Stock).", "Photo de stock + ventes sell-in");
    const known = list.filter((p) => p.stockKnown);
    if (!known.length) return unavailable("Aucune photo de stock importée pour ces produits.", "Importer l'état de stock (Imports → Stock) : sans lui la couverture n'est pas calculable.", "Photo de stock");
    const counts: Record<string, number> = {};
    for (const p of list) counts[p.level] = (counts[p.level] ?? 0) + 1;
    let rows = input.level ? list.filter((p) => p.level === input.level) : list;
    const sorters = {
      coverage_asc: (a: typeof rows[number], b: typeof rows[number]) => (a.coverageMonths ?? Infinity) - (b.coverageMonths ?? Infinity),
      stock_value_desc: (a: typeof rows[number], b: typeof rows[number]) => b.stockValue - a.stockValue,
      recommended_order_desc: (a: typeof rows[number], b: typeof rows[number]) => b.recommendedOrder - a.recommendedOrder,
    };
    rows = [...rows].sort(sorters[input.sort]).slice(0, limitOf(input.limit, 15));
    const stockDate = known.map((p) => p.stockDate).filter(Boolean).sort().at(-1) ?? null;
    const atRisk = list.filter((p) => p.level === "red" || p.level === "orange");
    return {
      available: true,
      source: `Photo de stock du ${stockDate ?? "?"} + vente moyenne sell-in Sage sur ${settings.avgSalesMonths} mois`,
      scope: scopeLabel(access, [brand ? `marque ${brand.name}` : null]),
      data: {
        thresholds_months: settings.coverage,
        stock_date: stockDate,
        products: list.length,
        by_level: Object.fromEntries(Object.entries(counts).map(([k, v]) => [`${k} ${LEVEL_LABEL[k as CoverageLevel]}`, v])),
        at_risk_count: atRisk.length,
        at_risk_monthly_revenue_mad: round(atRisk.reduce((s, p) => s + p.avgMonthly * (p.priceWholesale ?? 0), 0)),
        total_stock_value_mad: access.seeInternalCosts ? round(list.reduce((s, p) => s + p.stockValue, 0)) : null,
        rows: rows.map((p) => ({
          product: p.name, sku: p.sku, brand: p.brandName, level: `${EMOJI[p.level]} ${p.level}`,
          stock_units: p.stockKnown ? p.stock : null, on_order_units: p.onOrder, avg_monthly_units: round(p.avgMonthly, 1), trend_pct: round(p.trendPct, 1),
          coverage_months: round(p.coverageMonths, 1), stockout_date: p.stockoutDate, recommended_order_units: p.recommendedOrder,
          lead_time_days: p.leadTimeDays, field_sell_out_30d_units: p.fieldSellOut30d, href: `/produits/${p.productId}`,
        })),
      },
      rowCount: rows.length,
      links: [{ label: "Ouvrir Stock & achats", href: `/stock${brand ? `?brand=${brand.id}` : ""}` }],
      notes: known.length < list.length ? [`${list.length - known.length} produit(s) sans photo de stock : couverture non mesurable pour eux.`] : [],
    };
  },
};
