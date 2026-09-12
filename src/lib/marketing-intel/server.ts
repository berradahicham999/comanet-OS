/**
 * Liaison réelle de la couche Marketing Intelligence (serveur uniquement).
 *
 * `realIntelDeps` renvoie chaque dépendance vers la définition officielle du tableau
 * « Une notion métier = une seule fonction » ; `intelContextFor()` construit le contexte d'exécution
 * (droits → portes, portée marques, dates, réglages) pour la page /marketing/agent. Les outils du
 * copilote réutilisent `realIntelDeps` à travers `src/lib/ai/tools/deps.ts`.
 */
import "server-only";
import { annualObjective, byDim, objectiveFor, totals } from "@/lib/analytics";
import { productStocks } from "@/lib/stock";
import { productList } from "@/lib/products";
import { budgetConsumption } from "@/lib/budget";
import { adsByDim, brandAverages, diagnose, kpis } from "@/lib/ads";
import { ADS_AGENT_API } from "@/lib/ads-intel/agent";
import type { PermissionSet } from "@/lib/permissions-shared";
import type { ComanetSettings } from "@/lib/settings";
import { marketingActivity } from "./queries";
import { gatesFor } from "./gates";
import type { IntelContext, MarketingIntelDeps } from "./types";

export const realIntelDeps: MarketingIntelDeps = {
  salesTotals: (start, end, f) => totals(start, end, f),
  salesByDim: (dim, start, end, f, limit) => byDim(dim, start, end, f, limit),
  salesObjective: (year, month, brandId) => objectiveFor(year, month, brandId),
  annualObjective: (year, brandId) => annualObjective(year, brandId),
  productStocks: (opts, ref) => productStocks(opts, ref),
  productCatalog: (ref, opts) => productList(ref, opts),
  budgetConsumption: (year, brandId) => budgetConsumption(year, brandId),
  adsByDim: (dim, range, filter) => adsByDim(dim, range, filter),
  adKpis: kpis, adDiagnose: diagnose, adBrandAverages: brandAverages,
  adsProductsToPush: async (o) => (await ADS_AGENT_API.recommend_products_to_push({ brandId: o.brandId })).map((p) => ({ productId: p.productId, decision: p.decision, costPerResult: p.costPerResult, why: p.why })),
  marketingActivity,
};

export function intelContextFor(o: { perms: PermissionSet; seeInternalCosts: boolean; scopeBrandIds: string[] | null; scopeClientIds: string[] | null; settings: ComanetSettings; refDate: Date; now: Date }): IntelContext {
  return { deps: realIntelDeps, settings: o.settings, refDate: o.refDate, now: o.now, gates: gatesFor(o.perms, o.seeInternalCosts), scopeBrandIds: o.scopeBrandIds, scopeClientIds: o.scopeClientIds };
}
