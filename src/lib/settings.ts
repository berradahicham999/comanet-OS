/**
 * Paramètres métier configurables (jamais hardcodés dans les règles).
 * Stockés dans la table `settings` (clé → JSON). Les valeurs ci-dessous sont
 * les défauts utilisés tant que l'admin ne les a pas modifiés.
 */
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export type ComanetSettings = {
  /** Couverture de stock (mois) : seuils vert / jaune / orange. En dessous d'orange = rouge. */
  coverage: { green: number; yellow: number; orange: number };
  /** Nombre de mois d'historique pour calculer la vente moyenne mensuelle. */
  avgSalesMonths: number;
  /** Client considéré inactif après N jours sans commande. */
  clientInactiveDays: number;
  /** Client "à risque" si baisse > X % (3 derniers mois vs 3 précédents). */
  clientRiskDropPct: number;
  /** Client "en croissance" si hausse > X %. */
  clientGrowthPct: number;
  /** Client "fort potentiel" : CA 12 mois au-dessus du percentile X. */
  clientHighPotentialPercentile: number;
  /** Jours avant expiration pour déclencher les alertes réglementaires. */
  regulatoryAlertDays: number[];
  /** Jours avant expiration à partir desquels le redépôt doit être lancé (tâche auto). */
  regulatoryRenewalDays: number;
  /** Seuil de baisse du sell-out terrain (%) déclenchant une recommandation. */
  sellOutDropPct: number;
  /** % de budget engagé au-delà duquel on alerte. */
  budgetAlertPct: number;
  /** Baisse de CA marque (%) vs M-1 déclenchant une alerte. */
  brandDropPct: number;
  /** Tolérance (jours) avant de relancer un client dont la commande théorique est passée. */
  reorderGraceDays: number;
  /** Marge brute par défaut (%) si prix d'achat inconnu. */
  defaultMarginPct: number;
  /** CA mensuel à risque (MAD) à partir duquel une alerte stock est critique / haute. */
  stockCriticalRevenue: number;
  /**
   * Produit « en tension » : couverture strictement inférieure à ce nombre de mois.
   * Seuil unique de la règle « campagne active + produit en tension » et du garde-fou
   * de scaling publicitaire (il était écrit en dur à deux endroits avant le 7/09/2026).
   */
  stockTightCoverageMonths: number;
  /**
   * Rotation minimale (unités/mois) pour qu'une couverture courte constitue un enjeu.
   * Sous ce volume, une couverture d'un mois ne représente que quelques unités.
   */
  stockTightMinMonthlyUnits: number;
  /** Fréquence de visite médicale par défaut (jours) si non précisée sur la fiche médecin. */
  medicalDefaultVisitFrequencyDays: number;
  /** Médecin considéré en retard de visite au-delà de ce nombre de jours sans visite. */
  medicalOverdueVisitDays: number;
  /** Nombre moyen d'échantillons distribués par visite (pour la prévision de stock). */
  medicalSamplesPerVisitDefault: number;
  /**
   * Taux de conversion vers le MAD, par devise (ex. { EUR: 10.85, USD: 9.9 }).
   * Les comptes publicitaires COMANET facturent en EUR et en USD. Aucun taux n'est deviné :
   * tant qu'une devise n'est pas renseignée ici, la synchronisation de ce compte est refusée
   * plutôt que d'inventer un montant en dirhams.
   */
  fxRates: Record<string, number>;
  /** Fenêtre d'attribution demandée à Meta. Un CA mesuré n'est comparable qu'à fenêtre égale. */
  metaAttributionWindow: string;
  /** Nombre de jours re-synchronisés à chaque passage : Meta révise ses conversions a posteriori. */
  metaSyncWindowDays: number;
  /** Premier jour du rattrapage historique Meta (AAAA-MM-JJ). Meta ne sert que 37 mois glissants : au-delà, « indisponible ». */
  metaHistoryStart: string;
  /** Seuils de la couche d'intelligence publicitaire (fatigue, anomalies, winners, contenu, budget). */
  adsIntel: AdsIntelSettings;
  /**
   * Seuils du moteur de décision publicitaire (SCALE / MAINTAIN / OPTIMIZE / STOP / WATCH).
   * Aucun de ces nombres n'est écrit dans `diagnose()` : sous `minSpend` ou `minDays`,
   * aucun verdict n'est rendu — la campagne est classée WATCH.
   */
  ads: AdThresholds;
  /** Fenêtres et délais du module Activations (mesure du retour, rappels). */
  activations: ActivationSettings;
  /** Couche d'analyse marketing transverse : fenêtres, répartition, coûts, seuils de verdict. */
  analytics: AnalyticsSettings;
  /** Copilote IA : limites d'usage et plafond de coût (les modèles et la clé restent en variables d'environnement). */
  ai: AiSettings;
  /** Agent marketing : seuils de lecture d'un produit (contribution, marge faible, volume minimal) et nombre de décisions. */
  marketingIntel: MarketingIntelSettings;
  /** Stock chez le client : ancienneté d'un relevé, fenêtres de croisement sell-in / sell-out. */
  clientStock: ClientStockSettings;
  /** Gestion commerciale : identité de la société imprimée sur les pièces, politiques, bascule depuis Sage. */
  gestion: GestionSettings;
};

