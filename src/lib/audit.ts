import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import type { DbLike } from "@/lib/events/emit";
import type { ModuleKey } from "@/lib/access-shared";

/**
 * Journal d'audit : qui a créé, modifié, validé, archivé ou annulé quoi, et quand.
 *
 * La table `audit_logs` existait depuis la migration 0000 sans jamais être écrite : ce module
 * en est le seul écrivain (garde-fou dans `tests/definitions-uniques.test.ts`). Une entrée est
 * écrite dans la MÊME transaction que la modification qu'elle décrit : pas de trace sans fait,
 * pas de fait sans trace. Le nom de l'auteur est copié pour rester lisible après la suppression
 * d'un compte. Distinct de `permission_audit_logs` (droits) et de `events` (faits déclencheurs).
 */

export type AuditActor = { id: string | null; name: string };

export type AuditEntry = {
  actor: AuditActor;
  /** CREATE | UPDATE | ARCHIVE | RESTORE | DELETE | VALIDATE | CANCEL | IMPORT | ROLLBACK | SETTINGS… */
  action: string;
  module?: ModuleKey | null;
  /** Type d'objet : client, supplier, product, stock_movement, document_series, settings… */
  entity: string;
  entityId?: string | null;
  label?: string | null;
  before?: unknown;
  after?: unknown;
};

export async function audit(entry: AuditEntry, tx: DbLike = db): Promise<void> {
  await tx.insert(auditLogs).values({
    actorId: entry.actor.id,
    actorName: entry.actor.name,
    action: entry.action.slice(0, 50),
    module: entry.module ?? null,
    entity: entry.entity.slice(0, 50),
    entityId: entry.entityId ?? null,
    entityLabel: entry.label ?? null,
    oldValue: entry.before === undefined ? null : (entry.before as object),
    newValue: entry.after === undefined ? null : (entry.after as object),
  });
}

/**
 * Ne garde que les champs qui changent, pour un journal lisible. Les valeurs sont comparées
 * sous forme de texte (un `numeric` relu « 25.00 » et saisi « 25 » ne sont pas un changement).
 */
export function changedFields<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  const norm = (v: unknown) => {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return String(Number(v));
    if (typeof v === "number") return String(v);
    return JSON.stringify(v);
  };
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (norm(before[k]) !== norm(after[k])) { b[k] = before[k]; a[k] = after[k]; }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

export type AuditRow = { id: string; actorName: string; action: string; entityLabel: string | null; oldValue: unknown; newValue: unknown; createdAt: Date };

/** Historique d'un objet, du plus récent au plus ancien. */
export async function auditTrail(entity: string, entityId: string, limit = 50): Promise<AuditRow[]> {
  const r = await db.execute<AuditRow>(sql`
    select id, actor_name as "actorName", action, entity_label as "entityLabel", old_value as "oldValue", new_value as "newValue", created_at as "createdAt"
    from audit_logs where entity = ${entity} and entity_id = ${entityId}::uuid order by created_at desc limit ${limit}`);
  return r.rows;
}
