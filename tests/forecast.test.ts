/** Prévision saisonnière : la définition officielle (`src/lib/forecast-shared.ts`) et son branchement sur la couverture. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildForecast, coveredShare, demandSeries, eventApplies, flatForecast, observedEventRatio, seasonIndex, type SeasonEvent } from "@/lib/forecast-shared";
import { computeCoverage, daysCovered, demandOver } from "@/lib/stock-math";
import { DEFAULT_FORECAST, mergeForecast } from "@/lib/settings";

const T = { green: 4, yellow: 2, orange: 1 };
const RAMADAN: SeasonEvent = { key: "ramadan", label: "Ramadan", multiplier: 0.8, keywords: [], recurring: null, windows: [{ start: "2027-02-08", end: "2027-03-09" }, { start: "2026-02-18", end: "2026-03-19" }] };
const SOLAIRE: SeasonEvent = { key: "solaire", label: "Saison solaire", multiplier: 1.5, keywords: ["solaire", "spf"], windows: [], recurring: { startMonth: 5, startDay: 1, endMonth: 8, endDay: 31 } };
const HIVER: SeasonEvent = { key: "hiver", label: "Hors saison", multiplier: 0.5, keywords: ["solaire"], windows: [], recurring: { startMonth: 11, startDay: 1, endMonth: 2, endDay: 28 } };
const creme = { name: "Crème hydratante", category: null };
const spf = { name: "Fluide solaire SPF 50", category: "Solaire" };
const ref = new Date(Date.UTC(2026, 9, 3, 12)); // 3 octobre 2026

const month = (y: number, m: number) => ({ from: Date.UTC(y, m - 1, 1), to: Date.UTC(y, m, 1) });

describe("portée d'un événement", () => {
  test("sans mot-clé : tous les produits ; avec : nom ou catégorie, sans accent ni casse", () => {
    assert.equal(eventApplies(RAMADAN, creme), true);
    assert.equal(eventApplies(SOLAIRE, creme), false);
    assert.equal(eventApplies(SOLAIRE, spf), true);
    assert.equal(eventApplies({ ...SOLAIRE, keywords: ["SOLAIRE"] }, { name: "Lait après-soleil", category: "solaire" }), true);
    assert.equal(eventApplies({ ...SOLAIRE, keywords: ["écran"] }, { name: "Ecran total", category: null }), true);
  });
});

describe("indice saisonnier d'un mois", () => {
  test("part du mois couverte par une fenêtre explicite (Ramadan 2027 : 8 février → 9 mars)", () => {
    const feb = month(2027, 2), mar = month(2027, 3), apr = month(2027, 4);
    assert.ok(Math.abs(coveredShare(RAMADAN, feb.from, feb.to) - 21 / 28) < 1e-9);
    assert.ok(Math.abs(coveredShare(RAMADAN, mar.from, mar.to) - 9 / 31) < 1e-9);
    assert.equal(coveredShare(RAMADAN, apr.from, apr.to), 0);
    // 1 + (0,8 − 1) × 21/28 = 0,85
    assert.ok(Math.abs(seasonIndex([RAMADAN], creme, feb.from, feb.to).index - 0.85) < 1e-9);
  });
  test("fenêtre récurrente chaque année, y compris à cheval sur le nouvel an", () => {
    const jun = month(2027, 6), jan = month(2027, 1), dec = month(2026, 12), apr = month(2027, 4);
    assert.equal(coveredShare(SOLAIRE, jun.from, jun.to), 1);
    assert.equal(coveredShare(SOLAIRE, apr.from, apr.to), 0);
    assert.equal(coveredShare(HIVER, jan.from, jan.to), 1);
    assert.equal(coveredShare(HIVER, dec.from, dec.to), 1);
    assert.equal(coveredShare(HIVER, apr.from, apr.to), 0);
  });
  test("les événements se multiplient, seuls ceux qui concernent le produit comptent", () => {
    const jun = month(2027, 6);
    assert.equal(seasonIndex([RAMADAN, SOLAIRE, HIVER], creme, jun.from, jun.to).index, 1);
    const si = seasonIndex([RAMADAN, SOLAIRE, HIVER], spf, jun.from, jun.to);
    assert.equal(si.index, 1.5);
    assert.deepEqual(si.events.map((e) => e.key), ["solaire"]);
  });
  test("un coefficient nul ou négatif est ignoré plutôt que d'annuler la prévision", () => {
    const jun = month(2027, 6);
    assert.equal(seasonIndex([{ ...SOLAIRE, multiplier: 0 }], spf, jun.from, jun.to).index, 1);
  });
});

describe("buildForecast", () => {
  const settings = { baseMonths: 6, horizonMonths: 6, events: [RAMADAN, SOLAIRE, HIVER] };
  test("base désaisonnalisée sur les mois complets avant le mois de référence, puis base × indice", () => {
    // Avril → septembre 2026 : 100 u. chaque mois, produit sans saisonnalité → base 100.
    const history = { "2026-04": 100, "2026-05": 100, "2026-06": 100, "2026-07": 100, "2026-08": 100, "2026-09": 100, "2026-10": 7 };
    const f = buildForecast({ product: creme, history, firstSaleMonth: "2025-01", ref, avgMonthly: 90, settings });
    assert.equal(f.method, "MODELISEE");
    assert.equal(f.fallbackToAverage, false);
    assert.deepEqual(f.base.map((b) => b.month), ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    assert.equal(f.baseline, 100);
    assert.deepEqual(f.months.map((m) => m.month), ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    assert.equal(f.months[0].qty, 100);
    // Février 2027 : 21 jours de Ramadan sur 28 → ×0,85.
    assert.ok(Math.abs(f.months[4].qty - 85) < 1e-9);
    assert.deepEqual(f.months[4].events.map((e) => e.key), ["ramadan"]);
    assert.equal(f.remainingDaysFirstMonth, 28); // 31 − 3
  });
  test("un produit solaire : l'été des mois de base est ramené à un mois normal, l'hiver à venir est réduit", () => {
    // Mai → août vendus 150 (×1,5), septembre 100 (neutre), avril 100 → base 100 partout.
    const history = { "2026-04": 100, "2026-05": 150, "2026-06": 150, "2026-07": 150, "2026-08": 150, "2026-09": 100 };
    const f = buildForecast({ product: spf, history, firstSaleMonth: "2025-01", ref, avgMonthly: 133, settings });
    assert.ok(Math.abs(f.baseline - 100) < 1e-9);
    assert.equal(f.months[1].month, "2026-11");
    assert.ok(Math.abs(f.months[1].qty - 50) < 1e-9); // hors saison ×0,5
    assert.equal(f.months[0].qty, 100); // octobre neutre
  });
  test("les mois antérieurs à la première vente sont exclus de la base", () => {
    const history = { "2026-08": 60, "2026-09": 60 };
    const f = buildForecast({ product: creme, history, firstSaleMonth: "2026-08", ref, avgMonthly: 40, settings });
    assert.deepEqual(f.base.map((b) => b.month), ["2026-08", "2026-09"]);
    assert.equal(f.baseline, 60);
  });
  test("sans aucun mois complet, la base est la vente moyenne glissante et le dit", () => {
    const f = buildForecast({ product: creme, history: { "2026-10": 5 }, firstSaleMonth: "2026-10", ref, avgMonthly: 12, settings });
    assert.equal(f.fallbackToAverage, true);
    assert.equal(f.baseline, 12);
  });
  test("un produit sans vente a une base nulle : rien n'est inventé", () => {
    const f = buildForecast({ product: creme, history: {}, firstSaleMonth: null, ref, avgMonthly: 0, settings });
    assert.equal(f.baseline, 0);
    assert.ok(f.months.every((m) => m.qty === 0));
  });
  test("l'horizon demandé prime sur celui des réglages quand il est plus long", () => {
    const f = buildForecast({ product: creme, history: {}, firstSaleMonth: null, ref, avgMonthly: 0, settings, horizonMonths: 9 });
    assert.equal(f.months.length, 9);
  });
});

describe("série de demande et couverture modélisée", () => {
  test("le premier mois est proraté aux jours restants", () => {
    const f = buildForecast({ product: creme, history: { "2026-09": 310 }, firstSaleMonth: "2026-09", ref, avgMonthly: 300, settings: { baseMonths: 1, horizonMonths: 3, events: [] } });
    const s = demandSeries(f);
    assert.equal(s.baseline, 310);
    assert.equal(s.series[0].days, 28);
    assert.ok(Math.abs(s.series[0].qty - 280) < 1e-9); // 310 × 28/31
    assert.equal(s.series[1].qty, 310);
  });
  test("daysCovered parcourt la série puis la base ; demandOver cumule au prorata", () => {
    const f = { baseline: 100, series: [{ qty: 50, days: 15 }, { qty: 100, days: 30 }] };
    assert.equal(daysCovered(150, f), 45);
    assert.equal(daysCovered(100, f), 30); // 50 sur 15 j, puis la moitié du mois suivant
    assert.equal(daysCovered(250, f), 75); // série épuisée, 100 u. de base = 30 j
    assert.equal(daysCovered(10, { baseline: 0, series: [] }), null);
    assert.equal(demandOver(45, f), 150);
    assert.equal(demandOver(30, f), 100);
    assert.equal(demandOver(75, f), 250);
  });
  test("computeCoverage avec prévision : stock cible = demande sur délai + sécurité + revue, rupture par parcours", () => {
    // Base 100/mois, mais un pic ×2 sur le mois à venir (30 j).
    const forecast = { baseline: 100, series: [{ qty: 200, days: 30 }, { qty: 100, days: 30 }, { qty: 100, days: 30 }, { qty: 100, days: 30 }] };
    const r = computeCoverage({ stock: 250, stockKnown: true, onOrder: 0, avgMonthly: 100, leadTimeDays: 30, safetyStockDays: 30, moq: null, forecast }, T);
    assert.equal(r.targetStock, 400); // 90 j : 200 + 100 + 100
    assert.equal(r.recommendedOrder, 150);
    assert.equal(r.daysToStockout, 45); // 200 u. en 30 j, puis 50 u. = 15 j
    assert.equal(r.coverageMonths, 1.5);
    assert.equal(r.level, "orange");
  });
  test("sans prévision, la vente moyenne plate donne le résultat historique", () => {
    const r = computeCoverage({ stock: 100, stockKnown: true, onOrder: 0, avgMonthly: 50, leadTimeDays: 60, safetyStockDays: 30, moq: null }, T);
    assert.equal(r.targetStock, 200);
    assert.equal(r.coverageMonths, 2);
  });
  test("prévision plate ≈ l'ancienne formule (à la longueur des mois civils près : 30 ou 31 jours)", () => {
    const f = demandSeries(flatForecast(50, new Date(Date.UTC(2026, 8, 1, 12))));
    const r = computeCoverage({ stock: 100, stockKnown: true, onOrder: 0, avgMonthly: 50, leadTimeDays: 60, safetyStockDays: 30, moq: null, forecast: f }, T);
    assert.ok(Math.abs(r.targetStock - 200) <= 4, String(r.targetStock));
    assert.ok(Math.abs((r.coverageMonths ?? 0) - 2) < 0.05);
  });
  test("base modélisée nulle : pas de rotation, aucune commande ; stock négatif : déficit signalé", () => {
    const none = computeCoverage({ stock: 10, stockKnown: true, onOrder: 0, avgMonthly: 5, leadTimeDays: 30, safetyStockDays: 0, moq: null, forecast: { baseline: 0, series: [] } }, T);
    assert.equal(none.level, "none");
    assert.equal(none.recommendedOrder, 0);
    const neg = computeCoverage({ stock: -20, stockKnown: true, onOrder: 0, avgMonthly: 10, leadTimeDays: 30, safetyStockDays: 0, moq: null, forecast: { baseline: 10, series: [{ qty: 10, days: 30 }] } }, T);
    assert.equal(neg.coverageMonths, -2);
    assert.equal(neg.level, "red");
    assert.equal(neg.recommendedOrder, 40); // cible 20 − (−20)
  });
});

describe("ratio observé d'un événement (corrélation, jamais estimé)", () => {
  test("ventes journalières dedans ÷ dehors, null sous le minimum de jours", () => {
    const daily: { date: string; qty: number }[] = [];
    for (let d = new Date(Date.UTC(2026, 0, 1)); d < new Date(Date.UTC(2026, 4, 1)); d = new Date(d.getTime() + 86400000)) {
      const s = d.toISOString().slice(0, 10);
      daily.push({ date: s, qty: s >= "2026-02-18" && s <= "2026-03-19" ? 8 : 10 });
    }
    const r = observedEventRatio(RAMADAN, daily);
    assert.equal(r.daysIn, 30);
    assert.ok(Math.abs((r.ratio ?? 0) - 0.8) < 1e-9);
    assert.equal(observedEventRatio(RAMADAN, daily.slice(0, 20)).ratio, null);
  });
});

describe("réglages de prévision", () => {
  test("les défauts sont cohérents et la fusion répare un événement partiel", () => {
    assert.ok(DEFAULT_FORECAST.events.some((e) => e.key === "ramadan" && e.windows.length >= 3));
    const m = mergeForecast({ events: [{ key: "x", label: "X", multiplier: -1 } as unknown as SeasonEvent] });
    assert.equal(m.baseMonths, DEFAULT_FORECAST.baseMonths);
    assert.deepEqual(m.events, [{ key: "x", label: "X", multiplier: 1, windows: [], recurring: null, keywords: [] }]);
    assert.equal(mergeForecast(undefined), DEFAULT_FORECAST);
  });
});
