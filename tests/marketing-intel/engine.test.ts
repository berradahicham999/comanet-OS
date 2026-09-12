/**
 * Moteurs purs de la couche Marketing Intelligence : statut et risque de stock (seuils Paramètres),
 * profil commercial d'un produit, objectifs et run-rate, moteur de décision (ventes × stock × marge × Ads).
 * Aucune base, aucun appel réseau.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { ProductStock } from "@/lib/stock";
import { daysOfStock, inventoryRow, inventorySummary, stockRiskOf, stockStatusOf, stockThresholdsDays } from "@/lib/marketing-intel/inventory";
import { buildProductPerfRows, categoryOf, growthPct, salesProfileOf, topSkus, profileThresholds } from "@/lib/marketing-intel/performance";
import { computeTargets } from "@/lib/marketing-intel/targets";
import { decide, decideProduct } from "@/lib/marketing-intel/decisions";
import type { ProductPerf, InventoryRow } from "@/lib/marketing-intel/types";

const S = DEFAULT_SETTINGS;

function stock(over: Partial<ProductStock>): ProductStock {
  return {
    productId: "p1", sku: "SKU1", name: "Crème A", brandId: "b1", brandName: "Gamarde", brandColor: null, category: null, stock: 850, stockKnown: true, onOrder: 0,
    stockDate: "2026-08-30", avgMonthly: 400, trendPct: 5, coverageMonths: 850 / 400, level: "yellow", stockoutDate: "2026-11-02", leadTimeDays: 60, safetyStockDays: 30, moq: null,
    recommendedOrder: 0, targetStock: 1600, costPrice: 40, priceWholesale: 80, marginPct: 50, stockValue: 34_000, fieldSellOut30d: 0, fieldStockAvg: null, ...over,
  };
}

describe("statut et risque de stock — seuils Paramètres, jamais en dur", () => {
  test("les seuils sont convertis en jours depuis settings", () => {
    const t = stockThresholdsDays(S);
    assert.equal(t.criticalBelowDays, S.coverage.orange * 30);
    assert.equal(t.lowBelowDays, S.coverage.yellow * 30);
    assert.equal(t.tensionBelowDays, S.stockTightCoverageMonths * 30);
    assert.equal(t.overstockAboveDays, S.analytics.productCases.overstockMonths * 30);
    assert.equal(daysOfStock(2.1), 63);
    assert.equal(daysOfStock(null), null);
  });
  test("CRITICAL sous le seuil orange, LOW sous le seuil jaune, HEALTHY sinon", () => {
    assert.equal(stockStatusOf(stock({ coverageMonths: 0.5, level: "red" }), S), "CRITICAL");
    assert.equal(stockStatusOf(stock({ coverageMonths: 1.5, level: "orange" }), S), "LOW");
    assert.equal(stockStatusOf(stock({}), S), "HEALTHY");
    assert.equal(stockStatusOf(stock({ coverageMonths: 5, level: "green" }), S), "HEALTHY");
  });
  test("OVERSTOCK au-delà du seuil de surstock sur un volume qui compte ; jamais sur 10 unités", () => {
    assert.equal(stockStatusOf(stock({ stock: 1200, avgMonthly: 100, coverageMonths: 12, level: "green" }), S), "OVERSTOCK");
    assert.equal(stockStatusOf(stock({ stock: 10, avgMonthly: 1, coverageMonths: 10, level: "green" }), S), "HEALTHY");
  });
  test("sans photo de stock : UNKNOWN ; sans rotation : NO_ROTATION — jamais estimé", () => {
    assert.equal(stockStatusOf(stock({ stockKnown: false, level: "unknown", coverageMonths: null }), S), "UNKNOWN");
    assert.equal(stockRiskOf(stock({ stockKnown: false, level: "unknown", coverageMonths: null }), S), "UNKNOWN");
    assert.equal(stockStatusOf(stock({ avgMonthly: 0, coverageMonths: null, level: "none" }), S), "NO_ROTATION");
    const row = inventoryRow(stock({ stockKnown: false, level: "unknown", coverageMonths: null, stock: 0 }), { unitsLast30: 3, revenueLast30: 240, lastSale: "2026-08-01" }, S, true);
    assert.equal(row.stock, null, "un stock inconnu est null, pas 0");
    assert.equal(row.daysOfStock, null);
  });
  test("RUPTURE_RISQUE = niveau rouge OU tension (couverture < seuil de tension avec rotation) ; SURSTOCK ; HEALTHY", () => {
    assert.equal(stockRiskOf(stock({ stock: 40, avgMonthly: 90, coverageMonths: 40 / 90, level: "red" }), S), "RUPTURE_RISQUE");
    assert.equal(stockRiskOf(stock({ stock: 100, avgMonthly: 80, coverageMonths: 1.25, level: "orange" }), S), "RUPTURE_RISQUE", "tension : < 1,5 mois et > 30 unités/mois");
    assert.equal(stockRiskOf(stock({ stock: 12, avgMonthly: 10, coverageMonths: 1.2, level: "orange" }), S), "HEALTHY", "couverture courte sans enjeu de volume");
    assert.equal(stockRiskOf(stock({ stock: 1200, avgMonthly: 100, coverageMonths: 12, level: "green" }), S), "SURSTOCK");
    assert.equal(stockRiskOf(stock({}), S), "HEALTHY");
  });
  test("coûts internes masqués : marge et valeur de stock absentes", () => {
    const row = inventoryRow(stock({}), { unitsLast30: 400, revenueLast30: 32_000, lastSale: "2026-08-30" }, S, false);
    assert.equal(row.marginPct, null);
    assert.equal(row.stockValue, null);
    assert.equal(row.avgDailySales, 400 / 30);
    const sum = inventorySummary([row], false);
    assert.equal(sum.stockValue, null);
    assert.equal(sum.avgDaysOfStock, Math.round((850 / 400) * 30));
  });
});

describe("profil commercial d'un produit", () => {
  const t = profileThresholds(S);
  test("croissance : null sans période comparable", () => {
    assert.equal(growthPct(100, null), null);
    assert.equal(growthPct(100, 0), null);
    assert.equal(growthPct(120, 100), 20);
  });
  test("STAR / GROWTH / CASH_COW / UNDERPERFORMER / STABLE / INSUFFICIENT_DATA", () => {
    assert.equal(salesProfileOf({ revenue: 30_000, revenuePrev: 22_000, growthPct: 36, contributionPct: 25 }, t).profile, "STAR");
    assert.equal(salesProfileOf({ revenue: 5_000, revenuePrev: 4_000, growthPct: 25, contributionPct: 3 }, t).profile, "GROWTH");
    assert.equal(salesProfileOf({ revenue: 30_000, revenuePrev: 29_000, growthPct: 3, contributionPct: 25 }, t).profile, "CASH_COW");
    assert.equal(salesProfileOf({ revenue: 8_000, revenuePrev: 9_000, growthPct: -11, contributionPct: 6 }, t).profile, "UNDERPERFORMER");
    assert.equal(salesProfileOf({ revenue: 5_000, revenuePrev: 5_100, growthPct: -2, contributionPct: 4 }, t).profile, "STABLE");
    assert.equal(salesProfileOf({ revenue: 500, revenuePrev: 300, growthPct: 66, contributionPct: 0.4 }, t).profile, "INSUFFICIENT_DATA", "volume trop faible pour classer");
  });
  test("sans période comparable, jamais STAR ni GROWTH : la raison le dit", () => {
    const r = salesProfileOf({ revenue: 30_000, revenuePrev: null, growthPct: null, contributionPct: 25 }, t);
    assert.equal(r.profile, "CASH_COW");
    assert.ok(r.reasons.some((x) => /non mesurable/.test(x)));
  });
  test("le stock prime sur le profil dans la catégorie finale", () => {
    assert.equal(categoryOf("STAR", "RUPTURE_RISQUE"), "STOCK_RISK");
    assert.equal(categoryOf("UNDERPERFORMER", "SURSTOCK"), "OVERSTOCK");
    assert.equal(categoryOf("STAR", "HEALTHY"), "STAR");
    assert.equal(categoryOf("STABLE", null), "STABLE");
  });
  test("buildProductPerfRows : contribution, marge officielle, historique, tri par CA ; top croissance exclut les non comparables", () => {
    const inv = new Map<string, InventoryRow>([["p1", inventoryRow(stock({}), { unitsLast30: 400, revenueLast30: 32_000, lastSale: "2026-08-30" }, S, true)]]);
    const rows = buildProductPerfRows({
      cur: [{ id: "p1", name: "Crème A", extra: "Gamarde", amount: 30_000, quantity: 375, orders: 20, clients: 15 }, { id: "p9", name: "Nouveau", extra: "Gamarde", amount: 4_000, quantity: 40, orders: 3, clients: 3 }],
      prev: [{ id: "p1", name: "Crème A", extra: "Gamarde", amount: 22_000, quantity: 280, orders: 15, clients: 12 }],
      catalog: [{ id: "p1", name: "Crème A", sku: "SKU1", shortName: null, category: null, active: true, needsReview: false, brandId: "b1", brandName: "Gamarde", brandColor: null, priceWholesale: 80, costPrice: 40, priceRetail: 120, revenue12: 300_000, qty12: 3_000, revenue3: 90_000, qtyPrev3: 800, qty3: 900, clients12: 40, lastSale: "2026-08-30" }],
      inventory: inv, scopeRevenue: 34_000, settings: S, internalCosts: true,
    });
    assert.equal(rows[0].productId, "p1");
    assert.equal(Math.round(rows[0].contributionPct as number), 88);
    assert.equal(rows[0].marginPct, 50);
    assert.equal(rows[0].profile, "STAR");
    assert.equal(rows[0].trend3Pct, 12.5);
    const nouveau = rows.find((r) => r.productId === "p9")!;
    assert.equal(nouveau.growthPct, null, "absent de la période précédente : croissance infinie non fabriquée");
    assert.deepEqual(topSkus(rows, "growth", 5).map((r) => r.productId), ["p1"]);
  });
});

describe("objectifs et run-rate", () => {
  test("objectif mensuel, écart, projection linéaire, rythme annuel", () => {
    const t = computeTargets({ ref: new Date("2026-09-15T12:00:00Z"), monthlyObjective: 120_000, annualObjective: 1_400_000, mtd: 50_000, ytd: 900_000 });
    assert.equal(t.monthly.gap, 70_000);
    assert.equal(Math.round(t.monthly.pct as number), 42);
    assert.equal(t.monthly.forecastRunRate, 100_000);
    assert.equal(t.monthly.forecastGap, 20_000);
    assert.equal(t.annual.gap, 500_000);
    assert.ok((t.annual.expectedAtPace as number) > 900_000 && (t.annual.paceGap as number) > 0);
  });
  test("objectif absent : null partout, jamais 0 %", () => {
    const t = computeTargets({ ref: new Date("2026-09-15T12:00:00Z"), monthlyObjective: null, annualObjective: null, mtd: 50_000, ytd: 900_000 });
    assert.equal(t.monthly.pct, null);
    assert.equal(t.monthly.gap, null);
    assert.equal(t.annual.expectedAtPace, null);
  });
});

/* ------------------------------ Moteur de décision ------------------------------ */

