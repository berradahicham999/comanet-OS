import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * JOURNAL DES ÉVÉNEMENTS — lecture, pour l'écran d'admin `/parametres/evenements`.
 *
 * C'est l'exigence de traçabilité de la Phase 1 : diagnostiquer sans ouvrir la base. Une
 * ligne = un fait (`events`) et ce qu'il a produit (`event_consequences`) — quelle règle,
 * quel verdict, quelle tâche. Purement en lecture ; le rejeu passe par `dispatch.ts`.
 */

export type JournalEvent = {
  id: string;
  type: string;
  status: string;
  source: string;
  entityType: string;
  entityId: string | null;
  occurredAt: string;
  createdAt: string;
  processedAt: string | null;
  attempts: number;
  revision: number;
  error: string | null;
  payload: Record<string, unknown>;
  consequences: { ruleId: string; outcome: string; recommendationKey: string | null; taskId: string | null }[];
};

export type JournalFilter = { status?: string; type?: string; limit?: number };

export async function listEvents(filter: JournalFilter = {}): Promise<JournalEvent[]> {
  const limit = Math.min(filter.limit ?? 200, 500);
  const r = await db.execute(sql`
    select e.id::text as id, e.type, e.status, e.source, e.entity_type, e.entity_id::text as entity_id,
           e.occurred_at::text as occurred_at, e.created_at::text as created_at, e.processed_at::text as processed_at,
           e.attempts, e.revision, e.error, e.payload,
           coalesce(
             (select json_agg(json_build_object('ruleId', c.rule_id, 'outcome', c.outcome, 'recommendationKey', c.recommendation_key, 'taskId', c.task_id::text) order by c.created_at)
              from event_consequences c where c.event_id = e.id),
             '[]'::json
           ) as consequences
    from events e
    where true
      ${filter.status ? sql`and e.status = ${filter.status}` : sql``}
      ${filter.type ? sql`and e.type = ${filter.type}` : sql``}
    order by e.created_at desc
    limit ${limit}`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), type: String(x.type), status: String(x.status), source: String(x.source),
    entityType: String(x.entity_type), entityId: x.entity_id ? String(x.entity_id) : null,
    occurredAt: String(x.occurred_at), createdAt: String(x.created_at), processedAt: x.processed_at ? String(x.processed_at) : null,
    attempts: Number(x.attempts), revision: Number(x.revision), error: x.error ? String(x.error) : null,
    payload: (x.payload ?? {}) as Record<string, unknown>,
    consequences: (x.consequences ?? []) as JournalEvent["consequences"],
  }));
}

export type JournalCounts = Record<string, number>;

/** Compteur par statut, pour les onglets de l'écran. */
export async function countByStatus(): Promise<JournalCounts> {
  const r = await db.execute(sql`select status, count(*)::int as n from events group by status`);
  const out: JournalCounts = {};
  for (const row of r.rows as { status: string; n: number }[]) out[row.status] = row.n;
  return out;
}
