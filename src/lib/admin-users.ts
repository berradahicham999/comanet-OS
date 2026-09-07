import "server-only";
import { sql, eq, and } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  userPermissions,
  userScope,
  userFlags,
  userBrandAssignments,
  userClientAssignments,
  roleTemplates,
  roleTemplatePermissions,
  permissionAuditLogs,
} from "@/db/schema";
import { FLAG_KEYS, MODULE_KEYS, type ModuleKey, type ScopeKey } from "./access-shared";
import {
  describeMatrix,
  legacyRoleFor,
  matrixFromRows,
  noFlags,
  noPermissions,
  normalizeMatrix,
  rowsFromMatrix,
  sameMatrix,
  type AccessConfig,
  type FlagSet,
  type PermissionSet,
} from "./permissions-shared";
import { hashPassword } from "./auth";

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  city: string | null;
  jobTitle: string | null;
  scope: ScopeKey;
  modules: ModuleKey[];
  isAdmin: boolean;
};

/** Liste des comptes avec leurs modules actifs, pour l'écran d'administration. */
export async function listAdminUsers(filter: { q?: string; module?: ModuleKey; includeSuspended?: boolean } = {}): Promise<AdminUserRow[]> {
  const r = await db.execute<{
    id: string; name: string; email: string; active: boolean; last_login_at: string | null; created_at: string; city: string | null; job_title: string | null;
    scope: ScopeKey | null; modules: string[] | null; is_admin: boolean;
  }>(sql`
    select u.id, u.name, u.email, u.active, u.last_login_at, u.created_at, u.city, u.job_title,
           s.scope,
           (select array_agg(p.module order by p.module) from user_permissions p where p.user_id = u.id and p.can_view) as modules,
           exists (select 1 from user_permissions p where p.user_id = u.id and p.module = 'administration' and p.can_validate) as is_admin
    from users u
    left join user_scope s on s.user_id = u.id
    where true
      ${filter.includeSuspended ? sql`` : sql`and u.active`}
      ${filter.q ? sql`and (u.name ilike ${"%" + filter.q + "%"} or u.email ilike ${"%" + filter.q + "%"})` : sql``}
      ${filter.module ? sql`and exists (select 1 from user_permissions p where p.user_id = u.id and p.module = ${filter.module} and p.can_view)` : sql``}
    order by u.active desc, u.name`);
  return r.rows.map((x) => ({
    id: x.id,
    name: x.name,
    email: x.email,
    active: x.active,
    lastLoginAt: x.last_login_at ? new Date(x.last_login_at) : null,
    createdAt: new Date(x.created_at),
    city: x.city,
    jobTitle: x.job_title,
    scope: x.scope ?? "ALL",
    modules: (x.modules ?? []).filter((m): m is ModuleKey => (MODULE_KEYS as readonly string[]).includes(m)),
    isAdmin: x.is_admin,
  }));
}

export type UserConfig = AccessConfig & {
  user: { id: string; name: string; email: string; active: boolean; city: string | null; phone: string | null; jobTitle: string | null; lastLoginAt: Date | null; createdAt: Date };
};

/** Configuration complète d'un compte (profil + matrice + portée + interrupteurs + assignations). */
export async function getUserConfig(id: string): Promise<UserConfig | null> {
  const u = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!u) return null;
  const [perms, scope, flags, brandIds, clientIds] = await Promise.all([
    db.select().from(userPermissions).where(eq(userPermissions.userId, id)),
    db.select().from(userScope).where(eq(userScope.userId, id)),
    db.select().from(userFlags).where(eq(userFlags.userId, id)),
    db.select({ id: userBrandAssignments.brandId }).from(userBrandAssignments).where(eq(userBrandAssignments.userId, id)),
    db.select({ id: userClientAssignments.clientId }).from(userClientAssignments).where(eq(userClientAssignments.userId, id)),
  ]);
  const f = flags[0];
  return {
    user: { id: u.id, name: u.name, email: u.email, active: u.active, city: u.city, phone: u.phone, jobTitle: u.jobTitle, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt },
    perms: matrixFromRows(perms),
    scope: scope[0]?.scope ?? "ALL",
    flags: f
      ? { seeMargins: f.seeMargins, seeGlobalBudgets: f.seeGlobalBudgets, seeInternalCosts: f.seeInternalCosts, approveSpend: f.approveSpend, exportData: f.exportData, readActivityLog: f.readActivityLog }
      : noFlags(),
    brandIds: brandIds.map((b) => b.id),
    clientIds: clientIds.map((c) => c.id),
  };
}

