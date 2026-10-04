/**
 * Générateur d'actions marketing — bibliothèque et moteur PURS (aucune base) : cohérence des 30 modèles, mot-héros,
 * budget disponible par levier, budget proposé et détail poste par poste, classement, non-répétition, rupture,
 * absence de budget, coût par résultat Meta, hypothèses étiquetées.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { AXES, AXIS_KEYS, TEMPLATES } from "@/lib/action-generator/catalog";
import { axisAvailable, generate, heroWord, productKind, proposedBudget, remainingAfter, scheduleJ, splitBudget } from "@/lib/action-generator/engine";
import { generatorQuery, parseGeneratorParams } from "@/lib/action-generator/params";
import type { AxisKey, GeneratorData, GeneratorInput } from "@/lib/action-generator/types";
import { BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";

const COST_ITEMS = new Set(["LIEU", "TRAITEUR", "MATERIEL", "IMPRESSION", "TRANSPORT", "CACHET", "ECHANTILLONS", "GOODIES", "HOTESSES", "SPONSORING", "COMMUNICATION", "AGENCE", "AUTRE"]);
const ACTIVATION_TYPES = new Set(["EVENEMENT", "SPONSORING", "SALON", "PLV", "SAMPLING", "GOODIES", "OPERATION_PHARMACIE", "RP", "COLLABORATION", "AUTRE"]);
const SEASON_KEYS = new Set(DEFAULT_SETTINGS.forecast.events.map((e) => e.key));

describe("bibliothèque d'actions", () => {
  test("30 modèles, clés uniques, au moins 4 par levier", () => {
    assert.equal(TEMPLATES.length, 30);
    assert.equal(new Set(TEMPLATES.map((t) => t.key)).size, TEMPLATES.length);
    for (const a of AXIS_KEYS) assert.ok(TEMPLATES.filter((t) => t.axis === a).length >= 4, a);
  });
  for (const t of TEMPLATES) {
    test(`${t.key} : cohérent`, () => {
      const sum = t.lines.reduce((s, l) => s + l.share, 0);
      assert.ok(Math.abs(sum - 1) < 0.001, `parts = ${sum}`);
      assert.ok(t.lines.some((l) => l.label === "Imprévus"), "ligne d'imprévus");
      assert.ok(t.budget.min > 0 && t.budget.min <= t.budget.typical && t.budget.typical <= t.budget.max, "fourchette de budget");
      assert.ok(Object.keys(t.objectives).length > 0 && t.targets.length > 0 && t.channels.length > 0 && t.steps.length >= 5, "contenu minimal");
      assert.ok(Math.min(...t.steps.map((s) => s.offset)) >= -t.prepDays, "aucune étape avant le délai de préparation");
      for (const k of Object.keys(t.seasons)) assert.ok(SEASON_KEYS.has(k), `saison inconnue ${k}`);
      if (t.execution.kind === "ACTIVATION") {
        assert.ok(ACTIVATION_TYPES.has(t.execution.activationType), "type d'activation connu");
        for (const l of t.lines) assert.ok(l.costItem && COST_ITEMS.has(l.costItem), `poste d'activation pour « ${l.label} »`);
      }
      const name = t.name({ hero: "Collagenium", brand: "Auracos", product: "Pro Collagenium", target: "Femmes 25-45 ans", city: "Casablanca", season: null, month: "2026-11-01" });
      assert.ok(name.length > 6 && !Object.values(BUDGET_CATEGORY_LABELS).includes(name), "un nom d'action, pas une catégorie");
      assert.match(t.concept({ hero: "Collagenium", brand: "Auracos", product: "Pro Collagenium", target: "Femmes 25-45 ans", city: "Casablanca", season: null, month: "2026-11-01" }), /\w{20,}|.{80,}/);
    });
  }
});

describe("adaptation au produit", () => {
  test("mot-héros : retire la marque, les tailles et les mots génériques", () => {
    assert.equal(heroWord({ name: "AURACOS PRO COLLAGENIUM 30 sachets" }, "Auracos"), "Collagenium");
    assert.equal(heroWord({ name: "GAMARDE SEBO-CONTROL NETTOYANT CLARIFIANT 160 ml Foamer" }, "Gamarde"), "Sebo-Control");
    assert.equal(heroWord({ name: "Crème", shortName: "Hydra Boost" }, "X"), "Hydra");
    assert.equal(heroWord(null, "Gamarde"), "Gamarde");
  });
  test("type de produit", () => {
    assert.equal(productKind({ name: "Pro Collagenium 30 sachets", category: null }), "COMPLEMENT");
    assert.equal(productKind({ name: "Crème solaire SPF50+", category: null }), "SOLAIRE");
    assert.equal(productKind({ name: "Fluide hydratant", category: "Soin visage" }), "DERMO");
  });
});

describe("budget", () => {
  test("disponible d'un levier : alloué − engagé − réservé ; repli sur l'enveloppe ; sinon non défini", () => {
    assert.deepEqual(axisAvailable({ axis: "EVENEMENTIEL", allocated: 80_000, committed: 20_000, reserved: 15_000, brandAvailable: 300_000 }).available, 45_000);
    const m = axisAvailable({ axis: "TRADE", allocated: 0, committed: 5_000, reserved: 0, brandAvailable: 120_000 });
    assert.equal(m.source, "MARQUE"); assert.equal(m.available, 120_000);
    assert.equal(axisAvailable({ axis: "DIGITAL", allocated: 0, committed: 0, reserved: 0, brandAvailable: null }).available, null);
  });
  test("budget proposé : idéal s'il tient, sinon le disponible (≥ minimum), sinon rien", () => {
    const t = { budget: { min: 9000, typical: 14800, max: 30000 } };
    assert.equal(proposedBudget(t, 45_000), 14_800);
    assert.equal(proposedBudget(t, 11_250), 11_200);
    assert.equal(proposedBudget(t, 8_000), null);
  });
  test("détail poste par poste : somme exacte, arrondi à 100", () => {
    const t = TEMPLATES.find((x) => x.key === "EVT_PADEL")!;
    const lines = splitBudget(14_800, t.lines);
    assert.equal(lines.reduce((s, l) => s + l.amount, 0), 14_800);
    for (const l of lines) assert.equal(l.amount % 100, 0);
  });
  test("après ajout : 45 000 → 30 000", () => { assert.equal(remainingAfter(45_000, 15_000), 30_000); assert.equal(remainingAfter(null, 15_000), null); });
});

/* ------------------------------ Moteur ------------------------------ */

