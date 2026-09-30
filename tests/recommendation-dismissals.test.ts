/**
 * Action Center : recommandations écartées à la main — logique pure de `src/lib/rules/dismissals-shared.ts`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isDismissed, canDismiss, type Dismissal } from "../src/lib/rules/dismissals-shared";
import { noPermissions } from "../src/lib/permissions-shared";

const now = new Date("2026-09-30T10:00:00Z");
const d = (priority: Dismissal["priority"], until: string): Dismissal => ({ priority, until: new Date(until), by: "Hicham", reason: null, at: now });

describe("isDismissed", () => {
  test("pas d'écart : visible", () => assert.equal(isDismissed(undefined, "HIGH", now), false));
  test("écart en cours, même priorité : masquée", () => assert.equal(isDismissed(d("HIGH", "2026-10-30T00:00:00Z"), "HIGH", now), true));
  test("priorité redescendue : reste masquée", () => assert.equal(isDismissed(d("HIGH", "2026-10-30T00:00:00Z"), "MEDIUM", now), true));
  test("priorité aggravée : revient", () => assert.equal(isDismissed(d("HIGH", "2026-10-30T00:00:00Z"), "CRITICAL", now), false));
  test("échéance passée : revient", () => assert.equal(isDismissed(d("LOW", "2026-09-30T09:59:59Z"), "LOW", now), false));
});

describe("canDismiss", () => {
  test("sans droit Modifier : refusé", () => {
    const p = noPermissions(); p.stock.view = true;
    assert.equal(canDismiss(p, "STOCK"), false);
  });
  test("Modifier sur le module de la catégorie : autorisé", () => {
    const p = noPermissions(); p.stock.view = true; p.stock.edit = true;
    assert.equal(canDismiss(p, "STOCK"), true);
    assert.equal(canDismiss(p, "MARKETING"), false);
  });
  test("administrateur : autorisé partout", () => {
    const p = noPermissions(); p.administration.validate = true;
    assert.equal(canDismiss(p, "REGLEMENTAIRE"), true);
  });
});