/**
 * Gestion commerciale (`src/lib/gestion/`). L'identité de la société n'a pas de valeur par défaut
 * dans le code (le dépôt est public) : elle se saisit dans /parametres/gestion.
 */
export type CompanyIdentity = {
  legalName: string;
  address: string;
  city: string;
  postalCode: string;
  phone: string;
  email: string;
  /** Capital social, tel qu'imprimé (« 100.000,00 Dirhams »). */
  capital: string;
  rc: string;
  ice: string;
  ifNumber: string;
  cnss: string;
  /** Taxe professionnelle (patente). */
  tp: string;
  bankName: string;
  rib: string;
};

export type GestionSettings = {
  company: CompanyIdentity;
  /** Taux de TVA des articles qui n'en précisent pas (clé de `tax_rates`). */
  defaultTaxRateKey: string;
  /** Délai de paiement (jours) des clients qui n'en précisent pas. */
  defaultPaymentDays: number;
  /** Plafond du délai de paiement (jours) : aucune échéance ne va au-delà. À faire confirmer par le comptable. */
  maxPaymentDays: number;
  /** Stock insuffisant à la validation d'une sortie : bloquer, ou seulement alerter. */
  insufficientStock: "BLOCK" | "WARN";
  /** Alerte péremption : un lot est « proche » à moins de N jours. */
  expiryAlertDays: number;
  /** Fenêtre (jours) des ventes COMANET qui désigne les clients et articles à préparer pour la facturation. */
  readinessWindowDays: number;
  /**
   * Bascule depuis Sage. OFF : Sage fait foi. PARALLELE : pièces en simulation. ACTIF : COMANET OS
   * émet les pièces des `sites` listés, à partir de `date` ; les autres sites restent importés.
   */
  cutover: { mode: "OFF" | "PARALLELE" | "ACTIF"; date: string | null; sites: string[] };
  /** Modèle d'impression de la facture : PPH TTC + remise (modèle 1 de Sage) ou prix net (modèle 2). */
  invoiceModel: "PPH_REMISE" | "NET";
  /** Points de remise tolérés au-delà de la remise autorisée du client avant levée de blocage. */
  discountTolerancePct: number;
  /** Exiger l'étape « Livré » avant de pouvoir facturer un BL. */
  requireDelivered: boolean;
  /** Contrôler le plafond d'encours à la validation (utile une fois les règlements saisis, lot 5). */
  checkCreditLimit: boolean;
  /** Libellés du montant en lettres (Sage : « MAD » et « cents »). */
  amountWords: { major: string; minor: string };
  /** Durée de validité (jours) d'un lien de partage de PDF (WhatsApp, e-mail). */
  shareLinkDays: number;
  /** Alerte : BL validés et non facturés depuis plus de N jours. */
  uninvoicedAlertDays: number;
};

