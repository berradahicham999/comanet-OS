/**
 * Contexte d'une carte à expliquer (partagé client / serveur, aucune dépendance).
 * La carte transmet exactement ce qu'elle affiche : métrique, valeurs, période, filtres. Le copilote
 * relit ensuite la donnée par les outils ; les valeurs affichées servent de repère, pas de source.
 */
export type ExplainContext = {
  /** Écran d'origine (« cockpit », « ventes »…). */
  surface: string;
  /** Identifiant stable de la carte (« ca-mois », « stock »). */
  card: string;
  /** Titre de la carte tel qu'affiché. */
  title: string;
  /** Valeurs affichées, telles quelles (libellé → texte). */
  values: { label: string; value: string }[];
  /** Période affichée (libellé et bornes si connues). */
  period?: { label: string; start?: string; end?: string } | null;
  /** Filtres actifs (marque, ville…). */
  filters?: Record<string, string> | null;
  /** Outils suggérés pour relire la donnée (indication, le modèle reste libre parmi ses droits). */
  tools?: string[];
};

export type ExplainResult =
  | { ok: true; text: string; cached: boolean; model: string; generatedAt: string }
  | { ok: false; error: string; configured: boolean };
