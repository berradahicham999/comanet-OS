import type { BudgetCategory } from "@/db/schema";
import { normKey } from "./import/normalize";

export const BUDGET_CATEGORY_LABELS: Record<BudgetCategory, string> = {
  META: "Meta Ads",
  TIKTOK: "TikTok Ads",
  GOOGLE: "Google Ads",
  DIGITAL: "Communication digitale",
  INFLUENCE: "Influence",
  UGC: "UGC",
  CREATION: "Création",
  SHOOTING: "Shooting",
  EVENEMENT: "Événement",
  SPONSORING: "Sponsoring",
  TRADE: "Trade",
  PLV: "PLV / merchandising",
  ANIMATION: "Animation",
  GOODIES: "Goodies",
  ECHANTILLONS: "Échantillons / mini-doses",
  PRESCRIPTEURS: "Prescripteurs / médecins",
  CONGRES: "Congrès",
  AGENCE: "Agence",
  AUTRES: "Autres",
};

export const BUDGET_CATEGORIES = Object.keys(BUDGET_CATEGORY_LABELS) as BudgetCategory[];

const RULES: [RegExp, BudgetCategory][] = [
  [/\bMETA\b|FACEBOOK|INSTAGRAM/, "META"],
  [/TIKTOK/, "TIKTOK"],
  [/GOOGLE|SEA\b|YOUTUBE/, "GOOGLE"],
  [/INFLUENC/, "INFLUENCE"],
  [/\bUGC\b/, "UGC"],
  [/\bADS\b|DIGITAL|SOCIAL|RESEAUX/, "DIGITAL"],
  [/SHOOTING|PHOTO|VIDEO/, "SHOOTING"],
  [/CREATION|CREA\b|GRAPHI/, "CREATION"],
  [/EVENT|EVENEMENT|LANCEMENT/, "EVENEMENT"],
  [/SPONSOR/, "SPONSORING"],
  [/CONGRES|SALON|SYMPOSIUM/, "CONGRES"],
  [/MEDECIN|PRESCRIPTEUR|DERMATO|PHARMACIEN|DELEGUE/, "PRESCRIPTEURS"],
  [/ECHANTILLON|MINI DOSE|MINIDOSE|DOSE|CURE|PRODUITS POUR ANIMATION|SAMPLE|FOC\b/, "ECHANTILLONS"],
  [/GOODIES|CADEAU|GIFT/, "GOODIES"],
  [/ANIMATION|ANIMATRICE|MATERIEL ANIMATION/, "ANIMATION"],
  [/PLV|MERCHANDISING|PRESENTOIR|DISPLAY/, "PLV"],
  [/TRADE|GROSSISTE|REMISE|PROMO/, "TRADE"],
  [/AGENCE|RP\b|RELATIONS PRESSE/, "AGENCE"],
];

/** Déduit une catégorie normalisée à partir d'un libellé libre (ex: "Com digitale", "influenceuse"). */
export function categoryFromLabel(label: string): BudgetCategory {
  const k = normKey(label);
  for (const [re, cat] of RULES) if (re.test(k)) return cat;
  return "AUTRES";
}

/* ------------------------------------------------------------------ */
/* Ventilation du marketing réel (P&L)                                 */
/* ------------------------------------------------------------------ */

/**
 * Postes du marketing réel dans le P&L — définition unique de la ventilation (`budgetConsumptionByMonth()`).
 * La somme des postes égale exactement le consommé officiel (`foldConsumption()`) : la ventilation ne change aucun total.
 *  · ADS : dépense publicitaire officielle (régie, sinon média saisi) ;
 *  · ECH:<nature> : échantillons, par nature de sortie (BL de sortie marketing, remises en visite = MEDICAL) ;
 *    une dépense d'échantillons saisie sans nature va dans « ECH:AUTRE » (jamais devinée) ;
 *  · GOODIES, PLV (dont print) : achats de matériel — la charge du matériel naît à l'achat ;
 *  · INFLUENCE : influence et UGC ;
 *  · ACTIVATIONS : autres postes d'une activation ; AUTRES : le reste.
 */
export type MarketingBucket = string;
export const MARKETING_BUCKET_LABELS: Record<string, string> = {
  ADS: "Publicité (régie, sinon saisie)",
  GOODIES: "Goodies",
  PLV: "PLV & print",
  INFLUENCE: "Influence & UGC",
  ACTIVATIONS: "Activations (autres postes)",
  AUTRES: "Autres dépenses marketing",
};
/** Ordre d'affichage : publicité, échantillons (par nature), matériel, influence, activations, autres. */
export function bucketSortKey(b: MarketingBucket): number {
  if (b === "ADS") return 0;
  if (b.startsWith("ECH:")) return b === "ECH:AUTRE" ? 19 : 10;
  return { GOODIES: 20, PLV: 21, INFLUENCE: 30, ACTIVATIONS: 40, AUTRES: 50 }[b] ?? 60;
}
export const sampleBucket = (nature: string | null | undefined): MarketingBucket => `ECH:${nature || "AUTRE"}`;

const AD_CATS = new Set(["META", "TIKTOK", "GOOGLE", "DIGITAL"]);

/** Poste d'une dépense `marketing_expenses` (COMMITTED ou SPENT). */
export function marketingBucketOf(e: { category: string; outputNature?: string | null; activationId?: string | null }): MarketingBucket {
  if (AD_CATS.has(e.category)) return "ADS";
  if (e.category === "ECHANTILLONS") return sampleBucket(e.outputNature);
  if (e.category === "GOODIES") return "GOODIES";
  if (e.category === "PLV") return "PLV";
  if (e.category === "INFLUENCE" || e.category === "UGC") return "INFLUENCE";
  if (e.activationId) return "ACTIVATIONS";
  return "AUTRES";
}
