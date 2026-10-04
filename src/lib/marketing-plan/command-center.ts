/**
 * Command Center marketing (serveur) : QUOI POUSSER MAINTENANT, avec quel budget, où en est l'objectif,
 * quelles actions sont en retard, quelles alertes. Tout est lu par les fonctions officielles :
 * budget consommé (`budgetConsumption`), objectif et écart (`buildSalesTargets`), lecture marque et produits
 * à risque (`buildBrandOverview`), décisions (`buildUnifiedDecisions`), actions (`listActions`), plan
 * (`currentPlanFor`). Rien n'est recalculé ici, rien n'est estimé.
 */
import "server-only";
import type { BudgetConsumption } from "@/lib/budget";
import { budgetConsumptionByBrand } from "@/lib/budget";
import { buildBrandOverview, type BrandOverview, type MarketingPeriodKey } from "@/lib/marketing-intel/build";
import type { IntelContext, ProductPerf } from "@/lib/marketing-intel/types";
import type { PermissionSet } from "@/lib/permissions-shared";
import { buildUnifiedDecisions, type DecisionSet } from "@/lib/decisions/build";
import type { UnifiedDecision } from "@/lib/decisions/types";
import { marketingCounters } from "@/lib/marketing";
import { iso } from "@/lib/format";
import { actionCounters, listActions, type ActionRow } from "./actions";
import { currentPlanFor } from "./plan";
import { budgetChain, type BudgetChain } from "./shared";

export type BrandCockpit = {
  id: string; name: string; color: string;
  budget: BudgetConsumption;
  chain: BudgetChain;
  overview: BrandOverview;
  plan: { id: string; name: string; status: string; periodStart: string; periodEnd: string } | null;
  /** Décision n°1 de la marque (hors « ne pas pousser »). */
  focus: UnifiedDecision | null;
  proposed: UnifiedDecision[];
  doNotPush: UnifiedDecision[];
  stockAlerts: ProductPerf[];
  actions: ReturnType<typeof actionCounters>;
};

export type CommandCenterData = {
  year: number;
  todayIso: string;
  period: { key: MarketingPeriodKey; label: string };
  brands: BrandCockpit[];
  selected: BrandCockpit | null;
  decisions: DecisionSet;
  actions: { open: ActionRow[]; late: ActionRow[]; counters: ReturnType<typeof actionCounters> };
  totals: { budget: BudgetConsumption | null; chain: BudgetChain | null; activeCampaigns: number; plannedCampaigns: number; pendingContent: number };
  notes: string[];
};

export async function buildMarketingCommandCenter(o: { ctx: IntelContext; perms: PermissionSet; brands: { id: string; name: string; color: string }[]; selectedBrandId: string | null; period?: MarketingPeriodKey }): Promise<CommandCenterData> {
  const { ctx } = o;
  const now = ctx.now, year = now.getUTCFullYear(), todayIso = iso(now);
  const period = o.period ?? "30d";
  const brands = o.selectedBrandId ? o.brands.filter((b) => b.id === o.selectedBrandId) : o.brands;
  const brandIds = brands.map((b) => b.id);

  const [byBrand, overviews, actions, counters] = await Promise.all([
    budgetConsumptionByBrand(year),
    Promise.all(brands.map((b) => buildBrandOverview(ctx, { brandId: b.id, brandName: b.name, period }))),
    listActions({ brandIds, includeDone: false }),
    marketingCounters({ start: `${year}-01-01`, end: `${year + 1}-01-01` }, o.selectedBrandId),
  ]);
  const precomputed = new Map(brands.map((b, i) => [b.id, { performance: overviews[i].performance, targets: overviews[i].targets }]));
  const [decisions, plans] = await Promise.all([
    buildUnifiedDecisions({ ctx, perms: o.perms, brands, period, precomputed }),
    Promise.all(brands.map((b) => currentPlanFor(b.id, year))),
  ]);

  const cockpits: BrandCockpit[] = brands.map((b, i) => {
    const budget = byBrand.get(b.id) ?? { brandId: b.id, hasBudget: false, annual: 0, planned: 0, committed: 0, spent: 0, adSpend: 0, adSource: "AUCUNE" as const, manualAdIgnored: 0, samplesValue: 0, consumed: 0, remaining: null, consumedPct: null };
    const mine = (d: UnifiedDecision) => d.brandId === b.id;
    const proposed = decisions.proposed.filter(mine);
    const ov = overviews[i];
    return {
      id: b.id, name: b.name, color: b.color, budget,
      chain: budgetChain({ planned: budget.hasBudget ? budget.annual : null, allocated: 0, committed: budget.consumed, spent: budget.spent }),
      overview: ov, plan: plans[i],
      focus: proposed[0] ?? null, proposed, doNotPush: decisions.doNotPush.filter(mine),
      stockAlerts: ov.riskProducts,
      actions: actionCounters(actions.filter((a) => a.brandId === b.id), todayIso),
    };
  });
  const totalsBudget = cockpits.length ? sumConsumption(cockpits.map((c) => c.budget)) : null;
  const late = actions.filter((a) => a.dueDate && a.dueDate < todayIso);
  return {
    year, todayIso, period: { key: period, label: overviews[0]?.period.label ?? "" },
    brands: cockpits, selected: o.selectedBrandId ? cockpits[0] ?? null : null,
    decisions,
    actions: { open: actions, late, counters: actionCounters(actions, todayIso) },
    totals: {
      budget: totalsBudget, chain: totalsBudget ? budgetChain({ planned: totalsBudget.hasBudget ? totalsBudget.annual : null, allocated: 0, committed: totalsBudget.consumed, spent: totalsBudget.spent }) : null,
      activeCampaigns: counters.activeCampaigns, plannedCampaigns: counters.plannedCampaigns, pendingContent: counters.pendingContent,
    },
    notes: decisions.notes,
  };
}

/** Somme marque par marque (même règle que `budgetConsumption()` toutes marques : la priorité régie / saisie est tranchée par marque). */
function sumConsumption(parts: BudgetConsumption[]): BudgetConsumption {
  const sum = (pick: (c: BudgetConsumption) => number) => parts.reduce((a, c) => a + pick(c), 0);
  const annual = sum((c) => c.annual), consumed = sum((c) => c.consumed), hasBudget = annual > 0;
  const sources = new Set(parts.filter((p) => p.adSource !== "AUCUNE").map((p) => p.adSource));
  return {
    brandId: null, hasBudget, annual, planned: sum((c) => c.planned), committed: sum((c) => c.committed), spent: sum((c) => c.spent), adSpend: sum((c) => c.adSpend),
    adSource: sources.size === 1 ? [...sources][0] : sources.size === 0 ? "AUCUNE" : "REGIE", manualAdIgnored: sum((c) => c.manualAdIgnored), samplesValue: sum((c) => c.samplesValue),
    consumed, remaining: hasBudget ? annual - consumed : null, consumedPct: hasBudget ? (consumed / annual) * 100 : null,
  };
}
