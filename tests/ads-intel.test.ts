/**
 * Couche d'intelligence publicitaire : moteurs purs (résultat par objectif, tendance, fatigue,
 * winners, recommandations, contenu, étiquettes, rattachement produit). Aucune base requise.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { kpis, resultKindOf, type AdRow } from "@/lib/ads";
import { DEFAULT_ADS_INTEL, DEFAULT_AD_THRESHOLDS } from "@/lib/settings";
import { trendOf, stabilityOf, zScores, confidenceOf } from "@/lib/ads-intel/metrics";
import { fatigueOf } from "@/lib/ads-intel/fatigue";
import { classify } from "@/lib/ads-intel/winners";
import { recommend, topActions, causeOf } from "@/lib/ads-intel/recommend";
import { benchmarkFor } from "@/lib/ads-intel/benchmark";
import { patternsOf, opportunitiesOf } from "@/lib/ads-intel/content";
import { autoTags, matchProductInText, productKeys } from "@/lib/meta/entities";
import { explainMetaError } from "@/lib/meta/doctor";
import { diagnose } from "@/lib/ads";
import type { DailyPoint, EntityPerf } from "@/lib/ads-intel/types";

const S = DEFAULT_ADS_INTEL; const T = DEFAULT_AD_THRESHOLDS;

function row(p: Partial<AdRow> = {}): AdRow {
  return {
    key: "k", platform: "META", campaignName: "AURACOS_TRAFFIC_PRO-COLLAGENIUM", campaignId: null,
    brandId: "b", brandName: "Auracos", brandColor: null,
    spend: 3_000, impressions: 300_000, reach: 150_000, clicks: 9_000, linkClicks: 9_000,
    landingPageViews: 6_000, leads: 0, purchases: 0, messagingStarted: 5,
    revenue: 0, days: 14, objective: "OUTCOME_TRAFFIC", videoViews: 0, postEngagement: 0, ...p,
  };
}
function entity(p: Partial<AdRow> = {}, extra: Partial<EntityPerf> = {}): EntityPerf {
  return {
    ...kpis(row(p)), level: "campaign", externalId: "c1", externalCampaignId: "c1", externalAdsetId: null, externalCreativeId: null,
    accountName: "COMANET", status: "ACTIVE", effectiveStatus: "ACTIVE", productId: "p1", productName: "Procollagenium MV",
    thumbnailUrl: null, imageUrl: null, title: null, body: null, tags: {}, firstDay: "2026-08-20", lastDay: "2026-09-09", adCount: 3, hasPartial: false, ...extra,
  };
}
function day(date: string, p: Partial<DailyPoint> = {}): DailyPoint {
  return { date, spend: 200, impressions: 20_000, reach: 10_000, clicks: 600, linkClicks: 600, landingPageViews: 400, leads: 0, purchases: 0, messagingStarted: 0, revenue: 0, videoViews: 0, postEngagement: 0, ...p };
}
const days = (n: number, f: (i: number) => Partial<DailyPoint> = () => ({})) => Array.from({ length: n }, (_, i) => day(`2026-08-${String(i + 1).padStart(2, "0")}`, f(i)));

describe("Résultat officiel par objectif", () => {
  test("trafic → vues de page, messages → conversations, ventes → achats", () => {
    assert.equal(resultKindOf("OUTCOME_TRAFFIC", row()), "landing");
    assert.equal(resultKindOf("OUTCOME_ENGAGEMENT", row({ messagingStarted: 40 })), "message");
    assert.equal(resultKindOf("OUTCOME_SALES", row()), "purchase");
    assert.equal(resultKindOf("OUTCOME_AWARENESS", row()), "reach");
  });
  test("le coût par résultat suit l'objectif ; la couverture se paie aux mille", () => {
    const k = kpis(row());
    assert.equal(k.resultKind, "landing");
    assert.equal(k.results, 6_000);
    assert.equal(k.costPerResult, 0.5);
    const a = kpis(row({ objective: "OUTCOME_AWARENESS" }));
    assert.equal(a.costPerResult, (3_000 / 150_000) * 1000);
  });
  test("diagnose() juge une campagne trafic sur ses vues de page, pas sur des achats absents", () => {
    const d = diagnose(kpis(row()), null, null, T);
    assert.notEqual(d.verdict, "STOP");
    assert.ok(d.signals.some((s) => s.label.includes("vue de page")));
  });
  test("SCALE sans ROAS quand le coût par résultat chute nettement", () => {
    const cur = kpis(row({ landingPageViews: 12_000 }));
    const prev = kpis(row({ landingPageViews: 6_000 }));
    assert.equal(diagnose(cur, prev, null, T).verdict, "SCALE");
  });
});

describe("Tendance, stabilité, anomalies", () => {
  test("coût en baisse → tendance down", () => {
    const pts = days(14, (i) => ({ landingPageViews: 300 + i * 40 }));
    assert.equal(trendOf(pts, "costPerResult", "landing").direction, "down");
  });
  test("série trop courte → inconnue", () => {
    assert.equal(trendOf(days(4), "costPerResult", "landing").direction, "unknown");
  });
  test("série constante → stabilité 1", () => {
    assert.equal(stabilityOf(days(10), "landing"), 1);
  });
  test("z-score détecte un pic de dépense", () => {
    const pts = [...days(20), day("2026-08-21", { spend: 2_000 })];
    const z = zScores(pts, "spend", "landing");
    assert.ok(z.some((x) => x.date === "2026-08-21" && x.z > 3));
  });
  test("confiance : 30 MAD ne donnent jamais une confiance élevée", () => {
    const c = confidenceOf({ spend: 30, days: 2, stability: null, benchmarks: 0, maxBenchmarks: 5, closedOnly: true, objectiveKnown: true, productKnown: true, refSpend: S.winnerMinSpend });
    assert.ok(c.score < 30, String(c.score));
  });
});

describe("Fatigue", () => {
  test("fréquence haute + CTR en chute → FATIGUING", () => {
    const pts = days(14, (i) => (i >= 7 ? { reach: 4_000, impressions: 20_000, clicks: 300, linkClicks: 300, landingPageViews: 150 } : {}));
    const f = fatigueOf(pts, "landing", S);
    assert.equal(f.status, "FATIGUING");
    assert.ok(f.frequency! >= S.fatigueFrequency);
  });
  test("stable → OK ; moins de 10 jours → INSUFFICIENT", () => {
    assert.equal(fatigueOf(days(14), "landing", S).status, "OK");
    assert.equal(fatigueOf(days(6), "landing", S).status, "INSUFFICIENT");
  });
});

describe("Winners", () => {
  const trend = { direction: "flat" as const, pct: 0, points: 14 };
  test("un élément à 30 MAD n'est jamais un winner", () => {
    assert.equal(classify(entity({ spend: 30 }), 1, trend, null, 1, S, T, "2026-09-10").cls, "INSUFFICIENT_DATA");
  });
  test("coût 40 % sous la référence, volume et stabilité → WINNER", () => {
    const v = classify(entity(), 0.5 / 0.6, trend, null, 0.9, S, T, "2026-09-10");
    assert.equal(v.cls, "WINNER");
    assert.ok(v.score > 60);
  });
  test("coût 1,6× la référence → UNDERPERFORMING", () => {
    assert.equal(classify(entity(), 0.5 / 1.6, trend, null, 0.9, S, T, "2026-09-10").cls, "UNDERPERFORMING");
  });
  test("bon coût mais fatigue → FATIGUING", () => {
    const fat = { status: "FATIGUING" as const, frequency: 4.1, ctrDeltaPct: -23, cpcDeltaPct: 20, cpmDeltaPct: 5, costDeltaPct: 31, reasons: [] };
    assert.equal(classify(entity(), 0.5, trend, fat, 0.9, S, T, "2026-09-10").cls, "FATIGUING");
  });
});

describe("Recommandations", () => {
  const base = (over: Partial<Parameters<typeof recommend>[0]> = {}) => recommend({
    entity: entity(), previous: null, brandAvg: null, benchmark: null, fatigue: null, trend: { direction: "flat", pct: 0, points: 14 }, stability: 0.8,
    winner: { cls: "STABLE", score: 50, reasons: [] }, stockTight: null, isActive: true, ...over,
  }, S, T);
  test("stable → NE RIEN FAIRE, avec une confiance", () => {
    const r = base();
    assert.equal(r.decision, "DO_NOTHING");
    assert.ok(r.confidence > 0 && r.confidence <= 100);
    assert.ok(r.why.length > 0 && r.action.length > 0);
  });
  test("CTR effondré → cause créative → NOUVELLE CRÉATIVE", () => {
    const prev = entity({ clicks: 12_000, linkClicks: 12_000, landingPageViews: 12_000 });
    const r = base({ entity: entity({ clicks: 3_000, linkClicks: 3_000, landingPageViews: 3_000 }), previous: prev });
    assert.equal(r.decision, "CREATE_NEW_CREATIVE");
    assert.equal(r.cause, "CREATIVE");
  });
  test("clics intacts mais résultats en chute → offre / page, pas la créative", () => {
    const prev = entity({ landingPageViews: 8_000 });
    const r = base({ entity: entity({ landingPageViews: 3_000 }), previous: prev });
    assert.equal(r.cause, "OFFER_OR_PAGE");
    assert.equal(r.decision, "CHANGE_ANGLE");
  });
  test("SCALE bloqué par un stock en tension → MAINTENIR", () => {
    const prev = entity({ landingPageViews: 3_000 });
    const r = base({ entity: entity({ landingPageViews: 9_000 }), previous: prev, stockTight: "Procollagenium MV", winner: { cls: "WINNER", score: 80, reasons: [] } });
    assert.equal(r.decision, "MAINTAIN");
    assert.match(r.action, /stock/i);
  });
  test("aucun résultat → REVOIR / PAUSE, cause suivi", () => {
    const r = base({ entity: entity({ landingPageViews: 0, messagingStarted: 0, clicks: 0, linkClicks: 0 }) });
    assert.equal(r.decision, "PAUSE_REVIEW");
    assert.equal(r.cause, "TRACKING");
  });
  test("cause : WATCH → volume", () => {
    const d = diagnose(kpis(row({ spend: 10 })), null, null, T);
    assert.equal(causeOf(d, entity({ spend: 10 }), null, null, T), "VOLUME");
  });
  test("topActions ne remplit pas avec des DO_NOTHING quand il y a des décisions", () => {
    const recs = [base(), base({ entity: entity({ landingPageViews: 0, clicks: 0, linkClicks: 0 }, { key: "k2", externalId: "c2" }) })];
    const top = topActions(recs, 5);
    assert.equal(top[0].decision, "PAUSE_REVIEW");
  });
});

describe("Benchmark", () => {
  test("références absentes → null et « pas encore comparable »", () => {
    const b = benchmarkFor(entity(), { previous: null, brandRows: [], objectiveRows: [], brandHistory: [], productHistory: [], minSpend: 300 });
    assert.equal(b.previous.costPerResult, null);
    assert.equal(b.previous.note, "pas encore comparable");
    assert.equal(b.vsBrandPct, null);
  });
  test("meilleur mois historique et phrase de situation", () => {
    const hist = [
      { month: "2025-10", spend: 1_000, impressions: 1, reach: 1, clicks: 1, linkClicks: 1, landingPageViews: 1_000, leads: 0, purchases: 0, messagingStarted: 0, revenue: 0, videoViews: 0, postEngagement: 0, days: 30 },
      { month: "2025-11", spend: 1_000, impressions: 1, reach: 1, clicks: 1, linkClicks: 1, landingPageViews: 4_000, leads: 0, purchases: 0, messagingStarted: 0, revenue: 0, videoViews: 0, postEngagement: 0, days: 30 },
    ];
    const b = benchmarkFor(entity(), { previous: null, brandRows: [], objectiveRows: [], brandHistory: hist, productHistory: [], minSpend: 300 });
    assert.equal(b.best.costPerResult, 0.25);
    assert.equal(b.best.note, "2025-11");
    assert.equal(b.vsBestPct, 100);
    assert.match(b.verdict, /historique/);
    const strong = benchmarkFor(entity({ landingPageViews: 9_000 }), { previous: null, brandRows: [], objectiveRows: [], brandHistory: hist, productHistory: [], minSpend: 300 });
    assert.match(strong.verdict, /pas encore au meilleur historique/);
  });
});

describe("Étiquettes et rattachement produit", () => {
  const cr = (body: string, objectType: string | null = null) => ({ id: "x", name: null, title: null, body, thumbnailUrl: null, imageUrl: null, videoId: null, objectType, callToAction: null, linkUrl: null });
  test("avant/après, témoignage, problème → solution, promo", () => {
    assert.equal(autoTags("FEED_BEFORE/AFTER_AR_V1", cr("Résultats visibles")).angle, "Avant / après");
    assert.equal(autoTags("video", cr("Témoignage de Sara après 3 semaines")).angle, "Témoignage");
    assert.equal(autoTags("post", cr("Marre des imperfections ? Sebo-Control est la solution")).angle, "Problème → solution");
    assert.equal(autoTags("img", cr("-20 % cette semaine")).offer, "Offre promotionnelle");
  });
  test("format : vidéo depuis object_type, reel depuis le nom", () => {
    assert.equal(autoTags("x", cr("", "VIDEO")).format, "Reel / vidéo");
    assert.equal(autoTags("REEL_FAQ_V1", cr("")).format, "Reel / vidéo");
    assert.equal(autoTags("REEL_FAQ_V1", cr("Pourquoi le collagène ?")).angle, "FAQ / éducatif");
  });
  test("produit reconnu dans un nom de campagne soudé et dans un texte de créative", () => {
    const refs = [
      { id: "p1", name: "Procollagenium MV", brandId: "b1", keys: productKeys("Procollagenium MV", ["AURACOS"]) },
      { id: "p2", name: "BEAUTY BOOST", brandId: "b2", keys: productKeys("BEAUTY BOOST", ["CYGNELAB"]) },
      { id: "p3", name: "GAMARDE SEBO-CONTROL FLUIDE EQUILIBRANT Tube 40 g", brandId: "b3", keys: productKeys("GAMARDE SEBO-CONTROL FLUIDE EQUILIBRANT Tube 40 g", ["GAMARDE"]) },
    ];
    assert.equal(matchProductInText("AURACOS_TRAFFIC_PRO-COLLAGENIUM_8/24", "b1", refs), "p1");
    assert.equal(matchProductInText("CYGNE_MSG_BEAUTYBOOST_8/18", null, refs), "p2");
    assert.equal(matchProductInText("Marre des brillances ? Découvrez Sebo Control", "b3", refs), "p3");
    assert.equal(matchProductInText("video", null, refs), null);
  });
});

describe("Contenu", () => {
  test("des motifs mesurés produisent des idées notées, jamais sans preuve", () => {
    const creatives: EntityPerf[] = [
      entity({ landingPageViews: 9_000 }, { level: "creative", key: "cr1", tags: { angle: "Avant / après", format: "Reel / vidéo" } }),
      entity({ landingPageViews: 9_000 }, { level: "creative", key: "cr2", tags: { angle: "Avant / après", format: "Reel / vidéo" } }),
      entity({ landingPageViews: 2_000 }, { level: "creative", key: "cr3", tags: { angle: "Promo / offre", format: "Image / feed" } }),
    ];
    const patterns = patternsOf(creatives, S);
    const ab = patterns.find((p) => p.dimension === "angle" && p.value === "Avant / après" && p.brandId === "b");
    assert.ok(ab && ab.vsBrandPct !== null && ab.vsBrandPct < 0);
    const push = [{ productId: "p1", productName: "Procollagenium MV", brandId: "b", brandName: "Auracos", decision: "PUSH_MORE" as const, score: 80, why: [], spend: 1000, results: 100, resultKind: "landing" as const, costPerResult: 10, winners: 1, stockNote: null }];
    const ideas = opportunitiesOf(patterns, push, [], S, new Date("2026-09-10T12:00:00Z"));
    assert.ok(ideas.length >= 1);
    assert.match(ideas[0].title, /avant \/ après/i);
    assert.ok(ideas[0].score > 50 && ideas[0].why.length >= 2);
    assert.equal(opportunitiesOf([], push, [], S, new Date()).length, 0);
  });
});

describe("Doctor : lecture des erreurs Meta", () => {
  const r = (over: Partial<Parameters<typeof explainMetaError>[0]>) => ({ ok: false, httpStatus: 400, code: null, subcode: null, type: null, message: null, fbtraceId: null, sample: null, ms: 1, ...over });
  test("« API access blocked » n'est pas un jeton expiré : c'est l'application", () => {
    assert.match(explainMetaError(r({ message: "API access blocked.", code: 200 })), /application/i);
  });
  test("190 → jeton, 10/200 → permission, 37 mois → rétention", () => {
    assert.match(explainMetaError(r({ code: 190, subcode: 463 })), /expir/i);
    assert.match(explainMetaError(r({ code: 10 })), /permission/i);
    assert.match(explainMetaError(r({ code: 100, message: "Data older than 37 months" })), /37 mois/);
  });
});
