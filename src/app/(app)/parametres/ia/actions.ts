"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/access";
import { getSettings, saveSettings, type AiSettings } from "@/lib/settings";

const num = (fd: FormData, k: string, fallback: number) => { const v = Number(String(fd.get(k) ?? "").replace(",", ".")); return Number.isFinite(v) ? v : fallback; };

/** Limites d'usage du copilote (les modèles et la clé restent en variables d'environnement). */
export async function saveAiSettings(formData: FormData) {
  await requireAdmin();
  const cur = await getSettings();
  const a = cur.ai;
  const next: AiSettings = {
    requestsPerHour: Math.max(1, Math.round(num(formData, "requestsPerHour", a.requestsPerHour))),
    dailyTokenBudget: Math.max(10_000, Math.round(num(formData, "dailyTokenBudget", a.dailyTokenBudget))),
    monthlyCostAlertUsd: Math.max(0, num(formData, "monthlyCostAlertUsd", a.monthlyCostAlertUsd)),
    maxToolCalls: Math.max(1, Math.min(12, Math.round(num(formData, "maxToolCalls", a.maxToolCalls)))),
    timeoutSeconds: Math.max(15, Math.min(120, Math.round(num(formData, "timeoutSeconds", a.timeoutSeconds)))),
    explainCacheMinutes: Math.max(1, Math.round(num(formData, "explainCacheMinutes", a.explainCacheMinutes))),
  };
  await saveSettings({ ...cur, ai: next });
  revalidatePath("/parametres/ia");
}
