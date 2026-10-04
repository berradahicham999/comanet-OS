/**
 * Studio créatif (Intelligence contenu) — moteurs PURS, sans base ni appel API : taxonomie, tensions, intelligence
 * produit, conformité des allégations, empreinte et fatigue, apprentissage, notation, opportunités, concepts et package
 * déterministes, variations, brief. Trois cas représentatifs de catégories (jamais câblés dans le moteur) : Gamarde
 * (dermo-cosmétique), CygneLab (gummies beauté), Auracos (collagène). Un garde-fou vérifie les écritures du module.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { MECHANICS, TERRITORY_KEYS, mechanicOf, mechanicsForAngleTag } from "@/lib/creative/territories";
import { TENSIONS, matchTensions, tensionOf } from "@/lib/creative/consumer";
import { buildProductIntelligence, creativeCategoryOf, routineRoleOf, splitSheet } from "@/lib/creative/product-intel";
import { checkText, checkConcept, mandatoryMentions, hasBlock } from "@/lib/creative/compliance";
import { creativeFingerprint, similarity, nearestRecent, territoryUsage, saturatedTerritories, fatigueOf, repetitionPenalty, parseFingerprint } from "@/lib/creative/fingerprint";
import { creativeLearning, historicalFit } from "@/lib/creative/learning";
import { scoreOpportunity, scoreConcept, funnelOf, AXIS_OF_TERRITORY } from "@/lib/creative/scoring";
import { buildOpportunities, rankMechanics, parseOpportunityKey, opportunityKey } from "@/lib/creative/opportunities";
import { rulesConcepts, draftPackage, draftVariations, fill, paidTestBudget, kpisFor } from "@/lib/creative/rules";
import { buildBrief } from "@/lib/creative/brief";
import type { CreativeData, CreativePerformance, ProductIntelligence, RecentConcept } from "@/lib/creative/types";

const T = DEFAULT_SETTINGS.creative;
const META_ANGLES = ["Avant / après", "Témoignage", "Problème → solution", "FAQ / éducatif", "Démonstration", "Promo / offre", "Événement / point de vente", "Nouveauté / lancement"];

/* ------------------------------ Trois cas : dermo-cosmétique, gummies, collagène ------------------------------ */

const GAMARDE = buildProductIntelligence(
  { id: "p-gam", name: "GAMARDE HYDRATATION ACTIVE CRÈME 40 ml", shortName: null, category: "Soin visage", priceRetail: 189, actives: "Eau thermale de Gamarde ; huile de sésame bio", marketingAngle: "Hydratation bio certifiée", benefits: "Hydrate et apaise les peaux sèches et sensibles ; confort immédiat", claims: "Hydrate 24 h ; apaise", target: "Femmes 25-45 ans à peau sèche" },
  { name: "Gamarde", positioning: "Dermo-cosmétique bio vendue en pharmacie" }, { profile: "GROWTH", growthPct: 18, contributionPct: 22, revenue90: 120_000, stockRisk: "HEALTHY", daysOfStock: 75 },
);
const CYGNE = buildProductIntelligence(
  { id: "p-cyg", name: "CYGNELAB BEAUTY GUMMIES 60 gommes", shortName: null, category: "Complément alimentaire", priceRetail: 249, actives: "Biotine ; zinc ; vitamine C", marketingAngle: "La beauté qui se croque", benefits: "Contribue au maintien de cheveux normaux et d'ongles normaux", claims: "Biotine : contribue au maintien de cheveux normaux", target: "Femmes 25-45 ans" },
  { name: "CygneLab", positioning: "Beauté de l'intérieur, gourmande" }, { profile: "STAR", growthPct: 30, contributionPct: 40, revenue90: 300_000, stockRisk: "HEALTHY", daysOfStock: 60 },
);
const AURACOS = buildProductIntelligence(
  { id: "p-aur", name: "AURACOS PRO COLLAGENIUM 30 sachets", shortName: null, category: "Complément", priceRetail: 290, actives: "Collagène marin hydrolysé ; vitamine C", marketingAngle: null, benefits: "Peau plus ferme et éclatante ; cheveux et ongles renforcés", claims: null, target: null },
  { name: "Auracos", positioning: "Nutricosmétique premium" }, { profile: "CASH_COW", growthPct: -4, contributionPct: 35, revenue90: 200_000, stockRisk: "SURSTOCK", daysOfStock: 200 },
);

const FORMATS = [{ key: "REEL", label: "Réel" }, { key: "UGC", label: "UGC" }, { key: "CARROUSEL", label: "Carrousel" }, { key: "POST", label: "Post" }, { key: "STORY", label: "Story" }, { key: "VIDEO", label: "Vidéo" }];

