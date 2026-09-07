/** Réglages fusionnés et utilitaires de date centralisés. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mergeSettings, DEFAULT_SETTINGS, DEFAULT_AD_THRESHOLDS } from "@/lib/settings";
import { mondayOf, iso } from "@/lib/format";

describe("mergeSettings", () => {
  test("aucun réglage enregistré : les défauts s'appliquent", () => {
    assert.deepEqual(mergeSettings(null), DEFAULT_SETTINGS);
  });
  test("un réglage partiel ne fait pas disparaître les autres", () => {
    const m = mergeSettings({ budgetAlertPct: 75 });
    assert.equal(m.budgetAlertPct, 75);
    assert.equal(m.avgSalesMonths, DEFAULT_SETTINGS.avgSalesMonths);
  });
  test("un objet `ads` partiel conserve les seuils non mentionnés", () => {
    const m = mergeSettings({ ads: { minSpend: 500 } as never });
    assert.equal(m.ads.minSpend, 500);
    assert.equal(m.ads.cpaVsBrandFactor, DEFAULT_AD_THRESHOLDS.cpaVsBrandFactor);
    assert.equal(m.ads.scaleStepDays, DEFAULT_AD_THRESHOLDS.scaleStepDays);
  });
  test("un objet `coverage` partiel conserve les autres seuils", () => {
    const m = mergeSettings({ coverage: { orange: 0.5 } as never });
    assert.equal(m.coverage.orange, 0.5);
    assert.equal(m.coverage.green, DEFAULT_SETTINGS.coverage.green);
  });
  test("les seuils de tension stock existent et sont exploitables", () => {
    const m = mergeSettings(null);
    assert.equal(typeof m.stockTightCoverageMonths, "number");
    assert.equal(typeof m.stockTightMinMonthlyUnits, "number");
  });
});

describe("mondayOf", () => {
  test("un lundi reste lui-même", () => {
    assert.equal(iso(mondayOf(new Date("2026-09-07T12:00:00Z"))), "2026-09-07");
  });
  test("un dimanche renvoie le lundi précédent", () => {
    assert.equal(iso(mondayOf(new Date("2026-09-13T12:00:00Z"))), "2026-09-07");
  });
  test("un mercredi renvoie le lundi de sa semaine", () => {
    assert.equal(iso(mondayOf(new Date("2026-09-09T12:00:00Z"))), "2026-09-07");
  });
  test("passage de mois et d'année", () => {
    assert.equal(iso(mondayOf(new Date("2027-01-01T12:00:00Z"))), "2026-12-28");
  });
});