const axisB = (axis: AxisKey, available: number | null, source: "AXE" | "MARQUE" | "AUCUN" = "AXE") => ({ axis, allocated: available ?? 0, committed: 0, reserved: 0, available, source });

function data(over: Partial<GeneratorData> = {}): GeneratorData {
  return {
    today: "2026-10-04", brand: { id: "b1", name: "Auracos" },
    product: { id: "p1", name: "AURACOS PRO COLLAGENIUM 30 sachets", shortName: null, category: "Complément", priceRetail: 290, actives: null, marketingAngle: null, profile: "GROWTH", growthPct: 18, revenue90: 120_000, contributionPct: 22, stockRisk: "HEALTHY", daysOfStock: 75 },
    budgets: { EVENEMENTIEL: axisB("EVENEMENTIEL", 45_000), TRADE: axisB("TRADE", 30_000), DIGITAL: axisB("DIGITAL", 25_000), INFLUENCE: axisB("INFLUENCE", 20_000), CONTENU: axisB("CONTENU", 10_000) },
    brandAvailable: 200_000, monthRemaining: null, history: [], verdicts: {}, adsCost: null,
    seasonEvents: [], topCity: "Casablanca", topPos: [{ name: "Pharmacie Atlas", city: "Casablanca", revenue: 30_000, trendPct: -12 }],
    influencers: [{ name: "Sara", followers: 25_000, usualRate: 3000, collabs: 2, lastReach: 12_000 }],
    team: { MARKETING: { id: "u1", name: "Hicham" }, TRADE: { id: "u2", name: "Samy" } },
    ...over,
  };
}
const input = (over: Partial<GeneratorInput> = {}): GeneratorInput => ({ brandId: "b1", objective: "SELL_OUT", axis: "EVENEMENTIEL", budget: 20_000, month: "2026-11-01", target: "FEMMES_25_45", productId: "p1", ...over });

