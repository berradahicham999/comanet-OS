import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/db";
import { requireUser, getSession, type SessionUser } from "./auth";
import { MODULE_LABELS, MODULE_KEYS, FLAG_KEYS, PREVIEW_COOKIE, type FlagKey, type ModuleKey, type ScopeKey, FLAG_LABELS } from "./access-shared";
import {
  can,
  isAdmin,
  hasAnyModule,
  matrixFromRows,
  noFlags,
  noPermissions,
  ACTION_LABELS,
  type FlagSet,
  type PermissionAction,
  type PermissionSet,
} from "./permissions-shared";

export { can, noPermissions, isAdmin, hasAnyModule, type PermissionAction, type PermissionSet } from "./permissions-shared";

/* ------------------------------------------------------------------ */
/* Résolution                                                          */
/* ------------------------------------------------------------------ */

export type ResolvedAccess = {
  perms: PermissionSet;
  scope: ScopeKey;
  flags: FlagSet;
  brandIds: string[];
  clientIds: string[];
  /** Page d'accueil déduite des droits. */
  home: string;
};

/** Contexte d'accès de la requête : la personne connectée, ses droits, et l'éventuelle prévisualisation en cours. */
export type Access = ResolvedAccess & {
  /** La personne dont les droits s'appliquent (en prévisualisation : le compte simulé). */
  user: SessionUser;
  /** Renseigné quand un administrateur prévisualise un autre compte. */
  preview: { adminId: string; adminName: string } | null;
};

/** Page d'accueil : la saisie pour qui ne voit que ses données, le cockpit sinon. */
export function homeFor(perms: PermissionSet, scope: ScopeKey): string {
  if (scope === "OWN") {
    if (can(perms, "terrain", "create")) return "/terrain/saisie";
    if (can(perms, "medical", "create")) return "/medical/visites/saisie";
  }
  if (hasAnyModule(perms)) return "/";
  return "/taches";
}

/**
 * Repli tant que la migration 0012 n'est pas appliquée (les tables `user_permissions`,
 * `user_scope`, `user_flags` n'existent pas encore) : les droits sont déduits de l'ancien
 * enum `users.role`, avec la même correspondance que la migration. Sans ce repli, personne
 * ne pourrait se connecter pour appliquer la migration depuis /installation.
 */
function legacyAccessFor(role: SessionUser["role"]): ResolvedAccess {
  const perms = noPermissions();
  const all = (m: ModuleKey, validate = true) => { perms[m] = { view: true, create: true, edit: true, validate }; };
  const view = (m: ModuleKey) => { perms[m] = { view: true, create: false, edit: false, validate: false }; };
  let scope: ScopeKey = "ALL";
  const flags = noFlags();
  switch (role) {
    case "ADMIN":
      for (const m of MODULE_KEYS) all(m);
      for (const f of FLAG_KEYS) flags[f] = true;
      break;
    case "MARKETING":
      for (const m of ["ventes", "produits", "stock", "marketing", "influence", "budgets", "assets", "taches", "rapports"] as ModuleKey[]) all(m, false);
      flags.seeGlobalBudgets = flags.seeInternalCosts = flags.exportData = true;
      break;
    case "TRADE":
      for (const m of ["ventes", "clients", "produits", "stock", "terrain", "taches", "rapports"] as ModuleKey[]) all(m, m === "terrain");
      flags.seeMargins = flags.exportData = true;
      break;
    case "REGLEMENTAIRE":
      for (const m of ["produits", "reglementaire", "taches"] as ModuleKey[]) all(m, false);
      flags.exportData = true;
      break;
    case "ANIMATRICE":
      all("terrain", false); all("taches", false); view("produits");
      scope = "OWN";
      break;
    case "DELEGUE_MEDICAL":
      all("medical", false); all("taches", false); view("produits");
      scope = "OWN";
      break;
    case "MANAGER_MEDICAL":
      all("medical"); all("taches");
      break;
  }
  return { perms, scope, flags, brandIds: [], clientIds: [], home: homeFor(perms, scope) };
}

