/** « Détailler » une recommandation — types partagés client / serveur. */
import type { RecommendationWithState } from "@/lib/rules/types";

/** Ce que la carte transmet au copilote : le contenu de la recommandation, sans état interne. */
export type RecSummary = {
  key: string; rule: string; category: string; priority: string; title: string; subtitle: string | null;
  facts: { label: string; value: string }[]; why: string; action: string; impact: string | null; taskTitle: string; dueInDays: number;
};

export function recSummary(r: RecommendationWithState): RecSummary {
  return { key: r.key, rule: r.rule, category: r.category, priority: r.priority, title: r.title, subtitle: r.subtitle ?? null, facts: r.facts, why: r.why, action: r.action, impact: r.impact ?? null, taskTitle: r.task.title, dueInDays: r.task.dueInDays };
}

export type StoredPlan = { recKey: string; contentMd: string; model: string | null; updatedAt: string };

export type PlanResult = { ok: true; plan: StoredPlan; cached: boolean } | { ok: false; error: string; configured: boolean };
