import "server-only";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getAccess, requireAccessContext, requireView, requirePermission, can, isAdmin, type PermissionAction } from "@/lib/permissions";
import { MODULE_LABELS, type ModuleKey } from "@/lib/access-shared";
import { canValidateBrand } from "@/lib/content/workflow";
import type { SessionUser } from "@/lib/auth";
import { pgArray } from "@/lib/sql-array";

/**
 * Droits du module Activations — décision d'Hicham : pas de quinzième module.
 *  - Voir / Créer / Modifier : module « Marketing digital » (équipe marketing) OU
 *    « Clients et trade marketing » (trade) — le premier qui accorde le droit.
 *  - Valider (passer une activation au statut validé, donc engager le budget) : un
 *    administrateur, l'interrupteur « Valider une dépense », ou un validateur de la marque
 *    (`brand_validators`, partagé avec le planning éditorial).
 *  - Portée OWN : ses activations (pilote, créateur ou contributeur) et celles de ses clients assignés.
 */
export const ACTIVATION_MODULES: ModuleKey[] = ["marketing", "clients"];

/** Garde d'une page : redirige si aucun des deux modules n'est visible. */
export async function requireActivationAccess(): Promise<SessionUser> {
  const a = await requireAccessContext();
  const m = ACTIVATION_MODULES.find((x) => can(a.perms, x, "view"));
  if (!m) redirect(a.home);
  return requireView(m);
}

/** Garde d'une server action : lève une erreur explicite. */
export async function requireActivationPermission(action: PermissionAction): Promise<SessionUser> {
  const a = await requireAccessContext();
  const m = ACTIVATION_MODULES.find((x) => can(a.perms, x, action));
  if (!m) throw new Error(`Accès refusé : cette action demande le droit « ${action === "view" ? "Voir" : action === "create" ? "Créer" : action === "edit" ? "Modifier" : "Valider"} » sur ${MODULE_LABELS.marketing} ou ${MODULE_LABELS.clients}.`);
  return requirePermission(m, action);
}

export async function canDoActivation(action: PermissionAction = "view"): Promise<boolean> {
  const a = await getAccess();
  return !!a && ACTIVATION_MODULES.some((m) => can(a.perms, m, action));
}

/**
 * Qui peut valider une activation (et donc engager son budget) ? Définition unique, utilisée
 * par la transition, la file de validation et l'affichage des boutons.
 */
export async function canValidateActivation(brandId: string | null | undefined): Promise<boolean> {
  const a = await getAccess();
  if (!a) return false;
  if (isAdmin(a.perms) || a.flags.approveSpend) return true;
  return brandId ? canValidateBrand(brandId) : false;
}

/** Personnes à prévenir quand une activation attend une validation. */
export async function activationValidators(brandId: string | null, validatorId: string | null): Promise<string[]> {
  if (validatorId) return [validatorId];
  const r = await db.execute<{ id: string }>(sql`
    select distinct u.id from users u
    where u.active and (
      ${brandId ? sql`exists (select 1 from brand_validators bv where bv.user_id = u.id and bv.brand_id = ${brandId}::uuid) or` : sql``}
      exists (select 1 from user_flags f where f.user_id = u.id and f.approve_spend)
      or exists (select 1 from user_permissions p where p.user_id = u.id and p.module = 'administration' and p.can_validate))`);
  return r.rows.map((x) => x.id);
}

export type ActivationScope = {
  /** Portée OWN : identifiant de la personne (pilote, créateur ou contributeur). */
  ownerId: string | null;
  /** Clients assignés (portée OWN / ASSIGNED), `null` sans restriction. */
  clientIds: string[] | null;
  /** Marques assignées (portée ASSIGNED), `null` sans restriction. */
  brandIds: string[] | null;
};

/** Portée à appliquer aux requêtes d'activations. */
export async function activationScope(): Promise<ActivationScope> {
  const a = await getAccess();
  if (!a || a.scope === "ALL") return { ownerId: null, clientIds: null, brandIds: null };
  if (a.scope === "OWN") return { ownerId: a.user.id, clientIds: a.clientIds, brandIds: null };
  return { ownerId: null, clientIds: a.clientIds.length ? a.clientIds : null, brandIds: a.brandIds.length ? a.brandIds : null };
}

/** Fragment SQL de portée pour un alias d'activation (`a`). */
export function scopeSql(scope: ActivationScope, alias = "a") {
  const t = sql.raw(alias);
  const parts = [];
  if (scope.ownerId) {
    parts.push(sql`(${t}.responsible_id = ${scope.ownerId}::uuid or ${t}.created_by_id = ${scope.ownerId}::uuid
      or exists (select 1 from activation_contributors ac where ac.activation_id = ${t}.id and ac.user_id = ${scope.ownerId}::uuid)
      ${scope.clientIds?.length ? sql`or exists (select 1 from activation_clients x where x.activation_id = ${t}.id and x.client_id = any(${pgArray(scope.clientIds)}))` : sql``})`);
  } else {
    if (scope.brandIds) parts.push(sql`(${t}.brand_id = any(${pgArray(scope.brandIds)}) or exists (select 1 from activation_brands x where x.activation_id = ${t}.id and x.brand_id = any(${pgArray(scope.brandIds)})))`);
    if (scope.clientIds) parts.push(sql`(${t}.client_id is null and not exists (select 1 from activation_clients x where x.activation_id = ${t}.id) or ${t}.client_id = any(${pgArray(scope.clientIds)}) or exists (select 1 from activation_clients x where x.activation_id = ${t}.id and x.client_id = any(${pgArray(scope.clientIds)})))`);
  }
  return parts.length ? sql`and ${sql.join(parts, sql` and `)}` : sql``;
}
