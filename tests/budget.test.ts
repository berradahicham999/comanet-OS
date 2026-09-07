/** Budget consommé : la définition officielle (`foldConsumption` dans `src/lib/budget.ts`). */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { foldConsumption } from "@/lib/budget";

const zero = { annual: 0, planned: 0, committedAll: 0, spentAll: 0, manualAdCommitted: 0, manualAdSpent: 0, regieSpend: 0, regieRows: 0 };

describe("budget consommé", () => {
  test("aucune dépense : consommé nul, taux 0 %", () => {
    const c = foldConsumption("b", { ...zero, annual: 100_000 });
    assert.equal(c.consumed, 0);
    assert.equal(c.consumedPct, 0);
    assert.equal(c.remaining, 100_000);
  });

  test("PLANNED n'entre pas dans le consommé", () => {
    const c = foldConsumption("b", { ...zero, annual: 100_000, planned: 40_000 });
    assert.equal(c.consumed, 0);
    assert.equal(c.planned, 40_000);
  });

  test("COMMITTED et SPENT sont consommés", () => {
    const c = foldConsumption("b", { ...zero, annual: 100_000, committedAll: 60_000, spentAll: 25_000 });
    assert.equal(c.consumed, 60_000);
    assert.equal(c.spent, 25_000);
    assert.equal(c.consumedPct, 60);
  });

  test("budget dépassé : taux au-dessus de 100 %, restant négatif", () => {
    const c = foldConsumption("b", { ...zero, annual: 100_000, committedAll: 130_000 });
    assert.equal(c.consumedPct, 130);
    assert.equal(c.remaining, -30_000);
  });

  test("régie présente : elle fait foi et remplace le média saisi (pas de double compte)", () => {
    const c = foldConsumption("b", {
      ...zero, annual: 100_000,
      committedAll: 60_000, manualAdCommitted: 20_000,
      regieSpend: 35_000, regieRows: 120,
    });
    assert.equal(c.adSource, "REGIE");
    assert.equal(c.adSpend, 35_000);
    assert.equal(c.committed, 40_000);          // 60 000 − 20 000 de média saisi
    assert.equal(c.consumed, 75_000);           // 40 000 + 35 000 de régie
    assert.equal(c.manualAdIgnored, 20_000);
  });

  test("sans régie : le média saisi fait foi et n'est compté qu'une fois", () => {
    const c = foldConsumption("b", { ...zero, annual: 100_000, committedAll: 60_000, manualAdCommitted: 20_000 });
    assert.equal(c.adSource, "SAISIE");
    assert.equal(c.adSpend, 20_000);
    assert.equal(c.committed, 60_000);
    assert.equal(c.consumed, 60_000);
    assert.equal(c.manualAdIgnored, 0);
  });

  test("aucun budget défini : taux et restant non calculables, jamais 0 %", () => {
    const c = foldConsumption("b", { ...zero, committedAll: 30_000 });
    assert.equal(c.hasBudget, false);
    assert.equal(c.consumedPct, null);
    assert.equal(c.remaining, null);
    assert.equal(c.consumed, 30_000);
  });

  test("budget négatif : traité comme absent", () => {
    const c = foldConsumption("b", { ...zero, annual: -5_000, committedAll: 1_000 });
    assert.equal(c.hasBudget, false);
    assert.equal(c.consumedPct, null);
  });

  test("dépense négative (remboursement saisi) : elle diminue le consommé", () => {
    const c = foldConsumption("b", { ...zero, annual: 100_000, committedAll: 40_000 - 5_000 });
    assert.equal(c.consumed, 35_000);
  });

  test("aucune dépense publicitaire d'aucune sorte", () => {
    const c = foldConsumption("b", { ...zero, annual: 10_000, committedAll: 1_000 });
    assert.equal(c.adSource, "AUCUNE");
    assert.equal(c.adSpend, 0);
  });
});
