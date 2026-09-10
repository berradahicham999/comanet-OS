/**
 * Types de la couche d'intelligence publicitaire. Aucun code serveur ici : l'écran (composant
 * client) et les moteurs (purs) partagent ces formes.
 */
import type { AdKpis, ResultKind } from "@/lib/ads";

export type Range = { start: string; end: string };

export type EntityLevel = "campaign" | "adset" | "ad" | "creative" | "brand" | "product";

/** Une entité agrégée sur une période : ligne d'`ad_metrics` cumulée, enrichie par le catalogue. */
export type EntityPerf = AdKpis & {
  level: EntityLevel;
  /** Identifiant de régie (campagne, ensemble, publicité, créative) ou uuid (marque, produit). */
  externalId: string | null;
  externalCampaignId: string | null;
  externalAdsetId: string | null;
  externalCreativeId: string | null;
  accountName: string | null;
  status: string | null;
  effectiveStatus: string | null;
  productId: string | null;
  productName: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  title: string | null;
  body: string | null;
  tags: Record<string, string>;
  firstDay: string | null;
  lastDay: string | null;
  adCount: number;
  /** Vrai si au moins une journée de la période est la journée en cours (exclue des moyennes). */
  hasPartial: boolean;
};

export type DailyPoint = {
  date: string;
  spend: number; impressions: number; reach: number; clicks: number; linkClicks: number;
  landingPageViews: number; leads: number; purchases: number; messagingStarted: number; revenue: number;
  videoViews: number; postEngagement: number;
};

export type Trend = { direction: "up" | "down" | "flat" | "unknown"; pct: number | null; points: number };

export type BenchmarkRef = { label: string; costPerResult: number | null; roas: number | null; ctr: number | null; note: string | null };

export type Benchmark = {
  resultKind: ResultKind;
  previous: BenchmarkRef;
  brand: BenchmarkRef;
  objective: BenchmarkRef;
  historical: BenchmarkRef;
  best: BenchmarkRef;
  product: BenchmarkRef;
  /** Phrase de situation : « Performance forte, mais pas encore au meilleur historique ». */
  verdict: string;
  /** Écart (%) du coût par résultat vs la marque et vs l'historique (négatif = moins cher). */
  vsBrandPct: number | null;
  vsHistoryPct: number | null;
  vsBestPct: number | null;
};

export type FatigueStatus = "FATIGUING" | "WATCH" | "OK" | "INSUFFICIENT";
export type Fatigue = {
  status: FatigueStatus;
  frequency: number | null;
  ctrDeltaPct: number | null;
  cpcDeltaPct: number | null;
  cpmDeltaPct: number | null;
  costDeltaPct: number | null;
  reasons: string[];
};

export type Anomaly = {
  date: string;
  metric: "spend" | "cpm" | "cpc" | "ctr" | "results" | "costPerResult";
  label: string;
  value: number;
  expected: number;
  z: number;
  severity: "high" | "medium";
  scope: string;
};

export type WinnerClass = "WINNER" | "PROMISING" | "STABLE" | "FATIGUING" | "UNDERPERFORMING" | "INSUFFICIENT_DATA";
export type WinnerVerdict = { cls: WinnerClass; score: number; reasons: string[] };

export type DecisionType =
  | "SCALE" | "MAINTAIN" | "OPTIMIZE" | "PAUSE_REVIEW" | "TEST" | "REUSE_WINNER" | "CREATE_NEW_CREATIVE"
  | "CHANGE_ANGLE" | "CHANGE_AUDIENCE" | "INCREASE_BUDGET" | "REDUCE_BUDGET" | "DO_NOTHING";

export type Cause = "CREATIVE" | "OFFER_OR_PAGE" | "AUDIENCE_OR_AUCTION" | "FATIGUE" | "TRACKING" | "VOLUME" | "NONE";

export type Recommendation = {
  id: string;
  decision: DecisionType;
  tone: "green" | "orange" | "red" | "blue" | "gray";
  level: EntityLevel;
  externalId: string | null;
  brandId: string | null;
  brandName: string | null;
  title: string;
  headline: string;
  why: string[];
  data: { label: string; value: string; delta: number | null; good: boolean | null }[];
  action: string;
  cause: Cause;
  confidence: number;
  confidenceWhy: string[];
  /** Verdict du moteur officiel (`diagnose()`), dont la décision découle. */
  verdict: string;
  priority: number;
};

export type ContentOpportunity = {
  id: string;
  title: string;
  brandId: string | null;
  brandName: string | null;
  productId: string | null;
  productName: string | null;
  angle: string | null;
  format: string | null;
  score: number;
  why: string[];
  evidence: { label: string; value: string }[];
  crossBrand: boolean;
};

export type ContentPattern = {
  key: string;
  dimension: "angle" | "format" | "hook" | "contentType" | "offer";
  value: string;
  brandId: string | null;
  brandName: string | null;
  spend: number;
  results: number;
  resultKind: ResultKind;
  costPerResult: number | null;
  ctr: number | null;
  creatives: number;
  lastDay: string | null;
  vsBrandPct: number | null;
};

