/**
 * Nomenclatures du module marketing (partagées client / serveur).
 * Aucune règle chiffrée ici : les seuils vivent dans `settings`.
 */

export const CAMPAIGN_TYPES = {
  AWARENESS: "Notoriété",
  ACQUISITION: "Acquisition",
  CONVERSION: "Conversion",
  RETARGETING: "Retargeting",
  LANCEMENT: "Lancement produit",
  PROMOTION: "Promotion",
  RAMADAN: "Ramadan",
  BLACK_FRIDAY: "Black Friday",
  SAISON: "Saison",
  EDUCATION: "Éducation",
  INFLUENCE: "Influence",
  TRADE: "Trade",
  TERRAIN: "Terrain",
  CAMPAGNE_360: "Campagne 360",
} as const;
export type CampaignType = keyof typeof CAMPAIGN_TYPES;

export const CAMPAIGN_STATUS: Record<string, { label: string; tone: "gray" | "blue" | "green" | "yellow" | "purple" | "accent" }> = {
  DRAFT: { label: "Brouillon", tone: "gray" },
  PLANNED: { label: "Planifiée", tone: "blue" },
  ACTIVE: { label: "Active", tone: "green" },
  PAUSED: { label: "En pause", tone: "yellow" },
  DONE: { label: "Terminée", tone: "purple" },
  ANALYZED: { label: "Analysée", tone: "accent" },
};

export const AD_PLATFORMS = { META: "Meta Ads", TIKTOK: "TikTok Ads", GOOGLE: "Google Ads", AUTRE: "Autre régie" } as const;
export type AdPlatform = keyof typeof AD_PLATFORMS;

export const COLLAB_STATUS: Record<string, { label: string; tone: "gray" | "blue" | "yellow" | "green" | "purple" | "accent"; done: boolean }> = {
  PROSPECT: { label: "Prospect", tone: "gray", done: false },
  CONTACTEE: { label: "Contactée", tone: "gray", done: false },
  NEGOCIATION: { label: "Négociation", tone: "yellow", done: false },
  CONFIRMEE: { label: "Confirmée", tone: "blue", done: false },
  CONTENU_RECU: { label: "Contenu reçu", tone: "blue", done: false },
  PUBLIE: { label: "Publié", tone: "green", done: true },
  ANALYSE: { label: "Analysé", tone: "accent", done: true },
  TERMINE: { label: "Terminé", tone: "purple", done: true },
};

export const ACTIVATION_TYPES = {
  EVENEMENT: "Événement",
  SPONSORING: "Sponsoring",
  PADEL: "Padel",
  PLV: "PLV",
  SHOOTING: "Shooting",
  SALON: "Salon",
  CONFERENCE: "Conférence",
  ANIMATION: "Animation",
  LANCEMENT: "Lancement",
  SAMPLING: "Sampling",
  GOODIES: "Goodies",
  PARTENARIAT: "Partenariat",
  INFLUENCE: "Campagne influence",
  DIGITAL: "Campagne digitale",
  PROMOTION: "Promotion",
  MEDICAL: "Événement médical",
  PRO: "Événement professionnel",
} as const;
export type ActivationType = keyof typeof ACTIVATION_TYPES;

/** Verdict d'une campagne publicitaire. */
export const AD_VERDICTS = {
  SCALE: { label: "SCALE", tone: "green" as const, help: "Performance au-dessus de la référence : augmenter progressivement le budget." },
  MAINTAIN: { label: "MAINTAIN", tone: "blue" as const, help: "Performance conforme : ne rien changer, surveiller." },
  OPTIMIZE: { label: "OPTIMIZE", tone: "orange" as const, help: "Dégradation identifiée : agir sur le maillon faible avant d'ajouter du budget." },
  STOP: { label: "STOP", tone: "red" as const, help: "Coût par résultat hors de proportion : couper et réallouer." },
  WATCH: { label: "À SURVEILLER", tone: "gray" as const, help: "Trop peu de données pour trancher." },
};
export type AdVerdict = keyof typeof AD_VERDICTS;

export function campaignTypeLabel(t: string) {
  return CAMPAIGN_TYPES[t as CampaignType] ?? t;
}
export function platformLabel(p: string) {
  return AD_PLATFORMS[p as AdPlatform] ?? p;
}
export function activationTypeLabel(t: string) {
  return ACTIVATION_TYPES[t as ActivationType] ?? t;
}

/** Plateforme déduite d'un libellé libre (colonne « source » ou nom de fichier). */
export function normalizePlatform(raw: unknown): AdPlatform {
  const k = String(raw ?? "").toUpperCase();
  if (k.includes("TIKTOK") || k.includes("TIK TOK")) return "TIKTOK";
  if (k.includes("GOOGLE") || k.includes("YOUTUBE") || k.includes("SEA")) return "GOOGLE";
  if (k.includes("META") || k.includes("FACEBOOK") || k.includes("INSTAGRAM") || k.includes("FB")) return "META";
  return "AUTRE";
}
