/**
 * Classement des « produits habituels » — la seule décision de `usual-products.ts`,
 * testable sans base : fréquence décroissante, puis récence, borné au nombre demandé.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rankUsualProducts, type ProductFrequencyRow } from "@/lib/terrain/usual-products-rank";

const row = (over: Partial<ProductFrequencyRow>): ProductFrequencyRow => ({
  id: "p", name: "Produit", brandId: null, brandName: null, count: 1, lastDate: "2026-09-01", ...over,
});

describe("rankUsualProducts", () => {
  test("trie par fréquence décroissante", () => {
    const rows = [row({ id: "a", count: 3 }), row({ id: "b", count: 8 }), row({ id: "c", count: 5 })];
    assert.deepEqual(rankUsualProducts(rows, 10).map((p) => p.id), ["b", "c", "a"]);
  });

  test("à fréquence égale, la plus récente d'abord", () => {
    const rows = [
      row({ id: "old", count: 4, lastDate: "2026-06-01" }),
      row({ id: "recent", count: 4, lastDate: "2026-09-01" }),
    ];
    assert.deepEqual(rankUsualProducts(rows, 10).map((p) => p.id), ["recent", "old"]);
  });

  test("respecte la limite demandée", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ id: `p${i}`, count: i }));
    assert.equal(rankUsualProducts(rows, 20).length, 20);
  });

  test("liste vide : liste vide, pas d'erreur", () => {
    assert.deepEqual(rankUsualProducts([], 20), []);
  });

  test("ne renvoie que les champs d'un produit, pas count ni lastDate", () => {
    const [p] = rankUsualProducts([row({ id: "x", count: 9, lastDate: "2026-01-01" })], 5);
    assert.deepEqual(Object.keys(p).sort(), ["brandId", "brandName", "id", "name"]);
  });
});
