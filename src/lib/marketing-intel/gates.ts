/** Portes d'accès de la couche Marketing Intelligence, déduites de la matrice de droits (logique pure). */
import { can, isAdmin, type PermissionSet } from "@/lib/permissions-shared";
import type { Gates } from "./types";

/** Un bloc hors droits est renvoyé « non accessible », jamais deviné ; un administrateur voit tout. */
export function gatesFor(perms: PermissionSet, seeInternalCosts: boolean): Gates {
  const admin = isAdmin(perms);
  return {
    stock: admin || can(perms, "stock", "view"),
    budgets: admin || can(perms, "budgets", "view"),
    marketing: admin || can(perms, "marketing", "view"),
    internalCosts: admin || seeInternalCosts,
  };
}
