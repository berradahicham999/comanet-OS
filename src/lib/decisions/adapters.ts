/**
 * Adaptateurs PURS : chaque moteur existant → `UnifiedDecision`. Aucun moteur n'est modifié, aucune donnée
 * n'est recalculée ici : on traduit des champs (pourquoi, données, impact, confiance, action) et on pose une
 * priorité et un canal suggéré à partir de ce que le moteur dit déjà. Testés sans base.
 */
import type { BudgetCategory, TaskPriority } from "@/db/schema";
import type { RecommendationWithState } from "@/lib/rules/types";
import type { Recommendation as AdsRecommendation } from "@/lib/ads-intel/types";
import type { Decision as IntelDecision, Confidence } from "@/lib/marketing-intel/types";
import { ACTION_LABELS } from "@/lib/marketing-intel/decisions";
import { addDays, iso } from "@/lib/format";
import type { DecisionDomain, UnifiedDecision } from "./types";

/* ------------------------------ Correspondances ------------------------------ */

/** Canal budgétaire impliqué par une action de moteur, quand elle en implique un. */
export const CATEGORY_OF_ACTION: Record<string, BudgetCategory> = {
  PUSH: "META", BOOST_DIGITAL: "META", SCALE: "META", INCREASE_BUDGET: "META", REDUCE_BUDGET: "META", PAUSE_REVIEW: "META", TEST: "META",
  CHANGE_AUDIENCE: "META", MAINTAIN: "META",
  CREATE_CONTENT: "CREATION", CREATE_NEW_CREATIVE: "CREATION", CHANGE_ANGLE: "CREATION", REUSE_WINNER: "CREATION",
  ACTIVATE_INFLUENCER: "INFLUENCE",
  CREATE_PROMOTION: "TRADE", FOCUS_SELL_OUT: "ANIMATION",
};

const ADS_LABELS: Record<string, string> = {
  SCALE: "Augmenter l'investissement", MAINTAIN: "Maintenir", OPTIMIZE: "Optimiser", PAUSE_REVIEW: "Mettre en pause et revoir", TEST: "Tester",
  REUSE_WINNER: "Réutiliser la créative gagnante", CREATE_NEW_CREATIVE: "Créer une nouvelle créative", CHANGE_ANGLE: "Changer d'angle",
  CHANGE_AUDIENCE: "Changer d'audience", INCREASE_BUDGET: "Augmenter le budget", REDUCE_BUDGET: "Réduire le budget", DO_NOTHING: "Ne rien faire",
};

const reviewDate = (now: Date, days: number) => iso(addDays(now, days));

const ruleDomain = (rule: string): DecisionDomain => (rule.startsWith("analytics-") ? "ANALYTICS" : "RULES");

/** Montant d'une réallocation (règle `analytics-reallocation`), lu dans ses faits ; `null` sinon. */
function amountFromFacts(rec: RecommendationWithState): number | null {
  if (rec.rule !== "analytics-reallocation") return null;
  const f = rec.facts.find((x) => x.label === "Montant");
  if (!f) return null;
  const digits = f.value.replace(/\s| | /g, "").match(/^(\d+)/);
  return digits ? Number(digits[1]) : null;
}

const categoryFromRule = (rec: RecommendationWithState): BudgetCategory | null => {
  if (rec.rule.startsWith("ads-")) return "META";
  if (rec.rule.startsWith("influence")) return "INFLUENCE";
  if (rec.rule === "content-late") return "CREATION";
  if (rec.rule.startsWith("activation")) return "EVENEMENT";
  if (rec.rule === "campaign-stock" || rec.rule === "stock-overstock") return "TRADE";
  return null;
};

/* ------------------------------ Règles Action Center ------------------------------ */

export function fromRule(rec: RecommendationWithState, now: Date, reviewDays: number): UnifiedDecision {
  const kind = rec.rule.startsWith("ads-") ? rec.rule.slice(4).toUpperCase() : rec.rule.toUpperCase().replace(/-/g, "_");
  return {
    id: rec.key, domain: ruleDomain(rec.rule), source: rec.rule,
    entity: { type: (rec.entity?.type as UnifiedDecision["entity"]["type"]) ?? "other", id: rec.entity?.id ?? null, name: rec.title, href: rec.entity?.href ?? null },
    brandId: rec.brandId ?? null, brandName: null, productId: rec.entity?.type === "product" ? rec.entity.id : null,
    title: rec.subtitle ? `${rec.title} — ${rec.subtitle}` : rec.title,
    why: [rec.why], evidence: rec.facts.map((f) => ({ label: f.label, value: f.value, tag: "CONFIRMED" as const })),
    impact: rec.impact ?? null,
    confidence: { level: rec.priority === "CRITICAL" || rec.priority === "HIGH" ? "HIGH" : "MEDIUM", pct: null, why: ["règle déterministe sur des données lues telles quelles"] },
    recommendation: kind, recommendationLabel: rec.subtitle ?? rec.rule, action: rec.action,
    period: null, expectedReviewDate: reviewDate(now, reviewDays), priority: rec.priority, score: rec.score ?? 0, doNotPush: false,
    category: categoryFromRule(rec), amount: amountFromFacts(rec), task: { title: rec.task.title, dueInDays: rec.task.dueInDays },
    status: "PROPOSED", state: null,
  };
}