describe("génération", () => {
  test("3 à 5 options concrètes, classées, toutes dans le budget, avec budget détaillé, rétroplanning et KPI", () => {
    const r = generate(input(), data(), TEMPLATES);
    assert.equal(r.blocked, null);
    assert.ok(r.options.length >= 3 && r.options.length <= 5, `${r.options.length} options`);
    for (let i = 1; i < r.options.length; i++) assert.ok(r.options[i - 1].score >= r.options[i].score, "classement par score");
    for (const p of r.options) {
      assert.equal(p.axis, "EVENEMENTIEL");
      assert.ok(p.budget <= 20_000);
      assert.equal(p.lines.reduce((s, l) => s + l.amount, 0), p.budget);
      assert.ok(p.steps.length >= 5 && p.kpis.length >= 6);
      assert.ok(p.steps.every((s) => s.date >= "2026-10-04"), "aucune étape dans le passé");
      assert.match(p.objectiveText, /essais|ventes/);
      assert.ok(p.kpis.filter((k) => k.label !== "Coût par essai").every((k) => k.tag === "INFERRED" || k.tag === "MISSING"), "résultats attendus = hypothèses");
      assert.ok(p.name.includes("Collagenium") || p.name.includes("Auracos"));
    }
    const small = generate(input({ budget: 10_000 }), data(), TEMPLATES);
    assert.ok(small.excluded.some((e) => e.templateKey === "EVT_POPUP" && /hors budget/.test(e.reason)), "les modèles trop chers sont écartés avec leur raison");
    assert.ok(r.excluded.some((e) => /complément/.test(e.reason)), "l'atelier routine (dermo) est écarté pour un complément");
  });
  test("le CA attendu utilise le prix public réel ; sans prix, il est non mesurable", () => {
    const p = generate(input(), data(), TEMPLATES).options[0];
    assert.equal(p.estimate.revenue, p.estimate.units * 290);
    const q = generate(input(), data({ product: { ...data().product!, priceRetail: null } }), TEMPLATES).options[0];
    assert.equal(q.estimate.revenue, null);
    assert.equal(q.roiLevel, "NON_MESURABLE");
    assert.ok(q.warnings.some((w) => /Prix public/.test(w)));
  });
  test("non-répétition : une action au plan est exclue, une action récente est pénalisée", () => {
    const base = generate(input(), data(), TEMPLATES).options;
    const top = base[0];
    const planned = generate(input(), data({ history: [{ kind: "ACTION", templateKey: top.templateKey, activationType: null, productId: "p1", label: top.name, date: "2026-10-20", open: true }] }), TEMPLATES);
    assert.ok(!planned.options.some((o) => o.templateKey === top.templateKey));
    assert.ok(planned.excluded.some((e) => e.templateKey === top.templateKey && /déjà au plan/.test(e.reason)));
    const done = generate(input(), data({ history: [{ kind: "ACTION", templateKey: top.templateKey, activationType: null, productId: "p1", label: top.name, date: "2026-08-15", open: false }] }), TEMPLATES);
    const again = done.options.find((o) => o.templateKey === top.templateKey);
    if (again) { assert.ok(again.score <= top.score - 20); assert.ok(again.scoreItems.some((s) => s.key === "repetition")); }
  });
  test("budget-aware : sans budget saisi, la base est le disponible du levier", () => {
    const r = generate(input({ budget: null }), data(), TEMPLATES);
    assert.equal(r.budgetSource, "AXE");
    assert.equal(r.budgetUsed, 45_000);
    assert.ok(r.options.every((o) => o.budget <= 45_000));
  });
  test("sans levier : chaque modèle est borné par le disponible de SON levier, au plus 2 options par levier", () => {
    const r = generate(input({ axis: null, budget: null }), data(), TEMPLATES);
    for (const o of r.options) assert.ok(o.budget <= (data().budgets[o.axis].available ?? Infinity), `${o.templateKey} dans le budget de son levier`);
    const per = new Map<string, number>(); for (const o of r.options) per.set(o.axis, (per.get(o.axis) ?? 0) + 1);
    assert.ok([...per.values()].every((n) => n <= 2));
  });
  test("produit en risque de rupture : aucune option, réapprovisionner d'abord", () => {
    const r = generate(input(), data({ product: { ...data().product!, stockRisk: "RUPTURE_RISQUE", daysOfStock: 9 } }), TEMPLATES);
    assert.equal(r.options.length, 0);
    assert.match(r.blocked ?? "", /rupture/);
  });
  test("aucun budget : rien n'est inventé", () => {
    const d = data({ budgets: { ...data().budgets, EVENEMENTIEL: axisB("EVENEMENTIEL", null, "AUCUN") }, brandAvailable: null });
    const r = generate(input({ budget: null }), d, TEMPLATES);
    assert.equal(r.options.length, 0);
    assert.match(r.blocked ?? "", /budget/i);
  });
  test("digital : le coût par résultat Meta mesuré remplace l'hypothèse du modèle", () => {
    const r = generate(input({ axis: "DIGITAL" }), data({ adsCost: { value: 6, label: "conversations" } }), TEMPLATES);
    const conv = r.options.find((o) => o.templateKey === "DG_CONVERSION")!;
    assert.equal(conv.estimate.costSource, "META");
    assert.equal(conv.estimate.contacts, Math.round((conv.budget * 0.78) / 6));
  });
  test("saisonnalité : un événement favorable relève le score", () => {
    const a = generate(input({ axis: "TRADE" }), data(), TEMPLATES).options.find((o) => o.templateKey === "TR_GWP")!;
    const b = generate(input({ axis: "TRADE" }), data({ seasonEvents: [{ key: "ramadan", label: "Ramadan" }] }), TEMPLATES).options.find((o) => o.templateKey === "TR_GWP")!;
    assert.ok(b.score > a.score);
  });
  test("délai de préparation : J reporté si la période est trop proche", () => {
    const t = TEMPLATES.find((x) => x.key === "EVT_POPUP")!;
    const s = scheduleJ(t, "2026-10-01", "2026-10-04");
    assert.equal(s.shifted, true);
    assert.equal(s.j, "2026-11-13");
  });
});

describe("paramètres d'URL", () => {
  test("aller-retour", () => {
    const i = input({ brandId: "11111111-1111-4111-8111-111111111111", productId: "22222222-2222-4222-8222-222222222222" });
    const back = parseGeneratorParams(Object.fromEntries(new URLSearchParams(generatorQuery(i))), { month: "2026-10-01" });
    assert.deepEqual(back, i);
    assert.equal(parseGeneratorParams({ brand: "x" }, { month: "2026-10-01" }), null);
  });
  test("chaque levier a une catégorie principale dans ses catégories", () => { for (const a of AXIS_KEYS) assert.ok(AXES[a].categories.includes(AXES[a].mainCategory)); });
});
