/**
 * Gestion commerciale — numérotation des pièces (src/lib/gestion/numbering-shared.ts).
 * L'attribution concurrente (verrou de ligne dans la transaction) se vérifie sur un vrai
 * Postgres : voir docs/guide-gestion-commerciale.md.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatNumber, nextNumberError, patternError, previewNext } from "@/lib/gestion/numbering-shared";

describe("formats de série", () => {
  test("le format Sage actuel est reproduit", () => {
    assert.equal(formatNumber("FA{AAAA}{N:5}", { year: 2026, month: 7, seq: 198 }), "FA202600198");
    assert.equal(formatNumber("BL{AAAA}{N:5}", { year: 2026, month: 9, seq: 600 }), "BL202600600");
    assert.equal(formatNumber("AV{AAAA}{N:5}", { year: 2026, month: 7, seq: 38 }), "AV202600038");
  });
  test("jetons année courte et mois", () => {
    assert.equal(formatNumber("FAC{AA}{MM}-{N:4}", { year: 2027, month: 1, seq: 7 }), "FAC2701-0007");
  });
  test("un format sans année, sans compteur ou avec un jeton inconnu est refusé", () => {
    assert.match(patternError("FA{N:5}")!, /année/);
    assert.match(patternError("FA{AAAA}")!, /compteur/);
    assert.match(patternError("FA{AAAA}{N:5}{N:3}")!, /exactement un compteur/);
    assert.match(patternError("FA{AAAA}{X}{N:5}")!, /Jeton inconnu/);
    assert.match(patternError("FA {AAAA}{N:5}")!, /espace/);
    assert.match(patternError("")!, /vide/);
    assert.equal(patternError("FA{AAAA}{N:5}"), null);
  });
  test("un compteur qui déborde est refusé au lieu d'allonger le numéro en silence", () => {
    assert.throws(() => formatNumber("FA{AAAA}{N:3}", { year: 2026, month: 1, seq: 1000 }), /dépasse/);
    assert.throws(() => formatNumber("FA{AAAA}{N:3}", { year: 2026, month: 1, seq: 0 }), /commence à 1/);
  });
  test("aperçu du prochain numéro", () => {
    assert.equal(previewNext("FA{AAAA}{N:5}", 2027, 0), "FA202700001");
    assert.equal(previewNext("FA{AAAA}{N:5}", 2026, 261), "FA202600262");
    assert.equal(previewNext("FA{N:5}", 2026, 1), null);
  });
});

describe("reprise de la séquence Sage", () => {
  test("le prochain numéro se règle tant qu'aucune pièce n'est numérotée dans l'année", () => {
    assert.equal(nextNumberError(0, 262), null);
    assert.equal(nextNumberError(0, 1), null);
  });
  test("ensuite la série reste continue : ni avance (trou) ni recul (doublon)", () => {
    assert.match(nextNumberError(12, 300)!, /continue/);
    assert.match(nextNumberError(12, 5)!, /continue/);
  });
  test("valeurs invalides", () => {
    assert.ok(nextNumberError(0, 0));
    assert.ok(nextNumberError(0, 1.5));
  });
});
