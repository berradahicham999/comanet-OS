import "server-only";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getAccess, requireAccess, isAdmin, type Access } from "@/lib/access";

/**
 * Médical v2 — qui voit les heures et positions des visites (décision d'Hicham, 03/10/2026) :
 * les administrateurs (direction) voient toutes les déléguées ; un manager voit les déléguées dont il
 * est le `manager_id` sur la fiche `medical_delegates`. Le droit « Valider » sur Médical ne suffit pas.
 * Une déléguée ne voit jamais les positions, ni les siennes ni celles des autres.
 */
export type FieldScope = { all: boolean; delegateIds: string[] };

export async function fieldScopeOf(access: Access | null): Promise<FieldScope> {
  if (!access) return { all: false, delegateIds: [] };
  return fieldScopeOfUser(access.user.id, isAdmin(access.perms));
}

/** Même portée, à partir d'un identifiant (copilote IA, scripts). */
export async function fieldScopeOfUser(userId: string, admin: boolean): Promise<FieldScope> {
  if (admin) return { all: true, delegateIds: [] };
  const r = await db.execute<{ user_id: string }>(sql`select user_id from medical_delegates where manager_id = ${userId}::uuid`);
  return { all: false, delegateIds: r.rows.map((x) => x.user_id) };
}

export async function fieldScope(): Promise<FieldScope> {
  return fieldScopeOf(await getAccess());
}

export function inFieldScope(scope: FieldScope, delegateId: string | null | undefined): boolean {
  return scope.all || (!!delegateId && scope.delegateIds.includes(delegateId));
}

export function hasFieldControl(scope: FieldScope): boolean {
  return scope.all || scope.delegateIds.length > 0;
}

/** Garde des pages de contrôle terrain : renvoie vers le dashboard médical sans droit. */
export async function requireFieldControl() {
  const user = await requireAccess("medical");
  const scope = await fieldScope();
  if (!hasFieldControl(scope)) redirect("/medical");
  return { user, scope };
}
