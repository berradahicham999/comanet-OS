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

/* ------------------------------ Analyses et verdicts ------------------------------ */
import { classifyInvestment, channelMix, rankPairs } from "@/lib/analytics-marketing/analysis";
import { diagnoseChannel } from "@/lib/analytics-marketing/diagnosis";
import { DEFAULT_AD_THRESHOLDS, animationDayCostOf, animationMinMultipleOf } from "@/lib/settings";

const spend = (spent: number, rows = 1) => ({ planned: 0, committed: 0, spent, rows, measurableRows: rows, unmeasuredRows: 0 });

describe("classification d'investissement", () => {
  test("sur / sous / aligné selon le seuil en points", () => {
    assert.equal(classifyInvestment(0.30, 0.20, 5).cls, "SUR_INVESTI");
    assert.equal(classifyInvestment(0.10, 0.20, 5).cls, "SOUS_INVESTI");
    assert.equal(classifyInvestment(0.22, 0.20, 5).cls, "ALIGNE");
    assert.equal(classifyInvestment(null, 0.20, 5).cls, "NON_CLASSABLE");
  });
  test("mix de canaux : parts et écart au portefeuille en points", () => {
    const m = channelMix([{ key: "A", spent: 300 }, { key: "B", spent: 100 }, { key: "C", spent: 0 }], [{ key: "A", spent: 500 }, { key: "B", spent: 500 }]);
    assert.deepEqual(m.map((r) => [r.key, r.share, r.deltaPts]), [["A", 0.75, 25], ["B", 0.25, -25]]);
  });
  test("meilleur / pire couple : relatif à la médiane du canal, au moins deux marques par canal", () => {
    const S2 = { ...S, channelDiagnosis: { ...S.channelDiagnosis, minSpend: 100 } };
    const r = rankPairs([
      { brandId: "b1", channelKey: "META_ADS", agg: agg({ spend: spend(1000), results: { MESSAGES_STARTED: 100 } }), resultMetric: "PURCHASES", fallback: "MESSAGES_STARTED" },
      { brandId: "b2", channelKey: "META_ADS", agg: agg({ spend: spend(1000), results: { MESSAGES_STARTED: 25 } }), resultMetric: "PURCHASES", fallback: "MESSAGES_STARTED" },
      { brandId: "b1", channelKey: "INFLUENCE", agg: agg({ spend: spend(2000), results: { REACH: 20000 } }), resultMetric: "REACH", fallback: null },
    ], S2);
    assert.equal(r.best?.brandId, "b1"); assert.equal(r.best?.channelKey, "META_ADS");
    assert.equal(r.worst?.brandId, "b2");
    assert.equal(r.all.find((x) => x.channelKey === "INFLUENCE")?.relative, null, "un seul couple sur le canal : pas de classement");
  });
});

