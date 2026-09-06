/**
 * Types et helpers de permissions utilisables côté client.
 * La résolution (lecture en base) vit dans `src/lib/permissions.ts`, côté serveur.
 */
import { MODULE_KEYS, type ModuleKey } from "./access-shared";

export const ACTIONS = ["view", "create", "edit", "delete", "export", "admin"] as const;
export type PermissionAction = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "Voir",
  create: "Créer",
  edit: "Modifier",
  delete: "Supprimer",
  export: "Exporter",
  admin: "Administrer",
};

export type ModulePermissions = Record<PermissionAction, boolean>;
export type PermissionSet = Record<ModuleKey, ModulePermissions>;

export function noPermissions(): PermissionSet {
  return Object.fromEntries(
    MODULE_KEYS.map((m) => [m, { view: false, create: false, edit: false, delete: false, export: false, admin: false }]),
  ) as PermissionSet;
}

export function can(perms: PermissionSet, module: ModuleKey, action: PermissionAction = "view") {
  return perms[module]?.[action] === true;
}

/** Modules sur lesquels la personne a au moins le droit de lecture. */
export function visibleModules(perms: PermissionSet): ModuleKey[] {
  return MODULE_KEYS.filter((m) => can(perms, m, "view"));
}
