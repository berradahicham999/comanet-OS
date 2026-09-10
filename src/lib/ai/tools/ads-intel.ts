/**
 * `get_ads_intelligence` — le Ads Command Center pour le copilote : décisions, winners,
 * fatigue, anomalies, allocation, produits à pousser, contenus à produire, explication d'une
 * campagne, benchmark historique. Mêmes moteurs que l'écran (`lib/ads-intel`), rien de recalculé.
 */
import { z } from "zod";
import type { AiTool, ToolResult } from "./types";
import { resolveBrand, scopeLabel, unavailable } from "./shared";

const schema = z.object({
  question: z.enum(["performance", "winners", "underperformers", "anomalies", "fatigue", "budget", "push", "content", "explain", "benchmark", "history"])
    .describe("performance : snapshot, santé, allocation, budget, impact · winners · underperformers · anomalies · fatigue · budget : où mettre l'argent · push : quels produits pousser · content : quoi publier + mémoire · explain / benchmark : une entité (entity_level + entity_id) · history : recherche dans l'historique (query, dates)."),
  brand: z.string().optional().describe("Marque (nom)."),
  period: z.enum(["today", "7d", "14d", "30d", "mtd", "90d", "year"]).optional().describe("Période publicitaire (défaut 30d)."),
  entity_level: z.enum(["campaign", "adset", "ad", "creative", "product", "brand"]).optional(),
  entity_id: z.string().optional().describe("Identifiant Meta (campagne, publicité, créative) ou uuid (produit, marque)."),
  query: z.string().optional().describe("history : texte cherché (nom, angle, produit)."),
  start: z.string().optional().describe("history : AAAA-MM-JJ."),
  end: z.string().optional().describe("history : AAAA-MM-JJ."),
  sort: z.enum(["spend", "cost", "results"]).optional(),
});

export const getAdsIntelligence: AiTool<typeof schema> = {
  name: "get_ads_intelligence",
  description:
    "Ads Command Center (Meta) : décisions justifiées (SCALE, OPTIMISER, REVOIR, NOUVELLE CRÉATIVE, NE RIEN FAIRE…) avec cause et confiance, winners, créatives en fatigue, anomalies, allocation par marque, produits à pousser, opportunités de contenu, mémoire marketing, explication et benchmark historique d'une campagne, recherche dans l'historique depuis 2023. Le résultat officiel dépend de l'objectif (conversation, vue de page, lead, achat) ; sans CA mesuré, ROAS = non mesurable. Les liens avec les ventes sont des corrélations observées.",
  module: "marketing",
  action: "view",
  schema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access } = ctx;
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    if (access.brandIds && !brand && input.question !== "explain" && input.question !== "benchmark" && input.question !== "history") {
      return unavailable("Précisez une marque de votre périmètre.", "Indiquer `brand`.", "Ads Command Center");
    }
    const scope = { periodKey: input.period ?? "30d", brandId: brand?.id ?? null };
    const base = { source: "Meta Ads — journées closes, MAD au taux saisi ; moteurs du Ads Command Center", scope: scopeLabel(access, [brand ? `marque ${brand.name}` : null]), links: [{ label: "Ouvrir le Ads Command Center", href: `/marketing/ads?period=${scope.periodKey}${brand ? `&brand=${brand.id}` : ""}` }] };
    const ok = (data: unknown, rowCount: number, notes?: string[]): ToolResult => ({ available: true, ...base, data, rowCount, notes });
    const ai = deps.adsIntel;
    switch (input.question) {
      case "performance": { const r = await ai.get_current_ads_performance(scope); return ok(r, 1, r.data.verdict === "LIVE" ? undefined : [`Connexion Meta : ${r.data.verdict}.`]); }
      case "winners": { const r = await ai.get_top_winners(scope); return ok(r.winners, r.winners.campaigns.length + r.winners.creatives.length + r.winners.products.length); }
      case "underperformers": { const r = await ai.get_underperformers(scope); return ok(r, r.length); }
      case "anomalies": { const r = await ai.detect_anomalies(scope); return ok(r, r.length); }
      case "fatigue": { const r = await ai.detect_creative_fatigue(scope); return ok(r.map((c) => ({ name: c.campaignName, brand: c.brandName, product: c.productName, spend: c.spend, fatigue: c.fatigue })), r.length); }
      case "budget": { const r = await ai.recommend_budget_allocation(scope); return ok(r, r.allocation.length); }
      case "push": { const r = await ai.recommend_products_to_push(scope); return ok(r, r.length); }
      case "content": { const r = await ai.recommend_content_to_create(scope); return ok(r, r.opportunities.length); }
      case "history": { const r = await ai.get_historical_performance({ q: input.query, brandId: brand?.id ?? null, start: input.start, end: input.end, level: (input.entity_level === "campaign" || input.entity_level === "creative") ? input.entity_level : "ad", sort: input.sort }); return ok(r.map((e) => ({ name: e.campaignName, level: e.level, id: e.externalId, brand: e.brandName, product: e.productName, tags: e.tags, period: [e.firstDay, e.lastDay], spend: e.spend, results: e.results, resultKind: e.resultKind, costPerResult: e.costPerResult, ctr: e.ctr })), r.length); }
      case "explain": case "benchmark": {
        if (!input.entity_level || !input.entity_id) return unavailable("Il faut `entity_level` et `entity_id`.", "Chercher d'abord l'entité avec question=history.", "Ads Command Center");
        const r = input.question === "explain" ? await ai.explain_campaign_performance(input.entity_level, input.entity_id, scope.periodKey) : await ai.compare_with_historical_benchmark(input.entity_level, input.entity_id, scope.periodKey);
        if (!r) return unavailable("Entité introuvable ou sans donnée sur la période.", "Vérifier l'identifiant (question=history).", "Ads Command Center");
        return ok(r, 1);
      }
    }
  },
};
