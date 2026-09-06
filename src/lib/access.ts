import "server-only";
import type { SessionUser } from "./auth";
import { requireView } from "./permissions";
import type { ModuleKey } from "./access-shared";

export { MODULE_KEYS, MODULE_LABELS, MODULE_GROUPS, ROLE_LABELS, type ModuleKey } from "./access-shared";
export { getUserPermissions, getUserRoles, homeForUser, requirePermission, can } from "./permissions";

/**
 * Garde de lecture d'une page. Conservée sous ce nom : c'est le point d'entrée
 * appelé en tête de chaque page et de chaque action de l'application.
 */
export async function requireAccess(module: ModuleKey): Promise<SessionUser> {
  return requireView(module);
}
