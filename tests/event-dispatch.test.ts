/**
 * Isolation de la saisie et idempotence du dispatcher.
 *
 * Ces tests utilisent un journal en mémoire : il n'y a pas de Postgres sur les postes de
 * développement, et la garantie qui compte ici est une propriété de déroulé, pas de SQL.
 * Ce que le SQL garantit de son côté est écrit dans la migration : `events.dedupe_key` unique
 * (un seul enregistrement par fait) et `tasks.source_key` unique sur les statuts ouverts
 * (une seule tâche ouverte par recommandation).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runEvent, type EventStore, type EventHandler } from "@/lib/events/dispatch";
import { eventKey, EVENT_TYPES } from "@/lib/events/emit";
import type { EventRow } from "@/db/schema";

function memoryStore(initial: Partial<EventRow> & { id: string; type: string }) {
  const row = {
    entityType: "animation", entityId: "a1", dedupeKey: "k", payload: {}, source: "saisie_terrain",
    occurredAt: new Date(), createdAt: new Date(), status: "pending", processedAt: null,
    attempts: 0, error: null, revision: 1, ...initial,
  } as EventRow;
  const calls: string[] = [];
  const store: EventStore = {
    async claim(id) {
      calls.push("claim");
      if (id !== row.id) return null;
      if (row.status !== "pending" && row.status !== "failed") return null; // déjà pris
      row.status = "processing";
      row.attempts += 1;
      return { ...row };
    },
    async markDone() { calls.push("markDone"); row.status = "done"; row.error = null; },
    async markFailed(_id, error) { calls.push("markFailed"); row.status = "failed"; row.error = error; },
  };
  return { store, row, calls };
}

const okHandler = (seen: string[]): EventHandler => ({ id: "ok", async run(e) { seen.push(e.id); } });
const boomHandler: EventHandler = { id: "boom", async run() { throw new Error("stock injoignable"); } };

describe("un handler qui échoue n'annule jamais la saisie", () => {
  test("l'exception ne remonte pas, l'événement passe en failed avec son erreur", async () => {
    const { store, row } = memoryStore({ id: "e1", type: EVENT_TYPES.ANIMATION_COMPLETED });
    const res = await runEvent(store, { [EVENT_TYPES.ANIMATION_COMPLETED]: [boomHandler] }, "e1");
    assert.equal(res.status, "failed");
    assert.match(res.error ?? "", /stock injoignable/);
    assert.equal(row.status, "failed");
    assert.match(row.error ?? "", /stock injoignable/);
  });

  test("même si l'enregistrement de l'erreur échoue à son tour, rien ne remonte", async () => {
    const { store } = memoryStore({ id: "e1", type: EVENT_TYPES.ANIMATION_COMPLETED });
    store.markFailed = async () => { throw new Error("journal injoignable"); };
    const res = await runEvent(store, { [EVENT_TYPES.ANIMATION_COMPLETED]: [boomHandler] }, "e1");
    assert.equal(res.status, "failed");
  });

  test("un handler sain parmi plusieurs ne masque pas l'échec du suivant", async () => {
    const seen: string[] = [];
    const { store, row } = memoryStore({ id: "e1", type: EVENT_TYPES.ANIMATION_COMPLETED });
    await runEvent(store, { [EVENT_TYPES.ANIMATION_COMPLETED]: [okHandler(seen), boomHandler] }, "e1");
    assert.deepEqual(seen, ["e1"]);
    assert.equal(row.status, "failed");
  });
});

describe("idempotence du traitement", () => {
  test("le même événement traité deux fois n'exécute les handlers qu'une seule fois", async () => {
    const seen: string[] = [];
    const { store, row } = memoryStore({ id: "e1", type: EVENT_TYPES.ANIMATION_COMPLETED });
    const handlers = { [EVENT_TYPES.ANIMATION_COMPLETED]: [okHandler(seen)] };

    const first = await runEvent(store, handlers, "e1");
    const second = await runEvent(store, handlers, "e1");

    assert.equal(first.status, "done");
    assert.equal(second.status, "skipped", "le second passage ne doit pas rejouer le handler");
    assert.deepEqual(seen, ["e1"], "le handler n'a tourné qu'une fois");
    assert.equal(row.attempts, 1);
  });

  test("un événement en échec est rejouable, et réussit au rattrapage", async () => {
    const seen: string[] = [];
    const { store, row } = memoryStore({ id: "e1", type: EVENT_TYPES.ANIMATION_COMPLETED });
    await runEvent(store, { [EVENT_TYPES.ANIMATION_COMPLETED]: [boomHandler] }, "e1");
    assert.equal(row.status, "failed");
    const res = await runEvent(store, { [EVENT_TYPES.ANIMATION_COMPLETED]: [okHandler(seen)] }, "e1");
    assert.equal(res.status, "done");
    assert.equal(row.status, "done");
    assert.equal(row.attempts, 2);
  });

  test("un type sans handler est journalisé, pas en erreur", async () => {
    const { store, row } = memoryStore({ id: "e1", type: EVENT_TYPES.ANIMATION_IMPORT_CONFLICT });
    const res = await runEvent(store, {}, "e1");
    assert.equal(res.status, "done");
    assert.equal(row.status, "done");
  });

  test("un événement inconnu ou déjà traité est ignoré sans bruit", async () => {
    const { store } = memoryStore({ id: "e1", type: EVENT_TYPES.ANIMATION_COMPLETED, status: "done" });
    assert.equal((await runEvent(store, {}, "e1")).status, "skipped");
    assert.equal((await runEvent(store, {}, "inconnu")).status, "skipped");
  });
});

describe("clé d'événement — une animation corrigée reste le même fait", () => {
  test("la clé porte l'identifiant de l'animation, pas la journée", () => {
    const k = eventKey(EVENT_TYPES.ANIMATION_COMPLETED, "abc");
    assert.equal(k, "ANIMATION_COMPLETED:abc");
    assert.equal(k, eventKey(EVENT_TYPES.ANIMATION_COMPLETED, "abc"));
    assert.notEqual(k, eventKey(EVENT_TYPES.ANIMATION_COMPLETED, "def"));
  });
  test("deux types différents sur la même entité sont deux faits distincts", () => {
    assert.notEqual(
      eventKey(EVENT_TYPES.ANIMATION_COMPLETED, "abc"),
      eventKey(EVENT_TYPES.ANIMATION_IMPORT_CONFLICT, "abc"),
    );
  });
});
