import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { ModuleKey } from "./access-shared";
import type { PermissionAction } from "./permissions-shared";

export const listUsers = cache(async () => {
  return db.select({ id: users.id, name: users.name, role: users.role, email: users.email, active: users.active }).from(users).where(eq(users.active, true)).orderBy(asc(users.name));
});

export const listBrands = cache(async () => {
  return db.query.brands.findMany({ orderBy: (b, { asc }) => [asc(b.name)] });
});

const ACTION_COL: Record<PermissionAction, string> = { view: "can_view", create: "can_create", edit: "can_edit", validate: "can_validate" };

/**
 * Comptes actifs disposant d'un droit sur un module. Remplace les anciens filtres
 * `users.role = 'ANIMATRICE'` : une animatrice est une personne qui peut créer
 * sur Terrain et ne voit que ses données, quel que soit le reste de sa matrice.
 */
export async function usersWithPermission(module: ModuleKey, action: PermissionAction = "view", opts: { ownOnly?: boolean } = {}) {
  const r = await db.execute<{ id: string; name: string; email: string; city: string | null }>(sql`
    select u.id, u.name, u.email, u.city
    from users u
    join user_permissions p on p.user_id = u.id and p.module = ${module} and p.${sql.raw(ACTION_COL[action])}
    ${opts.ownOnly ? sql`join user_scope s on s.user_id = u.id and s.scope = 'OWN'` : sql``}
    where u.active
    order by u.name`);
  return r.rows;
}

/** Les animatrices : saisie terrain sur leurs propres animations. */
export const listAnimatrices = cache(() => usersWithPermission("terrain", "create", { ownOnly: true }));

/** Les délégués médicaux : saisie de visites sur leurs propres prescripteurs. */
export const listDelegates = cache(() => usersWithPermission("medical", "create", { ownOnly: true }));

/**
 * Fragments SQL — définition unique de « qui est animatrice » et « qui est délégué »
 * pour les requêtes qui listent la population (scores, stocks d'échantillons, imports).
 * L'alias de la table `users` doit être `u`.
 */
export const ANIMATRICE_SQL = sql`exists (select 1 from user_permissions p where p.user_id = u.id and p.module = 'terrain' and p.can_create)
  and exists (select 1 from user_scope s where s.user_id = u.id and s.scope = 'OWN')`;
export const DELEGATE_SQL = sql`(exists (select 1 from user_permissions p where p.user_id = u.id and p.module = 'medical' and p.can_create)
  and exists (select 1 from user_scope s where s.user_id = u.id and s.scope = 'OWN')
  or exists (select 1 from medical_delegates md where md.user_id = u.id and md.active))`;
