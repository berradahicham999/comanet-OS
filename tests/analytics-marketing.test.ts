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

/* ------------------------------ Rafraîchissement : logique pure ------------------------------ */
import { splitShares, expenseAmounts, collaborationAmounts, contentAmounts, animationCost, sampleValue, applyShare, regieOverrides } from "@/lib/analytics-marketing/refresh-shared";

describe("répartition d'une dépense entre produits", () => {
  test("aucun produit : une part à 100 % sans produit (niveau marque)", () => {
    assert.deepEqual(splitShares([], "PRORATA_SALES"), [{ productId: null, share: 1, basis: "NONE" }]);
  });
  test("un produit : 100 % déclaré", () => {
    assert.deepEqual(splitShares([{ productId: "a", weight: 0 }], "PRORATA_SALES"), [{ productId: "a", share: 1, basis: "DECLARED" }]);
  });
  test("prorata des ventes, parts sommant à 1", () => {
    const s = splitShares([{ productId: "a", weight: 300 }, { productId: "b", weight: 100 }], "PRORATA_SALES");
    assert.deepEqual(s.map((x) => [x.productId, x.share, x.basis]), [["a", 0.75, "PRORATA_SALES"], ["b", 0.25, "PRORATA_SALES"]]);
    const t = splitShares([{ productId: "a", weight: 1 }, { productId: "b", weight: 1 }, { productId: "c", weight: 1 }], "PRORATA_SALES");
    assert.equal(t.reduce((sum, x) => sum + x.share, 0), 1);
  });
  test("sans ventes récentes : parts égales", () => {
    const s = splitShares([{ productId: "a", weight: 0 }, { productId: "b", weight: 0 }], "PRORATA_SALES");
    assert.deepEqual(s.map((x) => [x.share, x.basis]), [[0.5, "EQUAL"], [0.5, "EQUAL"]]);
  });
  test("mode EQUAL ignore les poids ; doublons fusionnés", () => {
    const s = splitShares([{ productId: "a", weight: 900 }, { productId: "b", weight: 100 }, { productId: "a", weight: 900 }], "EQUAL");
    assert.deepEqual(s.map((x) => x.share), [0.5, 0.5]);
  });
});

describe("montants selon le statut", () => {
  test("dépense saisie : dépensé ⊂ engagé ⊂ prévu (jamais compté deux fois)", () => {
    assert.deepEqual(expenseAmounts("PLANNED", 100), { planned: 100, committed: null, spent: null });
    assert.deepEqual(expenseAmounts("COMMITTED", 100), { planned: 100, committed: 100, spent: null });
    assert.deepEqual(expenseAmounts("SPENT", 100), { planned: 100, committed: 100, spent: 100 });
  });
  test("collaboration : cachet + produit, selon l'étape du pipeline", () => {
    assert.deepEqual(collaborationAmounts("PROSPECT", 1000, 200), { planned: 1200, committed: null, spent: null });
    assert.deepEqual(collaborationAmounts("CONFIRMEE", 1000, 200), { planned: 1200, committed: 1200, spent: null });
    assert.deepEqual(collaborationAmounts("PUBLIE", 1000, 200), { planned: 1200, committed: 1200, spent: 1200 });
  });
  test("contenu : rien sans budget ; dépensé une fois publié", () => {
    assert.deepEqual(contentAmounts(null, true), { planned: null, committed: null, spent: null });
    assert.deepEqual(contentAmounts(500, false), { planned: 500, committed: null, spent: null });
    assert.deepEqual(contentAmounts(500, true), { planned: 500, committed: 500, spent: 500 });
  });
  test("quote-part : null reste null, arrondi au centime", () => {
    assert.deepEqual(applyShare({ planned: 100, committed: null, spent: 33.333 }, 0.333333), { planned: 33.33, committed: null, spent: 11.11 });
  });
});

describe("coût d'une animation", () => {
  test("coût saisi prioritaire", () => assert.deepEqual(animationCost(450, 2, 800), { spent: 450, reason: null }));
  test("tarif journalier × jours, appliqué à l'historique", () => assert.deepEqual(animationCost(0, 2, 800), { spent: 1600, reason: "TARIF_JOURNALIER" }));
  test("sans coût ni tarif : NON MESURABLE, jamais 0", () => assert.deepEqual(animationCost(0, 1, null), { spent: null, reason: "COUT_NON_MESURE" }));
});

describe("échantillons et régie prioritaire", () => {
  test("échantillon valorisé au prix d'achat, sinon COMANET, sinon non mesurable", () => {
    assert.deepEqual(sampleValue(3, 20, 35), { spent: 60, reason: null });
    assert.deepEqual(sampleValue(3, null, 35), { spent: 105, reason: "PRIX_COMANET" });
    assert.deepEqual(sampleValue(3, null, null), { spent: null, reason: "PRIX_INCONNU" });
  });
  test("une dépense média saisie est écartée quand la régie couvre le mois", () => {
    const ads = ["META", "TIKTOK", "GOOGLE", "DIGITAL"];
    assert.equal(regieOverrides("META", true, ads), true);
    assert.equal(regieOverrides("META", false, ads), false);
    assert.equal(regieOverrides("INFLUENCE", true, ads), false);
  });
});

/* ------------------------------ Dictionnaire : formules ↔ base ------------------------------ */
import { formulaKeys, compute, healthScore, EMPTY_AGGREGATE, type Aggregate } from "@/lib/analytics-marketing/metrics";

