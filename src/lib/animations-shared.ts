/**
 * Normalisations du domaine « animations POS » (partagé client / serveur / import).
 */
import { fmtDateShort } from "@/lib/format";

/**
 * Période d'une animation pour l'affichage : « 18 sept. → 20 sept. · 3 j ».
 * Sans date de début connue (import, historique), seul le dernier jour est affiché, suivi
 * du nombre de jours s'il dépasse 1 — la période n'est jamais reconstituée.
 */
export function fmtAnimationPeriod(startDate: string | null | undefined, date: string, days: number): string {
  const n = days > 1 ? ` · ${days} j` : "";
  if (!startDate || startDate === date) return `${fmtDateShort(date)}${n}`;
  return `${fmtDateShort(startDate)} → ${fmtDateShort(date)}${n}`;
}

const strip = (v: string) =>
  v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/** Variantes rencontrées dans les fichiers COMANET → ville canonique. */
const CITY_ALIASES: Record<string, string> = {
  CASA: "CASABLANCA",
  "CASA BLANCA": "CASABLANCA",
  KENITRA: "KÉNITRA",
  MEKNES: "MEKNÈS",
  TETOUAN: "TÉTOUAN",
  FES: "FÈS",
  LAAYOUNE: "LAÂYOUNE",
};

/** Ville canonique (majuscules, accents rétablis sur les villes connues). */
export function normalizeCity(raw: unknown): string | null {
  const k = strip(String(raw ?? ""));
  if (!k) return null;
  return CITY_ALIASES[k] ?? k;
}

/** Clé de comparaison d'une ville (sans accent), pour rapprocher objectifs et réalisé. */
export function cityKey(raw: unknown): string {
  const c = normalizeCity(raw);
  return c ? strip(c) : "";
}

/** Identité d'une ligne du fichier quotidien : date | ville | point de vente | animatrice. */
export function animationKey(parts: { date: string; city?: string | null; pos: string; animatrice?: string | null }) {
  return [parts.date, cityKey(parts.city), strip(parts.pos), strip(parts.animatrice ?? "")].join("|");
}

/** Nom d'animatrice normalisé pour l'affichage : « MERIEM AYOUB » → « Meriem Ayoub ». */
export function animatriceName(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(" ");
}

/** Adresse e-mail interne dérivée du prénom/nom d'une animatrice. */
export function animatriceEmail(raw: string) {
  const slug = strip(raw).toLowerCase().replace(/\s+/g, ".");
  return `${slug}@animatrice.comanet.ma`;
}

/* ------------------------------------------------------------------ */
/* Messages de la saisie d'animation                                   */
/* ------------------------------------------------------------------ */

/**
 * Codes rendus dans l'URL par `saveAnimation()` et affichés en bannière.
 * Ils vivent ici parce qu'un fichier « use server » ne peut exporter que des fonctions async.
 */
export const ANIMATION_ERRORS: Record<string, string> = {
  client: "Point de vente manquant ou inconnu.",
  date: "Date invalide.",
  periode: "Période invalide : la date de début doit précéder la date de fin, sur 31 jours au plus.",
  jours: "Nombre de jours invalide : entre 1 et le nombre de jours de la période.",
  nombre: "Une valeur numérique est invalide (coût, durée, clientes conseillées ou échantillons).",
  quantite: "Quantité vendue invalide : elle doit être un nombre entier positif ou nul.",
  stock: "Stock rayon invalide : il doit être un nombre entier positif ou nul.",
  doublon: "Une animation existe déjà pour ce point de vente, cette date et cette animatrice. Voici la fiche existante : modifiez-la plutôt que d'en créer une seconde.",
};

export const ANIMATION_WARNINGS: Record<string, string> = {
  chevauchement: "Animation enregistrée. Attention : cette animatrice a déjà une autre animation sur ces mêmes jours. Vérifiez qu'il ne s'agit pas d'un doublon ou d'une erreur de date.",
  prix: "Animation enregistrée. Attention : certains produits n'ont pas de prix public, leur chiffre d'affaires n'est donc pas mesurable. Renseignez le prix public sur la fiche produit.",
};
