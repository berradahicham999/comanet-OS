/**
 * Médical v2 — rapprochement des noms de médecin (`src/lib/medical/matching.ts`) :
 * titres, accents, ordre prénom / nom, fautes de frappe, initiales, homonymes, villes.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  doctorNameTokens, doctorAliasKey, jaroWinkler, doctorNameScore, matchDoctor, doctorCandidate,
} from "@/lib/medical/matching";

const docs = [
  doctorCandidate({ id: "d1", firstName: "Ahmed", lastName: "Bennani", city: "Casablanca" }),
  doctorCandidate({ id: "d2", firstName: "Salma", lastName: "El Idrissi", city: "Rabat" }),
  doctorCandidate({ id: "d3", firstName: "Karim", lastName: "Alaoui", city: "Fès" }),
  doctorCandidate({ id: "d4", firstName: "Karima", lastName: "Alaoui", city: "Fès" }),
  doctorCandidate({ id: "d5", firstName: "Nadia", lastName: "Tazi", city: "Casablanca" }),
];
const OPTS = { autoScore: 0.92, suggestScore: 0.75 };
const m = (raw: string, city: string | null = null) => matchDoctor(raw, city, docs, new Map(), OPTS);

describe("Normalisation", () => {
  test("titres, accents, ponctuation, ordre", () => {
    assert.deepEqual(doctorNameTokens("Dr. BENNANI Ahmed"), ["ahmed", "bennani"]);
    assert.deepEqual(doctorNameTokens("Pr Ahmed Bennani"), ["ahmed", "bennani"]);
    assert.deepEqual(doctorNameTokens("Docteure Éléonore  d'Hérouville"), doctorNameTokens("Eleonore D Herouville docteure"));
  });
  test("clé d'alias avec et sans ville", () => {
    assert.equal(doctorAliasKey("Dr Bennani Ahmed", "Casablanca"), "ahmed bennani|casablanca");
    assert.equal(doctorAliasKey("Dr Bennani Ahmed", null), "ahmed bennani");
  });
  test("Jaro-Winkler", () => {
    assert.equal(jaroWinkler("martha", "martha"), 1);
    assert.ok(Math.abs(jaroWinkler("martha", "marhta") - 0.961) < 0.01);
    assert.equal(jaroWinkler("abc", ""), 0);
  });
});

describe("Rapprochement", () => {
  test("ordre inversé + titre : automatique", () => {
    const r = m("Dr BENNANI Ahmed", "Casablanca");
    assert.equal(r.kind, "AUTO");
    assert.equal(r.kind === "AUTO" && r.doctorId, "d1");
  });
  test("faute de frappe : automatique", () => {
    const r = m("Dr Ahmed Benani", "Casablanca");
    assert.equal(r.kind === "AUTO" && r.doctorId, "d1");
  });
  test("nom composé sans espace", () => {
    const r = m("Pr Elidrissi Salma", "Rabat");
    assert.equal(r.kind === "AUTO" && r.doctorId, "d2");
  });
  test("homonymes proches (Karim / Karima Alaoui) : jamais automatique sur une initiale", () => {
    const r = m("Dr K. Alaoui", "Fès");
    assert.equal(r.kind, "NONE");
    assert.deepEqual(r.kind === "NONE" && r.suggestions.map((s) => s.doctorId).sort(), ["d3", "d4"]);
  });
  test("nom complet départage les homonymes", () => {
    const r = m("Dr Karima Alaoui", "Fès");
    assert.equal(r.kind === "AUTO" && r.doctorId, "d4");
  });
  test("ville différente : le score baisse, pas d'automatique", () => {
    assert.ok(doctorNameScore(["ahmed", "bennani"], ["ahmed", "bennani"], "Rabat", "Casablanca") < 0.92);
    assert.equal(m("Dr Ahmed Bennani", "Rabat").kind, "NONE");
  });
  test("nom inconnu : aucune suggestion", () => {
    const r = m("Dr Youssef Chraibi", "Casablanca");
    assert.equal(r.kind, "NONE");
    assert.deepEqual(r.kind === "NONE" && r.suggestions, []);
  });
  test("alias connu : rapprochement immédiat", () => {
    const aliases = new Map([[doctorAliasKey("Dr Benanni A.", "Casablanca"), "d1"]]);
    const r = matchDoctor("Dr Benanni A.", "Casablanca", docs, aliases, OPTS);
    assert.deepEqual(r, { kind: "ALIAS", doctorId: "d1", score: 1 });
  });
});