/** Table absente : la migration 0012 n'est pas encore appliquée. */
function isMissingTable(e: unknown) {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "42P01";
}

/** Droits d'une personne, lus en base. Utilisé pour la requête courante, la prévisualisation et l'administration. */
export async function resolveAccessFor(userId: string, legacyRole?: SessionUser["role"]): Promise<ResolvedAccess> {
  try {
    return await resolveFromTables(userId);
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    const role = legacyRole ?? (await db.execute<{ role: SessionUser["role"] }>(sql`select role from users where id = ${userId}::uuid`)).rows[0]?.role;
    return legacyAccessFor(role ?? "TRADE");
  }
}

async function resolveFromTables(userId: string): Promise<ResolvedAccess> {
  const [permRows, scopeRows, flagRows, brandRows, clientRows] = await Promise.all([
    db.execute<{ module: string; can_view: boolean; can_create: boolean; can_edit: boolean; can_validate: boolean }>(
      sql`select module, can_view, can_create, can_edit, can_validate from user_permissions where user_id = ${userId}::uuid`,
    ),
    db.execute<{ scope: ScopeKey }>(sql`select scope from user_scope where user_id = ${userId}::uuid`),
    db.execute<Record<string, boolean>>(
      sql`select see_margins, see_global_budgets, see_internal_costs, approve_spend, export_data, read_activity_log from user_flags where user_id = ${userId}::uuid`,
    ),
    db.execute<{ brand_id: string }>(sql`select brand_id from user_brand_assignments where user_id = ${userId}::uuid`),
    db.execute<{ client_id: string }>(sql`select client_id from user_client_assignments where user_id = ${userId}::uuid`),
  ]);
  const perms = matrixFromRows(
    permRows.rows.map((r) => ({ module: r.module, canView: r.can_view, canCreate: r.can_create, canEdit: r.can_edit, canValidate: r.can_validate })),
  );
  const scope: ScopeKey = scopeRows.rows[0]?.scope ?? "ALL";
  const f = flagRows.rows[0];
  const flags: FlagSet = f
    ? {
        seeMargins: !!f.see_margins,
        seeGlobalBudgets: !!f.see_global_budgets,
        seeInternalCosts: !!f.see_internal_costs,
        approveSpend: !!f.approve_spend,
        exportData: !!f.export_data,
        readActivityLog: !!f.read_activity_log,
      }
    : noFlags();
  return {
    perms,
    scope,
    flags,
    brandIds: brandRows.rows.map((r) => r.brand_id),
    clientIds: clientRows.rows.map((r) => r.client_id),
    home: homeFor(perms, scope),
  };
}

/* ------------------------------------------------------------------ */
/* Prévisualisation « en tant que »                                    */
/* ------------------------------------------------------------------ */

export { PREVIEW_COOKIE };

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET manquant ou trop court");
  return new TextEncoder().encode(s);
}

/** Jeton de prévisualisation : lié à l'administrateur ET au compte simulé, deux heures maximum. */
export async function createPreviewToken(adminId: string, targetId: string) {
  return new SignJWT({ target: targetId }).setProtectedHeader({ alg: "HS256" }).setSubject(adminId).setIssuedAt().setExpirationTime("2h").sign(secret());
}

async function readPreview(admin: SessionUser): Promise<{ targetId: string } | null> {
  const jar = await cookies();
  const token = jar.get(PREVIEW_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.sub !== admin.id || typeof payload.target !== "string") return null;
    return { targetId: payload.target };
  } catch {
    return null;
  }
}

/**
 * Contexte d'accès de la requête, résolu une seule fois. En prévisualisation, seul un
 * administrateur peut simuler un autre compte : sinon le cookie est ignoré.
 */
