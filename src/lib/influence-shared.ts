/**
 * Influence — définitions partagées entre le serveur et les composants client :
 * messages d'erreur des actions et lecture d'un montant saisi à la main.
 */

/** Messages affichés après une action (clé passée dans `?erreur=`). */
export const INFLUENCE_ERRORS: Record<string, string> = {
  nombre: "Une valeur numérique est invalide (cachet, valeur produits, reach, statistiques ou CA).",
  influenceuse: "Influenceuse manquante ou inconnue.",
  marque: "Marque manquante, ou hors de votre périmètre.",
  date: "Date invalide.",
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