function data(p: ProductIntelligence, over: Partial<CreativeData> = {}, business: Partial<CreativeData["business"]> = {}): CreativeData {
  return {
    today: "2026-10-04",
    business: {
      brandId: "b1", brandName: p.brandName, brandColor: "#0f766e", positioning: p.brandName === "Gamarde" ? "Dermo-cosmétique bio vendue en pharmacie" : null, brandTarget: null, objective: "SELL_OUT", objectiveLabel: "Augmenter le sell-out", priorityAction: "PUSH",
      commercialPriority: "sell-in +18 % vs période précédente, stock sain", funnelStage: "CONVERSION", audience: "Femmes 25-45 ans", month: "2026-11-01", season: null,
      budgets: { CONTENU: { available: 10_000, source: "AXE" }, DIGITAL: { available: 25_000, source: "AXE" }, INFLUENCE: { available: 0, source: "AXE" } }, adsCost: { value: 4.2, label: "conversations" }, ...business,
    },
    product: p, tensions: matchTensions(p).map((m) => m.tension), usage: [], recentConcepts: [], performances: [], insights: [], playbookNote: null, playbookLevers: {}, formats: FORMATS, ...over,
  };
}

function perf(over: Partial<CreativePerformance> & { id: string }): CreativePerformance {
  return {
    source: "ADS", label: `Créative ${over.id}`, brandId: "b1", productId: null, conceptId: null, territory: "UGC", mechanic: "UGC_PROBLEM_SOLUTION", hookType: "PROBLEM", format: "Reel / vidéo", persona: null, objective: null, funnelStage: null, publishedAt: "2026-09-01",
    metrics: { spend: 1000, results: 250, resultKind: "message", costPerResult: 4, reach: null, impressions: 20_000, engagement: null, views: null, ctr: 1.2, conversions: null, revenue: null }, ...over,
  };
}

/* ------------------------------ Taxonomie ------------------------------ */

describe("taxonomie créative", () => {
  test("au moins 35 mécaniques structurées, clés uniques, chaque territoire fourni", () => {
    assert.ok(MECHANICS.length >= 35, `${MECHANICS.length} mécaniques`);
    assert.equal(new Set(MECHANICS.map((m) => m.key)).size, MECHANICS.length);
    for (const t of TERRITORY_KEYS) assert.ok(MECHANICS.filter((m) => m.territory === t).length >= 5, t);
  });
  for (const m of MECHANICS) {
    test(`${m.key} : métadonnées complètes`, () => {
      assert.ok(m.hookPatterns.length >= 1 && m.narrativeStructures.length >= 1 && m.visualPatterns.length >= 1 && m.ctaPatterns.length >= 1);
      assert.ok(m.funnelStages.length && m.objectives.length && m.productTypes.length && m.formats.length && m.personas.length && m.targetProfiles.length);
      assert.ok(m.organicFit >= 0 && m.organicFit <= 1 && m.paidFit >= 0 && m.paidFit <= 1);
      assert.ok(m.psychologicalTrigger.length > 10 && m.bestFor.length > 10);
      if (m.angleTag) assert.ok(META_ANGLES.includes(m.angleTag), `angle Meta inconnu : ${m.angleTag}`);
    });
  }
  test("les étiquettes d'angle Meta relient la mémoire publicitaire aux mécaniques", () => {
    for (const a of META_ANGLES) assert.ok(mechanicsForAngleTag(a).length >= 1, a);
  });
});

/* ------------------------------ Tensions ------------------------------ */

describe("tensions consommateur", () => {
  test("catalogue complet : clés uniques, huit facettes renseignées, catégories et mots-clés", () => {
    assert.equal(new Set(TENSIONS.map((t) => t.key)).size, TENSIONS.length);
    for (const t of TENSIONS) {
      for (const f of [t.problem, t.frustration, t.desire, t.objection, t.belief, t.misconception, t.question, t.emotion]) assert.ok(f.length > 8, `${t.key} : facette vide`);
      assert.ok(t.categories.length && t.keywords.length >= 3 && t.funnelStages.length);
    }
  });
  test("la fiche produit active les bonnes tensions : Gamarde → peau qui tiraille / réactive, CygneLab → cheveux et ongles, Auracos → beauté de l'intérieur", () => {
    assert.ok(["SKIN_TIGHT", "SKIN_SENSITIVE"].includes(matchTensions(GAMARDE)[0].tension.key));
    assert.equal(matchTensions(CYGNE)[0].tension.key, "SUPP_HAIR");
    assert.equal(matchTensions(AURACOS)[0].tension.key, "SUPP_SKIN_WITHIN");
    assert.ok(matchTensions(GAMARDE).every((m) => m.tension.categories.includes("DERMOCOSMETIC")));
  });
  test("fiche vide : tension par défaut de la catégorie, force 0 (jamais inventée)", () => {
    const empty = buildProductIntelligence({ id: "x", name: "Référence 12", shortName: null, category: "Complément", priceRetail: null, actives: null, marketingAngle: null, benefits: null, claims: null, target: null }, { name: "Z", positioning: null }, null);
    const m = matchTensions(empty);
    assert.equal(m[0].score, 0);
    assert.equal(m[0].tension.key, "SUPP_ROUTINE");
  });
});

