import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { costIssues, outputCharges, type OutputLineLike } from "@/lib/gestion/marketing-outputs-shared";
import { marketingBucketOf, sampleBucket } from "@/lib/budget-categories";
import { AD_EXPENSE_CATEGORIES } from "@/lib/ad-spend";

const product = (over: Partial<OutputLineLike> = {}): OutputLineLike => ({
  id: "l1", productId: "p1", inventoryItemId: null, brandId: "G", designation: "Sérum", quantity: "10.000", freeQuantity: "2.000", unitCost: "45.50", ...over,
});
const goodie = (over: Partial<OutputLineLike> = {}): OutputLineLike => ({
  id: "l2", productId: null, inventoryItemId: "i1", brandId: "G", designation: "Trousse", quantity: "5.000", freeQuantity: "0.000", unitCost: "15.00", ...over,
});
const digital = { isInternal: true, outputNatureKey: "DIGITAL" };

describe("Sorties marketing — charges d'un BL", () => {
  test("BL échantillons digital avec un produit et un goodie : seule la ligne produit est une charge (matériel déjà passé en charge à l'achat)", () => {
    const { charges, errors } = outputCharges(digital, [product(), goodie()], "SIMBL2026001");
    assert.deepEqual(errors, []);
    assert.equal(charges.length, 1);
    assert.deepEqual(charges[0], {
      documentLineId: "l1", productId: "p1", brandId: "G", amount: "546.00", nature: "DIGITAL",
      label: "Échantillons — Sérum (SIMBL2026001)",
    });
  });
  test("un vrai client ne génère aucune charge : un goodie offert à une pharmacie est tracé, pas compté deux fois", () => {
    assert.deepEqual(outputCharges({ isInternal: false, outputNatureKey: null }, [product(), goodie()], "BL1"), { charges: [], errors: [] });
  });
  test("coût à 0 ou inconnu : aucune charge estimée, alerte", () => {
    const lines = [product({ id: "a", unitCost: "0.00" }), product({ id: "b", unitCost: null }), goodie({ id: "c", unitCost: "0.00" })];
    assert.deepEqual(outputCharges(digital, lines, "BL").charges, []);
    assert.deepEqual(costIssues(digital, lines).map((i) => [i.lineId, i.kind, i.reason]), [["a", "PRODUIT", "COUT_ZERO"], ["b", "PRODUIT", "COUT_INCONNU"], ["c", "MATERIEL", "COUT_ZERO"]]);
  });
  test("le coût d'un produit vendu à un vrai client n'est pas surveillé ici (il est dans le coût des ventes)", () => {
    assert.deepEqual(costIssues({ isInternal: false, outputNatureKey: null }, [product({ unitCost: null })]), []);
  });
  test("produit sans marque ou client interne sans nature : validation refusée", () => {
    assert.match(outputCharges(digital, [product({ brandId: null })], "BL").errors.join(), /sans marque/);
    assert.match(outputCharges({ isInternal: true, outputNatureKey: null }, [product()], "BL").errors.join(), /nature de sortie/);
  });
  test("montant exact, sans flottant : 3 × 33,33 = 99,99", () => {
    const { charges } = outputCharges(digital, [product({ quantity: "3.000", freeQuantity: "0.000", unitCost: "33.33" })], "BL");
    assert.equal(charges[0].amount, "99.99");
  });
});

describe("Marketing réel — postes du P&L", () => {
  test("publicité, échantillons par nature, matériel, influence, activations, autres", () => {
    assert.equal(marketingBucketOf({ category: "META" }), "ADS");
    assert.equal(marketingBucketOf({ category: "ECHANTILLONS", outputNature: "ANIMATION" }), "ECH:ANIMATION");
    assert.equal(marketingBucketOf({ category: "ECHANTILLONS" }), "ECH:AUTRE");
    assert.equal(marketingBucketOf({ category: "GOODIES", activationId: "a" }), "GOODIES");
    assert.equal(marketingBucketOf({ category: "PLV" }), "PLV");
    assert.equal(marketingBucketOf({ category: "UGC" }), "INFLUENCE");
    assert.equal(marketingBucketOf({ category: "EVENEMENT", activationId: "a" }), "ACTIVATIONS");
    assert.equal(marketingBucketOf({ category: "EVENEMENT" }), "AUTRES");
    assert.equal(sampleBucket(null), "ECH:AUTRE");
  });
  test("les catégories média sont celles de la règle régie / saisie", () => {
    for (const c of AD_EXPENSE_CATEGORIES) assert.equal(marketingBucketOf({ category: c }), "ADS");
  });
});
