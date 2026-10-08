/**
 * Influence — définitions partagées entre le serveur et les composants client :
 * messages d'erreur des actions et lecture d'un montant saisi à la main.
 */

/** Messages affichés après une action (clé passée dans `?erreur=`). */
export const INFLUENCE_ERRORS: Record<string, string> = {
  nombre: "Une valeur numérique est invalide (cachet, valeur produits, reach, statistiques ou CA).",
  influenceuse: "Influenceuse manquante ou inconnue.",
  marque: "Marque manquante, ou hors de votre périmètre.",
  date: "Date de début invalide.",
  periode: "Date de fin invalide : elle doit être postérieure ou égale à la date de début.",
  statut: "Statut inconnu.",
  campagne: "La campagne choisie n'appartient pas à cette marque.",
  produit: "Le produit choisi n'appartient pas à cette marque.",
  introuvable: "Cette collaboration n'existe plus, ou n'est pas dans votre périmètre.",
  nom: "Le nom de l'influenceuse est obligatoire.",
  doublon: "Une influenceuse porte déjà ce nom : modifiez sa fiche plutôt que d'en créer une seconde.",
};

/** Messages de confirmation (clé passée dans `?ok=`). */
export const INFLUENCE_OK: Record<string, string> = {
  collab: "Collaboration enregistrée.",
  collab_maj: "Collaboration mise à jour.",
  statut: "Statut mis à jour.",
  suppr: "Collaboration supprimée.",
  fiche: "Fiche influenceuse enregistrée.",
};

/**
 * Lit un montant saisi à la main : « 1 200,50 », « 1.200 », « 1,234,567 », « 1200.5 ».
 * Le dernier séparateur rencontré est le séparateur décimal ; un séparateur unique suivi
 * d'exactement trois chiffres par groupe est lu comme séparateur de milliers (« 1.200 » = 1200).
 * Retourne `null` si vide et `NaN` si illisible : l'appelant refuse la saisie au lieu de deviner.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").replace(/[\s  ]/g, "").replace(/mad$/i, "");
  if (s === "") return null;
  if (!/^-?[\d.,]+$/.test(s)) return NaN;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? "," : ".";
    normalized = s.replace(dec === "," ? /\./g : /,/g, "").replace(",", ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const groups = s.split(sep);
    const thousands = groups.length > 1 && groups.slice(1).every((g) => g.length === 3) && groups[0].replace("-", "").length <= 3;
    normalized = thousands ? groups.join("") : groups.length === 2 ? groups.join(".") : "";
  } else normalized = s;
  const n = Number(normalized);
  return normalized === "" || Number.isNaN(n) ? NaN : n;
}

/* ------------------------------ Période d'une collaboration ------------------------------ */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const utc = (d: string) => new Date(`${d}T00:00:00Z`);

/** Dernier jour couvert : la fin saisie, sinon le jour de début (collaboration d'un jour). */
export function collabLastDay(start: string, end: string | null | undefined): string {
  return end || start;
}

/** Fin saisie : `null` si vide (un seul jour), message d'erreur si illisible ou avant le début. */
export function collabEndError(start: string, end: string | null): string | null {
  if (!end) return null;
  if (!ISO.test(end) || Number.isNaN(utc(end).getTime()) || utc(end).toISOString().slice(0, 10) !== end) return "periode";
  return end < start ? "periode" : null;
}

/** Nombre de jours couverts, bornes incluses. */
export function collabDays(start: string, end: string | null | undefined): number {
  return Math.round((utc(collabLastDay(start, end)).getTime() - utc(start).getTime()) / 86400000) + 1;
}

/** Fin d'une période de `months` mois à partir de `start` : la veille du même jour, `months` mois plus tard (01/06 + 2 mois → 31/07). */
export function endAfterMonths(start: string, months: number): string {
  const d = utc(start);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months, day = d.getUTCDate();
  // Jour absent du mois d'arrivée (31 → février) : dernier jour de ce mois, sans déborder sur le suivant.
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const target = new Date(Date.UTC(y, m, Math.min(day, last)));
  return new Date(target.getTime() - 86400000).toISOString().slice(0, 10);
}

export type CollabPhase = "A_VENIR" | "EN_COURS" | "TERMINEE";

/** Où en est la période par rapport à `today` (date métier ISO) — indépendant du statut saisi. */
export function collabPhase(start: string, end: string | null | undefined, today: string): CollabPhase {
  if (today < start) return "A_VENIR";
  return today <= collabLastDay(start, end) ? "EN_COURS" : "TERMINEE";
}

export const COLLAB_PHASE: Record<CollabPhase, { label: string; tone: "blue" | "green" | "gray" }> = {
  A_VENIR: { label: "À venir", tone: "blue" },
  EN_COURS: { label: "En cours", tone: "green" },
  TERMINEE: { label: "Terminée", tone: "gray" },
};
