/**
 * Couche de décision unifiée — adaptateurs purs : une recommandation de règle, une décision Ads et une
 * décision marketing prennent la même forme (pourquoi, données étiquetées, impact, confiance, action, canal,
 * montant, date de revue) ; tri par priorité ; statut effectif (approuvée + tâche faite = exécutée, revue
 * dépassée = expirée). Aucune base.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fromAdsIntel, fromMarketingIntel, fromRule, sortDecisions, CATEGORY_OF_ACTION } from "@/lib/decisions/adapters";
import { effectiveStatus } from "@/lib/decisions/store-shared";
import type { RecommendationWithState } from "@/lib/rules/types";
import type { Recommendation as AdsRecommendation } from "@/lib/ads-intel/types";
import type { Decision as IntelDecision } from "@/lib/marketing-intel/types";

const now = new Date("2026-10-04T10:00:00Z");
const period = { start: "2026-09-05", end: "2026-10-05", label: "30 jours" };

describe("adaptateurs", () => {
  test("règle Action Center → décision (domaine RULES, données CONFIRMED, canal déduit de la règle)", () => {
    const rec: RecommendationWithState = {
      key: "ads-stop:camp1", rule: "ads-performance", category: "MARKETING", priority: "CRITICAL", title: "GAMARDE — Campagne X", subtitle: "STOP",
      facts: [{ label: "Dépense", value: "12 000 MAD" }], why: "Coût par résultat ×2.", action: "Mettre en pause.", impact: "Économie",
      task: { title: "Pause campagne X", dueInDays: 2, role: "MARKETING" }, brandId: "b1", score: 12_000, entity: { type: "campaign", id: "c1", href: "/marketing/campagnes/c1" },
    };
    const d = fromRule(rec, now, 30);
    assert.equal(d.id, "ads-stop:camp1");
    assert.equal(d.domain, "RULES");
    assert.equal(d.evidence[0].tag, "CONFIRMED");
    assert.equal(d.category, "META");
    assert.equal(d.expectedReviewDate, "2026-11-03");
    assert.equal(d.status, "PROPOSED");
    assert.equal(d.priority, "CRITICAL");
  });
  test("règle analytics-reallocation → domaine ANALYTICS et montant lu dans les faits", () => {
    const rec: RecommendationWithState = {
      key: "realloc:b1:INFLUENCE:META_ADS", rule: "analytics-reallocation", category: "MARKETING", priority: "HIGH", title: "GAMARDE — Influence → Meta Ads",
      facts: [{ label: "Montant", value: "20 000 MAD (30 % du canal source)" }], why: "Influence sous-performe.", action: "Réallouer.",
      task: { title: "Réallouer", dueInDays: 7, role: "MARKETING" }, brandId: "b1",
    };
    const d = fromRule(rec, now, 30);
    assert.equal(d.domain, "ANALYTICS");
    assert.equal(d.amount, 20_000);
  });
  test("intelligence Ads → décision (confiance en %, canal META, PAUSE_REVIEW = ne pas pousser)", () => {
    const r: AdsRecommendation = {
      id: "r1", decision: "PAUSE_REVIEW", tone: "red", level: "campaign", externalId: "123", brandId: "b1", brandName: "Gamarde", title: "Campagne Y", headline: "0 résultat",
      why: ["aucun résultat sur 14 j"], data: [{ label: "Dépense", value: "3 000 MAD", delta: null, good: null }], action: "Mettre en pause", cause: "CREATIVE", confidence: 80, confidenceWhy: ["volume suffisant"], verdict: "STOP", priority: 100,
    };
    const d = fromAdsIntel(r, period, now, 30);
    assert.equal(d.domain, "ADS_INTEL");
    assert.equal(d.confidence.level, "HIGH");
    assert.equal(d.confidence.pct, 80);
    assert.equal(d.doNotPush, true);
    assert.equal(d.category, "META");
    assert.equal(d.priority, "HIGH");
    assert.equal(d.evidence[0].tag, "CALCULATED");
    assert.equal(d.expectedReviewDate, "2026-10-18"); // revue Ads plafonnée à 14 jours
  });
  test("intelligence marketing → décision (étiquettes conservées, canal déduit de l'action, entité produit)", () => {
    const i: IntelDecision = {
      key: "PUSH:p1", scope: "product", productId: "p1", productName: "Sebo Control", brandName: "Gamarde", action: "PUSH", secondaryActions: ["BOOST_DIGITAL"], title: "Pousser",
      why: ["sell-in +18 %", "62 jours de couverture"], data: [{ label: "CA", value: "100 000 MAD", tag: "CONFIRMED" }, { label: "Croissance", value: "+18 %", tag: "CALCULATED" }, { label: "Marge", value: "non disponible", tag: "MISSING" }],
      expectedImpact: "Sell-out en hausse", confidence: "MEDIUM", confidenceWhy: ["marge inconnue"], doNotPush: false, score: 85,
    };
    const d = fromMarketingIntel(i, "b1", period, now, 30);
    assert.equal(d.domain, "MARKETING_INTEL");
    assert.equal(d.productId, "p1");
    assert.equal(d.entity.href, "/produits/p1");
    assert.deepEqual(d.evidence.map((e) => e.tag), ["CONFIRMED", "CALCULATED", "MISSING"]);
    assert.equal(d.category, "META");
    assert.equal(d.priority, "HIGH");
    assert.match(d.action, /Pousser/);
    assert.match(d.action, /Renforcer le digital/);
  });
  test("une action RESTOCK n'a pas de canal (rien à dépenser avant réassort)", () => {
    assert.equal(CATEGORY_OF_ACTION.RESTOCK, undefined);
    assert.equal(CATEGORY_OF_ACTION.DO_NOT_PROMOTE, undefined);
  });
  test("tri : priorité puis score", () => {
    const base = fromRule({ key: "a", rule: "x", category: "MARKETING", priority: "LOW", title: "a", facts: [], why: "", action: "", task: { title: "", dueInDays: 1, role: "MARKETING" }, score: 5 }, now, 30);
    const list = [base, { ...base, id: "b", priority: "HIGH" as const, score: 1 }, { ...base, id: "c", priority: "LOW" as const, score: 50 }];
    assert.deepEqual(sortDecisions(list).map((d) => d.id), ["b", "c", "a"]);
  });
});

describe("statut effectif", () => {
  const state = { status: "APPROVED" as const, decidedBy: "Hicham", decidedAt: null, reason: null, actionId: "a1", taskId: "t1", taskStatus: "TODO", expectedReviewDate: "2026-11-01", measuredNote: null };
  test("approuvée + tâche terminée = exécutée", () => { assert.equal(effectiveStatus({ ...state, taskStatus: "DONE" }, "2026-10-04"), "EXECUTED"); });
  test("approuvée + tâche annulée = refusée", () => { assert.equal(effectiveStatus({ ...state, taskStatus: "CANCELLED" }, "2026-10-04"), "REJECTED"); });
  test("approuvée + revue dépassée sans exécution = expirée", () => { assert.equal(effectiveStatus(state, "2026-11-02"), "EXPIRED"); });
  test("approuvée en cours = approuvée ; mesurée reste mesurée", () => {
    assert.equal(effectiveStatus(state, "2026-10-04"), "APPROVED");
    assert.equal(effectiveStatus({ ...state, status: "MEASURED", taskStatus: "DONE" }, "2026-12-01"), "MEASURED");
  });
});
