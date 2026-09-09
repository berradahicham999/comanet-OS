/** `get_terrain_summary` — sell-out animatrices (TTC, prix public), objectifs par ville, palmarès produits. */
import { z } from "zod";
import type { AiTool, ToolResult } from "./types";
import { customPeriodFields, fold, inBrandScope, limitOf, pctChange, periodOf, periodSchema, resolveBrand, round, scopeLabel, unavailable } from "./shared";

const schema = z.object({
  city: z.string().optional().describe("Ville d'animation (ex. « Casablanca »)."),
  animatrice: z.string().optional().describe("Nom de l'animatrice."),
  brand: z.string().optional().describe("Marque."),
  period: periodSchema,
  ...customPeriodFields,
  limit: z.number().int().min(1).max(50).optional().describe("Taille des palmarès (défaut 10)."),
});

export const getTerrainSummary: AiTool<typeof schema> = {
  name: "get_terrain_summary",
  description:
    "Terrain : SELL-OUT constaté par les animatrices en point de vente (unités et CA TTC au prix public, MAD), jours d'animation, atteinte de l'objectif d'unités par ville, palmarès produits et classement des animatrices. Ce n'est PAS le sell-in Sage : ne jamais additionner les deux.",
  module: "terrain",
  action: "view",
  schema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access } = ctx;
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    const filter: { animatriceId?: string; city?: string } = {};
    const scopeParts: string[] = [];
    if (access.ownOnly) filter.animatriceId = access.userId;
    else if (input.animatrice) {
      const u = await deps.findUser(input.animatrice);
      if (!u) return unavailable(`Animatrice « ${input.animatrice} » introuvable.`, "Vérifier le nom dans Terrain → Animatrices.");
      filter.animatriceId = u.id; scopeParts.push(`animatrice ${u.name}`);
    }
    if (input.city) { filter.city = input.city; scopeParts.push(`ville ${input.city}`); }
    if (brand) scopeParts.push(`marque ${brand.name}`);
    const p = periodOf(input, ctx.now);
    const range = { start: p.start, end: p.end }, prev = { start: p.prev.start, end: p.prev.end };
    const year = Number(p.start.slice(0, 4));
    const [tot, byBrand, byProduct, byAnimatrice, byCity, objectives] = await Promise.all([
      deps.animationTotals(range, filter),
      deps.animationsByDim("brand", range, prev, filter),
      deps.animationsByDim("product", range, prev, filter),
      access.ownOnly ? Promise.resolve([]) : deps.animationsByDim("animatrice", range, prev, filter),
      deps.animationsByDim("city", range, prev, filter),
      deps.animationObjectives(year),
    ]);
    if (tot.animations === 0) return unavailable(`Aucune animation saisie sur ${p.label}${scopeParts.length ? ` (${scopeParts.join(", ")})` : ""}.`, "Saisir les animations (Terrain → Saisie) ou importer le classeur animations (Imports → Animations).", "Animatrices — sell-out TTC");
    const brandScoped = inBrandScope(byBrand, access, (r) => r.id);
    const brandRow = brand ? brandScoped.find((r) => r.id === brand.id) ?? null : null;
    const products = (brand ? byProduct.filter((r) => fold(r.extra ?? "") === fold(brand.name)) : byProduct).slice(0, limitOf(input.limit));
    const units = brandRow ? brandRow.units : tot.units;
    const objective = deps.objectiveForRange(objectives, range, { cities: input.city ? [input.city] : undefined, brandId: brand?.id });
    const limit = limitOf(input.limit);
    const cost = access.seeInternalCosts ? round(tot.cost) : null;
    return {
      available: true,
      source: "Animatrices — sell-out TTC au prix public (MAD), unités",
      period: { start: p.start, end: p.end, label: p.label },
      scope: scopeLabel(access, scopeParts),
      data: {
        sell_out_ttc_mad: round(brandRow ? brandRow.revenue : tot.revenue),
        units,
        days: tot.days,
        animations: tot.animations,
        points_of_sale: tot.pos,
        customers_advised: tot.customers,
        cost_mad: cost,
        prev_sell_out_ttc_mad: round(brandRow ? brandRow.prevRevenue : byBrand.reduce((s, r) => s + r.prevRevenue, 0)),
        sell_out_change_pct: pctChange(brandRow ? brandRow.revenue : tot.revenue, brandRow ? brandRow.prevRevenue : byBrand.reduce((s, r) => s + r.prevRevenue, 0)),
        objective_units: objective > 0 ? round(objective) : null,
        objective_completion_pct: objective > 0 ? round((units / objective) * 100, 1) : null,
        by_brand: brandScoped.slice(0, limit).map((r) => ({ brand: r.name, sell_out_ttc_mad: round(r.revenue), units: r.units, days: r.days, prev_sell_out_ttc_mad: round(r.prevRevenue) })),
        top_products: products.map((r) => ({ product: r.name, brand: r.extra, units: r.units, sell_out_ttc_mad: round(r.revenue) })),
        by_city: byCity.slice(0, limit).map((r) => ({ city: r.name, sell_out_ttc_mad: round(r.revenue), units: r.units, days: r.days, objective_units: round(deps.objectiveForRange(objectives, range, { cities: [r.name], brandId: brand?.id })) })),
        animatrices: byAnimatrice.slice(0, limit).map((r) => ({ name: r.name, city: r.extra, sell_out_ttc_mad: round(r.revenue), units: r.units, days: r.days, per_day_ttc_mad: r.days ? round(r.revenue / r.days) : null, prev_sell_out_ttc_mad: round(r.prevRevenue) })),
      },
      rowCount: 1 + products.length + byAnimatrice.length + byCity.length,
      links: [{ label: "Ouvrir Terrain", href: `/terrain?period=${p.key}` }],
      notes: objective > 0 ? [] : ["Aucun objectif d'unités trouvé pour ce périmètre : atteinte non mesurable (Imports → Objectifs animation)."],
    };
  },
};