export const EMPTY_COMPANY: CompanyIdentity = {
  legalName: "", address: "", city: "", postalCode: "", phone: "", email: "", capital: "", rc: "", ice: "", ifNumber: "", cnss: "", tp: "", bankName: "", rib: "",
};

export const DEFAULT_GESTION: GestionSettings = {
  company: EMPTY_COMPANY,
  defaultTaxRateKey: "TVA20",
  defaultPaymentDays: 60,
  maxPaymentDays: 120,
  insufficientStock: "BLOCK",
  expiryAlertDays: 90,
  readinessWindowDays: 365,
  cutover: { mode: "OFF", date: null, sites: ["COMANET", "DESK DIGITAL"] },
  invoiceModel: "PPH_REMISE",
  discountTolerancePct: 0,
  requireDelivered: false,
  checkCreditLimit: false,
  amountWords: { major: "MAD", minor: "cents" },
  shareLinkDays: 30,
  uninvoicedAlertDays: 15,
};

/**
 * Seuils du stock chez le client (`src/lib/client-stock-shared.ts`). Aucun de ces nombres
 * n'est écrit dans le code : l'ancienneté d'un relevé et la fenêtre de couverture estimée
 * viennent d'ici.
 */
export type ClientStockSettings = {
  /** Relevé « frais » (vert) s'il a strictement moins de N jours. */
  freshDays: number;
  /** Relevé « à refaire » (rouge) à partir de N jours ; entre les deux, orange. */
  staleDays: number;
  /** Jours de sell-in Sage et de sell-out animation croisés avec le dernier relevé. */
  coverageWindowDays: number;
  /** Fenêtre (jours) de sell-out animation qui qualifie un client « actif » sur un produit en rupture. */
  stockoutSelloutDays: number;
};

export const DEFAULT_CLIENT_STOCK: ClientStockSettings = {
  freshDays: 15,
  staleDays: 45,
  coverageWindowDays: 90,
  stockoutSelloutDays: 30,
};

/**
 * Seuils de l'Agent marketing (couche `src/lib/marketing-intel/`). Les seuils de stock (couverture,
 * tension, surstock) et de croissance (`analytics.productCases.sellingGrowthPct`) sont réutilisés tels
 * quels : seuls les seuils propres à la lecture marketing d'un produit vivent ici.
 */
export type MarketingIntelSettings = {
  /** Contribution au CA de la marque (%) à partir de laquelle un produit est STAR (en croissance) ou CASH_COW (stable). */
  starContributionPct: number;
  /** CA sell-in minimal (MAD) sur la période pour classer un produit ; en dessous, « données insuffisantes ». */
  minPeriodRevenueMad: number;
  /** Marge brute (%) en dessous de laquelle un produit est à « marge faible » : la publicité n'est jamais scalée automatiquement. */
  lowMarginPct: number;
  /** Nombre maximal de recommandations rendues par le moteur de décision marketing. */
  maxDecisions: number;
};

export const DEFAULT_MARKETING_INTEL: MarketingIntelSettings = {
  starContributionPct: 10,
  minPeriodRevenueMad: 2000,
  lowMarginPct: 25,
  maxDecisions: 5,
};

export type AiSettings = {
  /** Requêtes au copilote par personne et par heure glissante. */
  requestsPerHour: number;
  /** Tokens (entrée + sortie) autorisés par jour, toutes personnes et surfaces confondues. */
  dailyTokenBudget: number;
  /** Coût mensuel estimé (USD) au-delà duquel les surfaces automatiques (brief, explications) sont suspendues. Les questions manuelles d'un administrateur restent possibles. */
  monthlyCostAlertUsd: number;
  /** Nombre maximal d'appels d'outils par question. */
  maxToolCalls: number;
  /** Délai maximal d'une réponse, en secondes. */
  timeoutSeconds: number;
  /** Durée de cache d'une explication de carte, en minutes. */
  explainCacheMinutes: number;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  requestsPerHour: 60,
  dailyTokenBudget: 2_000_000,
  monthlyCostAlertUsd: 100,
  maxToolCalls: 8,
  timeoutSeconds: 60,
  explainCacheMinutes: 60,
};

