/**
 * Normalisations du domaine « animations POS » (partagé client / serveur / import).
 */

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