describe("verdict par canal × marque", () => {
  const channel = { key: "INFLUENCE", family: "INFLUENCE", resultMetric: "REACH" as const, fallbackResultMetric: null };
  test("sous le seuil de dépense : WATCH, jamais « stable »", () => {
    const v = diagnoseChannel({ cur: agg({ spend: spend(100), results: { REACH: 1000 }, sources: ["COLLABORATION"] }), prev: null, portfolio: null, channel, days: 30 }, S, DEFAULT_AD_THRESHOLDS);
    assert.equal(v.verdict, "WATCH");
  });
  test("dépense non mesurable : WATCH avec renvoi vers Paramètres", () => {
    const v = diagnoseChannel({ cur: agg({ spend: { planned: 0, committed: 0, spent: 0, rows: 5, measurableRows: 0, unmeasuredRows: 5 }, results: { SELLOUT_AMOUNT: 5000 }, sources: ["ANIMATION"] }), prev: null, portfolio: null, channel: { ...channel, key: "ANIMATION_POS", family: "TERRAIN" }, days: 30 }, S, DEFAULT_AD_THRESHOLDS);
    assert.equal(v.verdict, "WATCH"); assert.match(v.actions[0], /Paramètres/);
  });
  test("générique : hausse du coût par résultat → OPTIMIZE ; baisse → SCALE ; très au-dessus des autres marques → STOP", () => {
    const cur = agg({ spend: spend(2000), results: { REACH: 10000 }, sources: ["COLLABORATION"] }); // 0,20 MAD / portée
    const cheaper = agg({ spend: spend(2000), results: { REACH: 20000 }, sources: ["COLLABORATION"] }); // 0,10
    assert.equal(diagnoseChannel({ cur, prev: cheaper, portfolio: null, channel, days: 30 }, S, DEFAULT_AD_THRESHOLDS).verdict, "OPTIMIZE");
    assert.equal(diagnoseChannel({ cur: cheaper, prev: cur, portfolio: null, channel, days: 30 }, S, DEFAULT_AD_THRESHOLDS).verdict, "SCALE");
    const portfolio = agg({ spend: spend(10000), results: { REACH: 200000 }, sources: ["COLLABORATION"] }); // 0,05
    assert.equal(diagnoseChannel({ cur, prev: null, portfolio, channel, days: 30 }, S, DEFAULT_AD_THRESHOLDS).verdict, "STOP");
  });
  test("véto stock : un SCALE devient MAINTAIN si un produit poussé est en tension", () => {
    const cur = agg({ spend: spend(2000), results: { REACH: 20000 }, sources: ["COLLABORATION"] });
    const prev = agg({ spend: spend(2000), results: { REACH: 10000 }, sources: ["COLLABORATION"] });
    const v = diagnoseChannel({ cur, prev, portfolio: null, channel, days: 30, stockTension: ["p1"] }, S, DEFAULT_AD_THRESHOLDS);
    assert.equal(v.verdict, "MAINTAIN"); assert.match(v.why, /rupture|couverture/);
  });
  test("animation : rentable au-dessus de l'objectif journalier, STOP sous le plancher", () => {
    const anim = { key: "ANIMATION_POS", family: "TERRAIN", resultMetric: "SELLOUT_AMOUNT" as const, fallbackResultMetric: null };
    const settings = { ...S, animationMonthlyCost: 7000, animationDaysPerMonth: 22, animationTargetSelloutPerDay: 1700 };
    assert.equal(animationDayCostOf(settings), 318);
    assert.ok(Math.abs(animationMinMultipleOf(settings) - 1700 / 318) < 1e-9);
    const good = diagnoseChannel({ cur: agg({ spend: spend(3180, 10), results: { SELLOUT_AMOUNT: 20000 }, sources: ["ANIMATION"] }), prev: null, portfolio: null, channel: anim, days: 30 }, settings, DEFAULT_AD_THRESHOLDS);
    assert.equal(good.verdict, "SCALE"); assert.match(good.why, /1.700 MAD TTC par jour/);
    const bad = diagnoseChannel({ cur: agg({ spend: spend(3180, 10), results: { SELLOUT_AMOUNT: 4000 }, sources: ["ANIMATION"] }), prev: null, portfolio: null, channel: anim, days: 30 }, settings, DEFAULT_AD_THRESHOLDS);
    assert.equal(bad.verdict, "STOP");
    const mid = diagnoseChannel({ cur: agg({ spend: spend(3180, 10), results: { SELLOUT_AMOUNT: 10000 }, sources: ["ANIMATION"] }), prev: null, portfolio: null, channel: anim, days: 30 }, settings, DEFAULT_AD_THRESHOLDS);
    assert.equal(mid.verdict, "OPTIMIZE");
  });
  test("régie : moteur Digital Ads quand il y a des conversions ; STOP sans aucun résultat", () => {
    const meta = { key: "META_ADS", family: "DIGITAL_PAID", resultMetric: "PURCHASES" as const, fallbackResultMetric: "MESSAGES_STARTED" as const };
    const none = diagnoseChannel({ cur: agg({ spend: spend(5000), results: { IMPRESSIONS: 100000, CLICKS: 900 }, sources: ["AD_METRIC"] }), prev: null, portfolio: null, channel: meta, days: 30 }, S, DEFAULT_AD_THRESHOLDS);
    assert.equal(none.engine, "ADS"); assert.equal(none.verdict, "STOP");
    const buys = diagnoseChannel({ cur: agg({ spend: spend(5000), results: { IMPRESSIONS: 100000, CLICKS: 900, PURCHASES: 20 }, attributed: { spend: 5000, revenue: 20000 }, sources: ["AD_METRIC"] }), prev: null, portfolio: null, channel: meta, days: 30 }, S, DEFAULT_AD_THRESHOLDS);
    assert.equal(buys.engine, "ADS"); assert.notEqual(buys.verdict, "STOP");
  });
  test("régie « Messages » : sans achat ni lead mais avec des conversations, jugée au coût par conversation", () => {
    const meta = { key: "META_ADS", family: "DIGITAL_PAID", resultMetric: "PURCHASES" as const, fallbackResultMetric: "MESSAGES_STARTED" as const };
    const v = diagnoseChannel({ cur: agg({ spend: spend(5000), results: { IMPRESSIONS: 100000, CLICKS: 900, MESSAGES_STARTED: 40 }, sources: ["AD_METRIC"] }), prev: null, portfolio: null, channel: meta, days: 30 }, S, DEFAULT_AD_THRESHOLDS);
    assert.equal(v.engine, "GENERIC"); assert.equal(v.verdict, "MAINTAIN");
    assert.equal(v.costPerResult?.key, "MESSAGES_STARTED"); assert.equal(v.costPerResult?.value, 125);
  });
});

