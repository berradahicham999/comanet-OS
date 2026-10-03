/**
 * Médical v2 — analyses des ordonnances (`src/lib/medical/prescriptions-shared.ts`) :
 * potentiel A/B/C, segments, produits recommandés, impact des visites.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  specialtyPeople, cityTitle, tourPriority,
  doctorPotential, percentileRank, trendPct, doctorSegment, recommendProducts, visitImpact,
  type PrescriberStats, type PrescriberProducts,
} from "@/lib/medical/prescriptions-shared";
import { DEFAULT_MEDICAL_FIELD as S } from "@/lib/settings";

const stat = (id: string, lines: number, over: Partial<PrescriberStats> = {}): PrescriberStats => ({
  doctorId: id, specialty: "derm", lines, recent: Math.round(lines / 4), previous: Math.round(lines / 4), brands: 1, ...over,
});
// 10 dermatologues : 1, 2, …, 10 × 10 lignes.
const PEERS = Array.from({ length: 10 }, (_, i) => stat(`d${i + 1}`, (i + 1) * 10));

describe("Potentiel automatique", () => {
  test("percentile et tendance", () => {
    assert.equal(percentileRank(100, [10, 50, 100]), 83);
    assert.equal(trendPct(12, 10), 20);
    assert.equal(trendPct(5, 0), null);
  });
  test("meilleurs 20 % de la spécialité = A", () => {
    const r = doctorPotential(PEERS[9], PEERS, S);
    assert.equal(r.level, "A");
    assert.equal(r.observations, 100);
    assert.ok(r.reasons[0].includes("1er sur 10 prescripteur(s) de sa spécialité (10 % premiers)"), r.reasons[0]);
  });
  test("milieu = B, bas = C", () => {
    assert.equal(doctorPotential(PEERS[5], PEERS, S).level, "B");
    assert.equal(doctorPotential(PEERS[1], PEERS, S).level, "C");
  });
  test("hausse nette : un cran de plus, avec le motif", () => {
    const me = stat("d2", 20, { recent: 12, previous: 4 });
    const r = doctorPotential(me, PEERS, S);
    assert.equal(r.level, "B");
    assert.ok(r.reasons.some((m) => m.includes("En hausse de 200 %")));
  });
  test("baisse nette : un cran de moins", () => {
    assert.equal(doctorPotential(stat("d10", 100, { recent: 5, previous: 40 }), PEERS, S).level, "B");
  });
  test("trois marques prescrites : un cran de plus", () => {
    assert.equal(doctorPotential(stat("d2", 20, { brands: 3 }), PEERS, S).level, "B");
  });
  test("trop peu d'ordonnances : non calculé", () => {
    const r = doctorPotential(stat("x", 2), PEERS, S);
    assert.equal(r.level, null);
    assert.ok(r.reasons[0].includes("non calculé"));
  });
  test("la spécialité compte : un généraliste n'est pas classé contre les dermatologues", () => {
    const me = stat("g1", 15, { specialty: "mg" });
    const gps = [2, 3, 4, 5].map((n) => stat(`g${n}`, n, { specialty: "mg" }));
    assert.equal(doctorPotential(me, [...PEERS, me, ...gps], S).level, "A");
  });
});

describe("Segments", () => {
  const base = { lines: 10, recent: 5, previous: 5, visits: 3, visitsRecent: 1, potential: "B" as const, overdue: false };
  test("chaque segment", () => {
    assert.equal(doctorSegment(base, S), "FIDELE");
    assert.equal(doctorSegment({ ...base, recent: 10, previous: 5 }, S), "CROISSANCE");
    assert.equal(doctorSegment({ ...base, recent: 2, previous: 5 }, S), "BAISSE");
    assert.equal(doctorSegment({ ...base, visits: 0, visitsRecent: 0 }, S), "JAMAIS_VISITE");
    assert.equal(doctorSegment({ ...base, lines: 0, recent: 0, previous: 0 }, S), "VISITE_SANS_PRESCRIPTION");
    assert.equal(doctorSegment({ ...base, potential: "A", overdue: true }, S), "POTENTIEL_NON_COUVERT");
  });
});

describe("Le bon produit au bon médecin", () => {
  const names = new Map([["X", "Crème X"], ["Y", "Sérum Y"], ["Z", "Gel Z"], ["W", "Lait W"]]);
  const labels = { specialty: "Dermatologie", city: "CASABLANCA" };
  const peer = (id: string, products: string[], city = "Casablanca"): PrescriberProducts => ({ doctorId: id, specialty: "derm", city, products: new Set(products) });
  // 25 dermatologues de Casablanca prescrivent X ; 16 d'entre eux prescrivent aussi Y ; 5 prescrivent Z.
  const all: PrescriberProducts[] = [
    ...Array.from({ length: 16 }, (_, i) => peer(`xy${i}`, ["X", "Y"])),
    ...Array.from({ length: 5 }, (_, i) => peer(`xz${i}`, ["X", "Z"])),
    ...Array.from({ length: 4 }, (_, i) => peer(`x${i}`, ["X"])),
    ...Array.from({ length: 3 }, (_, i) => peer(`w${i}`, ["W"])),
  ];
  test("association X → Y avec la justification en clair", () => {
    const r = recommendProducts({ doctorId: "me", specialty: "derm", city: "Casablanca", products: new Set(["X"]) }, all, names, labels, S);
    assert.equal(r.peerScope, "VILLE");
    assert.equal(r.items[0].productId, "Y");
    assert.equal(r.items[0].why, "64 % des dermatologues de Casablanca qui prescrivent Crème X prescrivent aussi Sérum Y (16 sur 25).");
    assert.deepEqual(r.items.map((i) => i.productId), ["Y", "Z"]);
  });
  test("ne recommande jamais un produit déjà prescrit", () => {
    const r = recommendProducts({ doctorId: "me", specialty: "derm", city: "Casablanca", products: new Set(["X", "Y"]) }, all, names, labels, S);
    assert.ok(!r.items.some((i) => i.productId === "X" || i.productId === "Y"));
  });
  test("médecin qui ne prescrit rien : produits les plus prescrits par ses pairs", () => {
    const r = recommendProducts({ doctorId: "me", specialty: "derm", city: "Casablanca", products: new Set() }, all, names, labels, S);
    assert.equal(r.items[0].productId, "X");
    assert.ok(r.items[0].why.startsWith("Prescrit par 89 % des dermatologues de Casablanca (25 sur 28)"));
  });
  test("ville sans assez de pairs : repli national, signalé", () => {
    const r = recommendProducts({ doctorId: "me", specialty: "derm", city: "Ifrane", products: new Set(["X"]) }, all, names, { ...labels, city: "Ifrane" }, S);
    assert.equal(r.peerScope, "NATIONAL");
    assert.ok(r.items[0].why.includes("dermatologues (tout le pays)"));
  });
  test("pas assez d'observations : aucune recommandation, explication", () => {
    const r = recommendProducts({ doctorId: "me", specialty: "derm", city: "Casablanca", products: new Set() }, all.slice(0, 3), names, labels, S);
    assert.equal(r.items.length, 0);
    assert.ok(r.note?.includes("pas assez d'observations"));
  });
});

describe("Libellés", () => {
  test("spécialités au pluriel et villes en clair", () => {
    assert.equal(specialtyPeople("Dermatologie"), "dermatologues");
    assert.equal(specialtyPeople("MGE"), "généralistes");
    assert.equal(specialtyPeople("Chirurgie plastique"), "chirurgiens plasticiens");
    assert.equal(specialtyPeople("Rhumatologie"), "médecins (Rhumatologie)");
    assert.equal(cityTitle("CASABLANCA"), "Casablanca");
    assert.equal(cityTitle("FÈS"), "Fès");
  });
});

describe("Impact des visites", () => {
  test("avant / après sur la fenêtre, comparable seulement une fois écoulée", () => {
    const dates = ["2026-06-10", "2026-07-20", "2026-08-05", "2026-08-10", "2026-12-01"];
    const r = visitImpact("2026-08-01", dates, 60, "2026-10-03");
    assert.deepEqual(r, { before: 2, after: 2, complete: true });
    assert.equal(visitImpact("2026-09-20", dates, 60, "2026-10-03").complete, false);
  });
});

describe("Tournée suggérée", () => {
  test("potentiel × retard × opportunité, avec les facteurs en clair", () => {
    const a = tourPriority({ potential: "A", daysSince: 60, frequencyDays: 30, neverVisited: false, recommended: 3 }, S);
    assert.equal(a.score, 12); // 3 × 2 × 2
    assert.ok(a.reasons[1].includes("60 j depuis la dernière visite"));
    const c = tourPriority({ potential: "C", daysSince: 10, frequencyDays: 30, neverVisited: false, recommended: 0 }, S);
    assert.ok(c.score < a.score);
    assert.equal(tourPriority({ potential: null, daysSince: null, frequencyDays: 30, neverVisited: true, recommended: 0 }, S).score, 2);
  });
});
