/**
 * Analytics marketing transverse — constantes partagées (sans accès base, importables partout).
 *
 * Les clés de métriques listées ici sont LA liste de référence côté code : la migration 0017
 * sème les mêmes clés dans `metrics_definitions`, et `tests/analytics-marketing.test.ts` échoue
 * si les deux listes divergent ou si une clé n'a pas de fonction de calcul dans `metrics.ts`.
 */

/** Familles de canaux (`dim_channel.family`). */
export const CHANNEL_FAMILIES = {
  DIGITAL_PAID: "Publicité digitale",
  ORGANIC: "Organique",
  INFLUENCE: "Influence & UGC",
  PRODUCTION: "Création de contenu",
  TERRAIN: "Terrain",
  TRADE: "Trade",
  EVENT: "Événementiel & RP",
  PRESCRIPTION: "Prescripteurs",
  OTHER: "Autres",
} as const;
export type ChannelFamily = keyof typeof CHANNEL_FAMILIES;

/** Sources qui alimentent la couche de faits (`fact_marketing_*.source_kind`). */
export const SOURCE_KINDS = {
  AD_METRIC: { label: "Régie publicitaire", href: "/marketing/ads" },
  EXPENSE: { label: "Dépense saisie", href: "/marketing/budgets" },
  ACTIVATION_LINE: { label: "Ligne budgétaire d'activation", href: "/marketing/activations" },
  COLLABORATION: { label: "Collaboration influence", href: "/marketing/influence" },
  CONTENT: { label: "Contenu éditorial", href: "/marketing/planning" },
  ANIMATION: { label: "Animation terrain", href: "/terrain" },
  SAMPLE: { label: "Échantillon médical", href: "/medical/echantillons" },
} as const;
export type SourceKind = keyof typeof SOURCE_KINDS;

/** Correspondances source → canal (`channel_mappings.source_kind`). */
export const MAPPING_KINDS = {
  BUDGET_CATEGORY: "Catégorie budgétaire",
  AD_PLATFORM: "Régie publicitaire",
  CONTENT_PLATFORM: "Plateforme éditoriale",
  ACTIVATION_TYPE: "Type d'activation",
  COLLABORATION: "Influence",
  ANIMATION: "Animation terrain",
  SAMPLE: "Échantillons médicaux",
} as const;
export type MappingKind = keyof typeof MAPPING_KINDS;

/** Clés des métriques du dictionnaire — même liste que la migration 0017. */
export const METRIC_KEYS = [
  // Argent
  "SPEND_PLANNED", "SPEND_COMMITTED", "SPEND_SPENT", "BUDGET_ANNUAL", "BUDGET_CONSUMED_PCT", "SPEND_SHARE", "MARKETING_INTENSITY",
  // Ventes
  "SELL_IN", "SELL_IN_UNITS", "SELL_OUT", "SELL_OUT_UNITS", "MARGIN", "SALES_SHARE", "OBJECTIVE_ATTAINMENT", "SALES_GROWTH_PREV", "SALES_GROWTH_N1",
  // Résultats
  "IMPRESSIONS", "REACH", "CLICKS", "LINK_CLICKS", "MESSAGES_STARTED", "LEADS", "PURCHASES", "VIEWS", "ENGAGEMENT", "CONTENTS_PUBLISHED",
  "ANIMATION_DAYS", "CUSTOMERS_ADVISED", "SAMPLES", "SELLOUT_AMOUNT", "SELLOUT_UNITS", "PARTICIPANTS", "NEW_CLIENTS", "PHARMACIES_REACHED",
  "ORDERS_ON_SITE", "ORDERS_AMOUNT", "PRESS_MENTIONS", "PROMO_CONVERSIONS", "COST_PER_RESULT", "CTR", "CPM", "CPC",
  // Retour
  "ATTRIBUTED_REVENUE", "ATTRIBUTION_COVERAGE", "ROI_MEASURED", "SALES_LIFT_CORRELATED", "ROI_CORRELATED", "CORRELATION_R",
  // Composites
  "HEALTH_SCORE", "INVESTMENT_BALANCE", "DATA_COMPLETENESS",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** Clés de résultat que la couche de faits peut produire (sous-ensemble du dictionnaire). */
export const RESULT_KEYS = [
  "IMPRESSIONS", "REACH", "CLICKS", "LINK_CLICKS", "MESSAGES_STARTED", "LEADS", "PURCHASES", "VIEWS", "ENGAGEMENT", "CONTENTS_PUBLISHED",
  "ANIMATION_DAYS", "CUSTOMERS_ADVISED", "SAMPLES", "SELLOUT_AMOUNT", "SELLOUT_UNITS", "PARTICIPANTS", "NEW_CLIENTS", "PHARMACIES_REACHED",
  "ORDERS_ON_SITE", "ORDERS_AMOUNT", "PRESS_MENTIONS", "PROMO_CONVERSIONS",
] as const satisfies readonly MetricKey[];
export type ResultKey = (typeof RESULT_KEYS)[number];

export type MetricUnit = "MAD" | "PCT" | "RATIO" | "COUNT" | "MULTIPLE" | "SCORE" | "POINTS";
export type MetricDirection = "HIGHER_BETTER" | "LOWER_BETTER" | "NEUTRAL";
/** Ce qui s'affiche à côté d'un chiffre : mesuré, corrélation observée, ou sans attribution. */
export type AttributionMode = "MEASURED" | "CORRELATION" | "NONE";

export const ATTRIBUTION_LABELS: Record<AttributionMode, string> = {
  MEASURED: "mesuré",
  CORRELATION: "corrélation observée",
  NONE: "",
};

/**
 * Une valeur affichable : soit un nombre, soit « données insuffisantes » avec la raison et le
 * responsable. Aucune page ne fabrique un 0 à partir d'une source vide.
 */
export type Measured<T = number> =
  | { ok: true; value: T; /** Complétude 0-1 de la donnée sous-jacente, si elle a un sens. */ completeness?: number | null; note?: string }
  | { ok: false; reason: string; /** Qui doit alimenter (libellé de rôle). */ owner?: string; /** Lien vers l'écran Qualité ou la fiche à corriger. */ href?: string };

export const insufficient = (reason: string, owner?: string, href = "/marketing/analytics/qualite"): Measured<never> => ({ ok: false, reason, owner, href });
export const measured = <T,>(value: T, completeness?: number | null, note?: string): Measured<T> => ({ ok: true, value, completeness, note });

/** Division sûre : `null` si le dénominateur est nul ou absent (jamais 0 ni Infinity). */
export function ratio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num === null || num === undefined || den === null || den === undefined || den === 0 || !Number.isFinite(num) || !Number.isFinite(den)) return null;
  return num / den;
}
