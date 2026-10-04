import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  monthBounds, monthElapsedPct, monthOf, parseMonth, shiftMonth, expectedVisits, countedVisits, remainingVisits,
  visitProgress, paceVerdict, monthlyTarget, objectiveProgress, tourPriority, suggestTour, rankMissingAssortment,
  type TourCandidate,
} from "@/lib/crm/portfolio-shared";
import { countsInProgress, crmCheckSettings } from "@/lib/crm/visits-shared";
import { verifyVisit, type EventForCheck } from "@/lib/medical/gps-shared";
import { DEFAULT_CRM, mergeCrm } from "@/lib/settings";

describe("CRM — mois de suivi", () => {
  test("bornes d'un mois, février bissextile compris", () => {
    assert.deepEqual(monthBounds("2026-10"), { start: "2026-10-01", end: "2026-11-01", last: "2026-10-31", days: 31, year: 2026, month: 10 });
    assert.equal(monthBounds("2028-02").days, 29);
    assert.equal(monthBounds("2026-12").end, "2027-01-01");
  });
  test("part du mois écoulée, aujourd'hui compris ; passé = 100, futur = 0", () => {
    assert.equal(Math.round(monthElapsedPct("2026-10", "2026-10-04")), 13);
    assert.equal(monthElapsedPct("2026-10", "2026-10-31"), 100);
    assert.equal(monthElapsedPct("2026-09", "2026-10-04"), 100);
    assert.equal(monthElapsedPct("2026-11", "2026-10-04"), 0);
  });
  test("lecture et décalage de mois", () => {
    assert.equal(parseMonth("2026-13", "2026-10"), "2026-10");
    assert.equal(parseMonth("2026-03", "2026-10"), "2026-03");
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
    assert.equal(monthOf("2026-10-04"), "2026-10");
  });
});

describe("CRM — progression plafonnée", () => {
  test("une fréquence non définie sort de la progression, 0 = ne pas visiter", () => {
    assert.equal(expectedVisits(null), 0);
    assert.equal(expectedVisits(0), 0);
    assert.equal(expectedVisits(2), 2);
  });
  test("cinq passages chez le même client ne compensent pas les autres", () => {
    assert.equal(countedVisits(1, 5), 1);
    assert.equal(remainingVisits(2, 1), 1);
    const p = visitProgress([{ frequency: 1, done: 5 }, { frequency: 1, done: 0 }, { frequency: 1, done: 0 }, { frequency: 1, done: 0 }, { frequency: 1, done: 0 }]);
    assert.equal(p.expected, 5);
    assert.equal(p.counted, 1);
    assert.equal(p.done, 5);
    assert.equal(p.pct, 20);
    assert.equal(p.notVisited, 4);
    assert.equal(p.complete, 1);
  });
  test("clients sans fréquence comptés à part, progression non mesurable si rien n'est attendu", () => {
    const p = visitProgress([{ frequency: null, done: 2 }, { frequency: 0, done: 1 }]);
    assert.equal(p.expected, 0);
    assert.equal(p.pct, null);
    assert.equal(p.undefinedFrequency, 1);
    assert.equal(paceVerdict(p, 50, 25).kind, "NON_MESURABLE");
  });
  test("rythme : en retard au-delà de l'écart toléré, sinon dans le rythme, atteint à 100 %", () => {
    const base = { expected: 40, counted: 4, pct: 10 };
    const late = paceVerdict(base, 60, 25);
    assert.equal(late.kind, "EN_RETARD");
    assert.equal(late.behind, 20);
    assert.match(late.label, /20 visites/);
    assert.equal(paceVerdict({ expected: 40, counted: 20, pct: 50 }, 60, 25).kind, "DANS_LE_RYTHME");
    assert.equal(paceVerdict({ expected: 40, counted: 40, pct: 100 }, 60, 25).kind, "ATTEINT");
  });
});

describe("CRM — objectif client", () => {
  const rows = [
    { clientId: "c", brandId: null, year: 2026, month: null, amount: 120_000 },
    { clientId: "c", brandId: null, year: 2026, month: 10, amount: 15_000 },
  ];
  test("la ligne mensuelle l'emporte, sinon l'annuel ÷ 12", () => {
    assert.deepEqual(monthlyTarget(rows, 2026, 10), { amount: 15_000, source: "MENSUEL" });
    assert.deepEqual(monthlyTarget(rows, 2026, 9), { amount: 10_000, source: "ANNUEL" });
    assert.equal(monthlyTarget(rows, 2027, 1), null);
  });
  const o = { elapsedPct: 60, dayOfMonth: 18, lateRatio: 0.7, checkFromDay: 15, monthOver: false };
  test("aucun objectif saisi : jamais de valeur déduite", () => {
    assert.equal(objectiveProgress(null, 5000, o).verdict, "AUCUN_OBJECTIF");
  });
  test("pas encore comparable avant le jour de contrôle", () => {
    assert.equal(objectiveProgress(10_000, 100, { ...o, dayOfMonth: 5, elapsedPct: 16 }).verdict, "PAS_ENCORE_COMPARABLE");
  });
  test("en retard sous attendu × tolérance, dans le rythme au-dessus, atteint au-delà de l'objectif", () => {
    assert.equal(objectiveProgress(10_000, 4000, o).verdict, "EN_RETARD"); // attendu 6 000 × 0,7 = 4 200
    assert.equal(objectiveProgress(10_000, 4500, o).verdict, "DANS_LE_RYTHME");
    assert.equal(objectiveProgress(10_000, 10_000, o).verdict, "ATTEINT");
    assert.equal(objectiveProgress(10_000, 9000, { ...o, monthOver: true, elapsedPct: 100 }).verdict, "EN_RETARD");
  });
});