/**
 * Réglages de l'analytics marketing transverse. Rien de ces nombres n'est écrit dans
 * `src/lib/analytics-marketing/` ; chaque page affiche le réglage appliqué à côté du chiffre.
 */
export type AnalyticsSettings = {
  /** Fenêtre d'attribution simple : jours de ventes comparés AVANT une action. */
  windowBeforeDays: number;
  /** Jours de ventes observés APRÈS une action. */
  windowAfterDays: number;
  /** Répartition d'une dépense multi-produits : au prorata du sell-in récent ou à parts égales. */
  productSplit: "PRORATA_SALES" | "EQUAL";
  /** Jours de sell-in utilisés pour le prorata. */
  productSplitLookbackDays: number;
  /**
   * Coût d'une journée d'animation (MAD), appliqué à tout l'historique terrain dont le coût
   * n'est pas saisi. `null` = coût non mesurable : le canal Animation affiche des résultats
   * sans dépense, jamais une dépense à 0.
   */
  animationDayCost: number | null;
  /** Coût mensuel CHARGÉ d'une animatrice (MAD, salaire + charges) et jours d'animation attendus par mois : déduisent le tarif journalier quand il n'est pas saisi. */
  animationMonthlyCost: number | null;
  animationDaysPerMonth: number;
  /** Sell-out TTC attendu par jour d'animation (MAD). S'il est renseigné, il prime sur le multiple ci-dessous. */
  animationTargetSelloutPerDay: number | null;
  /** Sell-out TTC attendu par jour d'animation, en multiple du coût journalier : ≥ ce multiple = rentable (SCALE). */
  animationMinSelloutMultiple: number;
  /** En dessous de ce multiple, l'animation ne couvre pas son coût : STOP. */
  animationStopSelloutMultiple: number;
  /** Poids du score de santé marketing (0-100 chacun ; une composante non mesurable sort du dénominateur). */
  healthWeights: { objective: number; roi: number; intensity: number; stockCoverage: number; dataQuality: number };
  /** Écart de points (part budget − part CA) au-delà duquel une marque est sur- ou sous-investie. */
  investmentBalancePts: number;
  /** Classification des produits en 4 cas. */
  productCases: {
    /** Dépense allouée minimale (MAD) sur la période pour considérer un produit « poussé ». */
    pushedMinSpend: number;
    /** Ou nombre d'expositions (contenus + activations + animations) minimal. */
    pushedMinExposures: number;
    /** Croissance de sell-in (%) vs période précédente à partir de laquelle un produit « se vend ». */
    sellingGrowthPct: number;
    /** Surstock : couverture supérieure à N mois sur au moins N unités (définition partagée avec la règle stock). */
    overstockMonths: number;
    overstockMinUnits: number;
  };
  /** Verdict par canal × marque hors Ads (les Ads gardent `settings.ads`). */
  channelDiagnosis: {
    /** Dépense minimale (MAD) sur la période pour rendre un verdict. */
    minSpend: number;
    /** Hausse du coût par résultat (%) vs période précédente déclenchant OPTIMIZE. */
    costRisePct: number;
    /** Baisse du coût par résultat (%) ouvrant SCALE. */
    costDropPct: number;
    /** Coût par résultat supérieur à N fois la moyenne du canal sur le portefeuille : STOP. */
    costVsPortfolioFactor: number;
    /** Semaines consécutives de dégradation déclenchant une alerte Action Center. */
    degradingWeeks: number;
  };
  /** Recommandations de réallocation mensuelles. */
  reallocation: {
    /** Montant minimal (MAD) d'un déplacement proposé. */
    minShiftMad: number;
    /** Part maximale (%) de la dépense du canal source déplaçable en un mois. */
    maxShiftPct: number;
  };
  /** Alertes automatiques. */
  alerts: {
    /** Engagé supérieur au prévu de plus de N % : dérive budget. */
    budgetDriftPct: number;
    /** Objectif de vente décroché de plus de N % alors que la marque n'a aucune dépense : alerte. */
    brandNoSpendObjectiveDropPct: number;
  };
};

