/** Saisie terrain : les points de vente du périmètre de l'animatrice passent en tête. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sortPointsOfSale } from "@/lib/terrain/points-of-sale-sort";

const rows = [
  { id: "a", name: "ATLAS MED", city: "CASABLANCA" },
  { id: "s", name: "SABEM", city: "CASABLANCA" },
  { id: "b", name: "BIOSAIN", city: "RABAT" },
];

test("les points de vente assignés passent en tête, puis ordre alphabétique", () => {
  assert.deepEqual(sortPointsOfSale(rows, ["s"]).map((r) => [r.name, r.mine]), [["SABEM", true], ["ATLAS MED", false], ["BIOSAIN", false]]);
});

test("sans périmètre (portée « tout »), simple ordre alphabétique", () => {
  assert.deepEqual(sortPointsOfSale(rows, null).map((r) => r.name), ["ATLAS MED", "BIOSAIN", "SABEM"]);
});

test("aucun écran de saisie ne recode le filtre grossiste à la main", () => {
  for (const f of ["src/app/(app)/terrain/saisie/page.tsx", "src/app/(app)/terrain/[id]/page.tsx"]) {
    assert.ok(!readFileSync(f, "utf8").includes("GROSSISTE"), `${f} doit passer par pointsOfSale()`);
  }
});
