"use server";

/** Server actions du copilote (hors chat, qui passe par /api/ai/chat pour le streaming). */
import { explainCard } from "@/lib/ai/explain";
import type { ExplainContext, ExplainResult } from "@/lib/ai/explain-shared";
import { createTaskFromBrief, getMorningBrief } from "@/lib/ai/brief";
import type { BriefResult } from "@/lib/ai/brief-shared";
import { detailRecommendation } from "@/lib/ai/plans";
import type { PlanResult, RecSummary } from "@/lib/ai/plans-shared";

export async function explainCardAction(ctx: ExplainContext, opts: { force?: boolean } = {}): Promise<ExplainResult> {
  if (!ctx || typeof ctx.card !== "string" || !Array.isArray(ctx.values)) return { ok: false, error: "Contexte de carte invalide.", configured: true };
  return explainCard({ ...ctx, values: ctx.values.slice(0, 20).map((v) => ({ label: String(v.label).slice(0, 80), value: String(v.value).slice(0, 80) })), title: String(ctx.title).slice(0, 120) }, opts);
}

export async function generateBriefAction(opts: { force?: boolean } = {}): Promise<BriefResult> {
  return getMorningBrief({ generate: true, force: !!opts.force });
}

export async function createTaskFromBriefAction(index: number): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> {
  if (!Number.isInteger(index) || index < 0 || index > 2) return { ok: false, error: "Action invalide." };
  return createTaskFromBrief(index);
}

export async function detailRecommendationAction(rec: RecSummary, opts: { force?: boolean } = {}): Promise<PlanResult> {
  if (!rec || typeof rec.key !== "string" || !rec.key || typeof rec.title !== "string") return { ok: false, error: "Recommandation invalide.", configured: true };
  const clean: RecSummary = {
    key: rec.key.slice(0, 200), rule: String(rec.rule ?? "").slice(0, 80), category: String(rec.category ?? "").slice(0, 40), priority: String(rec.priority ?? "").slice(0, 20),
    title: rec.title.slice(0, 200), subtitle: rec.subtitle ? String(rec.subtitle).slice(0, 200) : null,
    facts: (Array.isArray(rec.facts) ? rec.facts : []).slice(0, 12).map((f) => ({ label: String(f.label).slice(0, 80), value: String(f.value).slice(0, 120) })),
    why: String(rec.why ?? "").slice(0, 1500), action: String(rec.action ?? "").slice(0, 1500), impact: rec.impact ? String(rec.impact).slice(0, 500) : null,
    taskTitle: String(rec.taskTitle ?? "").slice(0, 200), dueInDays: Math.max(0, Math.min(365, Number(rec.dueInDays) || 7)),
  };
  return detailRecommendation(clean, opts);
}