const S = DEFAULT_ANALYTICS_SETTINGS;
const agg = (over: Partial<Aggregate>): Aggregate => ({ ...EMPTY_AGGREGATE, ...over });

describe("formules du dictionnaire", () => {
  test("chaque clé du dictionnaire a une formule, et réciproquement", () => {
    assert.deepEqual([...formulaKeys()].sort(), [...METRIC_KEYS].sort());
  });
  test("périmètre vide : aucune métrique ne renvoie 0, toutes disent « données insuffisantes »", () => {
    for (const k of METRIC_KEYS) {
      const m = compute(k, EMPTY_AGGREGATE, { settings: S });
      assert.equal(m.ok, false, `${k} devrait être insuffisant sur un périmètre vide`);
    }
  });
  test("intensité marketing = dépense ÷ sell-in, avec complétude des dépenses", () => {
    const m = compute("MARKETING_INTENSITY", agg({ spend: { planned: 0, committed: 0, spent: 5000, rows: 10, measurableRows: 8, unmeasuredRows: 2 }, sales: { ...EMPTY_AGGREGATE.sales, sellIn: 100_000, rows: 50 } }), { settings: S });
    assert.ok(m.ok); if (m.ok) { assert.equal(m.value, 5); assert.equal(m.completeness, 0.8); }
  });
  test("ROI mesuré : uniquement sur les dépenses attribuées, complétude affichée", () => {
    const a = agg({ spend: { planned: 0, committed: 0, spent: 10_000, rows: 4, measurableRows: 4, unmeasuredRows: 0 }, attributed: { spend: 2_000, revenue: 6_000 } });
    const m = compute("ROI_MEASURED", a, { settings: S });
    assert.ok(m.ok); if (m.ok) { assert.equal(m.value, 2); assert.equal(m.completeness, 0.2); assert.match(m.note ?? "", /20 %/); }
    const none = compute("ROI_MEASURED", agg({ spend: { planned: 0, committed: 0, spent: 10_000, rows: 4, measurableRows: 4, unmeasuredRows: 0 } }), { settings: S });
    assert.equal(none.ok, false);
  });
  test("retour observé : « pas encore comparable » sans fenêtre avant", () => {
    const base = agg({ spend: { planned: 0, committed: 0, spent: 1_000, rows: 1, measurableRows: 1, unmeasuredRows: 0 }, sales: { ...EMPTY_AGGREGATE.sales, sellIn: 5_000, rows: 3 } });
    assert.equal(compute("ROI_CORRELATED", base, { settings: S }).ok, false);
    const m = compute("ROI_CORRELATED", { ...base, compare: { sellInPrev: 3_000, sellInN1: null } }, { settings: S });
    assert.ok(m.ok); if (m.ok) { assert.equal(m.value, 2); assert.match(m.note ?? "", /corrélation/); }
  });
  test("coût par résultat : résultat propre, repli, ou insuffisant", () => {
    const a = agg({ spend: { planned: 0, committed: 0, spent: 1_000, rows: 2, measurableRows: 2, unmeasuredRows: 0 }, results: { MESSAGES_STARTED: 50 }, sources: ["AD_METRIC"] });
    const m = compute("COST_PER_RESULT", a, { settings: S, resultMetric: { key: "PURCHASES", fallback: "MESSAGES_STARTED" } });
    assert.ok(m.ok); if (m.ok) { assert.equal(m.value, 20); assert.match(m.note ?? "", /repli/); }
    assert.equal(compute("COST_PER_RESULT", a, { settings: S, resultMetric: { key: "PURCHASES", fallback: null } }).ok, false);
    const unmeasured = agg({ spend: { planned: 0, committed: 0, spent: 0, rows: 3, measurableRows: 0, unmeasuredRows: 3 }, results: { SELLOUT_AMOUNT: 700 }, sources: ["ANIMATION"] });
    assert.equal(compute("COST_PER_RESULT", unmeasured, { settings: S, resultMetric: { key: "SELLOUT_AMOUNT", fallback: null } }).ok, false);
  });
  test("équilibre d'investissement : part budget − part CA en points", () => {
    const m = compute("INVESTMENT_BALANCE", agg({ spend: { planned: 0, committed: 0, spent: 300, rows: 1, measurableRows: 1, unmeasuredRows: 0 }, sales: { ...EMPTY_AGGREGATE.sales, sellIn: 1_000, rows: 1 }, portfolio: { spend: 1_000, sellIn: 10_000 } }), { settings: S });
    assert.ok(m.ok); if (m.ok) assert.equal(Math.round(m.value), 20);
  });
  test("score de santé : composantes non mesurables hors dénominateur, jamais 0 par défaut", () => {
    assert.equal(healthScore(EMPTY_AGGREGATE, { settings: S }).ok, false);
    const a = agg({ sales: { ...EMPTY_AGGREGATE.sales, sellIn: 120_000, rows: 10 }, objective: 100_000 });
    const m = healthScore(a, { settings: S, health: { stockCoverageOk: null, dataQuality: 0.5 } });
    assert.ok(m.ok); if (m.ok) { assert.equal(m.value, Math.round(((30 * 1 + 15 * 0.5) / 45) * 100)); assert.match(m.note ?? "", /2 composantes/); }
  });
});