/* ------------------------------ Intelligence Ads ------------------------------ */

function adsPriority(r: AdsRecommendation): TaskPriority {
  if (r.decision === "DO_NOTHING") return "LOW";
  if (r.tone === "red" || r.priority >= 90) return "HIGH";
  if (r.priority >= 60) return "MEDIUM";
  return "LOW";
}

export function fromAdsIntel(r: AdsRecommendation, period: { start: string; end: string; label: string }, now: Date, reviewDays: number): UnifiedDecision {
  const level: Confidence = r.confidence >= 70 ? "HIGH" : r.confidence >= 40 ? "MEDIUM" : "LOW";
  return {
    id: `ads-intel:${r.decision}:${r.level}:${r.externalId ?? r.id}`, domain: "ADS_INTEL", source: "ads-intel/recommend",
    entity: { type: r.level === "campaign" || r.level === "adset" || r.level === "ad" || r.level === "creative" ? "ad" : r.level === "brand" ? "brand" : "product", id: r.externalId, name: r.title, href: r.brandId ? `/marketing/ads?brand=${r.brandId}` : "/marketing/ads" },
    brandId: r.brandId, brandName: r.brandName, productId: null,
    title: `${r.title} — ${r.headline}`, why: r.why.slice(0, 5),
    evidence: r.data.map((d) => ({ label: d.label, value: d.value, tag: "CALCULATED" as const })),
    impact: null, confidence: { level, pct: r.confidence, why: r.confidenceWhy },
    recommendation: r.decision, recommendationLabel: ADS_LABELS[r.decision] ?? r.decision, action: r.action,
    period, expectedReviewDate: reviewDate(now, Math.min(reviewDays, 14)), priority: adsPriority(r), score: r.priority, doNotPush: r.decision === "PAUSE_REVIEW" || r.decision === "REDUCE_BUDGET",
    category: CATEGORY_OF_ACTION[r.decision] ?? "META", amount: null, task: { title: `${ADS_LABELS[r.decision] ?? r.decision} : ${r.title}`, dueInDays: 3 },
    status: "PROPOSED", state: null,
  };
}

/* ------------------------------ Intelligence marketing ------------------------------ */

function intelPriority(d: IntelDecision): TaskPriority {
  if (d.doNotPush && d.action === "RESTOCK") return "HIGH";
  if (d.score >= 80) return "HIGH";
  if (d.score >= 45) return "MEDIUM";
  return "LOW";
}

export function fromMarketingIntel(d: IntelDecision, brandId: string, period: { start: string; end: string; label: string }, now: Date, reviewDays: number): UnifiedDecision {
  return {
    id: `marketing-intel:${d.key}:${brandId}`, domain: "MARKETING_INTEL", source: "marketing-intel/decide",
    entity: d.productId ? { type: "product", id: d.productId, name: d.productName ?? d.brandName, href: `/produits/${d.productId}` } : { type: "brand", id: brandId, name: d.brandName, href: `/marketing/agent?brand=${brandId}` },
    brandId, brandName: d.brandName, productId: d.productId,
    title: `${d.productName ?? d.brandName} — ${d.title}`, why: d.why, evidence: d.data, impact: d.expectedImpact,
    confidence: { level: d.confidence, pct: null, why: d.confidenceWhy },
    recommendation: d.action, recommendationLabel: ACTION_LABELS[d.action], action: `${ACTION_LABELS[d.action]}${d.secondaryActions.length ? ` ; ensuite : ${d.secondaryActions.map((a) => ACTION_LABELS[a]).join(", ")}` : ""}`,
    period, expectedReviewDate: reviewDate(now, reviewDays), priority: intelPriority(d), score: d.score, doNotPush: d.doNotPush,
    category: CATEGORY_OF_ACTION[d.action] ?? null, amount: null, task: { title: `${ACTION_LABELS[d.action]} — ${d.productName ?? d.brandName}`, dueInDays: 7 },
    status: "PROPOSED", state: null,
  };
}

/* ------------------------------ Tri ------------------------------ */

const RANK: Record<TaskPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** Priorité d'abord, puis score du moteur ; les « ne pas pousser » sont rangés à part par l'appelant. */
export function sortDecisions(list: UnifiedDecision[]): UnifiedDecision[] {
  return [...list].sort((a, b) => RANK[a.priority] - RANK[b.priority] || b.score - a.score || a.title.localeCompare(b.title));
}
