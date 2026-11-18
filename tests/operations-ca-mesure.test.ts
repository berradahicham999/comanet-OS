/**
 * CA réellement mesuré d'une opération → revue de marque : réparti sur les lignes de dépense de l'opération
 * (`spreadRevenue()`), somme exacte au centime, jamais de CA fabriqué.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spreadRevenue } from "@/lib/analytics-marketing/refresh-shared";

const sum = (m: Map<string, number>) => Math.round([...m.values()].reduce((s, v) => s + v, 0) * 100) / 100;

describe("spreadRevenue", () => {
  test("au prorata du montant des lignes", () => {
    const m = spreadRevenue([{ id: "a", amount: 300 }, { id: "b", amount: 100 }], 2000);
    assert.equal(m.get("a"), 1500);
    assert.equal(m.get("b"), 500);
  });
  test("la somme vaut exactement le CA saisi, l'arrondi va à la dernière ligne", () => {
    const m = spreadRevenue([{ id: "a", amount: 1 }, { id: "b", amount: 1 }, { id: "c", amount: 1 }], 1000);
    assert.equal(sum(m), 1000);
    assert.equal(m.get("a"), 333.33);
    assert.equal(m.get("c"), 333.34);
  });
  test("montants tous nuls : parts égales", () => {
    const m = spreadRevenue([{ id: "a", amount: 0 }, { id: "b", amount: 0 }], 100);
    assert.equal(m.get("a"), 50);
    assert.equal(m.get("b"), 50);
  });
  test("sans CA ou sans ligne : rien", () => {
    assert.equal(spreadRevenue([{ id: "a", amount: 10 }], null).size, 0);
    assert.equal(spreadRevenue([{ id: "a", amount: 10 }], 0).size, 0);
    assert.equal(spreadRevenue([], 500).size, 0);
  });
});

test("le montant de commandes DÉCLARÉ n'entre jamais dans la couche analytics", () => {
  const src = readFileSync("src/lib/analytics-marketing/refresh.ts", "utf8");
  assert.ok(!/orders_amount|ordersAmount/.test(src), "orders_amount est une déclaration, pas un CA mesuré");
  assert.ok(/a\.attributed_revenue/.test(src), "le CA réellement mesuré de l'opération est lu");
});