describe("CRM — Ma tournée : qui voir en priorité", () => {
  const base: TourCandidate = { clientId: "a", name: "A", city: "CASABLANCA", frequency: 2, doneThisMonth: 0, lastVisit: "2026-09-01", plannedToday: false, daysUntilNextOrder: null, objectiveLate: null, stockStale: false };
  test("chaque raison est mesurée et dite", () => {
    const r = tourPriority({ ...base, daysUntilNextOrder: -12, objectiveLate: { pct: 20, elapsedPct: 60 }, stockStale: true }, "2026-10-20");
    assert.ok(r.reasons.includes("encore 2 visites à faire ce mois"));
    assert.ok(r.reasons.some((x) => /commande attendue depuis 12 j/.test(x)));
    assert.ok(r.reasons.some((x) => /objectif du mois à 20 %/.test(x)));
    assert.ok(r.reasons.includes("relevé de stock en rayon à refaire"));
    assert.ok(r.reasons.some((x) => /dernière visite il y a 49 j/.test(x)));
  });
  test("un client à ne pas visiter n'est proposé que s'il est planifié", () => {
    assert.equal(tourPriority({ ...base, frequency: 0 }, "2026-10-20").score, 0);
    assert.ok(tourPriority({ ...base, frequency: 0, plannedToday: true }, "2026-10-20").score >= 100);
  });
  test("tri par priorité, rien de proposé sans raison", () => {
    const list = suggestTour([
      { ...base, clientId: "done", name: "Fait", frequency: 1, doneThisMonth: 1, lastVisit: "2026-10-18" },
      { ...base, clientId: "late", name: "Retard", daysUntilNextOrder: -20 },
      { ...base, clientId: "plan", name: "Planifié", frequency: 1, doneThisMonth: 1, lastVisit: "2026-10-18", plannedToday: true },
    ], "2026-10-20", 3);
    assert.deepEqual(list.map((x) => x.clientId), ["plan", "late"]);
  });
});

describe("CRM — assortiment manquant", () => {
  const rows = [
    { productId: "p1", name: "Sérum", brand: "Gamarde", buyers: 8 },
    { productId: "p2", name: "Crème", brand: "Gamarde", buyers: 3 },
    { productId: "p3", name: "Gel", brand: "CygneLab", buyers: 9 },
  ];
  test("produits répandus chez les pairs et absents du client, triés par part", () => {
    const r = rankMissingAssortment(rows, 10, new Set(["p3"]), { minPeers: 5, minShare: 0.4, topN: 5 });
    assert.deepEqual(r.map((x) => x.productId), ["p1"]);
    assert.equal(r[0].share, 0.8);
  });
  test("trop peu de pairs : rien, plutôt qu'une conclusion fragile", () => {
    assert.deepEqual(rankMissingAssortment(rows, 4, new Set(), { minPeers: 5, minShare: 0.1, topN: 5 }), []);
  });
});

describe("CRM — visites et réglages", () => {
  test("seules les visites effectuées d'un type compté alimentent la barre", () => {
    assert.equal(countsInProgress({ status: "EFFECTUEE", kind: "VISITE" }, ["VISITE"]), true);
    assert.equal(countsInProgress({ status: "EFFECTUEE", kind: "APPEL" }, ["VISITE"]), false);
    assert.equal(countsInProgress({ status: "EFFECTUEE", kind: "APPEL" }, ["VISITE", "APPEL"]), true);
    assert.equal(countsInProgress({ status: "NON_EFFECTUEE", kind: "VISITE" }, ["VISITE"]), false);
  });
  test("un réglage partiel ne perd aucun seuil, ni les fréquences par type", () => {
    const m = mergeCrm({ paceGapPts: 10, defaultFrequencyByType: { PHARMACIE: 3 } as never, countedKinds: [] });
    assert.equal(m.paceGapPts, 10);
    assert.equal(m.defaultFrequencyByType.PHARMACIE, 3);
    assert.equal(m.defaultFrequencyByType.GROSSISTE, DEFAULT_CRM.defaultFrequencyByType.GROSSISTE);
    assert.deepEqual(m.countedKinds, ["VISITE"]);
    assert.equal(m.radiusM, DEFAULT_CRM.radiusM);
  });
  test("le contrôle de présence parle du point de vente, avec les seuils du CRM", () => {
    const at = new Date("2026-10-04T09:00:00Z");
    const ev = (type: EventForCheck["type"], lat: number, min: number): EventForCheck => ({ type, lat, lng: -7.6, accuracyM: 10, gpsError: null, deviceTime: null, sentAt: null, serverTime: new Date(at.getTime() + min * 60_000) });
    const r = verifyVisit({
      events: [ev("START", 33.6, 0), ev("STOP", 33.6, 15)],
      cabinet: { lat: 33.61, lng: -7.6, validated: true },
      previousStop: null, autoClosed: false, settings: crmCheckSettings(DEFAULT_CRM), placeNoun: "point de vente",
    });
    assert.equal(r.status, "A_VERIFIER");
    assert.ok(r.reasons.some((x) => /du point de vente \(rayon 150 m\)/.test(x)));
    assert.ok(!r.reasons.some((x) => /cabinet/.test(x)));
  });
});