export const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettings = {
  windowBeforeDays: 30,
  windowAfterDays: 30,
  productSplit: "PRORATA_SALES",
  productSplitLookbackDays: 90,
  animationDayCost: null,
  animationMonthlyCost: null,
  animationDaysPerMonth: 22,
  animationTargetSelloutPerDay: null,
  animationMinSelloutMultiple: 4,
  animationStopSelloutMultiple: 2,
  healthWeights: { objective: 30, roi: 25, intensity: 15, stockCoverage: 15, dataQuality: 15 },
  investmentBalancePts: 5,
  productCases: { pushedMinSpend: 500, pushedMinExposures: 2, sellingGrowthPct: 10, overstockMonths: 6, overstockMinUnits: 50 },
  channelDiagnosis: { minSpend: 300, costRisePct: 20, costDropPct: 15, costVsPortfolioFactor: 1.8, degradingWeeks: 3 },
  reallocation: { minShiftMad: 1000, maxShiftPct: 30 },
  alerts: { budgetDriftPct: 10, brandNoSpendObjectiveDropPct: 15 },
};

/** Réglages du module Activations : aucun de ces nombres n'est écrit dans le code de mesure. */
export type ActivationSettings = {
  /** Jours de ventes comparés AVANT le début de l'activation. */
  windowBeforeDays: number;
  /** Jours de ventes observés APRÈS la fin de l'activation. */
  windowAfterDays: number;
  /** Jours après la fin au-delà desquels des résultats non saisis déclenchent un rappel. */
  resultsDelayDays: number;
  /** Jours avant le début à partir desquels une checklist incomplète devient une action prioritaire. */
  checklistAlertDays: number;
  /** Dépassement de l'engagé sur le prévu (%) déclenchant une alerte budget. */
  overrunAlertPct: number;
  /** Variation de CA (%) en dessous de laquelle le verdict est « ajuster » plutôt que « refaire ». */
  roiRepeatMinUpliftPct: number;
  /** ROI (incrément CA / coût complet) minimal pour « refaire ». */
  roiRepeatMin: number;
  /** Article d'inventaire considéré dormant après ce nombre de jours sans sortie. */
  inventoryDormantDays: number;
};

export const DEFAULT_ACTIVATION_SETTINGS: ActivationSettings = {
  windowBeforeDays: 30,
  windowAfterDays: 30,
  resultsDelayDays: 15,
  checklistAlertDays: 7,
  overrunAlertPct: 0,
  roiRepeatMinUpliftPct: 10,
  roiRepeatMin: 1,
  inventoryDormantDays: 180,
};

/** Seuils du moteur publicitaire, tels que passés à `diagnose()`. */
export type AdsIntelSettings = {
  /** Fréquence au-delà de laquelle une créative est suspectée de fatigue (avec CTR en baisse ou coût en hausse). */
  fatigueFrequency: number;
  /** Baisse du CTR (%) sur les 7 derniers jours vs les 7 précédents qui signe la fatigue. */
  fatigueCtrDropPct: number;
  /** Hausse du coût par résultat (%) qui signe la fatigue. */
  fatigueCostRisePct: number;
  /** Écart-type au-delà duquel une journée est une anomalie (z-score sur 28 jours). */
  anomalyZ: number;
  /** Dépense minimale (MAD) et jours minimaux pour qu'un élément puisse être WINNER. */
  winnerMinSpend: number;
  winnerMinDays: number;
  /** Coût par résultat sous N × la référence de la marque : WINNER (0,75 = 25 % moins cher). */
  winnerCostFactor: number;
  /** Coût par résultat au-dessus de N × la référence : UNDERPERFORMING. */
  underperformCostFactor: number;
  /** Budget mensuel Digital Ads (MAD) pour le bloc Budget ; 0 = non défini → « non défini ». */
  monthlyBudgetMad: number;
  /** Valeur (MAD) attribuée à un résultat par type (message, lead, vue de page…) pour la contribution après publicité ; vide = non mesurable. */
  valuePerResult: Record<string, number>;
};

