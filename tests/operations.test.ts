/**
 * Opérations de terrain (décision d'Hicham, 18/11/2026) : seuil de validation, chemins de statut lus dans le référentiel,
 * poste « Offre / UG » hors dépense, goodies prévus, migration 0061.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  exceedsAutoApprove, operationLaunchTarget, autoApproveRefusal, requalifyTarget, closeTarget, cleanPlannedMaterials, expenseRowsFor,
  type ActivationStatusRef,
} from "@/lib/activations/shared";
import { DEFAULT_ACTIVATION_SETTINGS } from "@/lib/settings";

const S = (key: string, f: Partial<ActivationStatusRef> = {}): ActivationStatusRef => ({
  key, label: key, tone: "gray", sort: 0, active: true, awaitingValidation: false, isValidated: false, isRunning: false, isDone: false, isMeasured: false, isArchived: false, isCancelled: false, ...f,
});
/** Le référentiel livré (migrations 0016 + 0061), réduit à ce qui compte ici. */
const statuses = [
  S("IDEE"), S("PROPOSEE", { awaitingValidation: true }), S("PLANIFIEE", { isValidated: true }), S("VALIDEE", { isValidated: true }),
  S("EN_PREPARATION", { isValidated: true }), S("EN_COURS", { isValidated: true, isRunning: true }), S("TERMINEE", { isValidated: true, isDone: true }),
  S("ANNULEE", { isCancelled: true }),
];
const T = (fromKey: string, toKey: string, requiresValidator = false) => ({ fromKey, toKey, requiresValidator, requiresComment: false, label: null });
const transitions = [
  T("IDEE", "PROPOSEE"), T("IDEE", "PLANIFIEE"), T("IDEE", "ANNULEE"), T("PROPOSEE", "VALIDEE", true), T("PROPOSEE", "IDEE", true),
  T("PLANIFIEE", "PROPOSEE"), T("PLANIFIEE", "EN_COURS"), T("PLANIFIEE", "TERMINEE"), T("PLANIFIEE", "ANNULEE"),
  T("VALIDEE", "EN_PREPARATION"), T("VALIDEE", "PROPOSEE", true), T("VALIDEE", "TERMINEE"), T("EN_COURS", "TERMINEE"),
];
const refs = { statuses, transitions };
const MAX = DEFAULT_ACTIVATION_SETTINGS.autoApproveMax;

describe("seuil de validation", () => {
  test("500 MAD par défaut, au centime", () => {
    assert.equal(MAX, 500);
    assert.equal(exceedsAutoApprove(499, MAX), false);
    assert.equal(exceedsAutoApprove(500, MAX), false);
    assert.equal(exceedsAutoApprove(500.01, MAX), true);
    assert.equal(exceedsAutoApprove(501, MAX), true);
  });
  test("499 → planifiée sans validation, 501 → à valider", () => {
    assert.deepEqual(operationLaunchTarget(refs, "IDEE", 499, MAX), { to: "PLANIFIEE", needsValidation: false });
    assert.deepEqual(operationLaunchTarget(refs, "IDEE", 500, MAX), { to: "PLANIFIEE", needsValidation: false });
    assert.deepEqual(operationLaunchTarget(refs, "IDEE", 501, MAX), { to: "PROPOSEE", needsValidation: true });
    assert.deepEqual(operationLaunchTarget(refs, "IDEE", 0, MAX), { to: "PLANIFIEE", needsValidation: false });
  });
  test("un seuil modifié dans les réglages s'applique", () => {
    assert.deepEqual(operationLaunchTarget(refs, "IDEE", 800, 1000), { to: "PLANIFIEE", needsValidation: false });
    assert.deepEqual(operationLaunchTarget(refs, "IDEE", 1, 0), { to: "PROPOSEE", needsValidation: true });
  });
  test("sans chemin dans le référentiel : rien", () => {
    assert.equal(operationLaunchTarget({ statuses, transitions: [] }, "IDEE", 100, MAX), null);
  });
  test("garde de transitionActivation() : refuse au non-validateur au-dessus du seuil seulement", () => {
    const base = { fromValidated: false, toValidated: true, isValidator: false, autoApproveMax: MAX };
    assert.equal(autoApproveRefusal({ ...base, planned: 499 }), null);
    assert.match(autoApproveRefusal({ ...base, planned: 501 }) ?? "", /au-dessus du seuil de 500 MAD/);
    assert.equal(autoApproveRefusal({ ...base, planned: 501, isValidator: true }), null, "la direction valide");
    assert.equal(autoApproveRefusal({ ...base, planned: 501, fromValidated: true }), null, "déjà validée : on avance");
    assert.equal(autoApproveRefusal({ ...base, planned: 501, toValidated: false }), null, "vers l'attente : toujours permis");
  });
  test("budget porté au-dessus du seuil : une opération partie seule retourne à la direction, pas une opération validée par elle", () => {
    assert.equal(requalifyTarget(refs, "PLANIFIEE", 600, MAX), "PROPOSEE");
    assert.equal(requalifyTarget(refs, "PLANIFIEE", 400, MAX), null);
    assert.equal(requalifyTarget(refs, "VALIDEE", 600, MAX), null);
    assert.equal(requalifyTarget(refs, "EN_COURS", 600, MAX), null);
    assert.equal(requalifyTarget(refs, "IDEE", 600, MAX), null);
  });
  test("clôture depuis le terrain : planifiée ou validée → terminée, jamais en attente", () => {
    assert.equal(closeTarget(refs, "PLANIFIEE"), "TERMINEE");
    assert.equal(closeTarget(refs, "VALIDEE"), "TERMINEE");
    assert.equal(closeTarget(refs, "PROPOSEE"), null);
    assert.equal(closeTarget(refs, "ANNULEE"), null);
  });
});

