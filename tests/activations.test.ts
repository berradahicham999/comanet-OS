/**
 * Activations : transitions, budget, reflet dans marketing_expenses, retards, modèles —
 * logique pure de `src/lib/activations/shared.ts`. Les statuts utilisés ici sont des données
 * de test : le code ne connaît aucun nom de statut.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkTransition, nextTransitions, budgetTotals, expenseRowsFor, activationLateness, applyActivationTemplate,
  durationDays, measurementWindows, unitCost, inventoryStatus, compareSales, roiVerdict, type ActivationStatusRef, type TransitionRef, type CostItemRef, type InventoryCategoryRef,
} from "@/lib/activations/shared";
import { DEFAULT_ACTIVATION_SETTINGS } from "@/lib/settings";

const S = (key: string, sort: number, flags: Partial<ActivationStatusRef> = {}): ActivationStatusRef => ({
  key, label: key, tone: "gray", sort, active: true,
  awaitingValidation: false, isValidated: false, isRunning: false, isDone: false, isMeasured: false, isArchived: false, isCancelled: false, ...flags,
});
const statuses: ActivationStatusRef[] = [
  S("IDEE", 1), S("PROPOSEE", 2, { awaitingValidation: true }), S("VALIDEE", 3, { isValidated: true }),
  S("EN_COURS", 4, { isValidated: true, isRunning: true }), S("TERMINEE", 5, { isValidated: true, isDone: true }),
  S("MESUREE", 6, { isValidated: true, isDone: true, isMeasured: true }), S("ARCHIVEE", 7, { isValidated: true, isDone: true, isArchived: true }),
  S("ANNULEE", 8, { isCancelled: true }),
];
const T = (fromKey: string, toKey: string, requiresValidator = false, requiresComment = false): TransitionRef => ({ fromKey, toKey, requiresValidator, requiresComment, label: null });
const transitions = [T("IDEE", "PROPOSEE"), T("PROPOSEE", "VALIDEE", true), T("PROPOSEE", "IDEE", true, true), T("VALIDEE", "EN_COURS"), T("EN_COURS", "TERMINEE"), T("TERMINEE", "MESUREE"), T("VALIDEE", "ANNULEE", true, true)];
const st = (k: string) => statuses.find((s) => s.key === k);

describe("Transitions d'une activation", () => {
  test("une transition absente du référentiel est refusée", () => {
    assert.equal(checkTransition(transitions, "IDEE", "VALIDEE", { isValidator: true }).ok, false);
  });
  test("valider exige un validateur ; refuser exige un validateur ET un commentaire", () => {
    assert.equal(checkTransition(transitions, "PROPOSEE", "VALIDEE", { isValidator: false }).ok, false);
    assert.equal(checkTransition(transitions, "PROPOSEE", "VALIDEE", { isValidator: true }).ok, true);
    assert.equal(checkTransition(transitions, "PROPOSEE", "IDEE", { isValidator: true, comment: " " }).ok, false);
    assert.equal(checkTransition(transitions, "PROPOSEE", "IDEE", { isValidator: true, comment: "Budget trop élevé" }).ok, true);
  });
  test("annuler une activation validée est réservé au validateur, avec commentaire", () => {
    assert.equal(checkTransition(transitions, "VALIDEE", "ANNULEE", { isValidator: false, comment: "x" }).ok, false);
    assert.equal(checkTransition(transitions, "VALIDEE", "ANNULEE", { isValidator: true, comment: "Salle indisponible" }).ok, true);
  });
  test("les transitions proposées sont triées et indiquent celles réservées au validateur", () => {
    const next = nextTransitions({ statuses, transitions }, "PROPOSEE", false);
    assert.deepEqual(next.map((t) => [t.toKey, t.allowed]), [["IDEE", false], ["VALIDEE", false]]);
  });
});

const costItems: CostItemRef[] = [
  { key: "LIEU", label: "Lieu", budgetCategory: "EVENEMENT", sort: 1, active: true },
  { key: "ECHANTILLONS", label: "Échantillons", budgetCategory: "ECHANTILLONS", sort: 2, active: true },
];
const invCats: InventoryCategoryRef[] = [{ key: "PLV", label: "PLV", budgetCategory: "PLV", sort: 1, active: true }];
const line = (id: string, costItemKey: string, planned: number, committed = 0, spent = 0, brandId: string | null = null) =>
  ({ id, costItemKey, label: costItemKey, brandId, date: null, planned, committed, spent });

describe("Budget d'une activation", () => {
  test("totaux : l'engagé effectif d'une ligne est le plus grand de engagé et dépensé", () => {
    const t = budgetTotals([line("1", "LIEU", 10000, 9000, 9500), line("2", "ECHANTILLONS", 2000, 0, 0)], [{ quantity: 50, unitCost: 12 }]);
    assert.equal(t.planned, 12000);
    assert.equal(t.committed, 9500);
    assert.equal(t.spent, 9500);
    assert.equal(t.materials, 600);
    assert.equal(t.fullCost, 10100);
    assert.equal(t.remaining, 12000 - 9500 - 600);
    assert.equal(t.overrunPct, 0);
  });
  test("sur une activation validée, une ligne sans devis ni facture est engagée pour son prévu", () => {
    const t = budgetTotals([line("1", "LIEU", 10000), line("2", "ECHANTILLONS", 2000, 1500)], [], { validated: true });
    assert.equal(t.committed, 11500);
    assert.equal(budgetTotals([line("1", "LIEU", 10000)], [], { validated: false }).committed, 0);
  });
  test("dépassement : engagé + matériel au-delà du prévu", () => {
    const t = budgetTotals([line("1", "LIEU", 1000, 1200)], []);
    assert.equal(Math.round(t.overrunPct), 20);
    assert.ok(t.remaining < 0);
  });
  test("une activation non validée ne pèse pas dans le Command Center", () => {
    const rows = expenseRowsFor({ status: st("PROPOSEE"), brandId: "b1", productId: null, date: "2026-10-01", lines: [line("1", "LIEU", 5000)], costItems, materials: [], inventoryCategories: invCats });
    assert.deepEqual(rows, []);
  });
  test("une activation validée engage chaque poste (devis sinon prévu) avec la catégorie budgétaire du poste", () => {
    const rows = expenseRowsFor({ status: st("VALIDEE"), brandId: "b1", productId: "p1", date: "2026-10-01", lines: [line("1", "LIEU", 5000), line("2", "ECHANTILLONS", 800, 700), line("3", "LIEU", 0)], costItems, materials: [], inventoryCategories: invCats });
    assert.deepEqual(rows.map((r) => [r.ref, r.category, r.amount, r.status]), [["LINE:1", "EVENEMENT", 5000, "COMMITTED"], ["LINE:2", "ECHANTILLONS", 700, "COMMITTED"]]);
    assert.ok(rows.every((r) => r.brandId === "b1" && r.productId === "p1"));
  });
  test("une facture saisie devient une dépense, et survit à l'annulation (l'argent est sorti)", () => {
    const lines = [line("1", "LIEU", 5000, 5000, 5200), line("2", "ECHANTILLONS", 800)];
    const ok = expenseRowsFor({ status: st("EN_COURS"), brandId: "b1", productId: null, date: "2026-10-01", lines, costItems, materials: [], inventoryCategories: invCats });
    assert.deepEqual(ok.map((r) => [r.ref, r.amount, r.status]), [["LINE:1", 5200, "SPENT"], ["LINE:2", 800, "COMMITTED"]]);
    const cancelled = expenseRowsFor({ status: st("ANNULEE"), brandId: "b1", productId: null, date: "2026-10-01", lines, costItems, materials: [], inventoryCategories: invCats });
    assert.deepEqual(cancelled.map((r) => [r.ref, r.amount, r.status]), [["LINE:1", 5200, "SPENT"]]);
  });
  test("le matériel consommé est une dépense par catégorie d'inventaire et par marque", () => {
    const rows = expenseRowsFor({ status: st("VALIDEE"), brandId: "b1", productId: null, date: "2026-10-01", lines: [], costItems, materials: [{ quantity: 10, unitCost: 25, categoryKey: "PLV", brandId: null }, { quantity: 4, unitCost: 25, categoryKey: "PLV", brandId: "b2" }], inventoryCategories: invCats });
    assert.deepEqual(rows.map((r) => [r.ref, r.brandId, r.amount, r.status]), [["MATERIAL:PLV:b1", "b1", 250, "SPENT"], ["MATERIAL:PLV:b2", "b2", 100, "SPENT"]]);
  });
  test("une ligne dont la marque est inconnue n'est pas reflétée (jamais de dépense sans marque)", () => {
    const rows = expenseRowsFor({ status: st("VALIDEE"), brandId: null, productId: null, date: "2026-10-01", lines: [line("1", "LIEU", 100)], costItems, materials: [], inventoryCategories: invCats });
    assert.deepEqual(rows, []);
  });
});

describe("Retards d'une activation", () => {
  const s = DEFAULT_ACTIVATION_SETTINGS;
  const base = { endDate: null, hasResults: false, checklistTotal: 0, checklistDone: 0, totals: { planned: 0, overrunPct: 0 } };
  test("date de début passée sans démarrage", () => {
    assert.deepEqual(activationLateness({ ...base, date: "2026-09-01", status: "VALIDEE" }, statuses, s, "2026-09-07"), ["STATUT"]);
    assert.deepEqual(activationLateness({ ...base, date: "2026-09-01", status: "EN_COURS" }, statuses, s, "2026-09-07"), ["STATUT"]);
    assert.deepEqual(activationLateness({ ...base, date: "2026-09-01", endDate: "2026-09-30", status: "EN_COURS" }, statuses, s, "2026-09-07"), []);
  });
  test("résultats non saisis 15 jours après la fin", () => {
    assert.deepEqual(activationLateness({ ...base, date: "2026-08-01", status: "TERMINEE" }, statuses, s, "2026-08-10"), []);
    assert.deepEqual(activationLateness({ ...base, date: "2026-08-01", status: "TERMINEE" }, statuses, s, "2026-08-20"), ["RESULTATS"]);
    assert.deepEqual(activationLateness({ ...base, date: "2026-08-01", status: "TERMINEE", hasResults: true }, statuses, s, "2026-08-20"), []);
  });
  test("checklist incomplète à J-7", () => {
    const a = { ...base, date: "2026-09-10", status: "VALIDEE", checklistTotal: 5, checklistDone: 3 };
    assert.deepEqual(activationLateness(a, statuses, s, "2026-09-01"), []);
    assert.deepEqual(activationLateness(a, statuses, s, "2026-09-03"), ["CHECKLIST"]);
    assert.deepEqual(activationLateness({ ...a, checklistDone: 5 }, statuses, s, "2026-09-03"), []);
  });
  test("dépassement de budget", () => {
    assert.deepEqual(activationLateness({ ...base, date: "2026-10-01", status: "VALIDEE", totals: { planned: 1000, overrunPct: 12 } }, statuses, s, "2026-09-07"), ["BUDGET"]);
    assert.deepEqual(activationLateness({ ...base, date: "2026-10-01", status: "IDEE", totals: { planned: 1000, overrunPct: 12 } }, statuses, s, "2026-09-07"), []);
  });
  test("une activation archivée ou annulée n'est jamais en retard", () => {
    assert.deepEqual(activationLateness({ ...base, date: "2026-01-01", status: "ARCHIVEE" }, statuses, s, "2026-09-07"), []);
    assert.deepEqual(activationLateness({ ...base, date: "2026-01-01", status: "ANNULEE" }, statuses, s, "2026-09-07"), []);
  });
});

describe("Modèles, dates et coûts unitaires", () => {
  test("un modèle ne remplace jamais ce qui est déjà saisi, et dérive dates et lignes", () => {
    const out = applyActivationTemplate(
      { objectiveKey: "SELL_IN", description: "", date: "2026-10-10" },
      { objectiveKey: "LANCEMENT", targetKey: "PHARMACIENS", description: "Soirée", prepOffsetDays: 21, durationDays: 2, budgetLines: [{ costItemKey: "LIEU", planned: 15000 }], checklist: ["Lieu réservé"] },
      { key: "EVENEMENT", label: "Événement", icon: null, sort: 1, active: true, defaultModule: "marketing", defaultBudgetCategory: "EVENEMENT", defaultChecklist: ["Autre"] },
    );
    assert.equal(out.objectiveKey, "SELL_IN");
    assert.equal(out.targetKey, "PHARMACIENS");
    assert.equal(out.description, "Soirée");
    assert.equal(out.endDate, "2026-10-11");
    assert.equal(out.prepDate, "2026-09-19");
    assert.deepEqual(out.budgetLines, [{ costItemKey: "LIEU", label: "LIEU", planned: 15000, sort: 0 }]);
    assert.deepEqual(out.checklist, [{ label: "Lieu réservé", sort: 0 }]);
  });
  test("sans modèle, la checklist vient du type", () => {
    const out = applyActivationTemplate({ date: "2026-10-10" }, null, { key: "PLV", label: "PLV", icon: null, sort: 1, active: true, defaultModule: "clients", defaultBudgetCategory: "PLV", defaultChecklist: ["Accord du pharmacien", "Photo"] });
    assert.deepEqual(out.checklist.map((c) => c.label), ["Accord du pharmacien", "Photo"]);
    assert.equal(out.endDate, null);
  });
  test("durée et fenêtres de mesure", () => {
    assert.equal(durationDays("2026-10-10", null), 1);
    assert.equal(durationDays("2026-10-10", "2026-10-12"), 3);
    const w = measurementWindows("2026-10-10", "2026-10-12", { windowBeforeDays: 30, windowAfterDays: 30 });
    assert.deepEqual(w.before, { start: "2026-09-10", end: "2026-10-10" });
    assert.deepEqual(w.during, { start: "2026-10-10", end: "2026-10-13" });
    assert.deepEqual(w.after, { start: "2026-10-13", end: "2026-11-12" });
  });
  test("un coût unitaire n'est jamais estimé sans résultat saisi", () => {
    assert.equal(unitCost(1000, 40), 25);
    assert.equal(unitCost(1000, 0), null);
    assert.equal(unitCost(1000, null), null);
  });
});

describe("Statut d'un article d'inventaire", () => {
  const today = "2026-09-08";
  test("rupture, stock bas, dormant, OK", () => {
    assert.equal(inventoryStatus({ stock: 0, alertThreshold: 5, lastOutAt: "2026-09-01", createdAt: null }, today, 180), "RUPTURE");
    assert.equal(inventoryStatus({ stock: 4, alertThreshold: 5, lastOutAt: "2026-09-01", createdAt: null }, today, 180), "BAS");
    assert.equal(inventoryStatus({ stock: 40, alertThreshold: 5, lastOutAt: "2026-01-01", createdAt: null }, today, 180), "DORMANT");
    assert.equal(inventoryStatus({ stock: 40, alertThreshold: 5, lastOutAt: "2026-08-01", createdAt: null }, today, 180), "OK");
  });
  test("sans sortie, un article récent attend le délai avant d'être dormant", () => {
    assert.equal(inventoryStatus({ stock: 10, alertThreshold: null, lastOutAt: null, createdAt: "2026-08-20T10:00:00Z" }, today, 180), "OK");
    assert.equal(inventoryStatus({ stock: 10, alertThreshold: null, lastOutAt: null, createdAt: "2025-12-01T10:00:00Z" }, today, 180), "DORMANT");
    assert.equal(inventoryStatus({ stock: 10, alertThreshold: null, lastOutAt: null, createdAt: null }, today, 180), "DORMANT");
  });
});

describe("Mesure du retour", () => {
  const s = { ...DEFAULT_ACTIVATION_SETTINGS };
  test("comparaison en CA par jour, incrément sur pendant + après", () => {
    const c = compareSales({ days: 30, qty: 100, amount: 30000 }, { days: 2, qty: 20, amount: 4000 }, { days: 30, qty: 150, amount: 45000 }, "2026-08-31", "2026-09-08");
    assert.equal(c.beforePerDay, 1000); assert.equal(c.duringPerDay, 2000); assert.equal(c.afterPerDay, 1500);
    assert.equal(c.comparable, true);
    // rythme après (49000/32 = 1531,25) − rythme avant (1000) × 32 jours = 17 000
    assert.equal(Math.round(c.increment!), 17000);
    assert.equal(Math.round(c.upliftPct!), 50);
  });
  test("fenêtre après non écoulée : pas encore comparable, aucun écart inventé", () => {
    const c = compareSales({ days: 30, qty: 1, amount: 30000 }, { days: 1, qty: 0, amount: 0 }, { days: 30, qty: 0, amount: 0 }, "2026-09-20", "2026-09-08");
    assert.equal(c.comparable, false); assert.equal(c.daysUntilComparable, 12); assert.equal(c.increment, null); assert.equal(c.upliftPct, null);
  });
  test("aucune vente sur les trois fenêtres : rien à comparer, jamais un verdict « arrêter »", () => {
    const none = compareSales({ days: 30, qty: 0, amount: 0 }, { days: 1, qty: 0, amount: 0 }, { days: 30, qty: 0, amount: 0 }, "2026-08-31", "2026-09-08");
    assert.equal(none.comparable, true); assert.equal(none.increment, null);
    const v = roiVerdict({ fullCost: 5000, comparison: none, attributedRevenue: null, hasResults: true, hasSalesScope: true, unit: { contact: null, sample: null, pharmacy: null } }, s);
    assert.equal(v.verdict, "PAS_ENCORE"); assert.ok(v.analysis.some((x) => /Aucune vente/.test(x)));
  });
  test("verdict REFAIRE / AJUSTER / ARRÊTER / pas encore, avec données, analyse, hypothèses, recommandation", () => {
    const unit = { contact: 50, sample: null, pharmacy: null };
    const ok = compareSales({ days: 30, qty: 0, amount: 30000 }, { days: 1, qty: 0, amount: 3000 }, { days: 30, qty: 0, amount: 45000 }, "2026-08-31", "2026-09-08");
    const r1 = roiVerdict({ fullCost: 10000, comparison: ok, attributedRevenue: null, hasResults: true, hasSalesScope: true, unit }, s);
    assert.equal(r1.verdict, "REFAIRE"); assert.ok(r1.roi! > 1); assert.ok(r1.hypotheses.some((h) => /corrélation/.test(h)));
    const r2 = roiVerdict({ fullCost: 40000, comparison: ok, attributedRevenue: null, hasResults: true, hasSalesScope: true, unit }, s);
    assert.equal(r2.verdict, "AJUSTER");
    const flat = compareSales({ days: 30, qty: 0, amount: 30000 }, { days: 1, qty: 0, amount: 1000 }, { days: 30, qty: 0, amount: 29000 }, "2026-08-31", "2026-09-08");
    assert.equal(roiVerdict({ fullCost: 5000, comparison: flat, attributedRevenue: null, hasResults: false, hasSalesScope: true, unit }, s).verdict, "ARRETER");
    const soon = compareSales({ days: 30, qty: 0, amount: 30000 }, { days: 1, qty: 0, amount: 0 }, { days: 30, qty: 0, amount: 0 }, "2026-09-20", "2026-09-08");
    const r4 = roiVerdict({ fullCost: 5000, comparison: soon, attributedRevenue: null, hasResults: false, hasSalesScope: true, unit }, s);
    assert.equal(r4.verdict, "PAS_ENCORE"); assert.match(r4.recommendation, /12 j/);
    assert.equal(roiVerdict({ fullCost: 0, comparison: ok, attributedRevenue: null, hasResults: false, hasSalesScope: false, unit }, s).verdict, "PAS_ENCORE");
  });
});
