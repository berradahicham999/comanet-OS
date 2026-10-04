/**
 * Générateur d'actions marketing — bibliothèque et moteur PURS (aucune base) : cohérence des 30 modèles, mot-héros,
 * budget disponible par levier, budget proposé et détail poste par poste, classement, non-répétition, rupture,
 * absence de budget, coût par résultat Meta, hypothèses étiquetées.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { AXES, AXIS_KEYS, TEMPLATES } from "@/lib/action-generator/catalog";
import { axisAvailable, extraKpiValue, firstItem, generate, heroWord, productKind, proposedBudget, remainingAfter, renderPattern, scheduleJ, splitBudget } from "@/lib/action-generator/engine";
import { TEMPLATE_COLUMNS, fieldsToTemplate, sheetRowToFields, formatContents, formatKpis, formatLines, formatSteps, parseContents, parseKpis, parseLines, parseSteps, templateFromActivation, templateFromProposal, templateToFields, validateTemplate } from "@/lib/action-generator/library-shared";
import { generatorQuery, parseGeneratorParams } from "@/lib/action-generator/params";
import type { AxisKey, GeneratorData, GeneratorInput } from "@/lib/action-generator/types";
import { BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import * as XLSX from "xlsx";
import { parseSheet } from "@/lib/import/parse";

const COST_ITEMS = new Set(["LIEU", "TRAITEUR", "MATERIEL", "IMPRESSION", "TRANSPORT", "CACHET", "ECHANTILLONS", "GOODIES", "HOTESSES", "SPONSORING", "COMMUNICATION", "AGENCE", "AUTRE"]);
const ACTIVATION_TYPES = new Set(["EVENEMENT", "SPONSORING", "SALON", "PLV", "SAMPLING", "GOODIES", "OPERATION_PHARMACIE", "RP", "COLLABORATION", "AUTRE"]);
const SEASON_KEYS = new Set(DEFAULT_SETTINGS.forecast.events.map((e) => e.key));

describe("bibliothèque d'actions", () => {
  test("60 modèles, clés uniques, au moins 3 par levier", () => {
    assert.ok(TEMPLATES.length >= 60, `${TEMPLATES.length} modèles`);
    assert.equal(new Set(TEMPLATES.map((t) => t.key)).size, TEMPLATES.length);
    for (const a of AXIS_KEYS) assert.ok(TEMPLATES.filter((t) => t.axis === a).length >= 3, a);
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
      const vars = { heros: "Collagenium", marque: "Auracos", produit: "Pro Collagenium", cible: "femmes 25-45 ans", ville: "Casablanca", benefice: null, actif: null, angle: null, saison: null };
      const name = renderPattern(t.name, vars), concept = renderPattern(t.concept, vars);
      assert.ok(name.length > 6 && !Object.values(BUDGET_CATEGORY_LABELS).includes(name), "un nom d'action, pas une catégorie");
      assert.ok(concept.length >= 80, "un concept complet");
      assert.doesNotMatch(name + concept, /[{}]/, "toutes les variables sont rendues (avec repli)");
      const v = validateTemplate(t);
      assert.ok(v.ok, v.ok ? "" : v.errors.join(" ; "));
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
    product: { id: "p1", name: "AURACOS PRO COLLAGENIUM 30 sachets", shortName: null, category: "Complément", priceRetail: 290, actives: "Collagène marin hydrolysé ; vitamine C", marketingAngle: null, benefits: "Peau plus ferme et éclatante en 8 semaines. Cheveux et ongles renforcés.", claims: null, profile: "GROWTH", growthPct: 18, revenue90: 120_000, contributionPct: 22, stockRisk: "HEALTHY", daysOfStock: 75 },
    budgets: { EVENEMENTIEL: axisB("EVENEMENTIEL", 45_000), TRADE: axisB("TRADE", 30_000), MEDICAL: axisB("MEDICAL", 20_000), PARTENARIAT: axisB("PARTENARIAT", 15_000), DIGITAL: axisB("DIGITAL", 25_000), INFLUENCE: axisB("INFLUENCE", 60_000), CONTENU: axisB("CONTENU", 10_000) },
    brandAvailable: 200_000, monthRemaining: null, history: [], verdicts: {}, adsCost: null,
    seasonEvents: [], topCity: "Casablanca", topPos: [{ name: "Pharmacie Atlas", city: "Casablanca", revenue: 30_000, trendPct: -12 }],
    influencers: [{ name: "Sara", followers: 25_000, usualRate: 3000, collabs: 2, lastReach: 12_000 }],
    team: { MARKETING: { id: "u1", name: "Hicham" }, TRADE: { id: "u2", name: "Samy" } },
    prescribers: { a: 12, b: 30, total: 80 }, playbook: null,
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

describe("fiches produits et textes à variables", () => {
  test("renderPattern : variable, repli, variable vide", () => {
    assert.equal(renderPattern("Atelier {heros} à {ville|la ville cible}", { heros: "Collagenium", ville: null }), "Atelier Collagenium à la ville cible");
    assert.equal(renderPattern("{benefice|son bénéfice} ({actif})", { benefice: "peau plus ferme", actif: "" }), "peau plus ferme");
  });
  test("firstItem : premier élément de la fiche, minuscule initiale", () => {
    assert.equal(firstItem("Peau plus ferme et éclatante en 8 semaines. Cheveux renforcés."), "peau plus ferme et éclatante en 8 semaines");
    assert.equal(firstItem("Collagène marin hydrolysé ; vitamine C"), "collagène marin hydrolysé");
    assert.equal(firstItem(null), null);
  });
  test("le concept reprend le bénéfice et l'actif de la fiche produit", () => {
    const r = generate(input({ axis: "INFLUENCE", objective: "LANCEMENT" }), data(), TEMPLATES);
    const ugc = r.options.find((o) => o.templateKey === "IN_UGC_CREATORS");
    assert.ok(ugc, "créatrices UGC proposées");
    assert.match(ugc!.concept, /peau plus ferme et éclatante en 8 semaines/);
    assert.ok(ugc!.data.some((d) => d.label.startsWith("Bénéfice") && d.tag === "CONFIRMED"));
  });
  test("KPI propre : valeur fixe ou calculée sur le budget", () => {
    assert.equal(extraKpiValue({ value: 4 }, 10_000), "4");
    assert.equal(extraKpiValue({ per: 110 }, 11_000), "100");
    assert.equal(extraKpiValue({ per: 20, factor: 0.5 }, 10_000), "250");
  });
});

describe("ce qui marche par marque et calendrier", () => {
  test("Auracos : la grosse influenceuse passe devant quand elle est favorite", () => {
    const base = generate(input({ axis: "INFLUENCE", budget: 50_000 }), data(), TEMPLATES).options;
    const pb = generate(input({ axis: "INFLUENCE", budget: 50_000 }), data({ playbook: { levers: { INFLUENCE: 1 }, favorites: ["IN_MACRO"], avoid: [], note: "grosse influenceuse" } }), TEMPLATES).options;
    assert.equal(pb[0].templateKey, "IN_MACRO");
    const before = base.find((o) => o.templateKey === "IN_MACRO")!, after = pb[0];
    assert.ok(after.score > before.score);
    assert.ok(after.scoreItems.some((i) => i.key === "marque" && i.points === 10 && i.tag === "INFERRED"));
    assert.ok(after.why.some((w) => /ce qui marche pour Auracos/.test(w)));
  });
  test("tous leviers : la favorite passe devant les autres actions du levier pondéré à 100 %", () => {
    const pb = data({ playbook: { levers: { INFLUENCE: 1, DIGITAL: 0.6 }, favorites: ["IN_MACRO"], avoid: [], note: null } });
    const r = generate(input({ axis: null, objective: "NOTORIETE", budget: 150_000 }), pb, TEMPLATES);
    const macro = r.options.find((o) => o.templateKey === "IN_MACRO");
    assert.ok(macro, "la grosse influenceuse doit figurer dans les options");
    const otherInfluence = r.options.filter((o) => o.axis === "INFLUENCE" && o.templateKey !== "IN_MACRO");
    assert.ok(otherInfluence.every((o) => o.score <= macro.score));
    assert.ok(otherInfluence.every((o) => o.scoreItems.find((i) => i.key === "marque")!.points === 7));
  });
  test("un modèle écarté pour la marque n'est jamais proposé", () => {
    const r = generate(input({ axis: "EVENEMENTIEL" }), data({ playbook: { levers: {}, favorites: [], avoid: ["EVT_PADEL"], note: null } }), TEMPLATES);
    assert.ok(!r.options.some((o) => o.templateKey === "EVT_PADEL"));
    assert.ok(r.excluded.some((e) => e.templateKey === "EVT_PADEL" && /écarté/.test(e.reason)));
  });
  test("médical : actions prescripteurs avec les médecins A et B de la base", () => {
    const r = generate(input({ axis: "MEDICAL", objective: "LANCEMENT" }), data(), TEMPLATES);
    assert.ok(r.options.length >= 3);
    assert.ok(r.options.every((o) => o.axis === "MEDICAL"));
    assert.ok(r.options[0].why.some((w) => /42 médecins de potentiel A ou B/.test(w)));
  });
  test("modèles saisonniers : réservés à leur période", () => {
    const nov = generate(input({ axis: "TRADE", objective: "SELL_OUT", month: "2026-11-01" }), data(), TEMPLATES);
    assert.ok(nov.excluded.some((e) => e.templateKey === "SZ_AID_COFFRET" && /réservé/.test(e.reason)));
    const ram = generate(input({ axis: "TRADE", objective: "SELL_OUT", month: "2027-02-01" }), data({ seasonEvents: [{ key: "ramadan", label: "Ramadan" }] }), TEMPLATES);
    assert.ok(!ram.excluded.some((e) => e.templateKey === "SZ_AID_COFFRET"));
    const bf = generate(input({ axis: "DIGITAL", objective: "ECOULEMENT", month: "2026-11-01", budget: 30_000 }), data(), TEMPLATES);
    assert.ok(bf.options.some((o) => o.templateKey === "SZ_BLACK_FRIDAY"));
  });
});

describe("bibliothèque éditable", () => {
  test("formulaire et Excel : chaque modèle livré fait l'aller-retour sans perte", () => {
    for (const t of TEMPLATES) {
      const { raw, errors, active } = fieldsToTemplate(templateToFields(t, true));
      assert.deepEqual(errors, [], `${t.key} : ${errors.join(" ; ")}`);
      assert.equal(active, true);
      const v = validateTemplate(raw);
      assert.ok(v.ok, `${t.key} : ${v.ok ? "" : v.errors.join(" ; ")}`);
      if (!v.ok) continue;
      const back = v.template;
      assert.equal(back.key, t.key); assert.equal(back.axis, t.axis); assert.equal(back.name, t.name); assert.equal(back.concept, t.concept);
      assert.deepEqual(back.budget, t.budget); assert.deepEqual(back.execution, t.execution); assert.deepEqual(back.targets, t.targets);
      assert.equal(back.steps.length, t.steps.length); assert.equal(back.lines.length, t.lines.length); assert.equal(back.contents.length, t.contents.length);
      assert.ok(Math.abs(back.lines.reduce((s, l) => s + l.share, 0) - 1) < 0.01, `${t.key} : parts`);
      assert.deepEqual(back.onlyWhen ?? null, t.onlyWhen ?? null, `${t.key} : réservé à`);
      assert.deepEqual(back.seasons, t.seasons);
      assert.equal(back.cityBased, t.cityBased); assert.equal(back.posBased, t.posBased); assert.equal(back.influencerBased, t.influencerBased);
    }
  });

  test("Excel : export puis réimport de toute la bibliothèque par le lecteur d'import", () => {
    const rows = TEMPLATES.map((t) => { const f = templateToFields(t, true); return Object.fromEntries(TEMPLATE_COLUMNS.map((c) => [c.label, f[c.key]])); });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: TEMPLATE_COLUMNS.map((c) => c.label) }), "Bibliothèque");
    const sheet = parseSheet(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
    assert.equal(sheet.rows.length, TEMPLATES.length);
    for (const row of sheet.rows) {
      const { raw, errors } = fieldsToTemplate(sheetRowToFields(row));
      assert.deepEqual(errors, [], String(row["Clé"]));
      const v = validateTemplate(raw);
      assert.ok(v.ok, `${row["Clé"]} : ${v.ok ? "" : v.errors.join(" ; ")}`);
    }
  });
  test("Excel : en-têtes courts ou clés techniques reconnus", () => {
    const f = sheetRowToFields({ "Étapes": "J-7 ; Préparer ; MARKETING", cle: "IM_X", "Budget min": 1000, Inconnu: "x" });
    assert.equal(f.etapes, "J-7 ; Préparer ; MARKETING"); assert.equal(f.cle, "IM_X"); assert.equal(f.budget_min, "1000");
  });

  test("formulaire : « actif » à non désactive, champ manquant signalé", () => {
    const f = templateToFields(TEMPLATES[0], false);
    assert.equal(fieldsToTemplate(f).active, false);
    const bad = fieldsToTemplate({ ...f, budget_min: "beaucoup", portee: "" });
    assert.ok(bad.errors.some((e) => e.includes("budget_min")));
    assert.ok(bad.errors.some((e) => e.includes("portée")));
  });

  test("syntaxe texte : aller-retour des postes, étapes, contenus, KPI", () => {
    const t = TEMPLATES.find((x) => x.key === "EVT_PADEL")!;
    const lines = parseLines(formatLines(t.lines)); assert.deepEqual(lines.errors, []); assert.deepEqual(lines.value, t.lines);
    const steps = parseSteps(formatSteps(t.steps)); assert.deepEqual(steps.errors, []); assert.deepEqual(steps.value, [...t.steps].sort((a, b) => a.offset - b.offset));
    const contents = parseContents(formatContents(t.contents)); assert.deepEqual(contents.errors, []); assert.deepEqual(contents.value, t.contents);
    const k = parseKpis(formatKpis([{ label: "A", value: 4 }, { label: "B", per: 20, factor: 0.5 }, { label: "C", value: "≥ 80 %" }])); assert.deepEqual(k.value, [{ label: "A", value: 4 }, { label: "B", per: 20, factor: 0.5 }, { label: "C", value: "≥ 80 %" }]);
  });
  test("erreurs de saisie lisibles", () => {
    assert.ok(parseLines("Location ; INCONNUE ; 50").errors[0].includes("ligne 1"));
    assert.ok(parseSteps("demain ; préparer ; marketing").errors.length === 1);
    const v = validateTemplate({ ...TEMPLATES[0], key: "x" });
    assert.ok(!v.ok && v.errors.some((e) => /clé/.test(e)));
  });
  test("enregistrer une action réussie comme modèle : textes généralisés, parts à 100 %", () => {
    const p = generate(input(), data(), TEMPLATES).options[0];
    const t = templateFromProposal(p, TEMPLATES.find((x) => x.key === p.templateKey)!, { key: "EQ_TEST_ABCD", brand: "Auracos", hero: "Collagenium" });
    const v = validateTemplate(t); assert.ok(v.ok, v.ok ? "" : v.errors.join(" ; "));
    assert.doesNotMatch(t.name, /Collagenium/); assert.match(t.name, /\{heros\}/);
    assert.equal(t.budget.typical, p.budget);
  });
  test("enregistrer une activation réalisée comme modèle", () => {
    const t = templateFromActivation({ name: "Journée Sebo-Control Casablanca", type: "OPERATION_PHARMACIE", description: null, date: "2026-09-10", endDate: null, city: "Casablanca", brand: "Gamarde", product: null },
      [{ costItem: "HOTESSES", label: "Animatrice", planned: 3000 }, { costItem: "ECHANTILLONS", label: "Échantillons", planned: 1500 }, { costItem: "AUTRE", label: "Divers", planned: 500 }],
      [{ label: "Prévenir la pharmacie", dueDate: "2026-09-01" }, { label: "Installer", dueDate: "2026-09-10" }], "AC_TEST_ABCD");
    const v = validateTemplate(t); assert.ok(v.ok, v.ok ? "" : v.errors.join(" ; "));
    assert.equal(t.axis, "TRADE"); assert.equal(t.budget.typical, 5000); assert.equal(t.steps[0].offset, -9);
    assert.match(t.name, /\{ville\|la ville cible\}/);
    assert.equal(t.family, "Operation pharmacie (réalisé)");
  });
  test("activation générée : la note du générateur ne devient pas le concept", () => {
    const t = templateFromActivation({ name: "Journées Vegan en pharmacie", type: "OPERATION_PHARMACIE", description: "Deux journées d'animation par officine avec une animatrice formée sur Vegan Lift.\n\nAction générée par COMANET (modèle « Journées en pharmacie ») : rétroplanning dans Priorités & actions.", date: "2026-09-10", endDate: null, city: null, brand: "Gamarde", product: "Vegan Lift" }, [], [], "AV_TEST_ABCD");
    assert.doesNotMatch(t.concept, /Action générée/);
    assert.match(t.concept, /\{produit\}/);
  });
});
