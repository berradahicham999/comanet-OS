/**
 * Pages du module Marketing masquées par la simplification du 18/11/2026 (décision d'Hicham : cinq entrées,
 * Pilotage · Opérations · Contenu · Digital Ads · Plan & budget). Aucun code ni aucune table n'est supprimé :
 * chaque adresse masquée renvoie, côté serveur, vers la page de remplacement la plus proche. Les liens déjà
 * enregistrés en base (notifications, tâches, recommandations) restent donc valides.
 *
 * Fichier sans dépendance : il est lu par `next.config.ts` (redirections) et par le test qui interdit tout lien
 * de `src/` vers une page masquée (`tests/marketing-simplifie.test.ts`).
 */
export type HiddenRedirect = {
  source: string;
  destination: string;
  permanent: false;
  has?: { type: "query"; key: string; value?: string }[];
};

/** Préfixes d'adresses masquées (le test les cherche dans le code). */
export const HIDDEN_MARKETING_PATHS = [
  "/marketing/studio",
  "/marketing/bibliotheque",
  "/marketing/priorites/generer",
  "/marketing/agent",
  "/marketing/analytics/360",
  "/marketing/analytics/canaux",
  "/marketing/analytics/marques",
  "/marketing/analytics/produits",
  "/marketing/analytics/qualite",
] as const;

/**
 * Adresses exactes masquées : la liste des priorités et la synthèse analytics. La fiche d'une action
 * (`/marketing/priorites/<id>`) et les résultats (`/marketing/analytics/plan`, `/marketing/analytics/revue/<marque>`)
 * restent ouverts.
 */
export const HIDDEN_MARKETING_EXACT = ["/marketing/priorites", "/marketing/analytics"] as const;

const r = (source: string, destination: string, has?: HiddenRedirect["has"]): HiddenRedirect => ({ source, destination, permanent: false, ...(has ? { has } : {}) });

/** Redirections Next (`redirects()`), les plus précises d'abord. Les paramètres d'adresse (marque, période) suivent. */
export const MARKETING_REDIRECTS: HiddenRedirect[] = [
  // Création de contenu → le fil éditorial de chaque marque.
  r("/marketing/studio", "/marketing/planning"),
  r("/marketing/studio/:path*", "/marketing/planning"),
  // Bibliothèque d'actions → les opérations.
  r("/marketing/bibliotheque", "/marketing/activations"),
  r("/marketing/bibliotheque/:path*", "/marketing/activations"),
  // Priorités et générateur → Pilotage (actions au plan, quoi pousser). La fiche d'une action reste ouverte.
  r("/marketing/priorites", "/marketing"),
  r("/marketing/priorites/generer", "/marketing"),
  r("/marketing/priorites/generer/:path*", "/marketing"),
  // Agent marketing → Pilotage (le copilote ⌘K reste disponible partout).
  r("/marketing/agent", "/marketing"),
  // Analytics : la revue de la marque quand une marque est choisie, sinon les résultats (plan vs réel).
  r("/marketing/analytics/marques", "/marketing/analytics/revue/:brand", [{ type: "query", key: "brand", value: "(?<brand>[0-9a-fA-F-]{36})" }]),
  r("/marketing/analytics", "/marketing/analytics/plan"),
  r("/marketing/analytics/360", "/marketing/analytics/plan"),
  r("/marketing/analytics/canaux", "/marketing/analytics/plan"),
  r("/marketing/analytics/marques", "/marketing/analytics/plan"),
  r("/marketing/analytics/produits", "/marketing/analytics/plan"),
  r("/marketing/analytics/qualite", "/marketing/analytics/plan"),
];

/** Une adresse (chemin seul ou avec paramètres) mène-t-elle à une page masquée ? */
export function isHiddenMarketingHref(href: string): boolean {
  const path = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if ((HIDDEN_MARKETING_EXACT as readonly string[]).includes(path)) return true;
  return HIDDEN_MARKETING_PATHS.some((p) => path === p || path.startsWith(p + "/"));
}