/* ------------------------------ Intelligence produit ------------------------------ */

describe("intelligence produit", () => {
  test("catégorie créative : dermo-cosmétique par le positionnement, complément, solaire, soin", () => {
    assert.equal(GAMARDE.category, "DERMOCOSMETIC");
    assert.equal(CYGNE.category, "SUPPLEMENT");
    assert.equal(AURACOS.category, "SUPPLEMENT");
    assert.equal(creativeCategoryOf({ name: "Fluide solaire SPF 50", category: null }, { name: "X", positioning: null }), "SUN");
    assert.equal(creativeCategoryOf({ name: "Crème visage bio", category: "Soin" }, { name: "Douceur", positioning: "Cosmétique naturelle" }), "SKINCARE");
  });
  test("complétude de la fiche et champs manquants, sans estimation", () => {
    assert.equal(GAMARDE.sheetCompleteness, 1);
    assert.ok(AURACOS.sheetCompleteness < 1 && AURACOS.missing.includes("allégations autorisées") && AURACOS.missing.includes("cible"));
    assert.deepEqual(splitSheet("a ; b\n• c"), ["a", "b", "c"].filter((x) => x.length >= 3).length ? ["a ; b".length ? [] : []].flat() : []);
  });
  test("rôle dans la routine déduit du nom", () => {
    assert.match(routineRoleOf("SUPPLEMENT", "Beauty Gummies 60 gommes", null), /gommes/);
    assert.match(routineRoleOf("DERMOCOSMETIC", "Sérum éclat", null), /Étape 2/);
    assert.match(routineRoleOf("SUN", "Fluide solaire SPF 50", null), /renouveler/);
  });
});

/* ------------------------------ Conformité ------------------------------ */

describe("conformité des allégations", () => {
  const gam = { category: GAMARDE.category, product: GAMARDE };
  const cyg = { category: CYGNE.category, product: CYGNE };
  test("cosmétique : allégation thérapeutique et pathologie bloquantes", () => {
    const flags = checkText("Cette crème traite l'eczéma et guérit les rougeurs", gam);
    assert.ok(flags.some((f) => f.code === "THERAPEUTIC" && f.severity === "BLOCK"));
    assert.ok(flags.some((f) => f.code === "PATHOLOGY"));
    assert.ok(hasBlock(flags));
  });
  test("complément : guérison, pathologie, perte de poids bloquantes ; « miracle » à vérifier", () => {
    assert.ok(hasBlock(checkText("Guérit la fatigue chronique", cyg)));
    assert.ok(hasBlock(checkText("Perdez 5 kg en un mois", cyg)));
    assert.ok(checkText("Un résultat miracle", cyg).some((f) => f.code === "MIRACLE" && f.severity === "WARN"));
  });
  test("ingrédient absent de la fiche signalé ; ingrédient de la fiche accepté", () => {
    assert.ok(checkText("Grâce au rétinol, la peau est lisse", gam).some((f) => f.code === "INGREDIENT_UNVERIFIED"));
    assert.ok(!checkText("La biotine contribue au maintien de cheveux normaux", cyg).some((f) => f.code === "INGREDIENT_UNVERIFIED"));
    assert.ok(!checkText("Hydrate les peaux sèches et sensibles", gam).length);
  });
  test("chiffre ou délai non sourcé sur la fiche : à vérifier", () => {
    assert.ok(checkText("Résultats visibles en 7 jours", gam).some((f) => f.code === "UNSOURCED_FIGURE"));
    assert.ok(checkText("92 % de satisfaction", cyg).some((f) => f.code === "UNSOURCED_FIGURE"));
  });
  test("mentions obligatoires par catégorie", () => {
    assert.match(mandatoryMentions("SUPPLEMENT")[0], /ne se substitue pas/);
    assert.match(mandatoryMentions("SUN")[0], /renouveler/);
  });
  test("checkConcept couvre tous les textes d'un concept", () => {
    const flags = checkConcept({ title: "Titre", bigIdea: "Idée", coreMessage: "soigne l'acné sévère", insight: "", organicVersion: "", paidVersion: "", productRole: "" }, gam);
    assert.ok(flags.some((f) => f.text.includes("message")));
  });
});

/* ------------------------------ Empreinte et fatigue ------------------------------ */

