/**
 * CRM commercial — portée d'affichage (pure, sans base : utilisable par les outils du copilote et les tests).
 * Voir `access.ts` pour la construction de `CrmViewer` et la règle complète.
 */
export type CrmViewer = {
  userId: string;
  name: string;
  admin: boolean;
  /** Suivi de toutes les commerciales (administrateur ou Valider sur Clients). */
  all: boolean;
  /** Commerciales dont la personne est le manager. */
  managedIds: string[];
  canCreate: boolean;
  canEdit: boolean;
  canValidate: boolean;
};

/** Les visites et le portefeuille de cette personne sont-ils visibles ? */
export function canSeeUser(v: CrmViewer, userId: string | null | undefined): boolean {
  if (!userId) return v.all;
  return v.all || userId === v.userId || v.managedIds.includes(userId);
}

/** Positions GPS d'une visite : administrateurs et manager de la commerciale seulement. */
export function canSeePositions(v: CrmViewer, userId: string | null | undefined): boolean {
  return v.admin || (!!userId && v.managedIds.includes(userId));
}

/** Voit-on le suivi d'au moins une autre personne (page « Suivi des visites ») ? */
export function hasTeamView(v: CrmViewer): boolean {
  return v.all || v.managedIds.length > 0;
}