export const DEFAULT_ADS_INTEL: AdsIntelSettings = {
  fatigueFrequency: 3,
  fatigueCtrDropPct: 20,
  fatigueCostRisePct: 25,
  anomalyZ: 2.5,
  winnerMinSpend: 300,
  winnerMinDays: 5,
  winnerCostFactor: 0.75,
  underperformCostFactor: 1.5,
  monthlyBudgetMad: 0,
  valuePerResult: {},
};

export type AdThresholds = {
  /** Dépense minimale (MAD) sur la fenêtre d'analyse pour qu'un verdict ait un sens. */
  minSpend: number;
  /** Nombre minimal de jours de diffusion sur la fenêtre. */
  minDays: number;
  /** Hausse du CPA (%) vs période précédente déclenchant OPTIMIZE. */
  cpaRisePct: number;
  /** Baisse du ROAS (%) vs période précédente déclenchant OPTIMIZE. */
  roasDropPct: number;
  /** Baisse du CTR (%) au-delà de laquelle l'accroche est mise en cause. */
  ctrDropPct: number;
  /** Hausse du CPM (%) au-delà de laquelle la diffusion est mise en cause. */
  cpmRisePct: number;
  /** Baisse du taux de conversion (%) au-delà de laquelle le post-clic est mis en cause. */
  convDropPct: number;
  /** Fréquence au-delà de laquelle les créatives sont considérées usées. */
  frequencyMax: number;
  /** CPA supérieur à N fois la moyenne de la marque : STOP. */
  cpaVsBrandFactor: number;
  /** Hausse du ROAS (%) vs période précédente ouvrant SCALE. */
  roasRisePct: number;
  /** ROAS supérieur à N fois la moyenne de la marque : SCALE. */
  roasVsBrandFactor: number;
  /** ROAS plancher en dessous duquel on ne scale jamais. */
  roasMin: number;
  /** Palier d'augmentation de budget recommandé (%) et sa fréquence (jours). */
  scaleStepPct: number;
  scaleStepDays: number;
};

/** Valeurs par défaut du moteur publicitaire — identiques aux constantes qu'elles remplacent. */
export const DEFAULT_AD_THRESHOLDS: AdThresholds = {
  minSpend: 200,
  minDays: 3,
  cpaRisePct: 25,
  roasDropPct: 25,
  ctrDropPct: 15,
  cpmRisePct: 15,
  convDropPct: 15,
  frequencyMax: 3.5,
  cpaVsBrandFactor: 1.8,
  roasRisePct: 20,
  roasVsBrandFactor: 1.3,
  roasMin: 1,
  scaleStepPct: 20,
  scaleStepDays: 3,
};

export const DEFAULT_SETTINGS: ComanetSettings = {
  coverage: { green: 4, yellow: 2, orange: 1 },
  avgSalesMonths: 3,
  clientInactiveDays: 90,
  clientRiskDropPct: 25,
  clientGrowthPct: 15,
  clientHighPotentialPercentile: 80,
  regulatoryAlertDays: [180, 120, 90, 60, 30, 15],
  regulatoryRenewalDays: 90,
  sellOutDropPct: 20,
  budgetAlertPct: 90,
  brandDropPct: 15,
  reorderGraceDays: 5,
  defaultMarginPct: 35,
  stockCriticalRevenue: 5000,
  stockTightCoverageMonths: 1.5,
  stockTightMinMonthlyUnits: 30,
  medicalDefaultVisitFrequencyDays: 30,
  medicalOverdueVisitDays: 60,
  medicalSamplesPerVisitDefault: 1,
  fxRates: {},
  metaAttributionWindow: "7d_click,1d_view",
  metaSyncWindowDays: 28,
  metaHistoryStart: "2023-01-01",
  adsIntel: DEFAULT_ADS_INTEL,
  ads: DEFAULT_AD_THRESHOLDS,
  activations: DEFAULT_ACTIVATION_SETTINGS,
  analytics: DEFAULT_ANALYTICS_SETTINGS,
  ai: DEFAULT_AI_SETTINGS,
  marketingIntel: DEFAULT_MARKETING_INTEL,
  clientStock: DEFAULT_CLIENT_STOCK,
  gestion: DEFAULT_GESTION,
};

