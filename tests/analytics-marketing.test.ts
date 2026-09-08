/**
 * Analytics marketing transverse — garde-fous de la fondation.
 *  - Le dictionnaire de métriques semé par la migration 0017 et la liste `METRIC_KEYS` du code
 *    sont une seule et même liste.
 *  - Les réglages `settings.analytics` fusionnent en profondeur (un réglage partiel n'efface rien).
 *  - `ratio()` ne fabrique jamais un 0 ni un Infinity à partir d'une donnée absente.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { METRIC_KEYS, RESULT_KEYS, ratio, insufficient, measured } from "@/lib/analytics-marketing/shared";
import { mergeAnalytics, DEFAULT_ANALYTICS_SETTINGS, mergeSettings } from "@/lib/settings";

const MIGRATION = readFileSync("drizzle/0017_analytics_marketing.sql", "utf8");

function seededKeys(table: string): string[] {
  const start = MIGRATION.indexOf(`INSERT INTO "${table}"`);
  assert.ok(start >= 0, `semis de ${table} introuvable`);
  const end = MIGRATION.indexOf("ON CONFLICT", start);
  return [...MIGRATION.slice(start, end).matchAll(/^\s*\('([A-Z0-9_]+)'/gm)].map((m) => m[1]);
}

describe("dictionnaire de métriques", () => {
  test("la migration sème exactement les clés de METRIC_KEYS", () => {
    const seeded = seededKeys("metrics_definitions");
    assert.deepEqual([...seeded].sort(), [...METRIC_KEYS].sort());
  });
  test("aucune clé en double", () => {
    assert.equal(new Set(METRIC_KEYS).size, METRIC_KEYS.length);
  });
  test("chaque résultat propre d'un canal est une clé de résultat connue", () => {
    const start = MIGRATION.indexOf('INSERT INTO "dim_channel"');
    const end = MIGRATION.indexOf("ON CONFLICT", start);
    const metrics = [...MIGRATION.slice(start, end).matchAll(/'([A-Z_]+)', (?:'([A-Z_]+)'|NULL), '#/g)].flatMap((m) => [m[1], m[2]].filter(Boolean));
    for (const k of metrics) assert.ok((RESULT_KEYS as readonly string[]).includes(k), `${k} n'est pas une clé de résultat`);
  });
  test("chaque catégorie budgétaire de l'enum a une correspondance de canal", () => {
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const enumBody = schema.slice(schema.indexOf('pgEnum("budget_category"'), schema.indexOf("]);", schema.indexOf('pgEnum("budget_category"')));
    const cats = [...enumBody.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]).filter((c) => c !== "budget_category".toUpperCase());
    const mapped = [...MIGRATION.matchAll(/\('BUDGET_CATEGORY', '([A-Z]+)'/g)].map((m) => m[1]);
    for (const c of cats) assert.ok(mapped.includes(c), `catégorie ${c} sans canal`);
    assert.equal(cats.length, 19, "l'enum compte 19 catégories (pas 14)");
  });
});

describe("réglages analytics", () => {
  test("défauts : coût animation non mesurable, prorata des ventes", () => {
    assert.equal(DEFAULT_ANALYTICS_SETTINGS.animationDayCost, null);
    assert.equal(DEFAULT_ANALYTICS_SETTINGS.productSplit, "PRORATA_SALES");
  });
  test("fusion profonde : un objet partiel garde les autres seuils", () => {
    const m = mergeAnalytics({ animationDayCost: 800, channelDiagnosis: { minSpend: 1000 } as never });
    assert.equal(m.animationDayCost, 800);
    assert.equal(m.channelDiagnosis.minSpend, 1000);
    assert.equal(m.channelDiagnosis.costRisePct, DEFAULT_ANALYTICS_SETTINGS.channelDiagnosis.costRisePct);
    assert.equal(m.healthWeights.objective, 30);
  });
  test("mergeSettings expose analytics même sans réglage enregistré", () => {
    assert.deepEqual(mergeSettings({}).analytics, DEFAULT_ANALYTICS_SETTINGS);
    assert.equal(mergeSettings({ analytics: { windowAfterDays: 45 } as never }).analytics.windowAfterDays, 45);
  });
});

describe("valeurs mesurées", () => {
  test("ratio : null sur dénominateur nul ou absent", () => {
    assert.equal(ratio(10, 0), null);
    assert.equal(ratio(10, null), null);
    assert.equal(ratio(null, 5), null);
    assert.equal(ratio(10, 4), 2.5);
  });
  test("insufficient porte la raison, le responsable et le lien Qualité", () => {
    const v = insufficient("aucune dépense sur la période", "Responsable marketing");
    assert.equal(v.ok, false);
    if (!v.ok) { assert.equal(v.owner, "Responsable marketing"); assert.equal(v.href, "/marketing/analytics/qualite"); }
    const m = measured(12, 0.8);
    assert.ok(m.ok && m.value === 12 && m.completeness === 0.8);
  });
});
