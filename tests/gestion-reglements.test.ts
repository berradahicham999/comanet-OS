/** Gestion commerciale — règlements et bascule (receivables-shared.ts, documents-shared.ts). */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  agedBalance, agingBucket, controlGap, invoiceBalance, nextPaymentStatuses, planAllocation, reminderLevel, reminderText, repriseColumns, repriseMissing,
} from "@/lib/gestion/receivables-shared";
import { emitsReal, importBlockedByCutover } from "@/lib/gestion/documents-shared";

describe("solde d'une facture", () => {
  test("TTC − déjà réglé à la reprise − imputations valides ; un impayé ne solde plus rien", () => {
    assert.equal(invoiceBalance("1200.00", "0", [{ amount: "500.00", settles: true }, { amount: "300.00", settles: false }]), "700.00");
    assert.equal(invoiceBalance("1200.00", "200.00", [{ amount: "1000.00", settles: true }]), "0.00");
    assert.equal(invoiceBalance("100.00", "0", [{ amount: "150.00", settles: true }]), "0.00");
  });
  test("cycle d'un règlement : un encaissé peut encore revenir impayé, un impayé est définitif", () => {
    assert.deepEqual(nextPaymentStatuses("REMIS"), ["ENCAISSE", "IMPAYE"]);
    assert.deepEqual(nextPaymentStatuses("ENCAISSE"), ["IMPAYE"]);
    assert.deepEqual(nextPaymentStatuses("IMPAYE"), []);
  });
});

describe("échéances", () => {
  test("tranches de la balance âgée", () => {
    assert.equal(agingBucket("2026-10-01", "2026-09-24"), "NON_ECHU");
    assert.equal(agingBucket(null, "2026-09-24"), "NON_ECHU");
    assert.equal(agingBucket("2026-09-24", "2026-09-24"), "NON_ECHU");
    assert.equal(agingBucket("2026-09-23", "2026-09-24"), "0_30");
    assert.equal(agingBucket("2026-08-01", "2026-09-24"), "31_60");
    assert.equal(agingBucket("2026-06-01", "2026-09-24"), "90P");
  });
  test("balance âgée par client, au centime", () => {
    const b = agedBalance([
      { clientId: "c", dueDate: "2026-09-30", balance: "100.10" },
      { clientId: "c", dueDate: "2026-09-10", balance: "200.20" },
      { clientId: "c", dueDate: "2026-05-01", balance: "0.01" },
    ], "2026-09-24").get("c")!;
    assert.deepEqual(b, { NON_ECHU: "100.10", "0_30": "200.20", "31_60": "0.00", "61_90": "0.00", "90P": "0.01", total: "300.31" });
  });
  test("niveau de relance d'après le retard le plus ancien", () => {
    assert.equal(reminderLevel(3, [7, 30, 60]), 0);
    assert.equal(reminderLevel(7, [7, 30, 60]), 1);
    assert.equal(reminderLevel(45, [7, 30, 60]), 2);
    assert.equal(reminderLevel(200, [7, 30, 60]), 3);
  });
  test("imputation proposée : les plus anciennes d'abord, jamais au-delà d'un solde", () => {
    const plan = planAllocation("1000.00", [
      { id: "b", dueDate: "2026-09-10", date: "2026-07-10", balance: "700.00" },
      { id: "a", dueDate: "2026-08-10", date: "2026-06-10", balance: "400.00" },
      { id: "c", dueDate: null, date: "2026-09-20", balance: "50.00" },
    ]);
    assert.deepEqual(plan, [{ invoiceId: "a", amount: "400.00" }, { invoiceId: "b", amount: "600.00" }]);
  });
  test("message de relance gradué avec le total", () => {
    const t = reminderText(3, "COMANET", "PHARMACIE TEST", [{ number: "FA202700001", dueDate: "2027-02-28", balance: "1790.98" }]);
    assert.match(t, /Malgré nos précédents rappels/);
    assert.match(t, /FA202700001 \(échéance 28\/02\/2027\) : 1\s790,98 MAD/);
    assert.match(t, /Total : 1\s790,98 MAD/);
  });
});

describe("bascule", () => {
  const c = { mode: "ACTIF" as const, date: "2027-01-01", sites: ["COMANET", "DESK DIGITAL"] };
  test("pièce légale seulement en mode ACTIF, après la date, pour un site basculé", () => {
    assert.equal(emitsReal(c, { date: "2027-01-02", site: "comanet" }), true);
    assert.equal(emitsReal(c, { date: "2026-12-31", site: "COMANET" }), false);
    assert.equal(emitsReal(c, { date: "2027-01-02", site: "COS" }), false);
    assert.equal(emitsReal({ ...c, mode: "PARALLELE" }, { date: "2027-01-02", site: "COMANET" }), false);
  });
  test("import Sage : lignes des sites basculés refusées après la bascule, les autres passent", () => {
    assert.match(importBlockedByCutover(c, "2027-01-05", "DESK DIGITAL")!, /comptée deux fois/);
    assert.equal(importBlockedByCutover(c, "2026-12-20", "COMANET"), null);
    assert.equal(importBlockedByCutover(c, "2027-01-05", "COS"), null);
    assert.equal(importBlockedByCutover(c, "2027-01-05", null), null);
  });
  test("rapport de contrôle : un centime par pièce au plus est un écart d'arrondi", () => {
    assert.deepEqual(controlGap("10000.03", "10000.00", 5), { gap: "0.03", rounding: true });
    assert.deepEqual(controlGap("10000.00", "9990.00", 5), { gap: "10.00", rounding: false });
    assert.deepEqual(controlGap("10.00", "10.00", 5), { gap: "0.00", rounding: false });
  });
  test("reprise : colonnes d'un état Sage reconnues, champs manquants listés", () => {
    const cols = repriseColumns(["Code client", "Intitulé", "N° pièce", "Date", "Échéance", "Montant TTC", "Reste à payer"]);
    assert.deepEqual(cols, { balance: "Reste à payer", dueDate: "Échéance", accountCode: "Code client", ttc: "Montant TTC", number: "N° pièce", date: "Date", client: "Intitulé" });
    assert.deepEqual(repriseMissing(cols), []);
    assert.deepEqual(repriseMissing(repriseColumns(["Client", "Date"])), ["N° de pièce", "Montant TTC", "Reste à payer"]);
  });
});
