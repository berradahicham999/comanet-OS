/** Gestion commerciale — achats (src/lib/gestion/purchases-shared.ts). */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  allocateLandedCosts, computePurchase, invoiceGaps, isLateOrder, orderStatusAfterReceipt, purchaseActions, rateError,
  receptionStatusAfterInvoice, remaining, unitCostMad,
} from "@/lib/gestion/purchases-shared";

describe("montants d'une pièce d'achat", () => {
  test("en dirhams : ligne = qté × prix × (1 − remise), TVA sur le montant", () => {
    const r = computePurchase([{ quantity: "10", unitPrice: "52.5", discountPct: "5", taxRate: "20" }], "1");
    assert.equal(r.lines[0].netHtCurrency, "498.75");
    assert.equal(r.netHtMad, "498.75");
    assert.equal(r.vatMad, "99.75");
    assert.equal(r.ttcMad, "598.50");
  });
  test("en euros : conversion au taux saisi, un seul arrondi par montant", () => {
    const r = computePurchase([
      { quantity: "3", unitPrice: "12.3456", discountPct: "0", taxRate: "20" },
      { quantity: "7", unitPrice: "4.9900", discountPct: "10", taxRate: "20" },
    ], "10.8765");
    assert.equal(r.lines[0].netHtCurrency, "37.04"); // 37,0368
    assert.equal(r.lines[0].netHtMad, "402.83"); // 37,0368 × 10,8765 = 402,8307…
    assert.equal(r.lines[1].netHtCurrency, "31.44"); // 31,437
    assert.equal(r.lines[1].netHtMad, "341.92"); // 31,437 × 10,8765 = 341,9245…
    assert.equal(r.netHtMad, "744.75");
    assert.equal(r.netHtCurrency, "68.48");
  });
  test("taux de change : 1 en dirhams, obligatoire et positif en devise", () => {
    assert.equal(rateError("MAD", "1"), null);
    assert.match(rateError("MAD", "10.8")!, /taux de 1/);
    assert.match(rateError("EUR", null)!, /taux du jour/);
    assert.match(rateError("EUR", "0")!, /taux du jour/);
    assert.match(rateError("EUR", "1")!, /pas un taux réel/);
    assert.equal(rateError("EUR", "10.87"), null);
  });
});

describe("frais d'approche et coût de revient", () => {
  const lines = [{ netHtMad: "1000.00", quantity: "10" }, { netHtMad: "500.00", quantity: "30" }, { netHtMad: "500.00", quantity: "60" }];
  test("répartition à la valeur : la somme est exactement le frais", () => {
    const a = allocateLandedCosts(lines, [{ amountMad: "100.01", allocation: "VALEUR" }]);
    assert.deepEqual(a, ["50.01", "25.00", "25.00"]);
    assert.equal(a.reduce((s, x) => s + Math.round(Number(x) * 100), 0), 10001);
  });
  test("répartition à la quantité et cumul de plusieurs frais", () => {
    assert.deepEqual(allocateLandedCosts(lines, [{ amountMad: "100.00", allocation: "QUANTITE" }]), ["10.00", "30.00", "60.00"]);
    assert.deepEqual(allocateLandedCosts(lines, [{ amountMad: "100.00", allocation: "QUANTITE" }, { amountMad: "20.00", allocation: "VALEUR" }]), ["20.00", "35.00", "65.00"]);
  });
  test("des centimes indivisibles vont aux plus grands restes", () => {
    const a = allocateLandedCosts([{ netHtMad: "1", quantity: "1" }, { netHtMad: "1", quantity: "1" }, { netHtMad: "1", quantity: "1" }], [{ amountMad: "0.10", allocation: "VALEUR" }]);
    assert.deepEqual(a, ["0.04", "0.03", "0.03"]);
  });
  test("coût de revient unitaire = (HT + frais) ÷ quantité, à 4 décimales", () => {
    assert.equal(unitCostMad("1000.00", "50.01", "10"), "105.0010");
    assert.equal(unitCostMad("100.00", "0.00", "3"), "33.3333");
  });
});

describe("statuts et actions", () => {
  test("commande après réception", () => {
    assert.equal(orderStatusAfterReceipt([{ quantity: "10", receivedQty: "0" }]), "VALIDE");
    assert.equal(orderStatusAfterReceipt([{ quantity: "10", receivedQty: "4" }, { quantity: "5", receivedQty: "5" }]), "PARTIELLE");
    assert.equal(orderStatusAfterReceipt([{ quantity: "10", receivedQty: "10" }]), "RECUE");
  });
  test("réception après facture", () => {
    assert.equal(receptionStatusAfterInvoice([{ quantity: "10", invoicedQty: "10" }]), "FACTUREE");
    assert.equal(receptionStatusAfterInvoice([{ quantity: "10", invoicedQty: "3" }]), "FACTUREE_PARTIEL");
    assert.equal(remaining("10", "3"), "7.000");
    assert.equal(remaining("10", "12"), "0.000");
  });
  test("actions : une commande reçue en partie se solde, pas une commande intacte ; on n'annule pas ce qui est reçu", () => {
    assert.equal(purchaseActions("COMMANDE", "PARTIELLE").close, true);
    assert.equal(purchaseActions("COMMANDE", "VALIDE").close, false);
    assert.equal(purchaseActions("COMMANDE", "VALIDE", { anyReceived: true }).cancel, false);
    assert.equal(purchaseActions("RECEPTION", "VALIDE").invoice, true);
    assert.equal(purchaseActions("RECEPTION", "FACTUREE").invoice, false);
  });
  test("commande en retard après le délai de grâce", () => {
    assert.equal(isLateOrder("2026-09-01", "VALIDE", "2026-09-09", 7), true);
    assert.equal(isLateOrder("2026-09-01", "VALIDE", "2026-09-08", 7), false);
    assert.equal(isLateOrder("2026-09-01", "RECUE", "2026-12-01", 7), false);
    assert.equal(isLateOrder(null, "VALIDE", "2026-12-01", 7), false);
  });
});

describe("rapprochement facture ↔ réception", () => {
  const src = { quantityLeft: "10", unitPrice: "12.00", discountPct: "0", number: "BR202600001" };
  test("aucun écart quand prix et quantité concordent", () => {
    assert.deepEqual(invoiceGaps([{ designation: "Crème", productId: "p", quantity: "10", unitPrice: "12", discountPct: "0", source: src }], 0), []);
  });
  test("écart de prix au-delà de la tolérance, écart de quantité, article sans réception", () => {
    const g = invoiceGaps([
      { designation: "Crème", productId: "p", quantity: "8", unitPrice: "12.50", discountPct: "0", source: src },
      { designation: "Sérum", productId: "p2", quantity: "1", unitPrice: "5", discountPct: "0", source: null },
      { designation: "Transport", productId: null, quantity: "1", unitPrice: "300", discountPct: "0", source: null },
    ], 1);
    assert.deepEqual(g.map((x) => x.kind), ["PRIX", "QUANTITE", "HORS_RECEPTION"]);
    assert.equal(g[0].label, "Crème : prix net facturé 12,50 contre 12,00 à la réception BR202600001.");
  });
  test("un écart dans la tolérance n'est pas signalé", () => {
    assert.deepEqual(invoiceGaps([{ designation: "Crème", productId: "p", quantity: "10", unitPrice: "12.10", discountPct: "0", source: src }], 1), []);
  });
});
