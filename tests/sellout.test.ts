/**
 * CA sell-out : la définition officielle (`src/lib/sellout.ts`).
 *
 * Aucun accès base : ces fonctions sont pures. Le `DATABASE_URL` factice du script `npm test`
 * sert uniquement à ce que les modules qui importent `@/db` puissent être chargés ; le pool
 * `pg` est paresseux et n'ouvre aucune connexion.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lineSellout, resolveUnitPrice, amountMatchesQuantity, toFiniteNumber, roundAmount } from "@/lib/sellout";

describe("toFiniteNumber", () => {
  test("lit les nombres, les chaînes, la virgule décimale et les espaces", () => {
    assert.equal(toFiniteNumber(12), 12);
    assert.equal(toFiniteNumber("12"), 12);
    assert.equal(toFiniteNumber("12,50"), 12.5);
    assert.equal(toFiniteNumber("1 200"), 1200);
  });
  test("refuse ce qui n'est pas un nombre au lieu de renvoyer 0", () => {
    assert.equal(toFiniteNumber(""), null);
    assert.equal(toFiniteNumber(null), null);
    assert.equal(toFiniteNumber(undefined), null);
    assert.equal(toFiniteNumber("abc"), null);
    assert.equal(toFiniteNumber(NaN), null);
    assert.equal(toFiniteNumber(Infinity), null);
  });
});

describe("resolveUnitPrice — priorité officielle", () => {
  test("le prix de la ligne prime sur le prix produit", () => {
    assert.deepEqual(resolveUnitPrice({ unitPrice: 120, productPriceRetail: 99 }), { price: 120, source: "LIGNE" });
  });
  test("le prix produit prend le relais", () => {
    assert.deepEqual(resolveUnitPrice({ unitPrice: null, productPriceRetail: 99 }), { price: 99, source: "PRODUIT" });
  });
  test("un prix nul ou négatif est traité comme absent, jamais retenu", () => {
    assert.deepEqual(resolveUnitPrice({ unitPrice: 0, productPriceRetail: 0 }), { price: null, source: "AUCUN" });
    assert.deepEqual(resolveUnitPrice({ unitPrice: -5, productPriceRetail: null }), { price: null, source: "AUCUN" });
  });
});

describe("lineSellout", () => {
  test("1 — le montant porté par la ligne fait foi", () => {
    const r = lineSellout({ quantitySold: 3, amount: 360, unitPrice: 100, productPriceRetail: 99 });
    assert.equal(r.amount, 360);
    assert.equal(r.source, "MONTANT_LIGNE");
  });
  test("2 — sans montant, quantité × prix de la ligne", () => {
    const r = lineSellout({ quantitySold: 3, unitPrice: 120, productPriceRetail: 99 });
    assert.equal(r.amount, 360);
    assert.equal(r.unitPrice, 120);
    assert.equal(r.source, "PRIX_LIGNE");
  });
  test("3 — sans prix de ligne, quantité × prix public du produit", () => {
    const r = lineSellout({ quantitySold: 4, productPriceRetail: 99.9 });
    assert.equal(r.amount, 399.6);
    assert.equal(r.source, "PRIX_PRODUIT");
  });
  test("4 — sans aucun prix : NON MESURABLE, et surtout pas 0", () => {
    const r = lineSellout({ quantitySold: 4 });
    assert.equal(r.amount, null);
    assert.equal(r.source, "NON_MESURABLE");
    assert.notEqual(r.amount, 0);
  });
  test("quantité 0 avec un prix connu vaut bien 0 MAD, ce n'est pas une donnée manquante", () => {
    const r = lineSellout({ quantitySold: 0, productPriceRetail: 99 });
    assert.equal(r.amount, 0);
  });
  test("quantité illisible : non mesurable", () => {
    assert.equal(lineSellout({ quantitySold: "abc", productPriceRetail: 99 }).amount, null);
  });
  test("arrondi à deux décimales, et montant toujours égal à quantité × prix enregistré", () => {
    // Le prix est arrondi AVANT la multiplication : `animation_lines.amount` reste
    // exactement `quantity_sold × unit_price` tel qu'enregistré, sans centime fantôme.
    const r = lineSellout({ quantitySold: 3, productPriceRetail: 33.333 });
    assert.equal(r.unitPrice, 33.33);
    assert.equal(r.amount, 99.99);
    assert.equal(r.amount, roundAmount(3 * 33.33));
    assert.equal(roundAmount(12.3456), 12.35);
  });
  test("le montant reste prioritaire même quand aucun prix n'est connu", () => {
    const r = lineSellout({ quantitySold: 2, amount: 250 });
    assert.equal(r.amount, 250);
    assert.equal(r.unitPrice, 125);
  });
});

describe("amountMatchesQuantity — cohérence d'un montant saisi", () => {
  test("accepte l'égalité exacte et les arrondis au centime", () => {
    assert.equal(amountMatchesQuantity(360, 3, 120), true);
    assert.equal(amountMatchesQuantity(360.02, 3, 120), true);
  });
  test("refuse un écart réel", () => {
    assert.equal(amountMatchesQuantity(500, 3, 120), false);
  });
});
