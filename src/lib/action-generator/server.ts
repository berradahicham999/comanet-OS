/**
 * Points d'entrée serveur du générateur d'actions : génération pour une demande (assistant, fiche, ajout au plan,
 * outil de l'Agent) et opportunités du moment (page Priorités & actions). Une seule logique : `generate()` sur les
 * données de `loadGeneratorData()`, avec la bibliothèque effective (`loadLibrary()` : modèles livrés + équipe).
 */
import "server-only";
import { buildProductPerformance, buildRecommendations } from "@/lib/marketing-intel/build";
import type { IntelContext, MarketingAction } from "@/lib/marketing-intel/types";
import { currentPlanFor } from "@/lib/marketing-plan/plan";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { loadLibrary } from "./library";
import { generate } from "./engine";
import { loadGeneratorData } from "./context";
import type { ActionProposal, GeneratorData, GeneratorInput, GeneratorResult, ObjectiveKey } from "./types";

export async function runGenerator(ctx: IntelContext, input: GeneratorInput, brandName: string, opts: { maxOptions?: number } = {}): Promise<{ result: GeneratorResult; data: GeneratorData }> {
  const data = await loadGeneratorData(ctx, { brandId: input.brandId, brandName, productId: input.productId, month: input.month });
  return { result: generate(input, data, await loadLibrary(), opts), data };
}

/** Mois de la période par défaut : le mois en cours, ou le suivant après le 20 (le temps de préparer). */
export function defaultMonth(now: Date): string {
  const d = now.getUTCDate() > 20 ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return d.toISOString().slice(0, 10);
}

/* ------------------------------ Opportunités ------------------------------ */

export type Opportunity = { brandId: string; brandName: string; brandColor: string; input: GeneratorInput; proposal: ActionProposal; signal: string; available: number | null; alternatives: number };
export type OpportunityAlert = { brandId: string; brandName: string; message: string };

/** Objectif du générateur déduit d'une décision du moteur marketing (réutilisé par le studio créatif). */
export const OBJECTIVE_OF: Partial<Record<MarketingAction, ObjectiveKey>> = {
  PUSH: "SELL_OUT", BOOST_DIGITAL: "SELL_OUT", CREATE_CONTENT: "NOTORIETE", ACTIVATE_INFLUENCER: "ACQUISITION", CREATE_PROMOTION: "ECOULEMENT", FOCUS_SELL_OUT: "SELL_OUT", MAINTAIN: "FIDELISATION",
};

/**
 * Opportunité du moment d'une marque : le produit que le moteur de décision pousse (sinon le produit prioritaire du
 * plan du mois, sinon le premier contributeur sain), l'objectif qui en découle, et la meilleure action finançable
 * tous leviers confondus, bornée par le budget disponible de chaque levier.
 */
export async function brandOpportunities(ctx: IntelContext, brand: { id: string; name: string; color: string }, opts: { max?: number } = {}): Promise<{ opportunities: Opportunity[]; alert: OpportunityAlert | null }> {
  const month = defaultMonth(ctx.now);
  const reco = await buildRecommendations(ctx, { brandId: brand.id, brandName: brand.name, period: "90d" }).catch(() => null);
  let productId: string | null = null, objective: ObjectiveKey = "SELL_OUT", signal = "";
  const d = reco?.set.decisions.find((x) => x.productId && OBJECTIVE_OF[x.action]);
  if (d) { productId = d.productId; objective = OBJECTIVE_OF[d.action]!; signal = d.why[0] ?? d.title; }
  if (!productId) {
    const plan = await currentPlanFor(brand.id, Number(month.slice(0, 4)));
    if (plan) {
      const m = (await db.execute<{ focus_product_id: string | null }>(sql`select focus_product_id from marketing_plan_months where plan_id = ${plan.id}::uuid and month = ${month}::date`)).rows[0];
      if (m?.focus_product_id) { productId = m.focus_product_id; signal = "produit prioritaire du plan pour ce mois"; }
    }
  }
  const perf = reco?.performance ?? (await buildProductPerformance(ctx, { brandId: brand.id, period: "90d" }).catch(() => null));
  if (!productId && perf) {
    const top = perf.rows.filter((r) => r.stock?.risk !== "RUPTURE_RISQUE").sort((a, b) => b.revenue - a.revenue)[0];
    if (top) { productId = top.productId; signal = `premier contributeur de la marque (${Math.round(top.contributionPct ?? 0)} % du CA sur 90 jours)`; }
  }
  if (!productId) return { opportunities: [], alert: null };
  const input: GeneratorInput = { brandId: brand.id, objective, axis: null, budget: null, month, target: "FEMMES_25_45", productId };
  const data = await loadGeneratorData(ctx, { brandId: brand.id, brandName: brand.name, productId, month, performance: perf });
  const result = generate(input, data, await loadLibrary(), { maxOptions: 5 });
  if (result.blocked) return { opportunities: [], alert: { brandId: brand.id, brandName: brand.name, message: result.blocked } };
  const picked = result.options.slice(0, opts.max ?? 1);
  return {
    // Le lien « Voir le plan » rejoue la génération sur le levier et le budget de l'option : même proposition, déterministe.
    opportunities: picked.map((proposal) => ({ brandId: brand.id, brandName: brand.name, brandColor: brand.color, input: { ...input, axis: proposal.axis, budget: proposal.budget }, proposal, signal, available: data.budgets[proposal.axis].available, alternatives: result.options.length - 1 })),
    alert: null,
  };
}
