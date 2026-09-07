/**
 * DISPATCHER — appelle les handlers d'un événement, de façon synchrone, dans le même serveur.
 *
 * Aucune file d'attente, aucun worker : le volume ne le justifie pas (une dizaine de journées
 * d'animation par jour). Ce qui remplace la file, c'est le statut porté par l'événement et le
 * rattrapage accroché au cron existant.
 *
 * ── La règle qui prime sur toutes les autres ────────────────────────────────
 *  La saisie terrain est sacrée. `dispatchEvent()` NE LÈVE JAMAIS. Un handler qui échoue met
 *  l'événement en `failed` avec son erreur, et c'est tout : l'animation reste enregistrée,
 *  l'animatrice voit sa saisie confirmée. L'événement est rejouable.
 *
 * ── Ajouter un type d'événement ─────────────────────────────────────────────
 *  Écrire un handler, l'enregistrer dans `HANDLERS`. Rien d'autre. Un type sans handler est
 *  légitime : le fait est journalisé, il n'a simplement aucune conséquence à évaluer.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, type EventRow } from "@/db/schema";
import { EVENT_TYPES, type EventType } from "./emit";

export type EventHandler = {
  /** Identifiant stable, repris dans `event_consequences.rule_id`. */
  id: string;
  run: (event: EventRow) => Promise<void>;
};

/**
 * Registre des handlers, par type d'événement.
 *
 * `ANIMATION_COMPLETED` n'a pas encore de handler : la règle d'écart à l'objectif attend que
 * les objectifs d'animation (ville × marque) soient chargés — la table est vide aujourd'hui.
 * Les faits sont donc journalisés dès maintenant et seront rejouables le jour venu.
 */
export const HANDLERS: Partial<Record<EventType, EventHandler[]>> = {
  [EVENT_TYPES.ANIMATION_COMPLETED]: [],
};

export type DispatchResult = { status: "done" | "failed" | "skipped"; error?: string };

/**
 * Accès au journal, isolé derrière une interface pour que le déroulé se teste sans Postgres
 * (il n'y a pas de base locale sur les postes de développement). L'implémentation réelle est
 * `dbStore` ; les tests en fournissent une en mémoire.
 */
export type EventStore = {
  /** Passe l'événement en `processing` et le renvoie, ou `null` s'il est déjà pris ou traité. */
  claim: (eventId: string) => Promise<EventRow | null>;
  markDone: (eventId: string) => Promise<void>;
  markFailed: (eventId: string, error: string) => Promise<void>;
};

const dbStore: EventStore = {
  async claim(eventId) {
    // Verrou optimiste : seul un passage peut faire basculer pending/failed → processing.
    const rows = await db
      .update(events)
      .set({ status: "processing", attempts: sql`${events.attempts} + 1` })
      .where(and(eq(events.id, eventId), inArray(events.status, ["pending", "failed"])))
      .returning();
    return rows[0] ?? null;
  },
  async markDone(eventId) {
    await db.update(events).set({ status: "done", processedAt: new Date(), error: null }).where(eq(events.id, eventId));
  },
  async markFailed(eventId, error) {
    await db.update(events).set({ status: "failed", processedAt: new Date(), error: error.slice(0, 2000) }).where(eq(events.id, eventId));
  },
};

/**
 * Déroulé d'un traitement, sans dépendance à la base. NE LÈVE JAMAIS.
 *
 * C'est ici que se joue l'isolation de la saisie : quoi qu'il arrive dans un handler, la
 * fonction rend la main normalement et l'événement porte l'erreur.
 */
export async function runEvent(
  store: EventStore,
  handlers: Partial<Record<EventType, EventHandler[]>>,
  eventId: string,
): Promise<DispatchResult> {
  let claimed: EventRow | null = null;
  try {
    claimed = await store.claim(eventId);
    if (!claimed) return { status: "skipped" };
    for (const h of handlers[claimed.type as EventType] ?? []) await h.run(claimed);
    await store.markDone(eventId);
    return { status: "done" };
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    if (!claimed) {
      // La base elle-même est injoignable : rien à enregistrer, la saisie est déjà acquise.
      console.error("Événement %s : journal injoignable", eventId, e);
      return { status: "failed", error: message };
    }
    try {
      await store.markFailed(eventId, message);
    } catch (inner) {
      console.error("Événement %s : échec du handler ET de l'enregistrement de l'erreur", eventId, inner);
    }
    return { status: "failed", error: message };
  }
}

/**
 * Traite un événement. Ne lève jamais : l'échec est enregistré, pas propagé.
 * À appeler APRÈS la validation de la transaction métier.
 */
export function dispatchEvent(eventId: string): Promise<DispatchResult> {
  return runEvent(dbStore, HANDLERS, eventId);
}

export type ReplaySummary = { processed: number; done: number; failed: number; remaining: number; durationMs: number };

/**
 * Rattrapage borné : reprend les événements en attente ou en échec, du plus ancien au plus
 * récent, et s'arrête dès que la limite de nombre OU de temps est atteinte. Ce qui reste
 * repart au passage suivant.
 *
 * Borné pour deux raisons : ne jamais dépasser la durée d'exécution d'une fonction Vercel,
 * et ne jamais faire échouer l'import qui l'appelle.
 */
export async function processPending(opts: { limit?: number; deadlineMs?: number } = {}): Promise<ReplaySummary> {
  const limit = opts.limit ?? 50;
  const deadlineMs = opts.deadlineMs ?? 20_000;
  const started = Date.now();

  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(inArray(events.status, ["pending", "failed"]))
    .orderBy(asc(events.createdAt))
    .limit(limit);

  let done = 0, failed = 0, processed = 0;
  for (const r of rows) {
    if (Date.now() - started > deadlineMs) break;
    const res = await dispatchEvent(r.id);
    processed++;
    if (res.status === "done") done++;
    else if (res.status === "failed") failed++;
  }

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(inArray(events.status, ["pending", "failed"]));

  return { processed, done, failed, remaining: Number(n), durationMs: Date.now() - started };
}