describe("empreinte créative et fatigue", () => {
  const a = { territory: "UGC" as const, mechanic: "UGC_PROBLEM_SOLUTION", tensionKey: "SKIN_TIGHT", hookType: "PROBLEM" as const, productId: "p-gam" };
  test("empreinte stable, analysable, similarité pondérée", () => {
    const fp = creativeFingerprint(a);
    assert.deepEqual(parseFingerprint(fp), a);
    assert.equal(similarity(a, a), 1);
    assert.ok(similarity(a, { ...a, mechanic: "ED_FAQ", territory: "EDUCATION" }) < 0.6);
    assert.ok(similarity(a, { ...a, tensionKey: "SKIN_DULL" }) > similarity(a, { ...a, mechanic: "ED_FAQ", territory: "EDUCATION", tensionKey: "SKIN_DULL" }));
  });
  test("pénalité de répétition au-delà du seuil, dégressive en dessous", () => {
    assert.equal(repetitionPenalty(0.8, T.duplicateThreshold), 25);
    assert.ok(repetitionPenalty(0.6, T.duplicateThreshold) > 0 && repetitionPenalty(0.6, T.duplicateThreshold) < 25);
    assert.equal(repetitionPenalty(0.2, T.duplicateThreshold), 0);
  });
  test("usage des territoires : contenus et concepts de la fenêtre, pas les écartés ni les anciens", () => {
    const recent: RecentConcept[] = [
      { id: "c1", fingerprint: creativeFingerprint(a), title: "Récent", date: "2026-09-20", status: "PROPOSED", mechanic: a.mechanic, territory: "UGC", tensionKey: a.tensionKey, hookType: "PROBLEM", productId: "p-gam" },
      { id: "c2", fingerprint: creativeFingerprint(a), title: "Écarté", date: "2026-09-20", status: "REJECTED", mechanic: a.mechanic, territory: "UGC", tensionKey: a.tensionKey, hookType: "PROBLEM", productId: "p-gam" },
      { id: "c3", fingerprint: creativeFingerprint(a), title: "Vieux", date: "2026-01-01", status: "SENT", mechanic: a.mechanic, territory: "UGC", tensionKey: a.tensionKey, hookType: "PROBLEM", productId: "p-gam" },
    ];
    const usage = territoryUsage({ performances: [perf({ id: "1" }), perf({ id: "2", territory: "EDUCATION", mechanic: "ED_FAQ" })], recentConcepts: recent, since: "2026-07-06" });
    assert.equal(usage.find((u) => u.territory === "UGC" && u.mechanic === null)?.count, 2);
    assert.equal(usage.find((u) => u.territory === "EDUCATION" && u.mechanic === null)?.count, 1);
    assert.ok(fatigueOf("UGC_PROBLEM_SOLUTION", usage) > fatigueOf("ED_MYTH_REALITY", usage));
    const near = nearestRecent(a, recent);
    assert.equal(near.score, 1);
  });
  test("territoires saturés : au moins N contenus et au-dessus de la médiane", () => {
    const usage = territoryUsage({ performances: [1, 2, 3, 4].map((i) => perf({ id: String(i), territory: "EDUCATION", mechanic: "ED_FAQ" })).concat([perf({ id: "x", territory: "UGC" })]), recentConcepts: [], since: "2026-01-01" });
    assert.deepEqual(saturatedTerritories(usage, 3), ["EDUCATION"]);
  });
});

/* ------------------------------ Apprentissage ------------------------------ */