export type BrandAllocation = {
  brandId: string | null;
  brandName: string;
  brandColor: string | null;
  spend: number;
  sharePct: number;
  resultKind: ResultKind;
  results: number;
  costPerResult: number | null;
  performance: "EXCELLENT" | "STRONG" | "AVERAGE" | "WEAK" | "UNKNOWN";
  performanceWhy: string;
  trend: Trend;
  opportunity: "SCALE" | "OPTIMIZE" | "REVIEW" | "MAINTAIN" | "INSUFFICIENT";
  confidence: number;
};

export type PushRecommendation = {
  productId: string | null;
  productName: string;
  brandId: string | null;
  brandName: string | null;
  decision: "PUSH_MORE" | "PUSH" | "HOLD" | "DONT_PUSH" | "INSUFFICIENT";
  score: number;
  why: string[];
  spend: number;
  results: number;
  resultKind: ResultKind;
  costPerResult: number | null;
  winners: number;
  stockNote: string | null;
};

export type HealthScore = {
  score: number;
  tone: "green" | "orange" | "red" | "gray";
  why: string[];
  components: { label: string; score: number; max: number; note: string }[];
};

export type BudgetStatus = {
  monthSpend: number;
  monthlyBudget: number | null;
  consumedPct: number | null;
  projected: number | null;
  status: "ON_TRACK" | "WATCH" | "OVERSPENDING" | "UNDEFINED";
  daysElapsed: number;
  daysInMonth: number;
};

export type BusinessImpact = {
  spend: number;
  results: number;
  resultKind: ResultKind;
  costPerResult: number | null;
  measuredRevenue: number;
  roas: number | null;
  /** Sell-in HT de la ou des marques sur la période et la précédente : corrélation observée, jamais attribution. */
  sellIn: number | null;
  sellInPrev: number | null;
  sellInDeltaPct: number | null;
  /** Dépense publicitaire / sell-in (MER inversé) : part du CA marque investie en pub. */
  spendToSalesPct: number | null;
  /** Valeur estimée des résultats si une valeur par résultat est saisie ; sinon null (« non mesurable »). */
  estimatedValue: number | null;
  contribution: number | null;
  notes: string[];
};

export type MemoryItem = { key: string; scope: string; brandId: string | null; brandName: string | null; productName: string | null; statement: string; evidence: Record<string, unknown>; confidence: number; computedAt: string };

export type EntityDetail = {
  entity: EntityPerf;
  daily: DailyPoint[];
  benchmark: Benchmark | null;
  fatigue: Fatigue | null;
  trend: Trend;
  winner: WinnerVerdict;
  recommendation: Recommendation | null;
  children: EntityPerf[];
  /** Historique mensuel de l'entité (toutes périodes confondues). */
  history: { month: string; spend: number; results: number; costPerResult: number | null }[];
};

export type DataStatus = {
  connected: boolean;
  verdict: "LIVE" | "DEGRADED" | "DOWN" | "NONE";
  lastSuccessfulSync: string | null;
  lastSyncError: string | null;
  accounts: { name: string; status: string; lastSyncAt: string | null; error: string | null; syncing: boolean }[];
  historyFirstDay: string | null;
  historyLastDay: string | null;
  closedRows: number;
  backfill: { name: string; status: string; cursor: string | null; gaps: { month: string; reason: string }[] }[];
  unavailableMonths: string[];
};

export type CommandCenterData = {
  period: { key: string; start: string; end: string; label: string; prevLabel: string; days: number };
  brandId: string | null;
  brands: { id: string; name: string; color: string }[];
  health: HealthScore;
  snapshot: {
    spend: number; spendDelta: number | null;
    results: number; resultsDelta: number | null; resultKind: ResultKind; resultLabel: string;
    costPerResult: number | null; costDelta: number | null; costLabel: string;
    messages: number; landing: number; clicks: number; impressions: number; reach: number;
    revenue: number; roas: number | null;
    activeCampaigns: number;
  };
  actions: Recommendation[];
  allActions: Recommendation[];
  allocation: BrandAllocation[];
  winners: { campaigns: EntityPerf[]; creatives: EntityPerf[]; products: EntityPerf[]; offers: ContentPattern[] };
  problems: EntityPerf[];
  winnerVerdicts: Record<string, WinnerVerdict>;
  push: PushRecommendation[];
  content: ContentOpportunity[];
  patterns: ContentPattern[];
  creativeHealth: (EntityPerf & { fatigue: Fatigue; trend: Trend })[];
  anomalies: Anomaly[];
  budget: BudgetStatus;
  impact: BusinessImpact;
  memory: MemoryItem[];
  data: DataStatus;
  entities: { campaigns: EntityPerf[]; ads: EntityPerf[]; creatives: EntityPerf[]; products: EntityPerf[] };
  thresholds: { minSpend: number; minDays: number; winnerMinSpend: number; winnerMinDays: number };
};
