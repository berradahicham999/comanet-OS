/** `get_sales_summary` — CA sell-in (Sage, HT), volumes, clients actifs, variation. */
import { z } from "zod";
import type { SalesFilter } from "@/lib/analytics";
import type { AiTool, ToolResult } from "./types";
import { customPeriodFields, inBrandScope, limitOf, pctChange, periodOf, periodSchema, resolveBrand, round, scopeLabel, unavailable } from "./shared";

const schema = z.object({
  brand: z.string().optional().describe("Nom de la marque (ex. « Gamarde »)."),
  client: z.string().optional().describe("Nom ou code d'un client (pharmacie, parapharmacie, grossiste)."),
  product: z.string().optional().describe("Nom ou référence d'un produit."),
  city: z.string().optional().describe("Ville des clients (ex. « Marrakech »)."),
  period: periodSchema,
  ...customPeriodFields,
  compare_to: z.enum(["previous", "n1", "none"]).default("previous").describe("Comparaison : période précédente de même longueur, même période N-1, ou aucune."),
  top: z.enum(["brand", "product", "client", "channel", "rep", "sector", "clientType"]).optional().describe("Dimension du top N à joindre (marques, produits, clients, canaux, commerciaux, secteurs, types de client)."),
  limit: z.number().int().min(1).max(50).optional().describe("Taille du top N (défaut 10)."),
});

export const getSalesSummary: AiTool<typeof schema> = {
  name: "get_sales_summary",
  description:
    "Ventes SELL-IN (factures Sage, montants HT en MAD) : chiffre d'affaires, quantités, nombre de commandes et de clients actifs, variation vs période de comparaison, objectif du mois si disponible, et top N sur une dimension. Ne contient PAS le sell-out des animatrices (voir get_terrain_summary).",
  module: "ventes",
  action: "view",
  schema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access } = ctx;
    const f: SalesFilter = {};
    const scopeParts: string[] = [];
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    if (brand) { f.brandId = brand.id; scopeParts.push(`marque ${brand.name}`); }
    else if (access.brandIds) f.brandIds = access.brandIds;
    if (input.client) {
      const c = await deps.findClient(input.client);
      if (!c) return unavailable(`Client « ${input.client} » introuvable.`, "Utiliser search_entities pour retrouver le nom exact du client.");
      if (access.clientIds && !access.clientIds.includes(c.id)) return unavailable(`Le client « ${c.name} » n'est pas dans votre périmètre.`, "Demander l'assignation du client à un administrateur.");
      f.clientId = c.id; scopeParts.push(`client ${c.name}`);
    } else if (access.clientIds) f.clientIds = access.clientIds;
    if (input.product) {
      const p = await deps.findProduct(input.product);
      if (!p) return unavailable(`Produit « ${input.product} » introuvable.`, "Utiliser search_entities pour retrouver la référence exacte.");
      f.productId = p.id; scopeParts.push(`produit ${p.name}`);
    }
    if (input.city) {
      const ids = await deps.clientIdsInCity(input.city);
      if (!ids.length) return unavailable(`Aucun client connu à « ${input.city} ».`, "Vérifier la ville sur les fiches clients (import CLIENTS) ou l'orthographe.");
      f.clientIds = f.clientIds ? f.clientIds.filter((id) => ids.includes(id)) : ids;
      scopeParts.push(`ville ${input.city}`);
    }
    const p = periodOf(input, ctx.refDate);
    const cmpRange = input.compare_to === "none" ? null : input.compare_to === "n1" ? p.n1 : p.prev;
    const [cur, cmp, top] = await Promise.all([
      deps.salesTotals(p.start, p.end, f),
      cmpRange ? deps.salesTotals(cmpRange.start, cmpRange.end, f) : Promise.resolve(null),
      input.top ? deps.salesByDim(input.top, p.start, p.end, f, limitOf(input.limit)) : Promise.resolve(null),
    ]);
    if (cur.lines === 0 && (!cmp || cmp.lines === 0)) {
      return unavailable(`Aucune ligne de vente Sage sur ${p.label}${scopeParts.length ? ` (${scopeParts.join(", ")})` : ""}.`, "Importer l'export Sage de la période (Imports → Ventes) ou élargir la période.", "Sage — sell-in HT");
    }
    const refYear = ctx.refDate.getUTCFullYear(), refMonth = ctx.refDate.getUTCMonth() + 1;
    const objective = p.key === "month" && !input.client && !input.product && !input.city ? await deps.salesObjective(refYear, refMonth, brand?.id ?? null) : null;
    const topRows = top ? inBrandScope(top, access, (r) => (input.top === "brand" ? r.id : null)) : null;
    const notes: string[] = [];
    if (p.end > new Date(ctx.refDate.getTime() + 86_400_000).toISOString().slice(0, 10)) notes.push(`Période en cours : données Sage arrêtées au ${ctx.refDate.toISOString().slice(0, 10)}.`);
    const href = `/ventes?period=${p.key}${brand ? `&brand=${brand.id}` : ""}`;
    return {
      available: true,
      source: "Sage — sell-in HT (MAD)",
      period: { start: p.start, end: p.end, label: p.label },
      scope: scopeLabel(access, scopeParts),
      data: {
        revenue_mad: round(cur.amount),
        quantity: round(cur.quantity),
        orders: cur.orders,
        active_clients: cur.clients,
        comparison: cmp && cmpRange
          ? { kind: input.compare_to, start: cmpRange.start, end: cmpRange.end, revenue_mad: round(cmp.amount), quantity: round(cmp.quantity), orders: cmp.orders, active_clients: cmp.clients, revenue_change_pct: pctChange(cur.amount, cmp.amount), quantity_change_pct: pctChange(cur.quantity, cmp.quantity) }
          : null,
        objective_mad: objective !== null ? round(objective) : null,
        objective_completion_pct: objective ? round((cur.amount / objective) * 100, 1) : null,
        top: topRows ? topRows.map((r) => ({ name: r.name, extra: r.extra, revenue_mad: round(r.amount), quantity: round(r.quantity), orders: r.orders, clients: r.clients })) : undefined,
      },
      rowCount: 1 + (topRows?.length ?? 0),
      links: [{ label: "Ouvrir Ventes", href }],
      notes,
    };
  },
};
