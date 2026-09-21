/**
 * Influence Center — KPI d'une collaboration, agrégats d'exposition, score relatif unique
 * et lecture des montants saisis. Aucune base requise.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { collabKpis, exposureAggregates, relativeScore, influenceTotals, rankInfluencers, influenceAdvice, scoreCollaborations, type CollabRow } from "@/lib/influence";
import { parseAmount } from "@/lib/influence-shared";

const base: CollabRow = {
  id: "c1", date: "2026-09-10", influencer_id: "i1", influencer: "Sara", followers: 50_000, engagement_rate: null, category: null, city: "Casablanca",
  brand_id: "b1", brand: "Gamarde", brand_color: null, product: null, campaign_id: null, campaign: null, content_type: null,
  stories: 0, reels: 1, posts: 0, fee: 1000, product_value: 200, status: "PUBLIE",
  reach: 10_000, impressions: null, views: null, likes: 300, comments: 50, shares: 0, saves: 50, link_clicks: 40,
  promo_code: "SARA10", conversions: 5, attributed_revenue: 3000, product_id: null, notes: null,
};
const row = (patch: Partial<CollabRow>): CollabRow => ({ ...base, ...patch });

describe("collabKpis", () => {
  test("coût, CPM, engagement, ROAS mesuré", () => {
    const k = collabKpis(base);
    assert.equal(k.cost, 1200);
    assert.equal(k.cpm, 120);
    assert.equal(k.interactions, 400);
    assert.equal(k.engagement, 4);
    assert.equal(k.costPerClick, 30);
    assert.equal(k.measured, true);
    assert.equal(k.roas, 2.5);
    assert.deepEqual(k.missing, []);
  });
  test("sans code promo, le CA n'est jamais attribué ; sans reach, rien n'est estimé", () => {
    const k = collabKpis(row({ promo_code: null, reach: null, likes: null, comments: null, shares: null, saves: null }));
    assert.equal(k.measured, false);
    assert.equal(k.roas, null);
    assert.equal(k.cpm, null);
    assert.equal(k.engagement, null);
    assert.equal(k.interactions, null);
    assert.deepEqual(k.missing, ["reach", "engagement", "code promo"]);
  });
  test("un code promo avec 0 MAD de CA est mesuré (à zéro), pas « non mesurable »", () => {
    const k = collabKpis(row({ attributed_revenue: 0 }));
    assert.equal(k.measured, true);
    assert.equal(k.roas, 0);
  });
});

describe("exposureAggregates — le coût sans reach ne gonfle pas le CPM", () => {
  const rows = [
    collabKpis(base), // 1 200 MAD, reach 10 000, 400 interactions
    collabKpis(row({ id: "c2", reach: null, likes: 1000, comments: 0, shares: 0, saves: 0 })), // 1 200 MAD, sans reach
    collabKpis(row({ id: "c3", reach: 10_000, likes: null, comments: null, shares: null, saves: null, fee: 400, product_value: 0 })), // 400 MAD, reach sans interactions
  ];
  test("CPM = coût des collaborations avec reach / reach", () => {
    const a = exposureAggregates(rows);
    assert.equal(a.reach, 20_000);
    assert.equal(a.cpm, ((1200 + 400) / 20_000) * 1000);
  });
  test("engagement = interactions / reach, sur les seules collaborations qui ont les deux", () => {
    const a = exposureAggregates(rows);
    assert.equal(a.interactions, 1400);
    assert.equal(a.engagement, 4);
  });
  test("influenceTotals et rankInfluencers reprennent ces agrégats", () => {
    const t = influenceTotals(rows);
    assert.equal(t.cpm, 80);
    assert.equal(t.engagement, 4);
    assert.equal(t.measuredCollabs, 3);
    const [r] = rankInfluencers(rows, new Map());
    assert.equal(r.collabs, 3);
    assert.equal(r.cpm, 80);
    assert.equal(r.engagement, 4);
  });
});

describe("relativeScore — une seule définition", () => {
  test("le meilleur profil sur chaque axe fait 100, un axe absent est retiré", () => {
    const s = relativeScore([
      { cpm: 100, engagement: 4, roas: 2 },
      { cpm: 200, engagement: 2, roas: null },
      { cpm: null, engagement: null, roas: null },
    ]);
    assert.equal(s[0].score, 100);
    assert.equal(s[1].score, 50);
    assert.equal(s[2].score, null);
  });
  test("scoreCollaborations délègue au même moteur", () => {
    const [a, b] = scoreCollaborations([collabKpis(base), collabKpis(row({ id: "c2", fee: 3000 }))]);
    assert.equal(a.score, 100);
    assert.ok(b.score !== null && b.score < 100);
  });
});

describe("influenceAdvice — date métier explicite", () => {
  test("une collaboration confirmée n'est en retard que par rapport à la date de référence", () => {
    const rows = scoreCollaborations([collabKpis(row({ status: "CONFIRMEE", date: "2026-09-10" }))]);
    const ranked = rankInfluencers(rows, new Map());
    assert.ok(!influenceAdvice(rows, ranked, "2026-09-10").some((a) => a.title.includes("non publiée")));
    assert.ok(influenceAdvice(rows, ranked, "2026-09-11").some((a) => a.title.includes("non publiée")));
  });
});

describe("parseAmount — montants saisis à la main", () => {
  test("formats courants", () => {
    assert.equal(parseAmount("1 200,50"), 1200.5);
    assert.equal(parseAmount("1.200"), 1200);
    assert.equal(parseAmount("1,234,567"), 1234567);
    assert.equal(parseAmount("1200.5"), 1200.5);
    assert.equal(parseAmount("1,5"), 1.5);
    assert.equal(parseAmount("12 500 MAD"), 12500);
    assert.equal(parseAmount("0"), 0);
  });
  test("vide = null, illisible = NaN (jamais deviné)", () => {
    assert.equal(parseAmount(""), null);
    assert.equal(parseAmount(null), null);
    assert.ok(Number.isNaN(parseAmount("abc")));
    assert.ok(Number.isNaN(parseAmount("1.2.3")));
  });
});
