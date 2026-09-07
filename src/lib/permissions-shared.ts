/**
 * Types et helpers de permissions utilisables côté client (matrice, dépendances,
 * fusion de modèles). La résolution (lecture en base) vit dans
 * `src/lib/permissions.ts`, côté serveur.
 */
import { FLAG_KEYS, MODULE_KEYS, type FlagKey, type ModuleKey, type ScopeKey } from "./access-shared";

export const ACTIONS = ["view", "create", "edit", "validate"] as const;
export type PermissionAction = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "Voir",
  create: "Créer",
  edit: "Modifier",
  validate: "Valider",
};

export type ModulePermissions = Record<PermissionAction, boolean>;
export type PermissionSet = Record<ModuleKey, ModulePermissions>;
export type FlagSet = Record<FlagKey, boolean>;

/** Configuration complète d'un compte, telle qu'affichée et enregistrée par l'administration. */
export type AccessConfig = {
  perms: PermissionSet;
  scope: ScopeKey;
  flags: FlagSet;
  brandIds: string[];
  clientIds: string[];
};

export function noPermissions(): PermissionSet {
  return Object.fromEntries(
    MODULE_KEYS.map((m) => [m, { view: false, create: false, edit: false, validate: false }]),
  ) as PermissionSet;
}

export function noFlags(): FlagSet {
  return Object.fromEntries(FLAG_KEYS.map((f) => [f, false])) as FlagSet;
}

export function can(perms: PermissionSet, module: ModuleKey, action: PermissionAction = "view") {
  return perms[module]?.[action] === true;
}

/** Modules sur lesquels la personne a au moins le droit de lecture. */
export function visibleModules(perms: PermissionSet): ModuleKey[] {
  return MODULE_KEYS.filter((m) => can(perms, m, "view"));
}

/** Vrai dès qu'un module est visible : c'est la condition d'accès au Cockpit, à l'Action Center et à la Recherche. */
export function hasAnyModule(perms: PermissionSet): boolean {
  return visibleModules(perms).length > 0;
}

/** Le module Administration avec « Valider » : gestion des comptes, des droits, des seuils. */
export function isAdmin(perms: PermissionSet): boolean {
  return can(perms, "administration", "validate");
}

/**
 * Dépendances logiques : Créer, Modifier ou Valider impliquent Voir.
 * Appliquée par l'interface (cocher Créer coche Voir) et re-vérifiée avant enregistrement.
 */
export function normalizeMatrix(perms: PermissionSet): PermissionSet {
  const out = noPermissions();
  for (const m of MODULE_KEYS) {
    const p = perms[m] ?? out[m];
    const implied = p.create || p.edit || p.validate;
    out[m] = { view: p.view || implied, create: !!p.create, edit: !!p.edit, validate: !!p.validate };
  }
  return out;
}

/** Fusion additive : appliquer un modèle cumule ses cases avec la matrice courante, jamais d'écrasement. */
export function mergeMatrix(a: PermissionSet, b: PermissionSet): PermissionSet {
  const out = noPermissions();
  for (const m of MODULE_KEYS) {
    for (const act of ACTIONS) out[m][act] = a[m]?.[act] === true || b[m]?.[act] === true;
  }
  return normalizeMatrix(out);
}

export function mergeFlags(a: FlagSet, b: Partial<FlagSet>): FlagSet {
  const out = noFlags();
  for (const f of FLAG_KEYS) out[f] = a[f] === true || b[f] === true;
  return out;
}

/** Portée la plus large des deux (ALL > ASSIGNED > OWN) — cumuler des modèles ne restreint jamais. */
export function widestScope(a: ScopeKey, b: ScopeKey): ScopeKey {
  const rank: Record<ScopeKey, number> = { OWN: 0, ASSIGNED: 1, ALL: 2 };
  return rank[b] > rank[a] ? b : a;
}

export type PermissionRowLike = {
  module: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canValidate: boolean;
};

export function matrixFromRows(rows: PermissionRowLike[]): PermissionSet {
  const perms = noPermissions();
  for (const r of rows) {
    const key = r.module as ModuleKey;
    if (!(key in perms)) continue; // module retiré du catalogue mais encore en base
    perms[key] = { view: r.canView, create: r.canCreate, edit: r.canEdit, validate: r.canValidate };
  }
  return normalizeMatrix(perms);
}

export function rowsFromMatrix(perms: PermissionSet): { module: ModuleKey; canView: boolean; canCreate: boolean; canEdit: boolean; canValidate: boolean }[] {
  const n = normalizeMatrix(perms);
  return MODULE_KEYS.filter((m) => n[m].view).map((m) => ({
    module: m,
    canView: n[m].view,
    canCreate: n[m].create,
    canEdit: n[m].edit,
    canValidate: n[m].validate,
  }));
}

/** Deux configurations sont-elles identiques ? (sert au journal : on n'écrit pas un changement vide). */
export function sameMatrix(a: PermissionSet, b: PermissionSet): boolean {
  return MODULE_KEYS.every((m) => ACTIONS.every((act) => a[m]?.[act] === b[m]?.[act]));
}

/** Résumé lisible d'une matrice, pour le journal et le récapitulatif : `terrain: voir, créer`. */
export function describeMatrix(perms: PermissionSet): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of MODULE_KEYS) {
    const p = perms[m];
    if (!p?.view) continue;
    out[m] = ACTIONS.filter((a) => p[a]).map((a) => ACTION_LABELS[a].toLowerCase()).join(", ");
  }
  return out;
}

export type LegacyRole = "ADMIN" | "MARKETING" | "REGLEMENTAIRE" | "TRADE" | "ANIMATRICE" | "DELEGUE_MEDICAL" | "MANAGER_MEDICAL";

/**
 * Rôle « legacy » recalculé à partir de la matrice — colonne `users.role` conservée
 * en lecture seule jusqu'à vérification de tous les comptes en production. Aucune
 * décision d'accès ne doit s'appuyer dessus.
 */
export function legacyRoleFor(perms: PermissionSet, scope: ScopeKey): LegacyRole {
  if (isAdmin(perms)) return "ADMIN";
  if (can(perms, "medical", "validate")) return "MANAGER_MEDICAL";
  if (can(perms, "medical", "create") && scope === "OWN") return "DELEGUE_MEDICAL";
  if (can(perms, "terrain", "create") && scope === "OWN") return "ANIMATRICE";
  if (can(perms, "reglementaire", "edit")) return "REGLEMENTAIRE";
  if (can(perms, "marketing", "create") || can(perms, "budgets", "view")) return "MARKETING";
  return "TRADE";
}
