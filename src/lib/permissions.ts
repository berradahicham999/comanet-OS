import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser, getSession, type SessionUser } from "./auth";
import { MODULE_LABELS, type ModuleKey } from "./access-shared";
import {
  can,
  noPermissions,
  type PermissionAction,
  type PermissionSet,
} from "./permissions-shared";

export { can, noPermissions, type PermissionAction, type PermissionSet } from "./permissions-shared";

/**
 * Droits d'une personne : union des permissions de tous ses rôles actifs
 * (la plus permissive gagne). Un utilisateur sans rôle explicite retombe sur
 * le rôle système correspondant à son enum `users.role` — cas des comptes
 * créés avant ce chantier ou par un script.
 */
async function resolvePermissions(user: SessionUser): Promise<PermissionSet> {
  const rows = await db.execute<{
    module: string;
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
    can_export: boolean;
    can_admin: boolean;
  }>(sql`
    select rp.module,
           bool_or(rp.can_view)   as can_view,
           bool_or(rp.can_create) as can_create,
           bool_or(rp.can_edit)   as can_edit,
           bool_or(rp.can_delete) as can_delete,
           bool_or(rp.can_export) as can_export,
           bool_or(rp.can_admin)  as can_admin
    from role_permissions rp
    join roles r on r.id = rp.role_id and r.active
    where r.id in (select role_id from user_roles where user_id = ${user.id})
       or (
         not exists (select 1 from user_roles where user_id = ${user.id})
         and r.key = ${user.role}
       )
    group by rp.module
  `);

  const perms = noPermissions();
  for (const row of rows.rows) {
    const key = row.module as ModuleKey;
    if (!(key in perms)) continue; // module retiré du catalogue mais encore en base
    perms[key] = {
      view: row.can_view,
      create: row.can_create,
      edit: row.can_edit,
      delete: row.can_delete,
      export: row.can_export,
      admin: row.can_admin,
    };
  }
  return perms;
}

/** Droits de l'utilisateur courant, résolus une seule fois par requête. */
export const getUserPermissions = cache(async (): Promise<PermissionSet> => {
  const user = await getSession();
  return user ? resolvePermissions(user) : noPermissions();
});

/** Rôles actifs de l'utilisateur courant, du plus prioritaire au moins prioritaire. */
export const getUserRoles = cache(async () => {
  const user = await getSession();
  if (!user) return [];
  const rows = await db.execute<{ id: string; key: string; name: string; home_path: string; priority: number }>(sql`
    select r.id, r.key, r.name, r.home_path, r.priority
    from roles r
    where r.active
      and (
        r.id in (select role_id from user_roles where user_id = ${user.id})
        or (not exists (select 1 from user_roles where user_id = ${user.id}) and r.key = ${user.role})
      )
    order by r.priority desc, r.name
  `);
  return rows.rows;
});

/** Page d'accueil : celle du rôle le plus prioritaire de la personne. */
export async function homeForUser(): Promise<string> {
  const roles = await getUserRoles();
  return roles[0]?.home_path || "/";
}

/**
 * Garde des pages : renvoie vers la page d'accueil de la personne si elle n'a pas
 * le droit demandé. `requireAccess` (src/lib/access.ts) en est l'alias en lecture.
 */
export async function requireView(module: ModuleKey): Promise<SessionUser> {
  const user = await requireUser();
  const perms = await getUserPermissions();
  if (!can(perms, module, "view")) redirect(await homeForUser());
  return user;
}

/**
 * Garde des server actions et des routes : lève une erreur explicite.
 * Une redirection n'aurait pas de sens depuis une action mutante.
 */
export async function requirePermission(module: ModuleKey, action: PermissionAction): Promise<SessionUser> {
  const user = await requireUser();
  const perms = await getUserPermissions();
  if (!can(perms, module, action)) {
    throw new Error(
      `Accès refusé : vous n'avez pas le droit « ${actionLabel(action)} » sur le module ${MODULE_LABELS[module]}.`,
    );
  }
  return user;
}

function actionLabel(action: PermissionAction) {
  return { view: "voir", create: "créer", edit: "modifier", delete: "supprimer", export: "exporter", admin: "administrer" }[
    action
  ];
}