function perf(over: Partial<ProductPerf> & { st?: Partial<InventoryRow> | null }): ProductPerf {
  const { st, ...rest } = over;
  const base = inventoryRow(stock({}), { unitsLast30: 400, revenueLast30: 32_000, lastSale: "2026-08-30" }, S, true);
  return {
    productId: "p1", sku: "SKU1", name: "Crème A", brandId: "b1", brandName: "Gamarde", revenue: 30_000, units: 375, orders: 20, clients: 15, revenuePrev: 22_000, unitsPrev: 280,
    growthPct: 36, unitsGrowthPct: 34, contributionPct: 25, marginPct: 50, revenue12: 300_000, units12: 3_000, clients12: 40, units3: 900, unitsPrev3: 800, trend3Pct: 12.5, lastSale: "2026-08-30",
    stock: st === null ? null : { ...base, ...(st ?? {}) }, profile: "STAR", category: "STAR", reasons: [], ...rest,
  };
}
const inputs = (rows: ProductPerf[], over: Partial<Parameters<typeof decide>[0]> = {}) => ({ rows, settings: S, brandName: "Gamarde", ads: null, targets: null, comparable: true, periodLabel: "30 derniers jours", ...over });

describe("moteur de décision — jamais sur les ventes seules", () => {
  test("ventes ↑ + stock faible → RESTOCK, à ne pas pousser", () => {
    const d = decideProduct(perf({ st: { stock: 40, daysOfStock: 13, risk: "RUPTURE_RISQUE", status: "CRITICAL", stockoutDate: "2026-09-13", recommendedOrder: 300 } }), inputs([]))!;
    assert.equal(d.action, "RESTOCK");
    assert.equal(d.doNotPush, true);
    assert.ok(d.why.some((w) => /13 jours/.test(w)) && d.why.some((w) => /\+36/.test(w)));
    assert.equal(d.confidence, "HIGH");
  });
  test("ventes ↓ + stock élevé → CREATE_PROMOTION (opportunité)", () => {
    const d = decideProduct(perf({ growthPct: -15, profile: "UNDERPERFORMER", category: "OVERSTOCK", st: { stock: 1200, daysOfStock: 360, risk: "SURSTOCK", status: "OVERSTOCK" } }), inputs([]))!;
    assert.equal(d.action, "CREATE_PROMOTION");
    assert.ok(d.secondaryActions.includes("FOCUS_SELL_OUT"));
    assert.equal(d.doNotPush, false);
  });
  test("ventes ↑ + stock élevé → PUSH", () => {
    const d = decideProduct(perf({ category: "OVERSTOCK", st: { stock: 1200, daysOfStock: 360, risk: "SURSTOCK", status: "OVERSTOCK" } }), inputs([]))!;
    assert.equal(d.action, "PUSH");
  });
  test("ventes ↓ + stock faible → DO_NOT_PROMOTE : problème à diagnostiquer", () => {
    const d = decideProduct(perf({ growthPct: -20, profile: "UNDERPERFORMER", category: "STOCK_RISK", st: { stock: 30, daysOfStock: 10, risk: "RUPTURE_RISQUE", status: "CRITICAL" } }), inputs([]))!;
    assert.equal(d.action, "DO_NOT_PROMOTE");
    assert.match(d.title, /Diagnostiquer/);
    assert.equal(d.doNotPush, true);
  });
  test("marge faible + Ads performantes → OPTIMIZE, jamais de scale automatique", () => {
    const ads = new Map([["p1", { decision: "PUSH", costPerResult: 4, why: ["winner"] }]]);
    const d = decideProduct(perf({ marginPct: 12 }), inputs([], { ads }))!;
    assert.equal(d.action, "OPTIMIZE");
    assert.ok(d.why.some((w) => /marge brute 12 %/.test(w)));
  });
  test("ventes ↑ + stock sain → PUSH (BOOST_DIGITAL si l'intelligence Ads confirme)", () => {
    const ads = new Map([["p1", { decision: "PUSH_MORE", costPerResult: 4, why: [] }]]);
    const d = decideProduct(perf({}), inputs([], { ads }))!;
    assert.equal(d.action, "PUSH");
    assert.ok(d.secondaryActions.includes("BOOST_DIGITAL"));
    assert.ok(d.data.some((f) => f.tag === "CONFIRMED") && d.data.some((f) => f.tag === "CALCULATED"));
  });
  test("gros contributeur stable et sain → MAINTAIN ; petit produit stable → rien", () => {
    assert.equal(decideProduct(perf({ growthPct: 2, profile: "CASH_COW", category: "CASH_COW" }), inputs([]))!.action, "MAINTAIN");
    assert.equal(decideProduct(perf({ growthPct: 2, contributionPct: 2, profile: "STABLE", category: "STABLE" }), inputs([])), null);
    assert.equal(decideProduct(perf({ revenue: 300, revenuePrev: 200, profile: "INSUFFICIENT_DATA", category: "INSUFFICIENT_DATA" }), inputs([])), null);
  });
  test("données manquantes : confiance abaissée, jamais une estimation", () => {
    const d = decideProduct(perf({ growthPct: null, revenuePrev: null, profile: "CASH_COW", category: "CASH_COW", st: null }), inputs([], { comparable: false }))!;
    assert.equal(d.confidence, "LOW");
    assert.ok(d.confidenceWhy.some((w) => /stock non renseigné/.test(w)) && d.confidenceWhy.some((w) => /non comparable/.test(w)));
    assert.ok(d.data.some((f) => f.tag === "MISSING"));
  });
  test("decide() : classement, séparation « à ne pas pousser », limite Paramètres, décision marque sur l'écart d'objectif", () => {
    const rows = [
      perf({ productId: "p1", name: "Crème A" }),
      perf({ productId: "p3", name: "SPF C", growthPct: 33, contributionPct: 10, st: { stock: 40, daysOfStock: 13, risk: "RUPTURE_RISQUE", status: "CRITICAL" } }),
      perf({ productId: "p2", name: "Sérum B", growthPct: -11, contributionPct: 6, profile: "UNDERPERFORMER", category: "OVERSTOCK", st: { stock: 1200, daysOfStock: 360, risk: "SURSTOCK", status: "OVERSTOCK" } }),
    ];
    const targets = computeTargets({ ref: new Date("2026-08-31T12:00:00Z"), monthlyObjective: 120_000, annualObjective: null, mtd: 60_000, ytd: 500_000 });
    const set = decide(inputs(rows, { targets, settings: { ...S, marketingIntel: { ...S.marketingIntel, maxDecisions: 2 } } }));
    assert.deepEqual(set.decisions.map((d) => d.action), ["PUSH", "CREATE_PROMOTION"], "la décision marque passe après les produits mieux notés et la limite s'applique");
    assert.equal(set.decisions[0].productName, "Crème A");
    assert.deepEqual(set.doNotPush.map((d) => `${d.action}:${d.productName}`), ["RESTOCK:SPF C"]);
    assert.equal(set.considered, 3);
    const full = decide(inputs(rows, { targets }));
    assert.ok(full.decisions.some((d) => d.scope === "brand" && d.action === "FOCUS_SELL_OUT"));
  });
});
