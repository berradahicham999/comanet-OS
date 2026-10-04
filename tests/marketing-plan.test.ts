/**
 * Plan marketing — logique pure : cadrage, chaîne budgétaire, mois, retard d'une action, répartition d'un
 * budget mensuel, allocation proposée (historique réel × verdict de canal, « non mesurable » sans historique).
 * Aucune base, aucun appel réseau.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MARKETING_PLAN } from "@/lib/settings";
import { actionLateDays, budgetChain, monthsBetween, planFraming, splitMonthBudget } from "@/lib/marketing-plan/shared";
import { proposeAllocation, type HistoryLine } from "@/lib/marketing-plan/allocation";

describe("cadrage du plan", () => {
  test("taux marketing = budget ÷ CA objectif ; reste à allouer = budget − lignes", () => {
    const f = planFraming({ revenueTarget: 5_000_000, budget: 1_000_000, allocationLines: [{ amount: 300_000 }, { amount: 150_000 }], axes: [{ budget: 200_000 }] });
    assert.equal(f.marketingRatePct, 20);
    assert.equal(f.allocated, 450_000);
    assert.equal(f.unallocated, 550_000);
    assert.equal(f.unassignedToAxes, 800_000);
  });
  test("sans budget ou sans CA objectif : taux et restes non mesurables (null, jamais 0)", () => {
    const f = planFraming({ revenueTarget: null, budget: null, allocationLines: [{ amount: 100 }], axes: [] });
    assert.equal(f.marketingRatePct, null);
    assert.equal(f.unallocated, null);
    assert.equal(f.budget, null);
    assert.equal(planFraming({ revenueTarget: 0, budget: 10, allocationLines: [], axes: [] }).marketingRatePct, null);
  });
  test("chaîne planifié → engagé → reste", () => {
    const c = budgetChain({ planned: 1_000_000, allocated: 900_000, committed: 650_000, spent: 430_000 });
    assert.equal(c.remaining, 350_000);
    assert.equal(c.committedPct, 65);
    assert.equal(budgetChain({ planned: null, allocated: 0, committed: 10, spent: 0 }).remaining, null);
  });
});

describe("mois et actions", () => {
  test("monthsBetween énumère les premiers jours, bornes incluses", () => {
    assert.deepEqual(monthsBetween("2027-01-01", "2027-03-31"), ["2027-01-01", "2027-02-01", "2027-03-01"]);
    assert.deepEqual(monthsBetween("2027-11-15", "2028-01-10"), ["2027-11-01", "2027-12-01", "2028-01-01"]);
    assert.deepEqual(monthsBetween("2027-03-01", "2027-01-01"), []);
  });
  test("retard d'une action : seulement ouverte et après l'échéance", () => {
    assert.equal(actionLateDays({ status: "TODO", dueDate: "2026-10-01" }, "2026-10-04"), 3);
    assert.equal(actionLateDays({ status: "BLOCKED", dueDate: "2026-10-01" }, "2026-10-04"), 3);
    assert.equal(actionLateDays({ status: "DONE", dueDate: "2026-10-01" }, "2026-10-04"), 0);
    assert.equal(actionLateDays({ status: "TODO", dueDate: null }, "2026-10-04"), 0);
    assert.equal(actionLateDays({ status: "TODO", dueDate: "2026-10-04" }, "2026-10-04"), 0);
  });
  test("répartition d'un budget mensuel au prorata de l'allocation, somme exacte, arrondi à 100", () => {
    const lines = splitMonthBudget(50_000, [{ category: "META", amount: 300_000 }, { category: "INFLUENCE", amount: 150_000 }, { category: "TRADE", amount: 200_000 }, { category: "GOODIES", amount: 0 }]);
    assert.equal(lines.reduce((s, l) => s + l.amount, 0), 50_000);
    assert.equal(lines.length, 3);
    for (const l of lines) assert.equal(l.amount % 100, 0, `${l.category} arrondi`);
    assert.deepEqual(splitMonthBudget(0, [{ category: "META", amount: 10 }]), []);
    assert.deepEqual(splitMonthBudget(1000, []), []);
  });
});

describe("allocation proposée", () => {
  const settings = { ...DEFAULT_MARKETING_PLAN, testingSharePct: 0 };
  const history: HistoryLine[] = [
    { category: "META", amount: 300_000, source: "REGIE" }, { category: "INFLUENCE", amount: 150_000, source: "DEPENSES" },
    { category: "TRADE", amount: 200_000, source: "DEPENSES" }, { category: "ANIMATION", amount: 120_000, source: "DEPENSES" },
  ];
  test("sans historique suffisant : NON MESURABLE, aucune ligne inventée", () => {
    const p = proposeAllocation({ budget: 1_000_000, history: [{ category: "META", amount: 5_000, source: "DEPENSES" }], historyYear: 2026, verdicts: [], settings });
    assert.equal(p.measurable, false);
    if (!p.measurable) assert.match(p.reason, /insuffisant/);
  });
  test("sans budget : NON MESURABLE", () => {
    const p = proposeAllocation({ budget: null, history, historyYear: 2026, verdicts: [], settings });
    assert.equal(p.measurable, false);
  });
  test("sans verdict : reproduit les parts réelles, somme = budget, confirmé en base", () => {
    const p = proposeAllocation({ budget: 1_000_000, history, historyYear: 2026, verdicts: [], settings });
    assert.ok(p.measurable);
    if (!p.measurable) return;
    assert.equal(p.lines.reduce((s, l) => s + l.amount, 0), 1_000_000);
    const meta = p.lines.find((l) => l.category === "META")!;
    assert.equal(Math.round(meta.sharePct), 39); // 300 / 770
    assert.equal(meta.basis, "HISTORIQUE");
    assert.equal(meta.tag, "CALCULATED");
    assert.match(meta.why, /confirmé/);
    assert.ok(p.notes.some((n) => /Aucun verdict/.test(n)));
  });
  test("verdicts : SCALE augmente la part, STOP la réduit, la somme reste le budget", () => {
    const base = proposeAllocation({ budget: 1_000_000, history, historyYear: 2026, verdicts: [], settings });
    const p = proposeAllocation({ budget: 1_000_000, history, historyYear: 2026, verdicts: [{ category: "META", verdict: "SCALE", headline: "coût en baisse" }, { category: "INFLUENCE", verdict: "STOP", headline: "aucun résultat" }], settings });
    assert.ok(base.measurable && p.measurable);
    if (!base.measurable || !p.measurable) return;
    const metaBefore = base.lines.find((l) => l.category === "META")!.amount, metaAfter = p.lines.find((l) => l.category === "META")!.amount;
    const inflBefore = base.lines.find((l) => l.category === "INFLUENCE")!.amount, inflAfter = p.lines.find((l) => l.category === "INFLUENCE")!.amount;
    assert.ok(metaAfter > metaBefore, "SCALE → part en hausse");
    assert.ok(inflAfter < inflBefore, "STOP → part en baisse");
    assert.equal(p.lines.reduce((s, l) => s + l.amount, 0), 1_000_000);
    const infl = p.lines.find((l) => l.category === "INFLUENCE")!;
    assert.equal(infl.adjustmentPct, -settings.stopAdjustPct);
    assert.equal(infl.basis, "HISTORIQUE_AJUSTE");
    assert.match(infl.why, /STOP/);
  });
  test("réserve de tests : une ligne TESTS, somme exacte", () => {
    const p = proposeAllocation({ budget: 1_000_000, history, historyYear: 2026, verdicts: [], settings: { ...settings, testingSharePct: 2 } });
    assert.ok(p.measurable);
    if (!p.measurable) return;
    const t = p.lines.find((l) => l.basis === "TESTS")!;
    assert.equal(t.amount, 20_000);
    assert.equal(p.lines.reduce((s, l) => s + l.amount, 0), 1_000_000);
  });
});
