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
  /**
   * Seuils du moteur de décision publicitaire (SCALE / MAINTAIN / OPTIMIZE / STOP / WATCH).
   * Aucun de ces nombres n'est écrit dans `diagnose()` : sous `minSpend` ou `minDays`,
   * aucun verdict n'est rendu — la campagne est classée WATCH.
   */
  ads: AdThresholds;
};

/** Seuils du moteur publicitaire, tels que passés à `diagnose()`. */
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
  ads: DEFAULT_AD_THRESHOLDS,
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
  };
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
