/**
 * Couche « Marketing Intelligence » — contrats.
 *
 * Interface entre l'Agent marketing (outils du copilote, page /marketing/agent, pont CLI) et les données
 * de COMANET OS. Aucune seconde source de vérité : chaque fonction de `build.ts` n'appelle que les
 * définitions officielles (`analytics.ts`, `stock.ts` / `stock-math.ts`, `products.ts`, `budget.ts`,
 * `ads.ts`) à travers `MarketingIntelDeps`, injectables et donc testables sans base.
 *
 * Chaque valeur exposée à l'agent porte une étiquette de fiabilité (`DataTag`) :
 *  - CONFIRMED  : lue telle quelle (stock à la dernière photo, CA facturé, objectif saisi) ;
 *  - CALCULATED : dérivée d'une formule officielle (couverture, croissance, contribution, run-rate) ;
 *  - INFERRED   : interprétation (profil d'un produit, verdict du moteur de décision) ;
 *  - MISSING    : donnée absente — jamais estimée, jamais remplacée par 0.
 */
import type { SalesFilter, Totals, DimRow, Dim } from "@/lib/analytics";
import type { ProductStock, CoverageLevel } from "@/lib/stock";
import type { ProductRow } from "@/lib/products";
import type { BudgetConsumption } from "@/lib/budget";
import type { AdRow, AdKpis, Diagnosis } from "@/lib/ads";
import type { AdThresholds, ComanetSettings } from "@/lib/settings";
import type { ResolvedPeriod } from "@/lib/periods";

export type DataTag = "CONFIRMED" | "CALCULATED" | "INFERRED" | "MISSING";

export type Range = { start: string; end: string };

/* ------------------------------ Stock ------------------------------ */

/** Statut de stock d'une référence, dérivé des seuils Paramètres (couverture, surstock). */
export type StockStatus = "CRITICAL" | "LOW" | "HEALTHY" | "OVERSTOCK" | "NO_ROTATION" | "UNKNOWN";
/** Risque marketing d'une référence : rupture (tension ou couverture critique), surstock, ou rien à signaler. */
export type StockRisk = "RUPTURE_RISQUE" | "SURSTOCK" | "HEALTHY" | "NO_ROTATION" | "UNKNOWN";

export type InventoryRow = {
  productId: string;
  sku: string;
  name: string;
  brandId: string | null;
  brandName: string | null;
  /** `false` : aucune photo de stock importée — le stock est alors `null`, jamais 0. */
  stockKnown: boolean;
  stock: number | null;
  onOrder: number;
  stockDate: string | null;
  /** Vente moyenne mensuelle sell-in (fenêtre `settings.avgSalesMonths`). */
  avgMonthly: number;
  /** Vente moyenne journalière = mensuelle ÷ 30 (CALCULATED). */
  avgDailySales: number;
  /** Unités et CA sell-in des 30 derniers jours (CONFIRMED) ; `null` si non lus. */
  unitsLast30: number | null;
  revenueLast30: number | null;
  lastSale: string | null;
  /** Couverture en jours = mois × 30 (CALCULATED) ; `null` sans photo ou sans rotation. */
  daysOfStock: number | null;
  coverageMonths: number | null;
  stockoutDate: string | null;
  recommendedOrder: number;
  level: CoverageLevel;
  status: StockStatus;
  risk: StockRisk;
  /** Dernier mois vs moyenne, en % (CALCULATED). */
  trendPct: number | null;
  /** Marge brute % — `null` si prix inconnu ou si la personne ne voit pas les coûts internes. */
  marginPct: number | null;
  /** Valeur au prix d'achat — `null` si coûts internes masqués. */
  stockValue: number | null;
};

/* ------------------------------ Produits ------------------------------ */

