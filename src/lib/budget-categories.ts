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
