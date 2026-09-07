/** Couverture de stock : la définition officielle (`src/lib/stock-math.ts`). */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeCoverage, coverageLevel, isUnderTension, trendPct, marginPct } from "@/lib/stock-math";

const T = { green: 4, yellow: 2, orange: 1 };
const TENSION = { stockTightCoverageMonths: 1.5, stockTightMinMonthlyUnits: 30 };
const base = { stock: 100, stockKnown: true, onOrder: 0, avgMonthly: 50, leadTimeDays: 60, safetyStockDays: 30, moq: null };

describe("coverageLevel — bornes des seuils", () => {
  test("chaque palier tombe du bon côté", () => {
    assert.equal(coverageLevel(6, T), "green");
    assert.equal(coverageLevel(4, T), "green");     // borne incluse
    assert.equal(coverageLevel(3.99, T), "yellow");
    assert.equal(coverageLevel(2, T), "yellow");    // borne incluse
    assert.equal(coverageLevel(1.99, T), "orange");
    assert.equal(coverageLevel(1, T), "orange");    // borne incluse
    assert.equal(coverageLevel(0.99, T), "red");
    assert.equal(coverageLevel(0, T), "red");
  });
  test("couverture inconnue : pas de rotation, pas « rouge »", () => {
    assert.equal(coverageLevel(null, T), "none");
    assert.equal(coverageLevel(NaN, T), "none");
  });
});

describe("computeCoverage", () => {
  test("cas nominal : couverture, stock cible et commande conseillée", () => {
    const r = computeCoverage(base, T);
    assert.equal(r.coverageMonths, 2);
    assert.equal(r.level, "yellow");
    // 60/30 + 30/30 + 1 = 4 mois × 50 = 200
    assert.equal(r.targetStock, 200);
    assert.equal(r.recommendedOrder, 100);
    assert.equal(r.daysToStockout, 60);
  });
  test("la commande en cours vient en déduction", () => {
    assert.equal(computeCoverage({ ...base, onOrder: 60 }, T).recommendedOrder, 40);
  });
  test("le MOQ arrondit au palier supérieur", () => {
    assert.equal(computeCoverage({ ...base, moq: 48 }, T).recommendedOrder, 144);
  });
  test("stock à zéro : couverture 0, critique, rupture immédiate", () => {
    const r = computeCoverage({ ...base, stock: 0 }, T);
    assert.equal(r.coverageMonths, 0);
    assert.equal(r.level, "red");
    assert.equal(r.daysToStockout, 0);
    assert.equal(r.recommendedOrder, 200);
  });
  test("stock négatif : signalé comme anomalie, jamais ramené à zéro", () => {
    const r = computeCoverage({ ...base, stock: -20 }, T);
    assert.ok(r.coverageMonths !== null && r.coverageMonths < 0);
    assert.equal(r.level, "red");
    assert.equal(r.recommendedOrder, 220);
  });
  test("aucune vente : pas de rotation, aucune commande conseillée", () => {
    const r = computeCoverage({ ...base, avgMonthly: 0 }, T);
    assert.equal(r.coverageMonths, null);
    assert.equal(r.level, "none");
    assert.equal(r.targetStock, 0);
    assert.equal(r.recommendedOrder, 0);
  });
  test("stock inconnu : on ne commande pas sur un stock qu'on ne connaît pas", () => {
    const r = computeCoverage({ ...base, stockKnown: false, stock: 0 }, T);
    assert.equal(r.level, "unknown");
    assert.equal(r.coverageMonths, null);
    assert.equal(r.recommendedOrder, 0);
  });
  test("ventes très faibles : couverture énorme, aucune commande", () => {
    const r = computeCoverage({ ...base, avgMonthly: 0.5 }, T);
    assert.equal(r.coverageMonths, 200);
    assert.equal(r.level, "green");
    assert.equal(r.recommendedOrder, 0);
  });
  test("stock déjà au-dessus de la cible : rien à commander", () => {
    assert.equal(computeCoverage({ ...base, stock: 500 }, T).recommendedOrder, 0);
  });
});

describe("isUnderTension — définition unique du produit en tension", () => {
  test("couverture courte ET rotation réelle", () => {
    assert.equal(isUnderTension({ coverageMonths: 1.2, avgMonthly: 50 }, TENSION), true);
  });
  test("couverture courte mais rotation négligeable : pas d'enjeu", () => {
    assert.equal(isUnderTension({ coverageMonths: 0.4, avgMonthly: 12 }, TENSION), false);
  });
  test("couverture confortable : jamais en tension", () => {
    assert.equal(isUnderTension({ coverageMonths: 3, avgMonthly: 500 }, TENSION), false);
  });
  test("couverture inconnue : jamais en tension (on n'alerte pas sur une inconnue)", () => {
    assert.equal(isUnderTension({ coverageMonths: null, avgMonthly: 500 }, TENSION), false);
  });
  test("bornes strictes", () => {
    assert.equal(isUnderTension({ coverageMonths: 1.5, avgMonthly: 50 }, TENSION), false);
    assert.equal(isUnderTension({ coverageMonths: 1.49, avgMonthly: 30 }, TENSION), false);
    assert.equal(isUnderTension({ coverageMonths: 1.49, avgMonthly: 30.1 }, TENSION), true);
  });
});

describe("trendPct et marginPct", () => {
  test("tendance vs moyenne", () => {
    assert.equal(trendPct(60, 50), 20);
    assert.equal(trendPct(40, 50), -20);
  });
  test("aucune moyenne ou aucun mois : non calculable", () => {
    assert.equal(trendPct(60, 0), null);
    assert.equal(trendPct(null, 50), null);
  });
  test("marge brute", () => {
    assert.equal(marginPct(60, 100), 40);
    assert.equal(marginPct(null, 100), null);
    assert.equal(marginPct(60, 0), null);
  });
});