/* ------------------------------ Produits : quatre cas et stock ------------------------------ */
import { classifyProduct, stockAdvice } from "@/lib/analytics-marketing/analysis";
import { isOverstock } from "@/lib/stock-math";

describe("classification des produits en quatre cas", () => {
  const t = S.productCases;
  test("poussé (dépense ou expositions) × se vend (croissance ou au-dessus de la médiane)", () => {
    assert.equal(classifyProduct({ spent: 800, exposures: 0, sellIn: 12000, sellInPrev: 10000, brandMedianSellIn: 5000 }, t).cls, "POUSSE_VEND");
    assert.equal(classifyProduct({ spent: 0, exposures: 3, sellIn: 4000, sellInPrev: 5000, brandMedianSellIn: 6000 }, t).cls, "POUSSE_VEND_PAS");
    assert.equal(classifyProduct({ spent: 0, exposures: 1, sellIn: 9000, sellInPrev: 6000, brandMedianSellIn: 5000 }, t).cls, "PAS_POUSSE_VEND");
    assert.equal(classifyProduct({ spent: 100, exposures: 0, sellIn: 1000, sellInPrev: 1200, brandMedianSellIn: 5000 }, t).cls, "DORMANT");
  });
  test("sans comparaison ni médiane : ne se vend pas seulement à 0 vente", () => {
    assert.equal(classifyProduct({ spent: 0, exposures: 0, sellIn: 500, sellInPrev: null, brandMedianSellIn: null }, t).selling, true);
    assert.equal(classifyProduct({ spent: 0, exposures: 0, sellIn: 0, sellInPrev: null, brandMedianSellIn: null }, t).cls, "DORMANT");
  });
  test("stock : rupture et tension interdisent de pousser, surstock à écouler", () => {
    assert.equal(stockAdvice({ stockKnown: false, stock: 0, coverageMonths: null, underTension: false, overstock: false }).level, "INCONNU");
    assert.equal(stockAdvice({ stockKnown: true, stock: 0, coverageMonths: 0, underTension: true, overstock: false }).level, "RUPTURE");
    assert.equal(stockAdvice({ stockKnown: true, stock: 20, coverageMonths: 0.6, underTension: false, overstock: false }).level, "TENSION");
    assert.equal(stockAdvice({ stockKnown: true, stock: 500, coverageMonths: 9, underTension: false, overstock: true }).level, "SURSTOCK");
    assert.equal(isOverstock({ coverageMonths: 9, stock: 500 }, { overstockMonths: 6, overstockMinUnits: 50 }), true);
    assert.equal(isOverstock({ coverageMonths: 9, stock: 10 }, { overstockMonths: 6, overstockMinUnits: 50 }), false);
  });
});

/* ------------------------------ Réallocation et dégradation ------------------------------ */
import { proposeReallocations, reallocationSentence } from "@/lib/analytics-marketing/reallocation";
import { isDegrading } from "@/lib/analytics-marketing/decision-shared";