export const SETTINGS_KEY = "comanet.rules";

/**
 * Fusionne les réglages enregistrés avec les défauts.
 *
 * La fusion est profonde sur les deux objets imbriqués (`coverage`, `ads`) : un réglage
 * enregistré partiellement — ce qui arrive dès qu'un nouveau seuil est ajouté au code —
 * ne doit pas effacer les seuils qu'il ne mentionne pas.
 */
export function mergeSettings(stored: Partial<ComanetSettings> | null | undefined): ComanetSettings {
  if (!stored) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    coverage: { ...DEFAULT_SETTINGS.coverage, ...(stored.coverage ?? {}) },
    ads: { ...DEFAULT_AD_THRESHOLDS, ...(stored.ads ?? {}) },
    adsIntel: { ...DEFAULT_ADS_INTEL, ...(stored.adsIntel ?? {}), valuePerResult: { ...(stored.adsIntel?.valuePerResult ?? {}) } },
    activations: { ...DEFAULT_ACTIVATION_SETTINGS, ...(stored.activations ?? {}) },
    analytics: mergeAnalytics(stored.analytics),
    ai: { ...DEFAULT_AI_SETTINGS, ...(stored.ai ?? {}) },
    marketingIntel: { ...DEFAULT_MARKETING_INTEL, ...(stored.marketingIntel ?? {}) },
    clientStock: { ...DEFAULT_CLIENT_STOCK, ...(stored.clientStock ?? {}) },
    gestion: mergeGestion(stored.gestion),
  };
}

/** Fusion profonde des réglages de gestion commerciale (identité et bascule imbriquées). */
export function mergeGestion(stored: Partial<GestionSettings> | null | undefined): GestionSettings {
  const d = DEFAULT_GESTION;
  if (!stored) return d;
  return {
    ...d,
    ...stored,
    company: { ...d.company, ...(stored.company ?? {}) },
    cutover: { ...d.cutover, ...(stored.cutover ?? {}) },
    amountWords: { ...d.amountWords, ...(stored.amountWords ?? {}) },
  };
}

/** Fusion profonde des réglages analytics : un objet imbriqué partiel ne doit pas effacer les autres seuils. */
export function mergeAnalytics(stored: Partial<AnalyticsSettings> | null | undefined): AnalyticsSettings {
  const d = DEFAULT_ANALYTICS_SETTINGS;
  if (!stored) return d;
  return {
    ...d,
    ...stored,
    healthWeights: { ...d.healthWeights, ...(stored.healthWeights ?? {}) },
    productCases: { ...d.productCases, ...(stored.productCases ?? {}) },
    channelDiagnosis: { ...d.channelDiagnosis, ...(stored.channelDiagnosis ?? {}) },
    reallocation: { ...d.reallocation, ...(stored.reallocation ?? {}) },
    alerts: { ...d.alerts, ...(stored.alerts ?? {}) },
  };
}

/** Coût d'une journée d'animation : tarif saisi, sinon salaire net mensuel ÷ jours attendus, sinon non mesurable. */
export function animationDayCostOf(a: AnalyticsSettings): number | null {
  if (a.animationDayCost !== null && a.animationDayCost > 0) return a.animationDayCost;
  if (a.animationMonthlyCost !== null && a.animationMonthlyCost > 0 && a.animationDaysPerMonth > 0) return Math.round(a.animationMonthlyCost / a.animationDaysPerMonth);
  return null;
}

/** Multiple de rentabilité attendu d'une animation : objectif journalier ÷ coût journalier s'ils sont connus, sinon le multiple saisi. */
export function animationMinMultipleOf(a: AnalyticsSettings): number {
  const day = animationDayCostOf(a);
  if (a.animationTargetSelloutPerDay !== null && a.animationTargetSelloutPerDay > 0 && day) return a.animationTargetSelloutPerDay / day;
  return a.animationMinSelloutMultiple;
}

export async function getSettings(): Promise<ComanetSettings> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, SETTINGS_KEY) });
  return mergeSettings(row?.value as Partial<ComanetSettings> | undefined);
}

export async function saveSettings(value: ComanetSettings) {
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