describe("poste « Offre / UG »", () => {
  test("chiffré au budget mais jamais reflété en dépense marketing (les UG sont au coût des ventes du BL)", () => {
    const rows = expenseRowsFor({
      status: S("PLANIFIEE", { isValidated: true }), brandId: "b", productId: null, date: "2026-11-20",
      lines: [
        { id: "1", costItemKey: "GOODIES", label: "Goodies", planned: 200, committed: 0, spent: 0, brandId: null, date: null },
        { id: "2", costItemKey: "OFFRE_UG", label: "Offre : 10 + 2", planned: 300, committed: 0, spent: 0, brandId: null, date: null },
      ],
      costItems: [
        { key: "GOODIES", label: "Goodies", sort: 1, active: true, budgetCategory: "GOODIES" },
        { key: "OFFRE_UG", label: "Offre / UG", sort: 2, active: true, budgetCategory: "TRADE", reflectsExpense: false },
      ],
      materials: [], inventoryCategories: [],
    });
    assert.deepEqual(rows.map((r) => [r.ref, r.amount, r.status]), [["LINE:1", 200, "COMMITTED"]]);
  });
});

describe("goodies prévus", () => {
  test("nettoyés : article valide, quantité entière positive, regroupés", () => {
    const a = "0f2c9a1e-1111-4222-8333-944445555666", b = "1f2c9a1e-1111-4222-8333-944445555666";
    assert.deepEqual(cleanPlannedMaterials([{ itemId: a, quantity: 10 }, { itemId: a, quantity: "5" }, { itemId: b, quantity: 0 }, { itemId: "x", quantity: 3 }, { itemId: b, quantity: 2.4 }]),
      [{ itemId: a, quantity: 15 }, { itemId: b, quantity: 2 }]);
    assert.deepEqual(cleanPlannedMaterials("nope"), []);
  });
});

describe("migration 0061", () => {
  test("au journal, avec le statut, les transitions, les types, l'offre et le poste hors dépense", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    assert.ok(journal.entries.some((e) => e.tag === "0061_operations_terrain"));
    const sqlText = readFileSync("drizzle/0061_operations_terrain.sql", "utf8");
    for (const s of ["'PLANIFIEE', 'Planifiée'", "('IDEE', 'PLANIFIEE', false", "('PLANIFIEE', 'PROPOSEE', false", "('PLANIFIEE', 'TERMINEE', false", "'GROSSISTE'", "'EVENEMENT_PARA'", "\"offer_label\"", "\"planned_materials\"", "('OFFRE_UG', 'Offre / UG', 'TRADE', 14, false)"]) {
      assert.ok(sqlText.includes(s), s);
    }
  });
});
