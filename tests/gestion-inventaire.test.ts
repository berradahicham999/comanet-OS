/** Gestion commerciale — inventaires (src/lib/gestion/counts-shared.ts). */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { countLineKey, countStats, countedByLine, gapLeads, gapOverOutflows, lineGap, recurringGaps, type GapFacts } from "@/lib/gestion/counts-shared";

describe("compté et écart", () => {
  test("le compté d'une ligne est la somme des saisies de tous les compteurs, lot sans casse ni espaces", () => {
    const m = countedByLine([
      { productId: "p", lotNumber: "a12", quantity: "10" },
      { productId: "p", lotNumber: " A12 ", quantity: "5" },
      { productId: "p", lotNumber: null, quantity: "2" },
    ]);
    assert.equal(m.get(countLineKey("p", "A12")), "15.000");
    assert.equal(m.get(countLineKey("p", null)), "2.000");
    assert.equal(m.get(countLineKey("q", null)), undefined);
  });
  test("écart en quantité, en valeur au CMUP figé et en % du théorique", () => {
    assert.deepEqual(lineGap("20", "17", "111.8118"), { gapQty: "-3.000", gapValue: "-335.44", gapPct: -15 });
    assert.deepEqual(lineGap("0", "4", "10.0000"), { gapQty: "4.000", gapValue: "40.00", gapPct: null });
    assert.deepEqual(lineGap("5", "5", null), { gapQty: "0.000", gapValue: null, gapPct: 0 });
  });
});

describe("fiabilité d'un inventaire", () => {
  test("sur les seules lignes comptées ; valeur = 1 − |écarts| ÷ théorique", () => {
    const s = countStats([
      { theoreticalQty: "10", countedQty: "10", cmup: "10.0000" },
      { theoreticalQty: "10", countedQty: "8", cmup: "10.0000" },
      { theoreticalQty: "20", countedQty: "22", cmup: "10.0000" },
      { theoreticalQty: "5", countedQty: null, cmup: "10.0000" },
    ]);
    assert.equal(s.counted, 3);
    assert.equal(s.uncounted, 1);
    assert.equal(s.withGap, 2);
    assert.equal(s.accuracyLines, 33.3);
    assert.equal(s.valueTheoretical, "400.00");
    assert.equal(s.gapValueNet, "0.00"); // −20 + 20 : un net nul cache deux écarts
    assert.equal(s.gapValueAbs, "40.00");
    assert.equal(s.accuracyValue, 90);
  });
  test("écart ÷ sorties de la période", () => {
    assert.equal(gapOverOutflows("-2", "400"), 0.5);
    assert.equal(gapOverOutflows("-2", "10"), 20);
    assert.equal(gapOverOutflows("-2", "0"), null);
  });
  test("écarts récurrents : au moins N inventaires distincts", () => {
    const r = recurringGaps([
      { productId: "a", countId: "c1", gapQty: "-1" }, { productId: "a", countId: "c2", gapQty: "2" },
      { productId: "b", countId: "c1", gapQty: "-1" }, { productId: "b", countId: "c2", gapQty: "0" },
    ], 2);
    assert.deepEqual([...r], [["a", 2]]);
  });
});

describe("pistes d'explication", () => {
  const base: GapFacts = {
    gapQty: "-3", blAfterStart: { count: 0, qty: "0" }, lateBls: { count: 0, hours: 48 }, receptionsAfterStart: { count: 0, qty: "0" },
    openOrdersQty: "0", creditsWithoutReturnQty: "0", samplesWithoutMovementQty: "0", expiredLot: null, movementsSinceStart: 0,
  };
  test("pas d'écart, pas de piste ; pas de donnée, pas de piste", () => {
    assert.deepEqual(gapLeads({ ...base, gapQty: "0", blAfterStart: { count: 2, qty: "3" } }), []);
    assert.deepEqual(gapLeads(base), []);
  });
  test("un manquant ne s'explique que par des sorties, un surplus que par des entrées", () => {
    const facts: GapFacts = { ...base, blAfterStart: { count: 1, qty: "3" }, receptionsAfterStart: { count: 1, qty: "5" }, openOrdersQty: "40", samplesWithoutMovementQty: "2", expiredLot: { lot: "L1", expiry: "2026-08-31" } };
    assert.deepEqual(gapLeads(facts).map((l) => l.code), ["BL_APRES_DEMARRAGE", "ECHANTILLONS", "LOT_PERIME"]);
    assert.deepEqual(gapLeads({ ...facts, gapQty: "5" }).map((l) => l.code), ["RECEPTION_APRES_DEMARRAGE", "COMMANDE_OUVERTE"]);
  });
  test("chaque piste sépare la donnée de l'hypothèse", () => {
    const [l] = gapLeads({ ...base, expiredLot: { lot: "L1", expiry: "2026-08-31" } });
    assert.equal(l.data, "Lot L1 périmé depuis le 31/08/2026.");
    assert.match(l.hypothesis, /peut-être/);
  });
});
