/**
 * ÉMISSION D'UN ÉVÉNEMENT — pattern outbox léger, sans file d'attente.
 *
 * La ligne d'événement est écrite dans la MÊME transaction que l'écriture métier : soit les
 * deux existent, soit aucune. Le traitement, lui, a lieu APRÈS la validation de la
 * transaction (voir `dispatch.ts`) — un handler qui échoue ne peut donc jamais annuler la
 * saisie qui l'a déclenché.
 *
 * Idempotence : `dedupeKey` est unique. Ré-émettre le même fait (une animation corrigée,
 * un fichier réimporté) met la ligne à jour, incrémente `revision` et repasse le statut à
 * `pending` — jamais un second enregistrement, jamais une seconde recommandation.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";

/** `db` ou la transaction en cours : `emitEvent` accepte les deux. */
export type DbLike = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Types de faits journalisés. Un seul est traité par un handler à ce stade. */
export const EVENT_TYPES = {
  /** Une journée d'animation est enregistrée avec le statut « réalisée ». */
  ANIMATION_COMPLETED: "ANIMATION_COMPLETED",
  /** L'import a rencontré une journée déjà saisie à la main et ne l'a pas touchée. */
  ANIMATION_IMPORT_CONFLICT: "ANIMATION_IMPORT_CONFLICT",
} as const;
export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export const EVENT_SOURCES = {
  SAISIE_TERRAIN: "saisie_terrain",
  IMPORT_ANIMATIONS: "import_animations",
} as const;
export type EventSource = (typeof EVENT_SOURCES)[keyof typeof EVENT_SOURCES];

export type EmitInput = {
  type: EventType;
  entityType: string;
  entityId: string | null;
  /** Identité du FAIT, pas de la ligne : `<TYPE>:<entity_id>`. Voir `eventKey()`. */
  dedupeKey: string;
  payload: Record<string, unknown>;
  source: EventSource;
  /** Temps métier : la date de l'animation, pas celle de la saisie. */
  occurredAt: Date;
  /**
   * `pending` (défaut) : à traiter par un handler.
   * `done` : fait purement journalisé, sans conséquence à évaluer (un conflit d'import).
   */
  status?: "pending" | "done";
};

/** Clé d'un fait. Portée par l'identifiant de l'entité : stable au renommage. */
export function eventKey(type: EventType, entityId: string): string {
  return `${type}:${entityId}`;
}

export type EmittedEvent = { id: string; revision: number; status: string };

/**
 * Écrit l'événement dans la transaction fournie.
 *
 * À appeler DANS la transaction métier. Ne déclenche aucun traitement : c'est
 * `dispatchEvent()` qui s'en charge, une fois la transaction validée.
 */
export async function emitEvent(tx: DbLike, input: EmitInput): Promise<EmittedEvent> {
  const status = input.status ?? "pending";
  const [row] = await tx
    .insert(events)
    .values({
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      dedupeKey: input.dedupeKey,
      payload: input.payload,
      source: input.source,
      occurredAt: input.occurredAt,
      status,
    })
    .onConflictDoUpdate({
      target: events.dedupeKey,
      set: {
        // Le fait a été corrigé : on remplace ce qu'on sait de lui et on le remet à traiter.
        payload: sql`excluded.payload`,
        source: sql`excluded.source`,
        occurredAt: sql`excluded.occurred_at`,
        entityId: sql`excluded.entity_id`,
        status: sql`excluded.status`,
        revision: sql`${events.revision} + 1`,
        attempts: 0,
        error: null,
        processedAt: null,
      },
    })
    .returning({ id: events.id, revision: events.revision, status: events.status });
  return row;
}

/**
 * Marque un fait comme caduc : l'animation a été annulée ou supprimée.
 *
 * Ni rejoué, ni retraité. Ses conséquences déjà produites restent visibles dans le journal —
 * on ne réécrit pas l'histoire — mais le cycle de vie des tâches créées est repris par
 * l'appelant (voir `releaseConsequences`).
 */
export async function obsoleteEvent(tx: DbLike, dedupeKey: string): Promise<boolean> {
  const rows = await tx
    .update(events)
    .set({ status: "obsolete", processedAt: new Date() })
    .where(sql`${events.dedupeKey} = ${dedupeKey} and ${events.status} <> 'obsolete'`)
    .returning({ id: events.id });
  return rows.length > 0;
}