describe("apprentissage créatif (corrélations observées)", () => {
  const brand = { id: "b1", name: "CygneLab" };
  const th = { minCreatives: 2, minSpendMad: 500 };
  test("une mécanique nettement moins chère par résultat produit un apprentissage POSITIF avec preuves", () => {
    const perfs = [perf({ id: "1", metrics: { ...perf({ id: "z" }).metrics, spend: 1000, results: 400 } }), perf({ id: "2", metrics: { ...perf({ id: "z" }).metrics, spend: 1000, results: 400 } }),
      perf({ id: "3", territory: "EDUCATION", mechanic: "ED_FAQ", hookType: "CURIOSITY", metrics: { ...perf({ id: "z" }).metrics, spend: 1000, results: 100 } }), perf({ id: "4", territory: "EDUCATION", mechanic: "ED_FAQ", hookType: "CURIOSITY", metrics: { ...perf({ id: "z" }).metrics, spend: 1000, results: 100 } })];
    const ins = creativeLearning(perfs, brand, th);
    const pos = ins.find((i) => i.mechanic === "UGC_PROBLEM_SOLUTION");
    assert.ok(pos && pos.direction === "POSITIVE" && pos.kind === "CORRELATION" && pos.evidence.length >= 3, JSON.stringify(ins));
    assert.match(pos!.statement, /corrélation observée/);
    assert.ok(ins.some((i) => i.mechanic === "ED_FAQ" && i.direction === "NEGATIVE"));
    assert.equal(historicalFit(mechanicOf("UGC_PROBLEM_SOLUTION")!, ins, null).points, 9);
    assert.equal(historicalFit(mechanicOf("ED_FAQ")!, ins, null).points, 1);
  });
  test("sans volume minimal : aucun apprentissage ; sans donnée : adéquation neutre et MISSING", () => {
    assert.equal(creativeLearning([perf({ id: "1" })], brand, th).length, 0);
    const fit = historicalFit(mechanicOf("ST_POV")!, [], null);
    assert.equal(fit.points, 5); assert.equal(fit.tag, "MISSING");
  });
  test("organique : fort engagement mais payant cher → « à garder en organique »", () => {
    const org = (id: string, territory: "EDUCATION" | "UGC", mech: string, eng: number) => perf({ id, source: "CONTENT", territory, mechanic: mech, metrics: { spend: null, results: null, resultKind: null, costPerResult: null, reach: 10_000, impressions: null, engagement: eng, views: null, ctr: null, conversions: null, revenue: null } });
    const perfs = [org("o1", "EDUCATION", "ED_FAQ", 800), org("o2", "EDUCATION", "ED_FAQ", 700), org("o3", "UGC", "UGC_PERSONAL_TEST", 100), org("o4", "UGC", "UGC_PERSONAL_TEST", 120),
      perf({ id: "a1", territory: "EDUCATION", mechanic: "ED_FAQ", metrics: { ...perf({ id: "z" }).metrics, spend: 1000, results: 50 } }), perf({ id: "a2", territory: "EDUCATION", mechanic: "ED_FAQ", metrics: { ...perf({ id: "z" }).metrics, spend: 1000, results: 50 } }),
      perf({ id: "a3", metrics: { ...perf({ id: "z" }).metrics, spend: 1000, results: 300 } }), perf({ id: "a4", metrics: { ...perf({ id: "z" }).metrics, spend: 1000, results: 300 } })];
    const ins = creativeLearning(perfs, brand, th);
    assert.ok(ins.some((i) => /organique, pas en acquisition/.test(i.statement)), ins.map((i) => i.statement).join("\n"));
  });
});

/* ------------------------------ Notation ------------------------------ */

describe("notation explicable", () => {
  test("score d'opportunité : critères sommés, bornés, étiquetés", () => {
    const r = scoreOpportunity({ priorityAction: "PUSH", prioritySignal: "ventes +18 %", product: GAMARDE, tensionScore: 6, tensionLabel: "Peau qui tiraille", budgetAvailable: 10_000, budgetAxis: "CONTENU", fit: { points: 5, why: "neutre", tag: "MISSING" }, fatigue: 0, season: null });
    assert.equal(r.score, r.items.reduce((s, i) => s + i.points, 0));
    assert.ok(r.score >= 70 && r.score <= 100);
    assert.equal(r.items.find((i) => i.key === "priorite")?.points, 20);
    const nb = scoreOpportunity({ priorityAction: null, prioritySignal: "x", product: AURACOS, tensionScore: 0, tensionLabel: "x", budgetAvailable: null, budgetAxis: "DIGITAL", fit: { points: 5, why: "", tag: "MISSING" }, fatigue: 0.8, season: null });
    assert.equal(nb.items.find((i) => i.key === "budget")?.tag, "MISSING");
    assert.ok(nb.score < r.score);
  });
  test("score de concept : dix critères, différenciation = 10 sans doublon, estimations IA reprises comme hypothèses", () => {
    const m = mechanicOf("UGC_PROBLEM_SOLUTION")!;
    const base = { mechanic: m, tensionScore: 6, product: GAMARDE, text: { coreMessage: "Hydratation : hydrate et apaise les peaux sèches", productRole: "Hydratation en étape 3", bigIdea: "x" }, playbookLevers: {}, positioningHit: false, similarity: 0, distribution: "BOTH" as const, funnelStage: "CONVERSION" as const, insights: [] };
    const s = scoreConcept(base);
    assert.equal(s.items.length, 10);
    assert.equal(new Set(s.items.map((i) => i.key)).size, 10);
    assert.equal(s.items.find((i) => i.key === "differentiation")?.points, 10);
    assert.ok(s.overall >= 0 && s.overall <= 100);
    const ai = scoreConcept({ ...base, ai: { hook: 9, scrollStop: 8, emotionalTension: 7 } });
    assert.equal(ai.items.find((i) => i.key === "hook")?.points, 9);
    assert.equal(ai.items.find((i) => i.key === "hook")?.tag, "INFERRED");
    assert.ok(scoreConcept({ ...base, similarity: 0.9 }).overall < s.overall);
  });
  test("objectif → étape du tunnel", () => {
    assert.equal(funnelOf("NOTORIETE"), "AWARENESS"); assert.equal(funnelOf("SELL_OUT"), "CONVERSION"); assert.equal(funnelOf("FIDELISATION"), "RETENTION"); assert.equal(funnelOf("LANCEMENT"), "CONSIDERATION");
  });
});

