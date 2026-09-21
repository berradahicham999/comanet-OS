/**
 * Stock chez le client — décisions pures (`src/lib/client-stock-shared.ts`) :
 * dernier relevé par produit, ancienneté, écart, couverture estimée, droits par canal.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  latestByProduct, agingOf, ageDays, deltaOf, estimatedCoverageWeeks, canRecordReading, parseReadingLines, type Reading,
} from "@/lib/client-stock-shared";
import { noPermissions } from "@/lib/permissions-shared";

const reading = (over: Partial<Reading>): Reading => ({
  id: "r", productId: "p1", quantity: 5, readAt: "2026-09-01", createdAt: "2026-09-01T10:00:00Z",
  userId: "u1", userName: "Meryem", channel: "ANIMATION", animationId: null, comment: null, ...over,
});
const TODAY = new Date(Date.UTC(2026, 8, 21)); // 21/09/2026
const S = { freshDays: 15, staleDays: 45 };

describe("Dernier relevé par produit", () => {
  test("le plus récent gagne, l'historique est du plus récent au plus ancien", () => {
    const m = latestByProduct([
      reading({ id: "a", readAt: "2026-08-01", quantity: 10 }),
      reading({ id: "c", readAt: "2026-09-10", quantity: 2 }),
      reading({ id: "b", readAt: "2026-08-20", quantity: 6 }),
      reading({ id: "z", productId: "p2", readAt: "2026-09-01", quantity: 0 }),
    ]);
    const p1 = m.get("p1")!;
    assert.equal(p1.latest.id, "c");
    assert.equal(p1.previous?.id, "b");
    assert.deepEqual(p1.history.map((r) => r.id), ["c", "b", "a"]);
    assert.equal(m.get("p2")!.previous, null);
  });
  test("deux relevés le même jour : l'ordre d'écriture départage", () => {
    const m = latestByProduct([
      reading({ id: "matin", readAt: "2026-09-10", createdAt: "2026-09-10T09:00:00Z", quantity: 4 }),
      reading({ id: "soir", readAt: "2026-09-10", createdAt: "2026-09-10T18:00:00Z", quantity: 1 }),
    ]);
    assert.equal(m.get("p1")!.latest.id, "soir");
  });
});

describe("Ancienneté d'un relevé (seuils des paramètres, jamais en dur)", () => {
  test("vert sous freshDays, orange sous staleDays, rouge au-delà, gris sans relevé", () => {
    assert.equal(agingOf("2026-09-20", TODAY, S), "fresh");
    assert.equal(agingOf("2026-09-07", TODAY, S), "fresh"); // 14 j
    assert.equal(agingOf("2026-09-06", TODAY, S), "aging"); // 15 j
    assert.equal(agingOf("2026-08-08", TODAY, S), "aging"); // 44 j
    assert.equal(agingOf("2026-08-07", TODAY, S), "stale"); // 45 j
    assert.equal(agingOf(null, TODAY, S), "never");
  });
  test("les seuils changent le verdict", () => {
    assert.equal(agingOf("2026-09-06", TODAY, { freshDays: 30, staleDays: 60 }), "fresh");
  });
  test("jours écoulés : jamais négatif, illisible → null", () => {
    assert.equal(ageDays("2026-09-21", TODAY), 0);
    assert.equal(ageDays("2026-09-30", TODAY), 0);
    assert.equal(ageDays("n/a", TODAY), null);
  });
});

describe("Écart et couverture estimée", () => {
  test("écart = dernier − précédent, null sans précédent", () => {
    assert.equal(deltaOf({ quantity: 2 }, { quantity: 6 }), -4);
    assert.equal(deltaOf({ quantity: 6 }, null), null);
  });
  test("couverture = stock ÷ rythme hebdomadaire de sell-in ; null sans livraison", () => {
    // 36 unités livrées sur 90 j = 2,8 u./semaine ; 14 en stock ≈ 5 semaines
    assert.equal(estimatedCoverageWeeks({ stock: 14, sellInUnits: 36, windowDays: 90 }), 5);
    assert.equal(estimatedCoverageWeeks({ stock: 14, sellInUnits: 0, windowDays: 90 }), null);
    assert.equal(estimatedCoverageWeeks({ stock: 0, sellInUnits: 36, windowDays: 90 }), 0);
  });
});

describe("Qui peut relever, par canal", () => {
  const perms = () => noPermissions();
  test("animatrice (Terrain créer, portée OWN) : seulement ses propres animations", () => {
    const p = perms(); p.terrain = { view: true, create: true, edit: false, validate: false };
    const me = { userId: "u1", perms: p, scope: "OWN" as const, clientIds: [] };
    assert.equal(canRecordReading(me, { channel: "ANIMATION", clientId: "c1", animatriceId: "u1" }), true);
    assert.equal(canRecordReading(me, { channel: "ANIMATION", clientId: "c1", animatriceId: "u2" }), false);
    assert.equal(canRecordReading(me, { channel: "TOURNEE_COMMERCIALE", clientId: "c1" }), false);
  });
  test("commercial (Clients créer) : tout client en portée ALL, seulement son portefeuille en ASSIGNED", () => {
    const p = perms(); p.clients = { view: true, create: true, edit: true, validate: false };
    assert.equal(canRecordReading({ userId: "u3", perms: p, scope: "ALL", clientIds: [] }, { channel: "TOURNEE_COMMERCIALE", clientId: "c1" }), true);
    const assigned = { userId: "u3", perms: p, scope: "ASSIGNED" as const, clientIds: ["c9"] };
    assert.equal(canRecordReading(assigned, { channel: "TOURNEE_COMMERCIALE", clientId: "c9" }), true);
    assert.equal(canRecordReading(assigned, { channel: "TOURNEE_COMMERCIALE", clientId: "c1" }), false);
    assert.equal(canRecordReading(assigned, { channel: "ANIMATION", clientId: "c9", animatriceId: "u3" }), false);
  });
  test("lecture seule sur Clients : aucun relevé", () => {
    const p = perms(); p.clients = { view: true, create: false, edit: false, validate: false };
    assert.equal(canRecordReading({ userId: "u4", perms: p, scope: "ALL", clientIds: [] }, { channel: "TOURNEE_COMMERCIALE", clientId: "c1" }), false);
  });
});

describe("Lecture des lignes d'un relevé", () => {
  test("relevé partiel : seules les lignes modifiées et renseignées", () => {
    const r = parseReadingLines([
      { productId: "p1", qty: "4", changed: true },
      { productId: "p2", qty: "7", changed: false },
      { productId: "p3", qty: "", changed: true },
    ], false);
    assert.ok(r.ok);
    assert.deepEqual(r.lines, [{ productId: "p1", quantity: 4 }]);
  });
  test("relevé complet : toutes les lignes renseignées, doublons ignorés", () => {
    const r = parseReadingLines([
      { productId: "p1", qty: "4", changed: false },
      { productId: "p2", qty: "0", changed: false },
      { productId: "p1", qty: "9", changed: true },
    ], true);
    assert.ok(r.ok);
    assert.deepEqual(r.lines, [{ productId: "p1", quantity: 4 }, { productId: "p2", quantity: 0 }]);
  });
  test("une quantité illisible ou négative refuse tout le relevé, jamais convertie en 0", () => {
    assert.deepEqual(parseReadingLines([{ productId: "p1", qty: "abc", changed: true }], false), { ok: false, error: "quantite" });
    assert.deepEqual(parseReadingLines([{ productId: "p1", qty: "-2", changed: true }], false), { ok: false, error: "quantite" });
    assert.deepEqual(parseReadingLines([{ productId: "p1", qty: "1.5", changed: true }], false), { ok: false, error: "quantite" });
  });
});
