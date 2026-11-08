import type { ScopeKey } from "@/lib/access-shared";
import { can, isAdmin, type PermissionSet } from "@/lib/permissions-shared";

/**
 * Le métier d'une personne sur le téléphone, déduit de ses droits et jamais de `users.role` : c'est ce qui choisit
 * ses onglets et son écran d'accueil. Pure, partagée client et serveur (`tests/mobile-socle.test.ts`).
 */
export type Persona = "DIRECTION" | "ANIMATRICE" | "DELEGUE" | "COMMERCIAL" | "AUTRE";

export function personaOf(perms: PermissionSet, scope: ScopeKey): Persona {
  if (isAdmin(perms)) return "DIRECTION";
  if (scope === "OWN" && can(perms, "terrain", "create")) return "ANIMATRICE";
  if (scope === "OWN" && can(perms, "medical", "create")) return "DELEGUE";
  if (can(perms, "clients", "create") && can(perms, "commandes", "create")) return "COMMERCIAL";
  return "AUTRE";
}