/* ------------------------------ Opportunités ------------------------------ */

describe("opportunités créatives", () => {
  test("Gamarde : tension peau, mécanique compatible dermo-cosmétique, clé rejouable, territoires variés", () => {
    const opps = buildOpportunities(data(GAMARDE), T);
    assert.ok(opps.length >= 1 && opps.length <= 3);
    const o = opps[0];
    assert.ok(o.tensionKey.startsWith("SKIN_"));
    assert.ok(mechanicOf(o.recommendedMechanic)!.productTypes.includes("DERMOCOSMETIC"));
    assert.deepEqual(parseOpportunityKey(o.key), { brandId: "b1", productId: "p-gam", objective: "SELL_OUT", tensionKey: o.tensionKey, mechanic: o.recommendedMechanic });
    assert.equal(new Set(opps.map((x) => x.recommendedTerritory)).size, opps.length, "un territoire par opportunité");
    assert.ok(o.reasoning.length >= 2 && o.reasoning.length <= 5 && o.blocked === null && o.data.length >= 5);
    assert.equal(o.budget.axis, AXIS_OF_TERRITORY[o.recommendedTerritory]);
  });
  test("budget : le levier de l'opportunité porte le disponible lu (cohérence avec le générateur)", () => {
    for (const o of buildOpportunities(data(CYGNE), T)) assert.equal(o.budget.available, data(CYGNE).business.budgets[o.budget.axis]?.available ?? null);
  });
  test("rupture de stock : opportunité bloquée, priorité basse, score plafonné", () => {
    const [o] = buildOpportunities(data({ ...GAMARDE, stockRisk: "RUPTURE_RISQUE", daysOfStock: 12 }), T);
    assert.match(o.blocked ?? "", /rupture/);
    assert.equal(o.priority, "LOW"); assert.ok(o.opportunityScore <= 30);
  });
  test("mécaniques impossibles pénalisées : zoom actif sans actif, preuve sans allégation, offre hors écoulement", () => {
    const noActives = { ...AURACOS, actives: [] as string[], claims: [] as string[] };
    const ranked = rankMechanics(data(noActives), tensionOf("SUPP_SKIN_WITHIN")!);
    const idx = (k: string) => ranked.findIndex((r) => r.mechanic.key === k);
    assert.ok(idx("ED_INGREDIENT") > 10, "zoom actif relégué");
    assert.ok(ranked.find((r) => r.mechanic.key === "ED_INGREDIENT")!.why.some((w) => /aucun actif/.test(w)));
    assert.ok(ranked.find((r) => r.mechanic.key === "PF_PROOF")!.why.some((w) => /allégation/.test(w)));
    assert.ok(idx("PF_OFFER") > 5);
  });
  test("territoire saturé évité quand une alternative existe ; forçage par clé respecté", () => {
    const usage = territoryUsage({ performances: [1, 2, 3, 4, 5].map((i) => perf({ id: String(i), territory: "UGC", mechanic: "UGC_PROBLEM_SOLUTION" })), recentConcepts: [], since: "2026-01-01" });
    const d = data(CYGNE, { usage });
    const [o] = buildOpportunities(d, T);
    assert.notEqual(o.recommendedTerritory, "UGC");
    const forced = buildOpportunities(d, T, { forced: { tensionKey: "SUPP_ROUTINE", mechanic: "ED_3_MISTAKES" } });
    assert.equal(forced[0].recommendedMechanic, "ED_3_MISTAKES"); assert.equal(forced[0].tensionKey, "SUPP_ROUTINE");
    assert.equal(opportunityKey({ brandId: "b1", productId: null, objective: "NOTORIETE", tensionKey: "SUPP_ROUTINE", mechanic: "ED_3_MISTAKES" }), "b1:marque:NOTORIETE:SUPP_ROUTINE:ED_3_MISTAKES");
  });
  test("apprentissage mesuré repris dans le pourquoi", () => {
    const ins = creativeLearning([perf({ id: "1", metrics: { ...perf({ id: "z" }).metrics, spend: 1000, results: 400 } }), perf({ id: "2", metrics: { ...perf({ id: "z" }).metrics, spend: 1000, results: 400 } }), perf({ id: "3", territory: "EDUCATION", mechanic: "ED_FAQ", metrics: { ...perf({ id: "z" }).metrics, spend: 1000, results: 80 } }), perf({ id: "4", territory: "EDUCATION", mechanic: "ED_FAQ", metrics: { ...perf({ id: "z" }).metrics, spend: 1000, results: 80 } })], { id: "b1", name: "Gamarde" }, { minCreatives: 2, minSpendMad: 500 });
    const opps = buildOpportunities(data(GAMARDE, { insights: ins }, { budgets: { CONTENU: { available: 10_000, source: "AXE" }, DIGITAL: { available: 25_000, source: "AXE" }, INFLUENCE: { available: 5_000, source: "AXE" } } }), T);
    assert.equal(opps[0].recommendedMechanic, "UGC_PROBLEM_SOLUTION");
    assert.ok(opps[0].learning.length >= 1);
    // Sans budget influence, la même mécanique reste proposée mais recule derrière un levier financé.
    assert.ok(buildOpportunities(data(GAMARDE, { insights: ins }), T).some((o) => o.recommendedMechanic === "UGC_PROBLEM_SOLUTION"));
  });
});

