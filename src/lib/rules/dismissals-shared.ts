import type { TaskPriority } from "@/db/schema";
import { can, isAdmin, type PermissionSet } from "@/lib/permissions-shared";
import { CATEGORY_MODULES, PRIORITY_ORDER, type RecCategory } from "./types";

/** Durée par défaut d'une recommandation écartée : elle revient ensuite si la situation n'a pas changé. */
export const DISMISS_DAYS = 30;

export type Dismissal = { priority: TaskPriority; until: Date; by: string; reason: string | null; at: Date };

/**
 * Une recommandation écartée reste masquée jusqu'à `until`, sauf si sa priorité s'est aggravée depuis
 * (ex. couverture passée de « Haute » à « Critique ») : la réponse connue ne vaut plus.
 */
export function isDismissed(d: Dismissal | undefined, currentPriority: TaskPriority, now: Date): boolean {
  if (!d) return false;
  if (d.until.getTime() <= now.getTime()) return false;
  return PRIORITY_ORDER[currentPriority] >= PRIORITY_ORDER[d.priority];
}

/** Écarter une recommandation la masque pour tout le monde : « Modifier » sur un module de sa catégorie, ou administrateur. */
export function canDismiss(perms: PermissionSet, category: RecCategory): boolean {
  return isAdmin(perms) || (CATEGORY_MODULES[category] ?? []).some((m) => can(perms, m, "edit"));
}
