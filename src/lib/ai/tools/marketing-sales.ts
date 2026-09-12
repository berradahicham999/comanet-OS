/**
 * Outils « ventes » de l'Agent marketing : performance commerciale détaillée (période, N-1, par SKU / canal /
 * client) et répartition par dimension (canal, client, secteur, type de client, commercial).
 * Définition unique : `analytics.ts` (`totals()`, `byDim()`, `SALES_CHANNEL`, `ORDER_KEY`).
 */
import { z } from "zod";
import type { Dim, DimRow, SalesFilter } from "@/lib/analytics";
import { marketingPeriod } from "@/lib/marketing-intel/build";
import { growthPct } from "@/lib/marketing-intel/performance";
import type { AiTool, ToolContext, ToolResult } from "./types";
import { DATA_TAGS_LEGEND, customPeriodFields, freshnessNotes, inBrandScope, limitOf, marketingPeriodSchema, resolveBrand, round, scopeLabel, unavailable } from "./shared";

async function baseFilter(ctx: ToolContext, input: { brand?: string; product?: string }): Promise<{ f: SalesFilter; parts: string[]; brandId: string | null; error?: ToolResult }> {
  const { brand, error } = await resolveBrand(ctx, input.brand);
  if (error) return { f: {}, parts: [], brandId: null, error };
  const f: SalesFilter = {};
  const parts: string[] = [];
  if (brand) { f.brandId = brand.id; parts.push(`marque ${brand.name}`); } else if (ctx.access.brandIds) f.brandIds = ctx.access.brandIds;
  if (ctx.access.clientIds) f.clientIds = ctx.access.clientIds;
  if (input.product) {
    const p = await ctx.deps.findProduct(input.product);
    if (!p) return { f, parts, brandId: brand?.id ?? null, error: unavailable(`Produit « ${input.product} » introuvable.`, "Utiliser search_entities pour retrouver la référence exacte.") };
    f.productId = p.id; parts.push(`produit ${p.name}`);
  }
  return { f, parts, brandId: brand?.id ?? null };
}

function dimRows(cur: DimRow[], prev: DimRow[] | null, total: number, limit: number) {
  const prevMap = new Map((prev ?? []).map((r) => [r.id, r]));
  return cur.slice(0, limit).map((r) => {
    const p = prev ? (prevMap.get(r.id)?.amount ?? 0) : null;
    return { name: r.name, extra: r.extra, revenue_mad: round(r.amount), units: round(r.quantity), orders: r.orders, clients: r.clients, share_pct: total > 0 ? round((r.amount / total) * 100, 1) : null, previous_revenue_mad: round(p), growth_pct: p === null ? "pas encore comparable" : (growthPct(r.amount, p) === null ? "nouveau" : round(growthPct(r.amount, p), 1)) };
  });
}

/* ------------------------------ get_sales_performance ------------------------------ */

const BREAKDOWNS = ["sku", "channel", "client"] as const;

const perfSchema = z.object({
  brand: z.string().optional().describe("Marque ; absente = tout le périmètre."),
  product: z.string().optional().describe("Un produit précis (nom ou référence)."),
  period: marketingPeriodSchema,
  ...customPeriodFields,
  breakdown: z.array(z.enum(BREAKDOWNS)).default(["sku", "channel"]).describe("Ventilations à joindre : sku (par produit), channel (par canal de facturation), client (par client)."),
  limit: z.number().int().min(1).max(50).optional().describe("Lignes par ventilation (défaut 10)."),
});

export const getSalesPerformance: AiTool<typeof perfSchema> = {
  name: "get_sales_performance",
  description:
    "Performance commerciale sell-in (Sage, HT, MAD) sur 7d / 30d / 90d / ytd / mois / custom : CA, unités, commandes, clients actifs, évolution vs période précédente de même longueur et vs même période N-1 (« pas encore comparable » si la fenêtre est vide), puis évolution par SKU, par canal de facturation (site Sage / canal client) et par client. Ne contient pas le sell-out des animatrices (get_terrain_summary).",
  module: "ventes",
  action: "view",
  schema: perfSchema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access } = ctx;
    const b = await baseFilter(ctx, input);
    if (b.error) return b.error;
    const p = marketingPeriod(input.period, ctx.refDate, { start: input.period_start, end: input.period_end });
    const lim = limitOf(input.limit, 10);
    const dims: Dim[] = input.breakdown.map((k) => (k === "sku" ? "product" : k === "channel" ? "channel" : "client"));
    const [cur, prev, n1, ...byDims] = await Promise.all([
      deps.salesTotals(p.start, p.end, b.f), deps.salesTotals(p.prev.start, p.prev.end, b.f), deps.salesTotals(p.n1.start, p.n1.end, b.f),
      ...dims.flatMap((d) => [deps.salesByDim(d, p.start, p.end, b.f, 1000), deps.salesByDim(d, p.prev.start, p.prev.end, b.f, 1000)]),
    ]);
    if (cur.lines === 0 && prev.lines === 0) return unavailable(`Aucune ligne de vente Sage sur ${p.label}${b.parts.length ? ` (${b.parts.join(", ")})` : ""}.`, "Importer l'export Sage de la période (Imports → Ventes) ou élargir la période.", "Sage — sell-in HT");
    const comparable = prev.lines > 0, comparableN1 = n1.lines > 0;
    const data: Record<string, unknown> = {
      revenue_mad: round(cur.amount), units: round(cur.quantity), orders: cur.orders, active_clients: cur.clients,
      vs_previous: comparable ? { start: p.prev.start, end: p.prev.end, revenue_mad: round(prev.amount), units: round(prev.quantity), revenue_growth_pct: round(growthPct(cur.amount, prev.amount), 1), units_growth_pct: round(growthPct(cur.quantity, prev.quantity), 1) } : "pas encore comparable",
      vs_n1: comparableN1 ? { start: p.n1.start, end: p.n1.end, revenue_mad: round(n1.amount), units: round(n1.quantity), revenue_growth_pct: round(growthPct(cur.amount, n1.amount), 1), units_growth_pct: round(growthPct(cur.quantity, n1.quantity), 1) } : "pas encore comparable",
      tags: { revenue_mad: "CONFIRMED", revenue_growth_pct: "CALCULATED", share_pct: "CALCULATED" }, legend: DATA_TAGS_LEGEND,
    };
    let rowCount = 1;
    input.breakdown.forEach((k, i) => {
      const rowsCur = inBrandScope(byDims[i * 2], access, () => null), rowsPrev = comparable ? byDims[i * 2 + 1] : null;
      const rows = dimRows(rowsCur, rowsPrev, cur.amount, lim);
      data[`by_${k}`] = rows; rowCount += rows.length;
    });
    return {
      available: true,
      source: "Sage — sell-in HT (MAD)",
      period: { start: p.start, end: p.end, label: p.label },
      scope: scopeLabel(access, b.parts),
      data, rowCount,
      links: [{ label: "Ouvrir Ventes", href: `/ventes?period=${p.key}${b.brandId ? `&brand=${b.brandId}` : ""}` }],
      notes: [...freshnessNotes(ctx), ...(comparable ? [] : ["Période précédente sans vente Sage : évolution non mesurable."]), ...(comparableN1 ? [] : ["Même période N-1 sans vente Sage : évolution N-1 non mesurable."])],
    };
  },
};

