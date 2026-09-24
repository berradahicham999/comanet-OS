/**
 * Gestion commerciale — règles du journal de stock (src/lib/gestion/ledger-shared.ts).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { allocateFefo, balanceKey, balancesOf, expiryStatus, movementError, type MovementDraft, type WarehouseLike } from "@/lib/gestion/ledger-shared";

const WH = new Map<string, WarehouseLike>([
  ["PRINCIPAL", { key: "PRINCIPAL", kind: "INTERNE", active: true }],
  ["NON_VENDABLE", { key: "NON_VENDABLE", kind: "INTERNE", active: true }],
  ["COSPHARMA", { key: "COSPHARMA", kind: "EXTERNE", active: true }],
]);
const P = { id: "p1", name: "BEAUTY BOOST", kind: "PRODUIT", trackLots: false };
const LOT = { ...P, trackLots: true };
const m = (x: Partial<MovementDraft>): MovementDraft => ({ productId: "p1", type: "SORTIE_BL", quantity: "-6", warehouseKey: "PRINCIPAL", ...x });

describe("mouvements recevables", () => {
  test("mouvements normaux", () => {
    assert.equal(movementError(m({}), P, WH), null);
    assert.equal(movementError(m({ type: "STOCK_INITIAL", quantity: "100", unitCost: "124.375" }), P, WH), null);
    assert.equal(movementError(m({ type: "AJUSTEMENT_INVENTAIRE", quantity: "-2" }), P, WH), null);
    assert.equal(movementError(m({ type: "AJUSTEMENT_INVENTAIRE", quantity: "3" }), P, WH), null);
  });
  test("le sens doit correspondre au type", () => {
    assert.match(movementError(m({ quantity: "6" }), P, WH)!, /négative/);
    assert.match(movementError(m({ type: "ENTREE_ACHAT", quantity: "-6", unitCost: "10" }), P, WH)!, /positive/);
    assert.match(movementError(m({ type: "CASSE_PERIME", quantity: "2" }), P, WH)!, /négative/);
  });
  test("un contre-mouvement d'annulation porte le sens inverse", () => {
    assert.equal(movementError(m({ type: "STOCK_INITIAL", quantity: "-100", isReversal: true }), P, WH), null);
    assert.equal(movementError(m({ type: "SORTIE_BL", quantity: "6", isReversal: true }), P, WH), null);
  });
  test("quantité nulle ou illisible refusée", () => {
    assert.match(movementError(m({ quantity: "0" }), P, WH)!, /Quantité invalide/);
    assert.match(movementError(m({ quantity: "abc" }), P, WH)!, /Quantité invalide/);
  });
  test("jamais de mouvement dans un dépôt externe (connu par photo)", () => {
    assert.match(movementError(m({ warehouseKey: "COSPHARMA" }), P, WH)!, /externe/);
    assert.match(movementError(m({ warehouseKey: "INCONNU" }), P, WH)!, /inconnu/);
  });
  test("un service n'a pas de stock", () => {
    assert.match(movementError(m({}), { ...P, kind: "SERVICE" }, WH)!, /service/);
  });
  test("un article suivi par lot exige son lot", () => {
    assert.match(movementError(m({}), LOT, WH)!, /lot/);
    assert.equal(movementError(m({ lotNumber: "L2407" }), LOT, WH), null);
  });
  test("une entrée coûtée exige son coût", () => {
    assert.match(movementError(m({ type: "STOCK_INITIAL", quantity: "10" }), P, WH)!, /coût/);
    assert.match(movementError(m({ type: "ENTREE_ACHAT", quantity: "10", unitCost: "-1" }), P, WH)!, /coût/);
  });
  test("transfert : dépôt d'en face obligatoire et différent", () => {
    assert.match(movementError(m({ type: "TRANSFERT", quantity: "-2" }), P, WH)!, /dépôt d'en face/);
    assert.match(movementError(m({ type: "TRANSFERT", quantity: "-2", counterpartWarehouseKey: "PRINCIPAL" }), P, WH)!, /identiques/);
    assert.equal(movementError(m({ type: "TRANSFERT", quantity: "-2", counterpartWarehouseKey: "NON_VENDABLE" }), P, WH), null);
    assert.equal(movementError(m({ type: "TRANSFERT", quantity: "-2", counterpartWarehouseKey: "COSPHARMA" }), P, WH), null);
  });
  test("article introuvable", () => {
    assert.match(movementError(m({}), undefined, WH)!, /introuvable/);
  });
});

describe("stock = somme des mouvements", () => {
  test("soldes par article × dépôt × lot", () => {
    const b = balancesOf([
      { productId: "p1", warehouseKey: "PRINCIPAL", lotId: "a", quantity: "100.000" },
      { productId: "p1", warehouseKey: "PRINCIPAL", lotId: "a", quantity: "-6.000" },
      { productId: "p1", warehouseKey: "PRINCIPAL", lotId: "b", quantity: "20" },
      { productId: "p1", warehouseKey: "NON_VENDABLE", lotId: "a", quantity: "2" },
    ]);
    assert.equal(b.get(balanceKey("p1", "PRINCIPAL", "a")), 94000n);
    assert.equal(b.get(balanceKey("p1", "PRINCIPAL", "b")), 20000n);
    assert.equal(b.get(balanceKey("p1", "NON_VENDABLE", "a")), 2000n);
  });
});

describe("péremption", () => {
  test("statut à une date avec alerte à J − N", () => {
    assert.equal(expiryStatus("2026-09-01", "2026-09-24", 90), "PERIME");
    assert.equal(expiryStatus("2026-12-01", "2026-09-24", 90), "PROCHE");
    assert.equal(expiryStatus("2026-12-23", "2026-09-24", 90), "PROCHE");
    assert.equal(expiryStatus("2026-12-24", "2026-09-24", 90), "OK");
    assert.equal(expiryStatus(null, "2026-09-24", 90), null);
  });
});

describe("sortie au plus proche de la péremption (FEFO)", () => {
  const lots = [
    { lotId: "c", lotNumber: "C", expiryDate: null, available: 50_000n },
    { lotId: "b", lotNumber: "B", expiryDate: "2027-06-30", available: 10_000n },
    { lotId: "a", lotNumber: "A", expiryDate: "2027-01-31", available: 4_000n },
    { lotId: "x", lotNumber: "X", expiryDate: "2026-08-31", available: 99_000n },
  ];
  test("les lots les plus proches sortent d'abord, un lot sans date en dernier, un lot périmé jamais", () => {
    const r = allocateFefo(lots, 20_000n, "2026-09-24");
    assert.deepEqual(r.allocations.map((a) => [a.lotNumber, a.qty]), [["A", 4_000n], ["B", 10_000n], ["C", 6_000n]]);
    assert.equal(r.missing, 0n);
  });
  test("quantité manquante quand le stock utilisable ne suffit pas", () => {
    const r = allocateFefo(lots, 70_000n, "2026-09-24");
    assert.equal(r.missing, 6_000n);
    assert.ok(!r.allocations.some((a) => a.lotNumber === "X"));
  });
  test("rien à sortir", () => {
    assert.deepEqual(allocateFefo(lots, 0n, "2026-09-24"), { allocations: [], missing: 0n });
  });
});