export function emptyConfig(): AccessConfig {
  return { perms: noPermissions(), scope: "ALL", flags: noFlags(), brandIds: [], clientIds: [] };
}

/* ------------------------------------------------------------------ */
/* Garde-fous                                                          */
/* ------------------------------------------------------------------ */

export class AdminGuardError extends Error {}

/** Nombre de comptes actifs disposant du module Administration avec « Valider ». */
async function countActiveAdmins(excludeId?: string): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from users u
    join user_permissions p on p.user_id = u.id and p.module = 'administration' and p.can_validate
    where u.active ${excludeId ? sql`and u.id <> ${excludeId}::uuid` : sql``}`);
  return r.rows[0]?.n ?? 0;
}

/** Impossible de rétrograder ou de suspendre le dernier administrateur. */
async function assertNotLastAdmin(targetId: string, stillAdmin: boolean) {
  if (stillAdmin) return;
  const others = await countActiveAdmins(targetId);
  if (others === 0) throw new AdminGuardError("Impossible : ce compte est le dernier à disposer du module Administration. Donnez d'abord ce droit à un autre compte actif.");
}

/** Personne ne modifie ses propres droits, même administrateur. */
function assertNotSelf(actorId: string, targetId: string) {
  if (actorId === targetId) throw new AdminGuardError("Vous ne pouvez pas modifier vos propres droits. Demandez à un autre administrateur.");
}

/* ------------------------------------------------------------------ */
/* Journal                                                             */
/* ------------------------------------------------------------------ */

type Actor = { id: string; name: string };

async function logChange(actor: Actor, target: { id: string | null; name: string }, change: string, before: unknown, after: unknown) {
  await db.insert(permissionAuditLogs).values({
    actorId: actor.id,
    actorName: actor.name,
    targetUserId: target.id,
    targetUserName: target.name,
    change,
    before: before as Record<string, unknown> | null,
    after: after as Record<string, unknown> | null,
  });
}

function configSnapshot(c: AccessConfig) {
  return { modules: describeMatrix(c.perms), scope: c.scope, flags: FLAG_KEYS.filter((f) => c.flags[f]), brandIds: c.brandIds, clientIds: c.clientIds };
}

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

/** Écrit la configuration complète d'un compte (transaction), recalcule l'enum legacy, journalise le diff. */
export async function saveUserConfig(actor: Actor, targetId: string, input: AccessConfig, opts: { templateNames?: string[]; skipSelfGuard?: boolean } = {}) {
  if (!opts.skipSelfGuard) assertNotSelf(actor.id, targetId);
  const before = await getUserConfig(targetId);
  if (!before) throw new AdminGuardError("Compte introuvable.");
  const perms = normalizeMatrix(input.perms);
  await assertNotLastAdmin(targetId, perms.administration.validate || !before.user.active);
  const next: AccessConfig = { perms, scope: input.scope, flags: input.flags, brandIds: [...new Set(input.brandIds)], clientIds: [...new Set(input.clientIds)] };

  await db.transaction(async (tx) => {
    await tx.delete(userPermissions).where(eq(userPermissions.userId, targetId));
    const rows = rowsFromMatrix(perms).map((r) => ({ userId: targetId, ...r }));
    if (rows.length) await tx.insert(userPermissions).values(rows);
    await tx
      .insert(userScope)
      .values({ userId: targetId, scope: next.scope })
      .onConflictDoUpdate({ target: userScope.userId, set: { scope: next.scope, updatedAt: sql`now()` } });
    const f = next.flags;
    await tx
      .insert(userFlags)
      .values({ userId: targetId, ...f })
      .onConflictDoUpdate({ target: userFlags.userId, set: { ...f, updatedAt: sql`now()` } });
    await tx.delete(userBrandAssignments).where(eq(userBrandAssignments.userId, targetId));
    if (next.brandIds.length) await tx.insert(userBrandAssignments).values(next.brandIds.map((brandId) => ({ userId: targetId, brandId })));
    await tx.delete(userClientAssignments).where(eq(userClientAssignments.userId, targetId));
    if (next.clientIds.length) await tx.insert(userClientAssignments).values(next.clientIds.map((clientId) => ({ userId: targetId, clientId })));
    // Enum legacy, lecture seule : recalculée, jamais décisionnelle.
    await tx.update(users).set({ role: legacyRoleFor(perms, next.scope) }).where(eq(users.id, targetId));
  });

  const b = configSnapshot(before), a = configSnapshot(next);
  const changes: string[] = [];
  if (!sameMatrix(before.perms, perms)) changes.push("PERMISSIONS");
  if (before.scope !== next.scope) changes.push("SCOPE");
  if (FLAG_KEYS.some((k) => before.flags[k] !== next.flags[k])) changes.push("FLAGS");
  if (JSON.stringify([...before.brandIds].sort()) !== JSON.stringify([...next.brandIds].sort()) || JSON.stringify([...before.clientIds].sort()) !== JSON.stringify([...next.clientIds].sort())) changes.push("ASSIGNMENTS");
  if (opts.templateNames?.length) changes.unshift("TEMPLATE_APPLIED");
  if (changes.length) {
    await logChange(actor, { id: targetId, name: before.user.name }, changes.join("+"), b, { ...a, templates: opts.templateNames ?? undefined });
  }
  return next;
}

export type ProfileInput = { name: string; email: string; password?: string; city?: string | null; phone?: string | null; jobTitle?: string | null };

/** Crée un compte avec sa configuration initiale. */
export async function createUser(actor: Actor, profile: ProfileInput, config: AccessConfig, templateNames: string[] = []): Promise<string> {
  if (!profile.password) throw new AdminGuardError("Un mot de passe initial est requis.");
  const email = profile.email.trim().toLowerCase();
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) throw new AdminGuardError("Un compte existe déjà avec cet e-mail.");
  const perms = normalizeMatrix(config.perms);
  const [created] = await db
    .insert(users)
    .values({
      name: profile.name.trim(),
      email,
      passwordHash: await hashPassword(profile.password),
      role: legacyRoleFor(perms, config.scope),
      city: profile.city || null,
      phone: profile.phone || null,
      jobTitle: profile.jobTitle || null,
    })
    .returning({ id: users.id });
  await logChange(actor, { id: created.id, name: profile.name.trim() }, "CREATED", null, { email });
  await saveUserConfig(actor, created.id, { ...config, perms }, { templateNames, skipSelfGuard: true });
  return created.id;
}

/** Met à jour le profil (nom, e-mail, mot de passe, ville…) sans toucher aux droits. */
export async function updateProfile(actor: Actor, targetId: string, profile: ProfileInput) {
  const email = profile.email.trim().toLowerCase();
  const clash = await db.query.users.findFirst({ where: and(eq(users.email, email), sql`${users.id} <> ${targetId}::uuid`) });
  if (clash) throw new AdminGuardError("Un autre compte utilise déjà cet e-mail.");
  await db
    .update(users)
    .set({
      name: profile.name.trim(),
      email,
      city: profile.city || null,
      phone: profile.phone || null,
      jobTitle: profile.jobTitle || null,
      ...(profile.password ? { passwordHash: await hashPassword(profile.password) } : {}),
    })
    .where(eq(users.id, targetId));
}

/** Suspension : le compte ne peut plus se connecter ; ses données et sa configuration restent intactes. */
export async function setUserActive(actor: Actor, targetId: string, active: boolean) {
  assertNotSelf(actor.id, targetId);
  const u = await db.query.users.findFirst({ where: eq(users.id, targetId) });
  if (!u) throw new AdminGuardError("Compte introuvable.");
  if (!active) {
    const isAdminUser = (await db.execute<{ n: number }>(sql`select count(*)::int as n from user_permissions where user_id = ${targetId}::uuid and module = 'administration' and can_validate`)).rows[0].n > 0;
    if (isAdminUser) await assertNotLastAdmin(targetId, false);
  }
  await db.update(users).set({ active }).where(eq(users.id, targetId));
  await logChange(actor, { id: targetId, name: u.name }, active ? "REACTIVATE" : "SUSPEND", { active: u.active }, { active });
}

/** Duplique la configuration d'un compte vers un nouveau compte. */
export async function duplicateUser(actor: Actor, sourceId: string, profile: ProfileInput): Promise<string> {
  const src = await getUserConfig(sourceId);
  if (!src) throw new AdminGuardError("Compte source introuvable.");
  const id = await createUser(actor, profile, { perms: src.perms, scope: src.scope, flags: src.flags, brandIds: src.brandIds, clientIds: src.clientIds });
  await logChange(actor, { id, name: profile.name }, "DUPLICATED", null, { from: src.user.name });
  return id;
}

/* ------------------------------------------------------------------ */
/* Modèles de rôle                                                     */
/* ------------------------------------------------------------------ */

export type TemplateConfig = {
  id: string;
  name: string;
  description: string | null;
  homePath: string;
  sortOrder: number;
  scope: ScopeKey;
  flags: FlagSet;
  perms: PermissionSet;
};

export async function listTemplates(): Promise<TemplateConfig[]> {
  const [tpls, rows] = await Promise.all([
    db.select().from(roleTemplates).orderBy(roleTemplates.sortOrder, roleTemplates.name),
    db.select().from(roleTemplatePermissions),
  ]);
  return tpls.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    homePath: t.homePath,
    sortOrder: t.sortOrder,
    scope: t.scope,
    flags: { ...noFlags(), ...Object.fromEntries(Object.entries(t.flags).filter(([k]) => (FLAG_KEYS as readonly string[]).includes(k))) } as FlagSet,
    perms: matrixFromRows(rows.filter((r) => r.templateId === t.id)),
  }));
}

export async function getTemplate(id: string): Promise<TemplateConfig | null> {
  return (await listTemplates()).find((t) => t.id === id) ?? null;
}

export async function saveTemplate(actor: Actor, input: { id?: string; name: string; description?: string | null; homePath?: string; scope: ScopeKey; flags: FlagSet; perms: PermissionSet }): Promise<string> {
  const perms = normalizeMatrix(input.perms);
  const flags = Object.fromEntries(FLAG_KEYS.map((k) => [k, !!input.flags[k]]));
  let id = input.id;
  await db.transaction(async (tx) => {
    if (id) {
      await tx.update(roleTemplates).set({ name: input.name.trim(), description: input.description || null, homePath: input.homePath || "/", scope: input.scope, flags, updatedAt: sql`now()` }).where(eq(roleTemplates.id, id));
      await tx.delete(roleTemplatePermissions).where(eq(roleTemplatePermissions.templateId, id));
    } else {
      const max = (await tx.execute<{ m: number }>(sql`select coalesce(max(sort_order), 0)::int as m from role_templates`)).rows[0].m;
      const [c] = await tx.insert(roleTemplates).values({ name: input.name.trim(), description: input.description || null, homePath: input.homePath || "/", scope: input.scope, flags, sortOrder: max + 10 }).returning({ id: roleTemplates.id });
      id = c.id;
    }
    const rows = rowsFromMatrix(perms).map((r) => ({ templateId: id!, ...r }));
    if (rows.length) await tx.insert(roleTemplatePermissions).values(rows);
  });
  await logChange(actor, { id: null, name: `Modèle « ${input.name.trim()} »` }, "TEMPLATE_EDITED", null, { modules: describeMatrix(perms), scope: input.scope, flags: FLAG_KEYS.filter((k) => flags[k]) });
  return id!;
}

export async function deleteTemplate(actor: Actor, id: string) {
  const all = await db.select({ id: roleTemplates.id, name: roleTemplates.name }).from(roleTemplates);
  if (all.length <= 1) throw new AdminGuardError("Impossible de supprimer le dernier modèle.");
  const t = all.find((x) => x.id === id);
  if (!t) return;
  await db.delete(roleTemplates).where(eq(roleTemplates.id, id));
  await logChange(actor, { id: null, name: `Modèle « ${t.name} »` }, "TEMPLATE_DELETED", null, null);
}

/* ------------------------------------------------------------------ */
/* Journal et récapitulatif                                            */
/* ------------------------------------------------------------------ */

export async function listPermissionAudit(opts: { targetId?: string; limit?: number } = {}) {
  const rows = await db.execute<{
    id: string; actor_name: string; target_user_id: string | null; target_user_name: string; change: string; before: unknown; after: unknown; created_at: string;
  }>(sql`
    select id, actor_name, target_user_id, target_user_name, change, before, after, created_at
    from permission_audit_logs
    where true ${opts.targetId ? sql`and target_user_id = ${opts.targetId}::uuid` : sql``}
    order by created_at desc
    limit ${opts.limit ?? 200}`);
  return rows.rows.map((r) => ({ ...r, createdAt: new Date(r.created_at) }));
}

/** Toutes les configurations, pour le récapitulatif imprimable. */
export async function allUserConfigs(): Promise<UserConfig[]> {
  const ids = await db.select({ id: users.id }).from(users).orderBy(users.active, users.name);
  const out: UserConfig[] = [];
  for (const { id } of ids) {
    const c = await getUserConfig(id);
    if (c) out.push(c);
  }
  return out.sort((a, b) => Number(b.user.active) - Number(a.user.active) || a.user.name.localeCompare(b.user.name, "fr"));
}

/** Marques et clients disponibles pour l'assignation de périmètre. */
export async function assignmentOptions() {
  const [brands, clients] = await Promise.all([
    db.execute<{ id: string; name: string; active: boolean }>(sql`select id, name, active from brands order by active desc, name`),
    db.execute<{ id: string; name: string; city: string | null }>(sql`select id, name, city from clients where active order by name limit 2000`),
  ]);
  return { brands: brands.rows, clients: clients.rows };
}

