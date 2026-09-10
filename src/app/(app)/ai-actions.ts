"use server";

/** Server actions du copilote (hors chat, qui passe par /api/ai/chat pour le streaming). */
import { explainCard } from "@/lib/ai/explain";
import type { ExplainContext, ExplainResult } from "@/lib/ai/explain-shared";

export async function explainCardAction(ctx: ExplainContext, opts: { force?: boolean } = {}): Promise<ExplainResult> {
  if (!ctx || typeof ctx.card !== "string" || !Array.isArray(ctx.values)) return { ok: false, error: "Contexte de carte invalide.", configured: true };
  return explainCard({ ...ctx, values: ctx.values.slice(0, 20).map((v) => ({ label: String(v.label).slice(0, 80), value: String(v.value).slice(0, 80) })), title: String(ctx.title).slice(0, 120) }, opts);
}
