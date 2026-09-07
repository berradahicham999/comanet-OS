/**
 * Verdict publicitaire : `diagnose()` est le seul moteur, et tous ses seuils viennent
 * de `settings.ads`. Ces tests vérifient chaque verdict et chaque frontière de seuil.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { diagnose, kpis, type AdRow } from "@/lib/ads";
import { DEFAULT_AD_THRESHOLDS } from "@/lib/settings";

const T = DEFAULT_AD_THRESHOLDS;

function row(p: Partial<AdRow> = {}): AdRow {
  return {
    key: "k", platform: "META", campaignName: "Campagne", campaignId: null,
    brandId: "b", brandName: "AURACOS", brandColor: null,
    spend: 10_000, impressions: 200_000, reach: 100_000, clicks: 4_000, linkClicks: 4_000,
    landingPageViews: 3_000, leads: 0, purchases: 100, messagingStarted: 0,
    revenue: 30_000, days: 30, objective: null, ...p,
  };
}
const k = (p: Partial<AdRow> = {}) => kpis(row(p));

describe("WATCH — données insuffisantes", () => {
  test("sous le seuil de dépense", () => {
    assert.equal(diagnose(k({ spend: T.minSpend - 1 }), null, null, T).verdict, "WATCH");
  });
  test("sous le seuil de jours", () => {
    assert.equal(diagnose(k({ days: T.minDays - 1 }), null, null, T).verdict, "WATCH");
  });
  test("juste au-dessus des deux seuils : le moteur tranche", () => {
    assert.notEqual(diagnose(k({ spend: T.minSpend, days: T.minDays }), null, null, T).verdict, "WATCH");
  });
  test("les seuils viennent bien des réglages, pas du code", () => {
    const strict = { ...T, minSpend: 50_000 };
    assert.equal(diagnose(k(), null, null, strict).verdict, "WATCH");
  });
});

describe("STOP", () => {
  test("aucune conversion : on met en cause le suivi avant de conclure", () => {
    const d = diagnose(k({ purchases: 0, leads: 0, revenue: 0 }), null, null, T);
    assert.equal(d.verdict, "STOP");
    assert.match(d.actions.join(" "), /pixel/i);
  });
  test("CPA très au-dessus de la moyenne de la marque", () => {
    // CPA = 10 000 / 100 = 100 ; moyenne marque 50 ; facteur 1,8 → seuil 90
    const d = diagnose(k(), null, { cpa: 50, roas: 3, ctr: 2 }, T);
    assert.equal(d.verdict, "STOP");
  });
  test("juste sous le facteur : ce n'est plus un STOP", () => {
    const d = diagnose(k(), null, { cpa: 100 / T.cpaVsBrandFactor + 1, roas: 3, ctr: 2 }, T);
    assert.notEqual(d.verdict, "STOP");
  });
});

describe("OPTIMIZE et localisation du maillon dégradé", () => {
  const ref = k({ spend: 10_000, purchases: 200, revenue: 60_000 }); // CPA 50, ROAS 6

  test("CPA en forte hausse → OPTIMIZE", () => {
    const d = diagnose(k(), ref, null, T);
    assert.equal(d.verdict, "OPTIMIZE");
  });
  test("problème post-clic : taux de conversion en baisse, accroche intacte", () => {
    const cur = k({ purchases: 100, clicks: 8_000, linkClicks: 8_000, impressions: 200_000 });
    const prev = k({ purchases: 200, clicks: 8_000, linkClicks: 8_000, impressions: 200_000, revenue: 60_000 });
    const d = diagnose(cur, prev, null, T);
    assert.equal(d.verdict, "OPTIMIZE");
    assert.match(d.diagnostic, /post-clic/i);
  });
  test("accroche : CTR effondré", () => {
    const cur = k({ clicks: 1_000, linkClicks: 1_000, purchases: 60, revenue: 18_000 });
    const prev = k({ clicks: 4_000, linkClicks: 4_000, purchases: 200, revenue: 60_000 });
    const d = diagnose(cur, prev, null, T);
    assert.equal(d.verdict, "OPTIMIZE");
    assert.match(d.diagnostic, /accroche/i);
  });
  test("fatigue créative signalée au-delà de la fréquence maximale", () => {
    const cur = k({ reach: 20_000 }); // fréquence 10
    const d = diagnose(cur, ref, null, T);
    assert.match(d.actions.join(" "), /Fréquence/);
  });
});

describe("SCALE", () => {
  test("ROAS en nette hausse vs la période précédente", () => {
    const prev = k({ revenue: 10_000 }); // ROAS 1
    const d = diagnose(k({ revenue: 30_000 }), prev, null, T); // ROAS 3
    assert.equal(d.verdict, "SCALE");
  });
  test("ROAS bien au-dessus de la moyenne de la marque", () => {
    const d = diagnose(k({ revenue: 30_000 }), null, { cpa: 120, roas: 1.5, ctr: 2 }, T);
    assert.equal(d.verdict, "SCALE");
  });
  test("on ne scale jamais sous le ROAS plancher, même en forte hausse", () => {
    const prev = k({ revenue: 1_000 });
    const d = diagnose(k({ revenue: 5_000 }), prev, null, T); // ROAS 0,5 < roasMin
    assert.notEqual(d.verdict, "SCALE");
  });
  test("le palier de budget recommandé reprend les réglages", () => {
    const prev = k({ revenue: 10_000 });
    const d = diagnose(k({ revenue: 30_000 }), prev, null, { ...T, scaleStepPct: 35, scaleStepDays: 5 });
    assert.match(d.actions.join(" "), /35 % tous les 5 jours/);
  });
});

describe("MAINTAIN", () => {
  test("aucune dérive significative", () => {
    const d = diagnose(k(), k(), { cpa: 100, roas: 3, ctr: 2 }, T);
    assert.equal(d.verdict, "MAINTAIN");
  });
});

describe("robustesse", () => {
  test("aucune impression : CTR et CPM absents, le moteur ne plante pas", () => {
    const d = diagnose(k({ impressions: 0, clicks: 0, linkClicks: 0, reach: 0 }), null, null, T);
    assert.ok(d.verdict);
    assert.equal(d.signals.find((s) => s.label === "CTR")?.value, "—");
  });
  test("dépense nulle mais journées suffisantes : classé WATCH, jamais un verdict inventé", () => {
    assert.equal(diagnose(k({ spend: 0 }), null, null, T).verdict, "WATCH");
  });
  test("aucune référence ni moyenne de marque : verdict rendu sans écart inventé", () => {
    const d = diagnose(k(), null, null, T);
    assert.ok(["MAINTAIN", "SCALE", "OPTIMIZE", "STOP"].includes(d.verdict));
    assert.ok(d.signals.every((s) => s.delta === null));
  });
});
