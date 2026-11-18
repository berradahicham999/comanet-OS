/**
 * Goodies par détenteur (décision d'Hicham, 18/11/2026) : transfert en deux mouvements, refus au-delà du stock en main,
 * reçu / utilisé / en main par personne, charge du matériel à la facture fournisseur, migration 0062.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heldStockRefusal, holderLedger, transferMovements } from "@/lib/activations/shared";
import { materialChargeRows } from "@/lib/gestion/material-charges-shared";
import { DEFAULT_ACTIVATION_SETTINGS } from "@/lib/settings";

const HANANE = "0f2c9a1e-1111-4222-8333-944445555666";
const SARA = "1f2c9a1e-1111-4222-8333-944445555666";

describe("transfert", () => {
  test("deux mouvements : − chez qui donne, + chez qui reçoit", () => {
    assert.deepEqual(transferMovements({ from: null, to: HANANE, quantity: 50 }), [{ holder: null, quantity: -50 }, { holder: HANANE, quantity: 50 }]);
    assert.deepEqual(transferMovements({ from: HANANE, to: SARA, quantity: 5 }), [{ holder: HANANE, quantity: -5 }, { holder: SARA, quantity: 5 }]);
    assert.deepEqual(transferMovements({ from: HANANE, to: null, quantity: 3 }), [{ holder: HANANE, quantity: -3 }, { holder: null, quantity: 3 }], "rendre au stock central");
  });
  test("quantité entière positive, détenteurs différents", () => {
    assert.throws(() => transferMovements({ from: null, to: HANANE, quantity: 0 }), /entier positif/);
    assert.throws(() => transferMovements({ from: null, to: HANANE, quantity: 2.5 }), /entier positif/);
    assert.throws(() => transferMovements({ from: null, to: HANANE, quantity: -4 }), /entier positif/);
    assert.throws(() => transferMovements({ from: HANANE, to: HANANE, quantity: 1 }), /les mêmes/);
    assert.throws(() => transferMovements({ from: null, to: null, quantity: 1 }), /les mêmes/);
  });
});

describe("refus au-delà du stock en main", () => {
  test("jusqu'au dernier goodie, pas un de plus", () => {
    assert.equal(heldStockRefusal({ available: 50, quantity: -30, itemName: "Trousse", holderLabel: "Hanane" }), null);
    assert.equal(heldStockRefusal({ available: 50, quantity: -50, itemName: "Trousse", holderLabel: "Hanane" }), null);
    assert.equal(heldStockRefusal({ available: 0, quantity: 10, itemName: "Trousse", holderLabel: "Hanane" }), null, "une entrée passe toujours");
    assert.equal(heldStockRefusal({ available: 50, quantity: -51, itemName: "Trousse", holderLabel: "Hanane" }), "Stock insuffisant pour « Trousse » chez Hanane : 50 disponibles, 51 demandés.");
  });
  test("même règle au stock central", () => {
    assert.equal(heldStockRefusal({ available: 1, quantity: -2, itemName: "Stylo", holderLabel: null }), "Stock insuffisant pour « Stylo » au stock central : 1 disponible, 2 demandés.");
  });
});

describe("reçu, utilisé, en main", () => {
  test("50 reçus, 30 utilisés en opération → 20 en main", () => {
    const l = holderLedger([
      { type: "TRANSFERT", quantity: 50, activationId: null },
      { type: "SORTIE", quantity: -30, activationId: "op" },
    ]);
    assert.deepEqual(l, { received: 50, given: 0, usedOnOperations: 30, other: 0, held: 20, unaccounted: 20 });
  });
  test("don à une collègue, retour d'opération, correction de la direction", () => {
    const l = holderLedger([
      { type: "TRANSFERT", quantity: 40, activationId: null },
      { type: "TRANSFERT", quantity: -10, activationId: null },
      { type: "SORTIE", quantity: -12, activationId: "op" },
      { type: "ENTREE", quantity: 2, activationId: "op" },
      { type: "AJUSTEMENT", quantity: -3, activationId: null },
    ]);
    assert.deepEqual(l, { received: 40, given: 10, usedOnOperations: 10, other: -3, held: 17, unaccounted: 20 });
  });
});

describe("charge du matériel à la facture fournisseur", () => {
  const items = new Map([
    ["g", { brandId: "b1", budgetCategory: "GOODIES", name: "Trousse" }],
    ["n", { brandId: null, budgetCategory: "PLV", name: "Présentoir" }],
  ]);
  const lines = [
    { id: "l1", inventoryItemId: "g", designation: "Trousse", netHtMad: "1200.00" },
    { id: "l2", inventoryItemId: null, designation: "Produit", netHtMad: "900.00" },
    { id: "l3", inventoryItemId: "n", designation: "Présentoir", netHtMad: "300.00" },
  ];
  test("désactivée par défaut : rien n'est compté deux fois avec les saisies manuelles", () => {
    assert.equal(DEFAULT_ACTIVATION_SETTINGS.materialChargeFrom, null);
    assert.deepEqual(materialChargeRows({ lines, items, from: null, date: "2026-11-18", invoiceLabel: "FF1" }), { rows: [], skipped: [] });
    assert.deepEqual(materialChargeRows({ lines, items, from: "2026-12-01", date: "2026-11-18", invoiceLabel: "FF1" }).rows, [], "facture antérieure à la date réglée");
  });
  test("une dépense par ligne de matériel, HT en MAD, sur la marque et la catégorie de l'article ; sans marque : signalée", () => {
    const r = materialChargeRows({ lines, items, from: "2026-11-01", date: "2026-11-18", invoiceLabel: "FF1" });
    assert.deepEqual(r.rows, [{ purchaseLineId: "l1", brandId: "b1", category: "GOODIES", label: "FF1 — Trousse", amount: "1200.00" }]);
    assert.deepEqual(r.skipped.map((x) => x.designation), ["Présentoir"]);
  });
});

describe("migration 0062", () => {
  test("au journal, avec le détenteur, le transfert et le lien facture → dépense", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string; idx: number }[] };
    const e = journal.entries.find((x) => x.tag === "0062_goodies_par_detenteur");
    assert.ok(e && e.idx === 62);
    const sqlText = readFileSync("drizzle/0062_goodies_par_detenteur.sql", "utf8");
    for (const s of ["\"holder_user_id\"", "\"transfer_id\"", "\"purchase_line_id\"", "marketing_expenses_purchase_line_uq"]) assert.ok(sqlText.includes(s), s);
  });
});