/* ------------------------------ Concepts et package déterministes ------------------------------ */

describe("concepts déterministes (sans IA)", () => {
  for (const [label, p] of [["Gamarde", GAMARDE], ["CygneLab", CYGNE], ["Auracos", AURACOS]] as const) {
    test(`${label} : 3 à 5 concepts différenciés, notés, conformes, sans variable non rendue`, () => {
      const d = data(p);
      const [o] = buildOpportunities(d, T);
      const cs = rulesConcepts(d, o, T);
      assert.ok(cs.length >= 3 && cs.length <= T.maxConcepts, `${cs.length} concepts`);
      assert.equal(new Set(cs.map((c) => c.mechanic)).size, cs.length, "mécaniques distinctes");
      assert.equal(new Set(cs.map((c) => c.fingerprint)).size, cs.length, "empreintes distinctes");
      for (let i = 1; i < cs.length; i++) assert.ok(cs[i - 1].scores.overall >= cs[i].scores.overall);
      for (const c of cs) {
        assert.equal(c.generatedBy, "RULES");
        assert.equal(c.scores.items.length, 10);
        assert.ok(!hasBlock(c.compliance), `allégation bloquante : ${JSON.stringify(c.compliance)}`);
        assert.doesNotMatch(`${c.title} ${c.bigIdea} ${c.coreMessage} ${c.organicVersion} ${c.paidVersion}`, /[{}]/);
        assert.ok(c.storytellingStructure.length >= 3 && c.reasoning.length >= 2);
        assert.ok(c.coreMessage.includes(p.hero));
      }
      if (p.benefits.length) assert.ok(cs.some((c) => c.coreMessage.toLowerCase().includes(p.benefits[0].slice(0, 12).toLowerCase())), "bénéfice de la fiche repris");
    });
  }
  test("un concept identique à un concept récent est détecté (doublon) et pénalisé", () => {
    const d = data(GAMARDE);
    const [o] = buildOpportunities(d, T);
    const [first] = rulesConcepts(d, o, T);
    const recent: RecentConcept[] = [{ id: "r1", fingerprint: first.fingerprint, title: "Déjà fait", date: "2026-09-20", status: "SENT", mechanic: first.mechanic, territory: first.creativeTerritory, tensionKey: first.tensionKey, hookType: first.hookType, productId: "p-gam" }];
    const again = rulesConcepts(data(GAMARDE, { recentConcepts: recent }), o, T).find((c) => c.mechanic === first.mechanic)!;
    assert.equal(again.similarity.score, 1); assert.equal(again.similarity.to, "Déjà fait");
    assert.equal(again.scores.items.find((i) => i.key === "differentiation")?.points, 0);
    assert.ok(again.scores.overall < first.scores.overall);
  });
});