describe("réallocation mensuelle", () => {
  const v = (verdict: "SCALE" | "STOP" | "OPTIMIZE" | "MAINTAIN" | "WATCH", cpr: number | null, key: "REACH" | "MESSAGES_STARTED" = "REACH") => ({ verdict, headline: `${verdict} test`, why: "raison", actions: [], costPerResult: cpr === null ? null : { value: cpr, key, prev: null, portfolio: null }, engine: "GENERIC" as const });
  const labels = { brand: (id: string) => `Marque ${id}`, channel: (k: string) => `Canal ${k}`, result: (k: string) => k };
  test("déplace une part d'un canal STOP vers le canal SCALE le moins cher, avec résultat attendu", () => {
    const r = proposeReallocations([
      { brandId: "b", channelKey: "A", spent: 10000, measurableRows: 5, rows: 5, hasPrev: true, verdict: v("STOP", 50) },
      { brandId: "b", channelKey: "B", spent: 5000, measurableRows: 5, rows: 5, hasPrev: true, verdict: v("SCALE", 10) },
      { brandId: "b", channelKey: "C", spent: 5000, measurableRows: 5, rows: 5, hasPrev: true, verdict: v("SCALE", 20) },
    ], S, labels);
    assert.equal(r.length, 1);
    assert.equal(r[0].toChannel, "B"); assert.equal(r[0].amount, 6000); assert.equal(r[0].fromSharePct, 60);
    assert.deepEqual(r[0].expected, { key: "REACH", value: 600, costPerResult: 10 });
    assert.equal(r[0].confidence, "HAUTE");
    assert.match(reallocationSentence(r[0], labels), /Déplacer 6.000 MAD .* de Canal A vers Canal B pour Marque b/);
  });
  test("OPTIMIZE : part limitée à maxShiftPct ; sous le montant minimal : rien ; sans cible SCALE : rien", () => {
    const opt = proposeReallocations([
      { brandId: "b", channelKey: "A", spent: 10000, measurableRows: 5, rows: 5, hasPrev: false, verdict: v("OPTIMIZE", 50) },
      { brandId: "b", channelKey: "B", spent: 500, measurableRows: 5, rows: 5, hasPrev: false, verdict: v("SCALE", 10) },
    ], S, labels);
    assert.equal(opt[0].amount, 3000); assert.equal(opt[0].confidence, "FAIBLE");
    assert.equal(proposeReallocations([{ brandId: "b", channelKey: "A", spent: 1500, measurableRows: 1, rows: 1, hasPrev: true, verdict: v("OPTIMIZE", 50) }, { brandId: "b", channelKey: "B", spent: 5000, measurableRows: 1, rows: 1, hasPrev: true, verdict: v("SCALE", 10) }], S, labels).length, 0);
    assert.equal(proposeReallocations([{ brandId: "b", channelKey: "A", spent: 10000, measurableRows: 1, rows: 1, hasPrev: true, verdict: v("STOP", 50) }], S, labels).length, 0);
  });
  test("dégradation : coût strictement croissant sur n semaines closes", () => {
    const pts = (xs: (number | null)[]) => xs.map((c, i) => ({ week: `2026-W3${i}`, costPerResult: c }));
    assert.equal(isDegrading(pts([10, 11, 12, 13]), 3), true);
    assert.equal(isDegrading(pts([10, 11, 11, 13]), 3), false);
    assert.equal(isDegrading(pts([10, 11, null, 13]), 3), false);
    assert.equal(isDegrading(pts([11, 12, 13]), 3), false, "il faut n + 1 points");
  });
});

/* ------------------------------ Bloc question (sans LLM) ------------------------------ */
import { parseQuestion } from "@/lib/analytics-marketing/ask";

describe("bloc question", () => {
  const vocab = { brands: [{ id: "g", name: "Gamarde" }, { id: "a", name: "Alphascience" }], channels: [{ key: "META_ADS", label: "Meta Ads" }, { key: "ANIMATION_POS", label: "Animation en point de vente" }, { key: "INFLUENCE", label: "Influence" }], cities: ["MARRAKECH", "CASABLANCA"], products: [{ id: "p1", name: "Ultra Shield SPF50+" }] };
  test("marque, ville, période et intention reconnues", () => {
    const p = parseQuestion("Quel canal marche le mieux pour Gamarde à Marrakech ce trimestre ?", vocab);
    assert.equal(p.intent, "BEST_CHANNEL"); assert.equal(p.brandId, "g"); assert.equal(p.city, "MARRAKECH"); assert.equal(p.period, "quarter");
    assert.deepEqual(p.unknown, []);
  });
  test("canal par synonyme, dépense sur 90 jours", () => {
    const p = parseQuestion("Combien avons-nous dépensé en animation à Casablanca sur les 90 derniers jours ?", vocab);
    assert.equal(p.intent, "SPEND"); assert.equal(p.channelKey, "ANIMATION_POS"); assert.equal(p.city, "CASABLANCA"); assert.equal(p.period, "last90");
  });
  test("produit reconnu, mots inconnus signalés, jamais devinés", () => {
    const p = parseQuestion("Faut-il pousser Ultra Shield SPF50+ chez les grossistes ?", vocab);
    assert.equal(p.intent, "PRODUCTS"); assert.equal(p.productId, "p1"); assert.ok(p.unknown.includes("grossistes"));
    assert.equal(p.brandId, null);
  });
  test("sans mot-clé : vue d'ensemble sur le mois", () => {
    const p = parseQuestion("Alphascience", vocab);
    assert.equal(p.intent, "OVERVIEW"); assert.equal(p.brandId, "a"); assert.equal(p.period, "month");
  });
});
