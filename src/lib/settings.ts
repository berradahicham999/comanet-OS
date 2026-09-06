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
  /** Fréquence de visite médicale par défaut (jours) si non précisée sur la fiche médecin. */
  medicalDefaultVisitFrequencyDays: number;
  /** Médecin considéré en retard de visite au-delà de ce nombre de jours sans visite. */
  medicalOverdueVisitDays: number;
  /** Nombre moyen d'échantillons distribués par visite (pour la prévision de stock). */
  medicalSamplesPerVisitDefault: number;
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
  medicalDefaultVisitFrequencyDays: 30,
  medicalOverdueVisitDays: 60,
  medicalSamplesPerVisitDefault: 1,
};

export const SETTINGS_KEY = "comanet.rules";

export async function getSettings(): Promise<ComanetSettings> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, SETTINGS_KEY) });
  if (!row) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...(row.value as Partial<ComanetSettings>) };
}

export async function saveSettings(value: ComanetSettings) {
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
