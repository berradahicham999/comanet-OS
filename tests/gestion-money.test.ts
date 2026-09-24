/**
 * Gestion commerciale — nombres décimaux exacts (src/lib/gestion/money.ts).
 * Aucun calcul en virgule flottante : tout passe par des entiers à échelle fixe.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SCALE, fmtDecimal, fmtQty, formatScaled, nextCmup, parseDecimal, rescale, roundDiv, valueOf } from "@/lib/gestion/money";

describe("lecture des nombres saisis ou stockés", () => {
  test("formats français, anglais et base de données", () => {
    assert.equal(parseDecimal("165.83", 2), 16583n);
    assert.equal(parseDecimal("165,83", 2), 16583n);
    assert.equal(parseDecimal("1 234,56", 2), 123456n);
    assert.equal(parseDecimal("1.234,56", 2), 123456n);
    assert.equal(parseDecimal("1,234.56", 2), 123456n);
    assert.equal(parseDecimal("-3", 3), -3000n);
    assert.equal(parseDecimal("6.000", 3), 6000n);
    assert.equal(parseDecimal(".5", 2), 50n);
  });
  test("une saisie vide ou illisible donne null, jamais 0", () => {
    assert.equal(parseDecimal("", 2), null);
    assert.equal(parseDecimal("   ", 2), null);
    assert.equal(parseDecimal("abc", 2), null);
    assert.equal(parseDecimal("1,2,3", 2), null);
    assert.equal(parseDecimal(null, 2), null);
    assert.equal(parseDecimal(Number.NaN, 2), null);
  });
  test("un nombre JavaScript (cellule Excel) est relu sans erreur de flottant", () => {
    assert.equal(parseDecimal(0.1 + 0.2, 2), 30n);
    assert.equal(parseDecimal(165.83, 2), 16583n);
    assert.equal(parseDecimal(6, 3), 6000n);
  });
  test("trop de décimales : arrondi au plus proche", () => {
    assert.equal(parseDecimal("124.375", 2), 12438n);
    assert.equal(parseDecimal("-124.375", 2), -12438n);
  });
});

describe("arrondi unique, demi s'éloignant de zéro, symétrique", () => {
  test("roundDiv", () => {
    assert.equal(roundDiv(74623_5n, 10n), 74624n); // 7462,35 → 7462,4 à l'échelle voulue
    assert.equal(roundDiv(5n, 2n), 3n);
    assert.equal(roundDiv(-5n, 2n), -3n);
    assert.equal(roundDiv(4n, 3n), 1n);
    assert.equal(roundDiv(-4n, 3n), -1n);
    assert.throws(() => roundDiv(1n, 0n));
  });
  test("une facture et son avoir s'annulent au centime", () => {
    const line = roundDiv(6000n * 16583n * 7500n, 1000n * 10000n); // 6 × 165,83 × (1 − 25 %)
    const credit = roundDiv(-6000n * 16583n * 7500n, 1000n * 10000n);
    assert.equal(line + credit, 0n);
  });
  test("rescale", () => {
    assert.equal(rescale(16583n, 2, 4), 1658300n);
    assert.equal(rescale(1658333n, 4, 2), 16583n);
  });
});

describe("Facture Sage FA202600198 : le calcul reproduit le papier", () => {
  test("PU HT = 199,00 ÷ 1,20 arrondi au centime = 165,83", () => {
    assert.equal(roundDiv(19900n * 100n, 120n), 16583n);
  });
  test("ligne : 6 × 165,83 × 75 % = 746,235 → 746,24 (l'export Sage donnait 746,25)", () => {
    const net = roundDiv(6000n * 16583n * 7500n, 1000n * 10000n);
    assert.equal(formatScaled(net, 2), "746.24");
    const vat = roundDiv(net * 2000n, 10000n); // 20 %
    assert.equal(formatScaled(vat, 2), "149.25");
    assert.equal(formatScaled(net + vat, 2), "895.49");
    assert.equal(formatScaled(2n * net, 2), "1492.48");
    assert.equal(formatScaled(2n * vat, 2), "298.50");
    assert.equal(formatScaled(2n * (net + vat), 2), "1790.98");
  });
});

describe("formats d'affichage", () => {
  test("formatScaled pour la base", () => {
    assert.equal(formatScaled(16583n, 2), "165.83");
    assert.equal(formatScaled(-6000n, 3), "-6.000");
    assert.equal(formatScaled(5n, 2), "0.05");
    assert.equal(formatScaled(0n, 3), "0.000");
  });
  test("fmtDecimal en français, arrondi sans float", () => {
    assert.equal(fmtDecimal(179098n, 2).replace(/\s/g, " "), "1 790,98");
    assert.equal(fmtDecimal(-179098n, 2, 0).replace(/\s/g, " "), "−1 791");
  });
  test("fmtQty retire les décimales inutiles", () => {
    assert.equal(fmtQty("6.000"), "6");
    assert.equal(fmtQty("12.500"), "12,5");
    assert.equal(fmtQty("-3.000"), "−3");
    assert.equal(fmtQty(null), "—");
  });
});

describe("CMUP", () => {
  const q = (v: string) => parseDecimal(v, SCALE.qty)!;
  const c = (v: string) => parseDecimal(v, SCALE.cost)!;
  test("première entrée : le CMUP est son coût", () => {
    assert.equal(nextCmup(0n, null, q("100"), c("50")), c("50"));
  });
  test("moyenne pondérée : 100 u. à 50 + 50 u. à 80 = 60", () => {
    assert.equal(nextCmup(q("100"), c("50"), q("50"), c("80")), c("60"));
  });
  test("arrondi au dix-millième : 3 u. à 10 + 1 u. à 11 = 10,25", () => {
    assert.equal(formatScaled(nextCmup(q("3"), c("10"), q("1"), c("11")), SCALE.cost), "10.2500");
    assert.equal(formatScaled(nextCmup(q("2"), c("10"), q("1"), c("11")), SCALE.cost), "10.3333");
  });
  test("stock nul ou négatif : on repart du coût de l'entrée", () => {
    assert.equal(nextCmup(q("-5"), c("40"), q("10"), c("50")), c("50"));
    assert.equal(nextCmup(0n, c("40"), q("10"), c("50")), c("50"));
  });
  test("refuse une sortie", () => {
    assert.throws(() => nextCmup(q("10"), c("50"), q("-1"), c("50")));
  });
  test("valeur d'un stock au CMUP, au centime", () => {
    assert.equal(formatScaled(valueOf(q("12"), c("124.3750")), 2), "1492.50");
    assert.equal(formatScaled(valueOf(q("3"), c("10.3333")), 2), "31.00");
  });
});
