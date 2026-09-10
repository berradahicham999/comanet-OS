/**
 * Fonctions d'intelligence publicitaire pour un agent (copilote, futur automate) — mêmes moteurs
 * que l'écran, aucun calcul propre. Chaque fonction renvoie des données sérialisables ; le nom
 * technique en snake_case est exposé dans `ADS_AGENT_API` pour un registre d'outils.
 */
import { buildCommandCenter, entityDetail, searchHistory, type HistorySearch } from "./command-center";
import type { CommandCenterData, EntityLevel } from "./types";

type Scope = { periodKey?: string; brandId?: string | null };

const center = (scope: Scope = {}) => buildCommandCenter({ periodKey: scope.periodKey ?? "30d", brandId: scope.brandId ?? null, persist: false });

export async function getCurrentAdsPerformance(scope: Scope = {}): Promise<Pick<CommandCenterData, "period" | "snapshot" | "health" | "allocation" | "budget" | "impact" | "data">> {
  const c = await center(scope);
  return { period: c.period, snapshot: c.snapshot, health: c.health, allocation: c.allocation, budget: c.budget, impact: c.impact, data: c.data };
}

export async function getHistoricalPerformance(q: HistorySearch) {
  return searchHistory(q);
}

export async function getTopWinners(scope: Scope = {}) {
  const c = await center(scope);
  return { winners: c.winners, verdicts: c.winnerVerdicts };
}

export async function getUnderperformers(scope: Scope = {}) {
  const c = await center(scope);
  return c.problems.map((p) => ({ ...p, verdict: c.winnerVerdicts[`${p.level}:${p.key}`] }));
}

export async function detectAnomalies(scope: Scope = {}) {
  return (await center(scope)).anomalies;
}

export async function detectCreativeFatigue(scope: Scope = {}) {
  return (await center(scope)).creativeHealth.filter((c) => c.fatigue.status === "FATIGUING" || c.fatigue.status === "WATCH");
}

export async function recommendBudgetAllocation(scope: Scope = {}) {
  const c = await center(scope);
  return { allocation: c.allocation, actions: c.actions.filter((a) => ["SCALE", "INCREASE_BUDGET", "REDUCE_BUDGET", "PAUSE_REVIEW"].includes(a.decision)), budget: c.budget };
}

export async function recommendProductsToPush(scope: Scope = {}) {
  return (await center(scope)).push;
}

export async function recommendContentToCreate(scope: Scope = {}) {
  const c = await center(scope);
  return { opportunities: c.content, patterns: c.patterns, memory: c.memory };
}

export async function explainCampaignPerformance(level: EntityLevel, externalId: string, periodKey?: string) {
  return entityDetail(level, externalId, periodKey);
}

export async function compareWithHistoricalBenchmark(level: EntityLevel, externalId: string, periodKey?: string) {
  const d = await entityDetail(level, externalId, periodKey);
  return d ? { entity: { name: d.entity.campaignName, spend: d.entity.spend, results: d.entity.results, costPerResult: d.entity.costPerResult, resultKind: d.entity.resultKind }, benchmark: d.benchmark, history: d.history } : null;
}

/** Registre nommé pour un futur agent : nom technique → fonction. */
export const ADS_AGENT_API = {
  get_current_ads_performance: getCurrentAdsPerformance,
  get_historical_performance: getHistoricalPerformance,
  get_top_winners: getTopWinners,
  get_underperformers: getUnderperformers,
  detect_anomalies: detectAnomalies,
  detect_creative_fatigue: detectCreativeFatigue,
  recommend_budget_allocation: recommendBudgetAllocation,
  recommend_products_to_push: recommendProductsToPush,
  recommend_content_to_create: recommendContentToCreate,
  explain_campaign_performance: explainCampaignPerformance,
  compare_with_historical_benchmark: compareWithHistoricalBenchmark,
} as const;
