import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getAccess, can, isAdmin, type Access } from "@/lib/access";
import type { CrmViewer } from "./access-shared";

export * from "./access-shared";

/**
 * CRM commercial — qui voit les visites de qui (même logique que `src/lib/medical/field-access.ts`) :
 * - la direction (administrateurs) et « Valider » sur Clients voient le suivi de toutes les commerciales ;
 * - un manager (`users.manager_id`) voit son équipe ;
 * - une commerciale voit les siennes.
 * Les heures sont visibles de qui voit la visite ; les **positions GPS** seulement des administrateurs et du
 * manager de la commerciale, jamais de « Valider » seul ni de la commerciale elle-même.
 */
export async function crmViewerOf(access: Access | null): Promise<CrmViewer | null> {
  if (!access) return null;
  return crmViewerFor(access.user.id, access.user.name, access.perms);
}

/** Même portée à partir d'un identifiant et d'une matrice (copilote IA, scripts). */
export async function crmViewerFor(userId: string, name: string, perms: Access["perms"]): Promise<CrmViewer> {
  const admin = isAdmin(perms);
  const r = await db.execute<{ id: string }>(sql`select id from users where manager_id = ${userId}::uuid and active`);
  return {
    userId,
    name,
    admin,
    all: admin || can(perms, "clients", "validate"),
    managedIds: r.rows.map((x) => x.id),
    canCreate: can(perms, "clients", "create"),
    canEdit: can(perms, "clients", "edit"),
    canValidate: can(perms, "clients", "validate"),
  };
}

export async function crmViewer(): Promise<CrmViewer | null> {
  return crmViewerOf(await getAccess());
}

/** Restriction SQL des visites visibles (alias de table `cv`). */
export function visibleUsersSql(v: CrmViewer) {
  if (v.all) return sql`true`;
  const ids = [v.userId, ...v.managedIds];
  return sql`cv.user_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`;
}