export const getAccess = cache(async (): Promise<Access | null> => {
  const session = await getSession();
  if (!session) return null;
  const own = await resolveAccessFor(session.id, session.role);
  if (isAdmin(own.perms)) {
    const preview = await readPreview(session);
    if (preview && preview.targetId !== session.id) {
      const target = await db.execute<{ id: string; name: string; email: string; role: SessionUser["role"] }>(
        sql`select id, name, email, role from users where id = ${preview.targetId}::uuid`,
      );
      const t = target.rows[0];
      if (t) {
        const resolved = await resolveAccessFor(t.id);
        return { ...resolved, user: { id: t.id, name: t.name, email: t.email, role: t.role }, preview: { adminId: session.id, adminName: session.name } };
      }
    }
  }
  return { ...own, user: session, preview: null };
});

/** Contexte d'accès obligatoire : redirige vers /login sans session. */
export async function requireAccessContext(): Promise<Access> {
  const a = await getAccess();
  if (!a) redirect("/login");
  return a;
}

/** Droits de l'utilisateur courant (compat : nombreuses pages l'appellent directement). */
export const getUserPermissions = cache(async (): Promise<PermissionSet> => {
  const a = await getAccess();
  return a ? a.perms : noPermissions();
});

export async function homeForUser(): Promise<string> {
  const a = await getAccess();
  return a?.home ?? "/";
}

/** Vrai si la requête est un appel de server action (en-tête `Next-Action`). */
async function isMutationRequest() {
  try {
    const h = await headers();
    return h.has("next-action");
  } catch {
    return false;
  }
}

class PreviewReadOnlyError extends Error {
  constructor() {
    super("Prévisualisation : lecture seule. Quittez la prévisualisation pour agir.");
    this.name = "PreviewReadOnlyError";
  }
}

/**
 * Garde des pages : renvoie vers la page d'accueil de la personne si elle n'a pas
 * le droit de voir le module. Sur une server action en prévisualisation, lève une erreur.
 */
export async function requireView(module: ModuleKey): Promise<SessionUser> {
  const a = await requireAccessContext();
  if (a.preview && (await isMutationRequest())) throw new PreviewReadOnlyError();
  if (!can(a.perms, module, "view")) redirect(a.home);
  return a.user;
}

/** Cockpit, Action Center, Recherche : accessibles dès qu'un module est visible. */
export async function requireAnyModule(): Promise<SessionUser> {
  const a = await requireAccessContext();
  if (a.preview && (await isMutationRequest())) throw new PreviewReadOnlyError();
  if (!hasAnyModule(a.perms)) redirect(a.home);
  return a.user;
}

/**
 * Garde des server actions et des routes : lève une erreur explicite.
 * Une redirection n'aurait pas de sens depuis une action mutante.
 */
export async function requirePermission(module: ModuleKey, action: PermissionAction): Promise<SessionUser> {
  const a = await requireAccessContext();
  if (a.preview && action !== "view") throw new PreviewReadOnlyError();
  if (!can(a.perms, module, action)) {
    throw new Error(`Accès refusé : vous n'avez pas le droit « ${ACTION_LABELS[action]} » sur le module ${MODULE_LABELS[module]}.`);
  }
  return a.user;
}

/** Interrupteur transverse obligatoire (export, validation d'une dépense, journal…). */
export async function requireFlag(flag: FlagKey): Promise<SessionUser> {
  const a = await requireAccessContext();
  if (a.preview && flag !== "readActivityLog") throw new PreviewReadOnlyError();
  if (!a.flags[flag]) throw new Error(`Accès refusé : le droit « ${FLAG_LABELS[flag]} » n'est pas activé sur votre compte.`);
  return a.user;
}

/** Module Administration avec « Valider » : gestion des comptes, seuils, connexions, suppressions définitives. */
export async function requireAdmin(): Promise<SessionUser> {
  return requirePermission("administration", "validate");
}

/** Session courante vérifiée, sans exigence de module (pages utilitaires). */
export async function requireSession(): Promise<SessionUser> {
  return requireUser();
}
