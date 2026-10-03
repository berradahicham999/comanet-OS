/**
 * Médical v2 — contrôle de présence (`src/lib/medical/gps-shared.ts`) : distance, durée, heure retenue,
 * vitesse implicite et chaque motif du statut de contrôle.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  haversineM, eventTime, visitDurationMinutes, impliedSpeedKmh, verifyVisit, canProposeCabinet,
  type EventForCheck, type Cabinet,
} from "@/lib/medical/gps-shared";
import { DEFAULT_MEDICAL_FIELD as S } from "@/lib/settings";

// Cabinet fictif à Casablanca (Maârif).
const CAB = { lat: 33.585, lng: -7.635 };
const cabinet = (validated = true): Cabinet => ({ ...CAB, validated });
/** Point décalé de `m` mètres vers le nord. */
const north = (m: number) => ({ lat: CAB.lat + m / 111_195, lng: CAB.lng });
const T0 = new Date("2026-10-05T09:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

const ev = (over: Partial<EventForCheck>): EventForCheck => ({
  type: "START", lat: CAB.lat, lng: CAB.lng, accuracyM: 15, gpsError: null,
  deviceTime: T0, sentAt: T0, serverTime: T0, ...over,
});
const visit = (startMin: number, stopMin: number, over: { start?: Partial<EventForCheck>; stop?: Partial<EventForCheck> } = {}) => [
  ev({ type: "START", deviceTime: at(startMin), sentAt: at(startMin), serverTime: at(startMin), ...over.start }),
  ev({ type: "STOP", deviceTime: at(stopMin), sentAt: at(stopMin), serverTime: at(stopMin), ...over.stop }),
];
const check = (events: EventForCheck[], extra: Partial<Parameters<typeof verifyVisit>[0]> = {}) =>
  verifyVisit({ events, cabinet: cabinet(), previousStop: null, autoClosed: false, settings: S, ...extra });

describe("Distance (haversine)", () => {
  test("même point = 0 m", () => assert.equal(haversineM(CAB, CAB), 0));
  test("1 km vers le nord ≈ 1000 m", () => assert.ok(Math.abs(haversineM(CAB, north(1000)) - 1000) < 2));
  test("Casablanca → Rabat ≈ 87 km", () => {
    const d = haversineM({ lat: 33.5731, lng: -7.5898 }, { lat: 34.0209, lng: -6.8416 });
    assert.ok(d > 85_000 && d < 90_000, String(d));
  });
});

describe("Durée et heure retenue", () => {
  test("durée arrondie à la minute", () => assert.equal(visitDurationMinutes(at(0), new Date(at(12).getTime() + 31_000)), 13));
  test("borne manquante ou négative = null", () => {
    assert.equal(visitDurationMinutes(null, at(5)), null);
    assert.equal(visitDurationMinutes(at(5), at(0)), null);
  });
  test("envoi direct : heure du serveur", () => {
    assert.deepEqual(eventTime({ deviceTime: null, sentAt: null, serverTime: at(3) }), at(3));
  });
  test("envoi différé : heure du téléphone recalée du décalage d'horloge", () => {
    // Téléphone en avance de 5 min ; action à 9h00 réelle (9h05 téléphone), envoyée à 11h00 réelle (11h05 téléphone).
    const t = eventTime({ deviceTime: at(5), sentAt: at(125), serverTime: at(120) });
    assert.deepEqual(t, at(0));
  });
  test("vitesse implicite", () => {
    assert.equal(impliedSpeedKmh(0, 0), 0);
    assert.equal(impliedSpeedKmh(1000, 0), Number.POSITIVE_INFINITY);
    assert.equal(Math.round(impliedSpeedKmh(20_000, 15 * 60_000)), 80);
  });
});

describe("Statut de contrôle", () => {
  test("Démarrer et Terminer au cabinet validé, 15 min : VERIFIEE", () => {
    const r = check(visit(0, 15));
    assert.equal(r.status, "VERIFIEE");
    assert.deepEqual(r.reasons, []);
  });
  test("démarrage à 2 km du cabinet : A_VERIFIER avec le motif", () => {
    const p = north(2000);
    const r = check(visit(0, 15, { start: p, stop: p }));
    assert.equal(r.status, "A_VERIFIER");
    assert.ok(r.reasons.some((m) => m.startsWith("Démarrage à 2,0 km du cabinet")), r.reasons.join(" | "));
  });
  test("précision > 100 m", () => {
    const r = check(visit(0, 15, { start: { accuracyM: 250 } }));
    assert.equal(r.status, "A_VERIFIER");
    assert.ok(r.reasons.some((m) => m.includes("Précision GPS insuffisante au démarrage")));
  });
  test("fin à plus de 300 m du démarrage", () => {
    const r = verifyVisit({ events: visit(0, 15, { stop: north(400) }), cabinet: null, previousStop: null, autoClosed: false, settings: S });
    assert.ok(r.reasons.some((m) => m.startsWith("Fin à 400 m du démarrage")), r.reasons.join(" | "));
  });
  test("durée trop courte ou trop longue", () => {
    assert.ok(check(visit(0, 2)).reasons.some((m) => m.includes("sous le minimum")));
    assert.ok(check(visit(0, 95)).reasons.some((m) => m.includes("au-delà du maximum")));
  });
  test("envoi différé de plus de 2 h", () => {
    const r = check(visit(0, 15, { stop: { deviceTime: at(15), sentAt: at(15 + 150), serverTime: at(15 + 150) } }));
    assert.ok(r.reasons.some((m) => m.includes("Fin : envoi 2 h 30 après")), r.reasons.join(" | "));
  });
  test("horloge du téléphone décalée de plus de 10 min", () => {
    const r = check(visit(0, 15, { start: { deviceTime: at(-20), sentAt: at(-20), serverTime: at(0) } }));
    assert.ok(r.reasons.some((m) => m.includes("Horloge du téléphone décalée de 20 min")), r.reasons.join(" | "));
  });
  test("déplacement impossible entre deux visites (> 80 km/h)", () => {
    const far = { lat: 34.0209, lng: -6.8416 }; // Rabat, 10 min avant
    const r = check(visit(0, 15), { previousStop: { at: at(-10), position: far } });
    assert.ok(r.reasons.some((m) => m.startsWith("Déplacement impossible")), r.reasons.join(" | "));
    const ok = check(visit(0, 15), { previousStop: { at: at(-10), position: north(2000) } });
    assert.equal(ok.status, "VERIFIEE");
  });
  test("cabinet non validé ou inconnu", () => {
    assert.ok(check(visit(0, 15), { cabinet: cabinet(false) }).reasons.includes("Position du cabinet pas encore validée."));
    assert.equal(check(visit(0, 15), { cabinet: null }).status, "A_VERIFIER");
  });
  test("GPS refusé : NON_VERIFIEE, la visite reste valable", () => {
    const r = check(visit(0, 15, { start: { lat: null, lng: null, accuracyM: null, gpsError: "REFUSE" } }));
    assert.equal(r.status, "NON_VERIFIEE");
    assert.ok(r.reasons[0].includes("localisation refusée"));
  });
  test("clôture automatique : toujours à vérifier, durée non mesurée", () => {
    const r = check([visit(0, 15)[0], ev({ type: "CLOTURE_AUTO", lat: null, lng: null, serverTime: at(180) })], { autoClosed: true });
    assert.equal(r.status, "A_VERIFIER");
    assert.ok(r.reasons.some((m) => m.startsWith("Clôture automatique")));
  });
  test("visite non effectuée au cabinet : vérifiée", () => {
    assert.equal(check([ev({ type: "NON_EFFECTUEE" })]).status, "VERIFIEE");
  });
  test("saisie sans chrono : hors contrôle", () => {
    assert.equal(check([]).status, "HORS_CONTROLE");
  });
  test("une correction impose le statut et garde son motif", () => {
    const p = north(2000);
    const r = check([...visit(0, 15, { start: p, stop: p }), ev({ type: "CORRECTION", forcedStatus: "VERIFIEE", reason: "Cabinet secondaire confirmé", actorName: "Hicham", serverTime: at(60) })]);
    assert.equal(r.status, "VERIFIEE");
    assert.ok(r.reasons.at(-1)!.includes("par Hicham : Cabinet secondaire confirmé"));
  });
});

describe("Proposition de la position du cabinet", () => {
  test("seulement avec une position précise", () => {
    assert.equal(canProposeCabinet({ lat: 1, lng: 1, accuracyM: 30 }, S), true);
    assert.equal(canProposeCabinet({ lat: 1, lng: 1, accuracyM: 300 }, S), false);
    assert.equal(canProposeCabinet({ lat: null, lng: null, accuracyM: null }, S), false);
  });
});