export type SalesProfile = "STAR" | "GROWTH" | "CASH_COW" | "UNDERPERFORMER" | "STABLE" | "INSUFFICIENT_DATA";
/** Catégorie finale : le risque de stock prime sur le profil commercial (il change l'action). */
export type ProductCategory = "STOCK_RISK" | "OVERSTOCK" | SalesProfile;

export type ProductPerf = {
  productId: string;
  sku: string | null;
  name: string;
  brandId: string | null;
  brandName: string | null;
  /** Période demandée (sell-in Sage HT, MAD). */
  revenue: number;
  units: number;
  orders: number;
  clients: number;
  /** Période de comparaison ; `null` = pas de période comparable (aucune vente Sage sur la fenêtre précédente). */
  revenuePrev: number | null;
  unitsPrev: number | null;
  growthPct: number | null;
  unitsGrowthPct: number | null;
  /** Part du CA de la marque (ou du périmètre) sur la période, en %. */
  contributionPct: number | null;
  marginPct: number | null;
  /** Historique (à la date de référence) : 12 mois, 3 mois vs 3 mois précédents. */
  revenue12: number;
  units12: number;
  clients12: number;
  units3: number;
  unitsPrev3: number;
  trend3Pct: number | null;
  lastSale: string | null;
  stock: InventoryRow | null;
  profile: SalesProfile;
  category: ProductCategory;
  reasons: string[];
};

/* ------------------------------ Objectifs ------------------------------ */

export type SalesTargets = {
  year: number;
  month: number;
  asOf: string;
  monthly: {
    objective: number | null;
    realized: number;
    pct: number | null;
    gap: number | null;
    dayOfMonth: number;
    daysInMonth: number;
    progressPct: number;
    /** Projection fin de mois au rythme courant (`monthProjection()`), CALCULATED ; `null` sans jour écoulé. */
    forecastRunRate: number | null;
    forecastPct: number | null;
    forecastGap: number | null;
  };
  annual: {
    objective: number | null;
    realized: number;
    pct: number | null;
    gap: number | null;
    /** Part de l'année écoulée à la date de référence, en %. */
    elapsedPct: number;
    /** Réalisé attendu au rythme linéaire de l'objectif (CALCULATED). */
    expectedAtPace: number | null;
    paceGap: number | null;
  };
};

/* ------------------------------ Contexte marketing ------------------------------ */

export type CampaignInfo = {
  id: string; name: string; type: string; channel: string; status: string; objective: string | null; offer: string | null;
  startDate: string | null; endDate: string | null; budget: number | null; kpiTarget: string | null; kpiActual: string | null;
  products: string[]; spent: number; adSpend: number;
};
export type ContentInfo = {
  id: string; title: string; date: string; deadline: string | null; platform: string | null; format: string | null; status: string; statusLabel: string;
  isPublished: boolean; awaitingValidation: boolean; inProduction: boolean; product: string | null; late: boolean;
};
export type CollaborationInfo = {
  id: string; influencer: string; date: string; status: string; done: boolean; contentType: string | null; product: string | null;
  fee: number; productValue: number; promoCode: string | null; attributedRevenue: number | null; reach: number | null;
};
export type ActivationInfo = {
  id: string; name: string; type: string; date: string; endDate: string | null; status: string; statusLabel: string;
  isRunning: boolean; isDone: boolean; isValidated: boolean; awaitingValidation: boolean; city: string | null;
  budgetPlanned: number; attributedRevenue: number | null; product: string | null;
};

/** Activité marketing d'une marque, lue dans les modules existants (campagnes, planning, influence, activations). */
export type MarketingActivity = {
  campaigns: CampaignInfo[];
  contents: ContentInfo[];
  collaborations: CollaborationInfo[];
  activations: ActivationInfo[];
  /** Texte libre de la fiche marque (`brands.objectives`). */
  brandObjectives: string | null;
};

/* ------------------------------ Décisions ------------------------------ */

