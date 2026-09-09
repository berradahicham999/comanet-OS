/** `get_client_intelligence` — segments, dernier achat, CA 12 mois, tendance (sell-in Sage). */
import { z } from "zod";
import type { Segment } from "@/lib/clients";
import type { AiTool, ToolResult } from "./types";
import { limitOf, resolveBrand, round, scopeLabel, unavailable } from "./shared";

const SEGMENTS = ["CROISSANCE", "STABLE", "A_RISQUE", "INACTIF", "NOUVEAU", "FORT_POTENTIEL", "EN_RETARD"] as const;

const schema = z.object({
  segment: z.enum(SEGMENTS).optional().describe("Filtre : CROISSANCE, STABLE, A_RISQUE, INACTIF, NOUVEAU, FORT_POTENTIEL (CA 12 mois élevé), EN_RETARD (commande théorique dépassée)."),
  brand: z.string().optional().describe("Restreindre aux clients ayant acheté cette marque."),
  city: z.string().optional().describe("Ville du client."),
  min_days_since_last_order: z.number().int().min(0).optional().describe("Ne garder que les clients sans commande depuis au moins N jours."),
  sort: z.enum(["revenue12", "days_since_last", "growth_desc", "growth_asc"]).default("revenue12").describe("Tri du top N."),
  limit: z.number().int().min(1).max(50).optional().describe("Taille du top N (défaut 10)."),
});

export const getClientIntelligence: AiTool<typeof schema> = {
  name: "get_client_intelligence",
  description:
    "Clients B2B (pharmacies, parapharmacies, grossistes) : comptes par segment (croissance / stable / à risque / inactif / nouveau), fort potentiel, retards de commande, et top N avec dernier achat, CA 12 mois sell-in HT, tendance 3 mois vs 3 mois précédents et recommandation. Source : factures Sage.",
  module: "clients",
  action: "view",
  schema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access } = ctx;
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    const list = await deps.clientIntel({ clientIds: access.clientIds, brandIds: brand ? [brand.id] : access.brandIds }, ctx.refDate);
    if (!list.length) return unavailable("Aucun client avec des ventes dans COMANET OS.", "Importer les exports Sage (Imports → Clients puis Ventes).", "Sage — sell-in HT");
    const counts: Record<string, number> = {};
    for (const c of list) counts[c.segment] = (counts[c.segment] ?? 0) + 1;
    const highPotential = list.filter((c) => c.highPotential).length;
    const overdue = list.filter((c) => c.overdue).length;
    let rows = list;
    if (input.segment === "FORT_POTENTIEL") rows = rows.filter((c) => c.highPotential);
    else if (input.segment === "EN_RETARD") rows = rows.filter((c) => c.overdue);
    else if (input.segment) rows = rows.filter((c) => c.segment === (input.segment as Segment));
    if (input.city) { const k = input.city.toLowerCase(); rows = rows.filter((c) => (c.city ?? "").toLowerCase().includes(k)); }
    if (input.min_days_since_last_order !== undefined) rows = rows.filter((c) => (c.daysSinceLast ?? Infinity) >= input.min_days_since_last_order!);
    const sorters = {
      revenue12: (a: typeof rows[number], b: typeof rows[number]) => b.revenue12 - a.revenue12,
      days_since_last: (a: typeof rows[number], b: typeof rows[number]) => (b.daysSinceLast ?? -1) - (a.daysSinceLast ?? -1),
      growth_desc: (a: typeof rows[number], b: typeof rows[number]) => (b.growthPct ?? -Infinity) - (a.growthPct ?? -Infinity),
      growth_asc: (a: typeof rows[number], b: typeof rows[number]) => (a.growthPct ?? Infinity) - (b.growthPct ?? Infinity),
    };
    const matched = rows.length;
    const top = [...rows].sort(sorters[input.sort]).slice(0, limitOf(input.limit));
    return {
      available: true,
      source: "Sage — sell-in HT (MAD), segments calculés par COMANET OS",
      scope: scopeLabel(access, [brand ? `marque ${brand.name}` : null, input.city ? `ville ${input.city}` : null]),
      data: {
        total_clients: list.length,
        by_segment: counts,
        high_potential: highPotential,
        overdue_reorder: overdue,
        filter: { segment: input.segment ?? null, matched },
        top: top.map((c) => ({
          name: c.name, city: c.city, type: c.type, segment: c.segment, high_potential: c.highPotential,
          revenue_12m_mad: round(c.revenue12), revenue_3m_mad: round(c.revenue3), growth_pct: round(c.growthPct, 1),
          orders_12m: c.orders12, last_order: c.lastOrder, days_since_last_order: c.daysSinceLast, overdue: c.overdue,
          brands: c.brands.slice(0, 6), recommendation: c.recommendation.title, href: `/clients/${c.id}`,
        })),
      },
      rowCount: top.length,
      links: [{ label: "Ouvrir Clients", href: `/clients${input.segment && SEGMENTS.includes(input.segment) && !["FORT_POTENTIEL", "EN_RETARD"].includes(input.segment) ? `?segment=${input.segment}` : ""}` }],
    };
  },
};
