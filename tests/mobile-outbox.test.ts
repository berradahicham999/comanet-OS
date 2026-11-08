import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GPS_WAIT_MS, SNAPSHOT_MAX_AGE_DAYS, sendable, settle, snapshotExpired, wireEvent, type MutationResult, type OutboxItem } from "@/lib/mobile/outbox-shared";
import { alignedDeviceTime, dateInWindow, gpsColumns, isUuid, rawLines } from "@/lib/mobile/mutations-shared";

const item = (id: string, over: Partial<OutboxItem> = {}): OutboxItem => ({
  clientEventId: id, kind: "ANIMATION", userId: "u1", label: "Pharmacie — 3 u.",
  payload: { clientId: "c", date: "2026-11-07", lines: [] },
  deviceTime: "2026-11-07T10:00:00.000Z", state: "PENDING", ...over,
});

describe("rejeu de la file", () => {
  test("une saisie acceptée sort de la file, qu'elle soit nouvelle ou déjà reçue", () => {
    const r: MutationResult[] = [{ clientEventId: "a", ok: true, id: "x" }, { clientEventId: "b", ok: true, id: "y", replayed: true }];
    assert.deepEqual(settle([{ clientEventId: "a" }, { clientEventId: "b" }], r).remove, ["a", "b"]);
  });

  test("une réponse perdue ne perd rien : sans résultat, la saisie reste", () => {
    const s = settle([{ clientEventId: "a" }, { clientEventId: "b" }], [{ clientEventId: "a", ok: true }]);
    assert.deepEqual(s.remove, ["a"]);
    assert.deepEqual(s.keep, ["b"]);
  });

  test("un conflit n'est jamais effacé en silence : il passe en « à corriger »", () => {
    const s = settle([{ clientEventId: "a" }], [{ clientEventId: "a", ok: false, code: "CONFLICT", message: "Existe déjà", existingId: "z" }]);
    assert.deepEqual(s.remove, []);
    assert.deepEqual(s.toFix, [{ clientEventId: "a", error: { code: "CONFLICT", message: "Existe déjà", existingId: "z" } }]);
  });

  test("une erreur serveur ou un autre compte : la saisie reste en file, sans déranger", () => {
    const s = settle([{ clientEventId: "a" }, { clientEventId: "b" }], [
      { clientEventId: "a", ok: false, code: "SERVER", message: "x" },
      { clientEventId: "b", ok: false, code: "WRONG_USER", message: "y" },
    ]);
    assert.deepEqual(s.keep, ["a", "b"]);
    assert.deepEqual(s.toFix, []);
  });

  test("un droit retiré ou une saisie invalide attend une décision", () => {
    const s = settle([{ clientEventId: "a" }, { clientEventId: "b" }], [
      { clientEventId: "a", ok: false, code: "FORBIDDEN", message: "x" },
      { clientEventId: "b", ok: false, code: "INVALID", message: "y" },
    ]);
    assert.deepEqual(s.toFix.map((f) => f.clientEventId), ["a", "b"]);
  });
});

describe("ce qui part", () => {
  const now = new Date("2026-11-07T10:00:10.000Z").getTime();

  test("seules les saisies de la personne connectée partent", () => {
    assert.deepEqual(sendable([item("a"), item("b", { userId: "u2" })], "u1", now).map((i) => i.clientEventId), ["a"]);
  });

  test("les saisies à corriger ne repartent pas toutes seules", () => {
    assert.deepEqual(sendable([item("a", { state: "A_CORRIGER" })], "u1", now), []);
  });

  test("dans l'ordre où elles ont été faites", () => {
    const list = [item("b", { deviceTime: "2026-11-07T10:00:05.000Z" }), item("a", { deviceTime: "2026-11-07T09:00:00.000Z" })];
    assert.deepEqual(sendable(list, "u1", now).map((i) => i.clientEventId), ["a", "b"]);
  });

  test("une saisie attend sa position, jamais plus de 30 secondes", () => {
    assert.deepEqual(sendable([item("a", { gpsPending: true })], "u1", now), []);
    assert.equal(sendable([item("a", { gpsPending: true })], "u1", new Date("2026-11-07T10:00:00.000Z").getTime() + GPS_WAIT_MS).length, 1);
  });

  test("ni le libellé ni l'état local ne partent, et l'absence de position est dite", () => {
    const w = wireEvent(item("a"), "2026-11-07T10:00:00.000Z") as Record<string, unknown>;
    assert.equal("label" in w, false);
    assert.equal("state" in w, false);
    assert.deepEqual(w.gps, { lat: null, lng: null, accuracyM: null, error: "SANS_POSITION" });
  });
});

describe("référentiels locaux", () => {
  test("sans contact avec le serveur pendant 14 jours, ils ne sont plus lisibles", () => {
    const t = new Date("2026-11-20T12:00:00Z").getTime();
    assert.equal(snapshotExpired("2026-11-10T12:00:00Z", t), false);
    assert.equal(snapshotExpired(new Date(t - (SNAPSHOT_MAX_AGE_DAYS + 1) * 86400000).toISOString(), t), true);
  });
});

describe("lecture d'une saisie reçue", () => {
  test("la date reste dans une fenêtre plausible", () => {
    assert.equal(dateInWindow("2026-11-07", "2026-11-07"), true);
    assert.equal(dateInWindow("2026-11-01", "2026-11-07"), true);
    assert.equal(dateInWindow("2026-11-08", "2026-11-07"), true);
    assert.equal(dateInWindow("2026-11-09", "2026-11-07"), false);
    assert.equal(dateInWindow("2026-09-01", "2026-11-07"), false);
    assert.equal(dateInWindow("n'importe quoi", "2026-11-07"), false);
    assert.equal(dateInWindow(null, "2026-11-07"), false);
  });

  test("une horloge de téléphone fausse est recalée à l'envoi", () => {
    const server = new Date("2026-11-07T12:00:00.000Z");
    const t = alignedDeviceTime("2026-11-07T09:50:00.000Z", "2026-11-07T11:50:00.000Z", server);
    assert.equal(t?.toISOString(), "2026-11-07T10:00:00.000Z");
    assert.equal(alignedDeviceTime("pas une date", null, server), null);
  });

  test("une position hors limites est refusée, l'absence garde sa raison", () => {
    assert.deepEqual(gpsColumns({ lat: 33.5731, lng: -7.5898, accuracyM: 12.4, error: null }), { gpsLat: "33.573100", gpsLng: "-7.589800", gpsAccuracyM: 12, gpsError: null });
    assert.equal(gpsColumns({ lat: 133, lng: 0 }).gpsLat, null);
    assert.equal(gpsColumns({ lat: null, lng: null, error: "REFUSE" }).gpsError, "REFUSE");
    assert.equal(gpsColumns({ error: "<script>" }).gpsError, "SANS_POSITION");
    assert.equal(gpsColumns(null).gpsError, "SANS_POSITION");
  });

  test("les lignes sont ramenées à des chaînes, sans identifiant fantaisiste", () => {
    const id = "8b405253-3d29-4e4e-9451-c70fd22778f6";
    assert.deepEqual(rawLines([{ productId: id, qty: 3, stock: "" }, { productId: "x", qty: 1 }, null]), [{ productId: id, qty: "3", stock: "" }]);
    assert.deepEqual(rawLines("pas un tableau"), []);
    assert.equal(rawLines(Array.from({ length: 80 }, () => ({ productId: id }))).length, 60);
    assert.equal(isUuid(id), true);
  });
});