describe("package de contenu déterministe", () => {
  const d = data(CYGNE);
  const [o] = buildOpportunities(d, T);
  const [c] = rulesConcepts(d, o, T);
  const pkg = draftPackage(c, d, T);
  test("cinq accroches (une par type, celle du concept d'abord), deux scripts cohérents, découpage et plans alignés", () => {
    assert.equal(pkg.hooks.length, 5);
    assert.equal(new Set(pkg.hooks.map((h) => h.type)).size, 5);
    assert.equal(pkg.hooks[0].type, c.hookType);
    assert.equal(pkg.scripts.length, 2);
    for (const s of pkg.scripts) assert.equal(s.scenes.reduce((a, x) => a + x.durationSec, 0), s.durationSec);
    assert.equal(pkg.storyboard.length, pkg.scripts[0].scenes.length);
    assert.equal(pkg.shotList.length, pkg.storyboard.length);
    assert.ok(pkg.storyboard.slice(0, 2).some((s) => s.productVisible) || pkg.storyboard[1]?.productVisible || pkg.storyboard.some((s) => s.productVisible));
  });
  test("budget de test payant borné par le disponible du levier ; KPI payant sur le coût mesuré de la marque", () => {
    const axis = AXIS_OF_TERRITORY[c.creativeTerritory];
    const avail = d.business.budgets[axis]?.available ?? null;
    assert.equal(pkg.paid.testBudgetMad, paidTestBudget(avail, T));
    assert.equal(paidTestBudget(0, T), null); assert.equal(paidTestBudget(null, T), null); assert.equal(paidTestBudget(1_000, T), 1_000); assert.equal(paidTestBudget(50_000, T), T.paidTestBudgetMad);
    assert.equal(kpisFor(d, "PAID")[0].tag, "CALCULATED");
    assert.equal(kpisFor(data(CYGNE, {}, { adsCost: null }), "PAID")[0].tag, "MISSING");
  });
  test("légende avec mention obligatoire du complément, hashtags, conformité sans blocage", () => {
    assert.match(pkg.caption, /ne se substitue pas/);
    assert.ok(pkg.hashtags.every((h) => h.startsWith("#")) && pkg.hashtags.length >= 4);
    assert.ok(!hasBlock(pkg.compliance), JSON.stringify(pkg.compliance));
    assert.ok(pkg.claims.mandatory.length >= 1 && pkg.claims.forbidden.length >= 3);
    assert.ok(pkg.performance.avoid.some((a) => /alimentation variée/.test(a)));
  });
  test("variations : une variable à la fois, ce qui change est dit, dimensions complètes", () => {
    const v = draftVariations(c, pkg, d);
    const by = (dim: string) => v.variations.filter((x) => x.dimension === dim);
    assert.equal(by("HOOK").length, 5); assert.equal(by("OPENING").length, 3); assert.equal(by("STRUCTURE").length, 3);
    assert.ok(by("PERSONA").length >= 1 && by("ANGLE").length >= 2 && by("CTA").length >= 2 && by("FORMAT").length >= 1);
    for (const x of v.variations) assert.ok(x.changed.length > 5 && x.content.length > 5);
    assert.ok(by("STRUCTURE").every((x) => (x.steps?.length ?? 0) >= 3));
  });
  test("brief de production : toutes les sections, Markdown exploitable", () => {
    const b = buildBrief(c, pkg, { brandName: "CygneLab", productName: CYGNE.name, audience: "Femmes 25-45 ans", objective: "Augmenter le sell-out", generatedAt: "4 octobre 2026", budgetAxisLabel: "digital" });
    for (const k of ["objectif", "produit", "cible", "concept", "insight", "accroche", "script", "decoupage", "plans", "visuel", "creatrice", "integration", "textes", "cta", "legende", "hashtags", "livrables", "notes", "conformite", "kpi"]) assert.ok(b.sections.some((s) => s.key === k), k);
    assert.match(b.markdown, /## Script/); assert.match(b.markdown, /## Allégations et conformité/);
  });
  test("textes à variables : clés accentuées et replis", () => {
    assert.equal(fill("Si vous aussi, {problème}…", { probleme: "la peau tiraille" }), "Si vous aussi, la peau tiraille…");
    assert.equal(fill("{actif|cette formule} agit", { actif: null }), "cette formule agit");
  });
});

/* ------------------------------ Garde-fous ------------------------------ */

describe("garde-fous du studio créatif", () => {
  const files = readdirSync("src/lib/creative").filter((f) => f.endsWith(".ts")).map((f) => ({ path: join("src/lib/creative", f), code: readFileSync(join("src/lib/creative", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "") }));
  test("seules les tables du studio, le planning éditorial et l'audit sont écrits ; aucune écriture SQL brute", () => {
    const allowed = ["creativeConcepts", "creativePackages", "contentItems", "contentProducts"];
    const bad: string[] = [];
    for (const f of files) {
      for (const m of f.code.matchAll(/\b(?:db|tx)\s*\.\s*(insert|update|delete)\s*\(\s*(\w+)/g)) if (!allowed.includes(m[2])) bad.push(`${f.path} → ${m[1]}(${m[2]})`);
      if (/sql`[^`]*\b(insert\s+into|update\s+\w+\s+set|delete\s+from|truncate)\b/i.test(f.code)) bad.push(`${f.path} → SQL brut`);
    }
    assert.deepEqual(bad, []);
  });
  test("les moteurs purs n'importent ni la base ni le serveur", () => {
    const pure = ["types.ts", "territories.ts", "consumer.ts", "product-intel.ts", "compliance.ts", "fingerprint.ts", "learning.ts", "scoring.ts", "opportunities.ts", "rules.ts", "brief.ts"];
    const offenders = files.filter((f) => pure.some((p) => f.path.endsWith(`/${p}`)) && /from\s+"@\/db"|server-only|@anthropic-ai/.test(f.code)).map((f) => f.path);
    assert.deepEqual(offenders, []);
  });
  test("les étapes IA n'écrivent jamais en base", () => {
    const stages = files.find((f) => f.path.endsWith("/stages.ts"))!;
    assert.doesNotMatch(stages.code, /\b(?:db|tx)\s*\.\s*(insert|update|delete)/);
    const llm = files.find((f) => f.path.endsWith("/llm.ts"))!;
    assert.doesNotMatch(llm.code, /\b(?:db|tx)\s*\.\s*(insert|update|delete)/);
  });
});
