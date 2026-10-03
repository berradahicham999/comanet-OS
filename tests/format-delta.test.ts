import { test } from "node:test";
import assert from "node:assert/strict";
import { delta } from "../src/lib/format";

test("delta : variation classique", () => {
  assert.equal(delta(150, 100), 50);
  assert.equal(delta(50, 100), -50);
  assert.equal(delta(10, 0), null);
});

test("delta : bornée à -100 % quand les retours rendent la valeur nette négative", () => {
  // 29 unités vendues puis -47 (avoirs) : « -261 % » n'a pas de sens, tout est parti.
  assert.equal(delta(-47, 29), -100);
  assert.equal(delta(0, 29), -100);
});