export type MarketingAction =
  | "PUSH" | "MAINTAIN" | "OPTIMIZE" | "REDUCE" | "STOP" | "RESTOCK" | "DO_NOT_PROMOTE"
  | "CREATE_CONTENT" | "CREATE_PROMOTION" | "ACTIVATE_INFLUENCER" | "BOOST_DIGITAL" | "FOCUS_SELL_OUT";

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type Fact = { label: string; value: string; tag: DataTag };

export type Decision = {
  /** Clé stable (action + entité). */
  key: string;
  scope: "product" | "brand";
  productId: string | null;
  productName: string | null;
  brandName: string;
  action: MarketingAction;
  secondaryActions: MarketingAction[];
  title: string;
  /** 3 à 5 raisons, chacune adossée à une donnée. */
  why: string[];
  data: Fact[];
  expectedImpact: string;
  confidence: Confidence;
  confidenceWhy: string[];
  /** Vrai pour les produits à ne pas pousser (rupture, diagnostic). */
  doNotPush: boolean;
  /** Score interne de classement. */
  score: number;
};

/* ------------------------------ Dépendances ------------------------------ */

/**
 * Fonctions métier accessibles à la couche. Chacune renvoie vers la définition officielle du tableau
 * « Une notion métier = une seule fonction » de CLAUDE.md ; aucune n'est redéfinie ici. Les outils du
 * copilote (`ToolDeps`) étendent ce type ; les tests injectent des doublures.
 */
export type MarketingIntelDeps = {
  salesTotals(start: string, end: string, f: SalesFilter): Promise<Totals>;
  salesByDim(dim: Dim, start: string, end: string, f: SalesFilter, limit: number): Promise<DimRow[]>;
  salesObjective(year: number, month: number, brandId: string | null): Promise<number | null>;
  annualObjective(year: number, brandId: string | null): Promise<number | null>;
  productStocks(opts: { brandId?: string }, ref: Date): Promise<ProductStock[]>;
  productCatalog(ref: Date, opts: { brandId?: string }): Promise<ProductRow[]>;
  budgetConsumption(year: number, brandId?: string | null): Promise<BudgetConsumption>;
  adsByDim(dim: "campaign" | "brand", range: Range, filter?: { brandId?: string | null; platform?: string | null }): Promise<AdRow[]>;
  adKpis(r: AdRow): AdKpis;
  adDiagnose(cur: AdKpis, ref: AdKpis | null, brandAvg: { cpa: number | null; roas: number | null; ctr: number | null } | null, t: AdThresholds): Diagnosis;
  adBrandAverages(rows: AdKpis[]): { cpa: number | null; roas: number | null; ctr: number | null };
  /** Produits à pousser selon l'intelligence Ads (`ADS_AGENT_API.recommend_products_to_push`). */
  adsProductsToPush(opts: { brandId: string | null }): Promise<{ productId: string | null; decision: string; costPerResult: number | null; why: string[] }[]>;
  marketingActivity(opts: { brandId: string; now: Date; windowDays: number }): Promise<MarketingActivity>;
};

/** Ce que la personne a le droit de voir : chaque bloc absent est renvoyé « non accessible », jamais deviné. */
export type Gates = { stock: boolean; budgets: boolean; marketing: boolean; internalCosts: boolean };

export type IntelContext = {
  deps: MarketingIntelDeps;
  settings: ComanetSettings;
  /** Date de référence des ventes Sage (dernier import). */
  refDate: Date;
  /** Date réelle du jour (planning, activations, campagnes). */
  now: Date;
  gates: Gates;
  /** Portée « marques assignées » ; `null` = toutes. */
  scopeBrandIds: string[] | null;
  /** Portée « clients assignés » ; `null` = tous. */
  scopeClientIds: string[] | null;
};

export type PeriodInfo = Pick<ResolvedPeriod, "key" | "start" | "end" | "label" | "days"> & { prev: { start: string; end: string; label: string }; n1: { start: string; end: string } };
