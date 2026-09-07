import "server-only";
import type { SessionUser } from "./auth";
import { requireView, getAccess, requireAccessContext } from "./permissions";
import type { ModuleKey } from "./access-shared";

export { MODULE_KEYS, MODULE_LABELS, MODULE_GROUPS, type ModuleKey } from "./access-shared";
export {
  getAccess,
  requireAccessContext,
  getUserPermissions,
  homeForUser,
  requirePermission,
  requireAnyModule,
  requireFlag,
  requireAdmin,
  can,
  isAdmin,
  type Access,
} from "./permissions";

/**
 * Garde de lecture d'une page. Conservée sous ce nom : c'est le point d'entrée
 * appelé en tête de chaque page et de chaque action de l'application.
 */
export async function requireAccess(module: ModuleKey): Promise<SessionUser> {
  return requireView(module);
}

/* ------------------------------------------------------------------ */
/* Portée des données — helpers pour les pages et les actions          */
/* ------------------------------------------------------------------ */

/**
 * Portée « ses propres données » : renvoie l'identifiant à imposer comme propriétaire
 * (animatrice, délégué, responsable, assigné), ou `undefined` si la personne voit plus large.
 */
export async function ownerFilter(): Promise<string | undefined> {
  const a = await getAccess();
  return a?.scope === "OWN" ? a.user.id : undefined;
}

/** Vrai si la personne ne voit que ses propres données. */
export async function isOwnOnly(): Promise<boolean> {
  const a = await getAccess();
  return a?.scope === "OWN";
}

/**
 * Portée « marques et clients assignés » : marques à imposer, ou `null` sans restriction.
 * Une portée OWN sur un module sans propriétaire est traitée comme ASSIGNED (décision d'Hicham).
 */
export async function brandFilter(): Promise<string[] | null> {
  const a = await getAccess();
  if (!a || a.scope === "ALL") return null;
  return a.brandIds;
}

export async function clientFilter(): Promise<string[] | null> {
  const a = await getAccess();
  if (!a || a.scope === "ALL") return null;
  return a.clientIds;
}

/** Une marque est-elle dans le périmètre de la personne ? */
export async function brandInScope(brandId: string | null | undefined): Promise<boolean> {
  const f = await brandFilter();
  return f === null || (!!brandId && f.includes(brandId));
}

export async function clientInScope(clientId: string | null | undefined): Promise<boolean> {
  const f = await clientFilter();
  return f === null || (!!clientId && f.includes(clientId));
}

/** Interrupteur transverse (lecture, pour masquer une information). */
export async function hasFlag(flag: keyof Awaited<ReturnType<typeof requireAccessContext>>["flags"]): Promise<boolean> {
  const a = await getAccess();
  return a?.flags[flag] === true;
}

/** La personne a-t-elle ce droit ? (lecture, pour conditionner un bouton ou un bloc). */
export async function canDo(module: ModuleKey, action: "view" | "create" | "edit" | "validate" = "view"): Promise<boolean> {
  const a = await getAccess();
  return a?.perms[module]?.[action] === true;
}