/* ------------------------------ get_sales_breakdown ------------------------------ */

const DIMENSIONS = { channel: "channel", client: "client", region: "sector", client_type: "clientType", rep: "rep" } as const;

const breakdownSchema = z.object({
  dimension: z.enum(["channel", "client", "region", "client_type", "rep"]).describe("channel (canal de facturation : site Sage ou canal client), client, region (secteur commercial déduit de la ville), client_type (pharmacie, parapharmacie, grossiste…), rep (commercial)."),
  brand: z.string().optional().describe("Marque ; absente = tout le périmètre."),
  product: z.string().optional().describe("Un produit précis (nom ou référence)."),
  period: marketingPeriodSchema,
  ...customPeriodFields,
  limit: z.number().int().min(1).max(50).optional().describe("Nombre de lignes (défaut 15)."),
});

export const getSalesBreakdown: AiTool<typeof breakdownSchema> = {
  name: "get_sales_breakdown",
  description:
    "Où une marque ou un SKU se vend le mieux (sell-in Sage, HT, MAD) : répartition du CA par canal de facturation, par client, par région (secteur commercial), par type de client (pharmacie, parapharmacie, grossiste, e-commerce…) ou par commercial, avec part du total, valeur de la période précédente et croissance. Remplace get_sales_by_channel / get_sales_by_customer / get_sales_by_region. Les canaux sont ceux facturés dans Sage : un canal absent (ex. e-commerce) est absent des données, pas nul.",
  module: "ventes",
  action: "view",
  schema: breakdownSchema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access } = ctx;
    const b = await baseFilter(ctx, input);
    if (b.error) return b.error;
    const p = marketingPeriod(input.period, ctx.refDate, { start: input.period_start, end: input.period_end });
    const dim = DIMENSIONS[input.dimension] as Dim;
    const [total, prevTotal, cur, prev] = await Promise.all([deps.salesTotals(p.start, p.end, b.f), deps.salesTotals(p.prev.start, p.prev.end, b.f), deps.salesByDim(dim, p.start, p.end, b.f, 1000), deps.salesByDim(dim, p.prev.start, p.prev.end, b.f, 1000)]);
    if (total.lines === 0) return unavailable(`Aucune vente Sage sur ${p.label}${b.parts.length ? ` (${b.parts.join(", ")})` : ""}.`, "Importer l'export Sage de la période (Imports → Ventes) ou élargir la période.", "Sage — sell-in HT");
    const comparable = prevTotal.lines > 0;
    const rows = dimRows(cur, comparable ? prev : null, total.amount, limitOf(input.limit, 15));
    const unknown = cur.find((r) => r.id === "—" || r.name === "Non renseigné" || r.name === "Non affecté");
    return {
      available: true,
      source: "Sage — sell-in HT (MAD)",
      period: { start: p.start, end: p.end, label: p.label },
      scope: scopeLabel(access, b.parts),
      data: {
        dimension: input.dimension, total_revenue_mad: round(total.amount), total_units: round(total.quantity), distinct_values: cur.length, comparable_period: comparable,
        unassigned_share_pct: unknown && total.amount > 0 ? round((unknown.amount / total.amount) * 100, 1) : 0,
        rows, tags: { revenue_mad: "CONFIRMED", share_pct: "CALCULATED", growth_pct: "CALCULATED" }, legend: DATA_TAGS_LEGEND,
      },
      rowCount: rows.length,
      links: [{ label: "Ouvrir Ventes", href: `/ventes?period=${p.key}${b.brandId ? `&brand=${b.brandId}` : ""}` }],
      notes: [...freshnessNotes(ctx), ...(comparable ? [] : ["Période précédente sans vente Sage : croissances non mesurables."]), ...(unknown && unknown.amount > 0 ? [`Une part du CA n'a pas de ${input.dimension === "region" ? "secteur" : input.dimension === "rep" ? "commercial" : "canal"} renseigné (ligne « Non renseigné / Non affecté »).`] : [])],
    };
  },
};
