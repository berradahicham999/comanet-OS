"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/access";
import { getSettings, saveSettings, type AnalyticsSettings } from "@/lib/settings";
import { refreshAfterWrite } from "@/lib/analytics-marketing/refresh";
import { METRIC_KEYS, RESULT_KEYS, CHANNEL_FAMILIES, MAPPING_KINDS } from "@/lib/analytics-marketing/shared";

const num = (fd: FormData, k: string, fallback: number) => { const v = Number(String(fd.get(k) ?? "").replace(",", ".")); return Number.isFinite(v) ? v : fallback; };
const numOrNull = (fd: FormData, k: string) => { const raw = String(fd.get(k) ?? "").trim(); if (!raw) return null; const v = Number(raw.replace(",", ".")); return Number.isFinite(v) && v > 0 ? v : null; };
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const done = () => { revalidatePath("/parametres/analytics"); revalidatePath("/marketing/analytics", "layout"); revalidatePath("/"); };

/** Fenêtres, répartition, coût animatrice, poids du score, seuils de verdict, réallocation, alertes. */
export async function saveAnalyticsSettings(formData: FormData) {
  await requireAdmin();
  const cur = await getSettings();
  const a = cur.analytics;
  const next: AnalyticsSettings = {
    ...a,
    windowBeforeDays: Math.max(1, Math.round(num(formData, "windowBeforeDays", a.windowBeforeDays))),
    windowAfterDays: Math.max(1, Math.round(num(formData, "windowAfterDays", a.windowAfterDays))),
    productSplit: str(formData, "productSplit") === "EQUAL" ? "EQUAL" : "PRORATA_SALES",
    productSplitLookbackDays: Math.max(7, Math.round(num(formData, "productSplitLookbackDays", a.productSplitLookbackDays))),
    animationDayCost: numOrNull(formData, "animationDayCost"),
    animationMonthlyCost: numOrNull(formData, "animationMonthlyCost"),
    animationDaysPerMonth: Math.max(1, Math.round(num(formData, "animationDaysPerMonth", a.animationDaysPerMonth))),
    animationTargetSelloutPerDay: numOrNull(formData, "animationTargetSelloutPerDay"),
    animationMinSelloutMultiple: num(formData, "animationMinSelloutMultiple", a.animationMinSelloutMultiple),
    animationStopSelloutMultiple: num(formData, "animationStopSelloutMultiple", a.animationStopSelloutMultiple),
    healthWeights: { objective: num(formData, "hw_objective", a.healthWeights.objective), roi: num(formData, "hw_roi", a.healthWeights.roi), intensity: num(formData, "hw_intensity", a.healthWeights.intensity), stockCoverage: num(formData, "hw_stock", a.healthWeights.stockCoverage), dataQuality: num(formData, "hw_data", a.healthWeights.dataQuality) },
    investmentBalancePts: num(formData, "investmentBalancePts", a.investmentBalancePts),
    productCases: { pushedMinSpend: num(formData, "pc_minSpend", a.productCases.pushedMinSpend), pushedMinExposures: Math.round(num(formData, "pc_minExposures", a.productCases.pushedMinExposures)), sellingGrowthPct: num(formData, "pc_growth", a.productCases.sellingGrowthPct), overstockMonths: num(formData, "pc_overstockMonths", a.productCases.overstockMonths), overstockMinUnits: num(formData, "pc_overstockUnits", a.productCases.overstockMinUnits) },
    channelDiagnosis: { minSpend: num(formData, "cd_minSpend", a.channelDiagnosis.minSpend), costRisePct: num(formData, "cd_rise", a.channelDiagnosis.costRisePct), costDropPct: num(formData, "cd_drop", a.channelDiagnosis.costDropPct), costVsPortfolioFactor: num(formData, "cd_factor", a.channelDiagnosis.costVsPortfolioFactor), degradingWeeks: Math.max(2, Math.round(num(formData, "cd_weeks", a.channelDiagnosis.degradingWeeks))) },
    reallocation: { minShiftMad: num(formData, "re_min", a.reallocation.minShiftMad), maxShiftPct: Math.min(100, Math.max(1, num(formData, "re_max", a.reallocation.maxShiftPct))) },
    alerts: { budgetDriftPct: num(formData, "al_drift", a.alerts.budgetDriftPct), brandNoSpendObjectiveDropPct: num(formData, "al_drop", a.alerts.brandNoSpendObjectiveDropPct) },
  };
  await saveSettings({ ...cur, analytics: next });
  // Le coût d'animation et la répartition changent les faits : on recalcule les sources concernées.
  const costChanged = next.animationDayCost !== a.animationDayCost || next.animationMonthlyCost !== a.animationMonthlyCost || next.animationDaysPerMonth !== a.animationDaysPerMonth;
  const splitChanged = next.productSplit !== a.productSplit || next.productSplitLookbackDays !== a.productSplitLookbackDays;
  if (costChanged || splitChanged) await refreshAfterWrite(splitChanged ? ["AD_METRIC", "EXPENSE", "COLLABORATION", "CONTENT", "ANIMATION", "SAMPLE"] : ["ANIMATION"], "WORKFLOW");
  done();
}

/** Canal : libellé, famille, résultat propre, repli, couleur, ordre, actif. La clé ne change pas. */
export async function saveChannel(formData: FormData) {
  await requireAdmin();
  const key = str(formData, "key").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const label = str(formData, "label");
  if (!key || !label) return;
  const family = (Object.keys(CHANNEL_FAMILIES) as string[]).includes(str(formData, "family")) ? str(formData, "family") : "OTHER";
  const rm = (RESULT_KEYS as readonly string[]).includes(str(formData, "resultMetric")) ? str(formData, "resultMetric") : null;
  const fb = (RESULT_KEYS as readonly string[]).includes(str(formData, "fallbackResultMetric")) ? str(formData, "fallbackResultMetric") : null;
  const color = /^#[0-9a-fA-F]{6}$/.test(str(formData, "color")) ? str(formData, "color") : "#64748b";
  const sort = Math.round(num(formData, "sort", 50));
  const active = formData.get("active") === "on";
  await db.execute(sql`
    insert into dim_channel (key, label, family, result_metric, fallback_result_metric, color, sort, active)
    values (${key}, ${label}, ${family}, ${rm}, ${fb}, ${color}, ${sort}, ${active})
    on conflict (key) do update set label = excluded.label, family = excluded.family, result_metric = excluded.result_metric, fallback_result_metric = excluded.fallback_result_metric, color = excluded.color, sort = excluded.sort, active = excluded.active`);
  done();
}

/** Correspondance source → canal. Un changement se reflète dans les faits au prochain recalcul (lancé ici). */
export async function saveMapping(formData: FormData) {
  await requireAdmin();
  const kind = str(formData, "sourceKind");
  const sourceKey = str(formData, "sourceKey");
  const channelKey = str(formData, "channelKey");
  if (!(Object.keys(MAPPING_KINDS) as string[]).includes(kind) || !sourceKey || !channelKey) return;
  await db.execute(sql`insert into channel_mappings (source_kind, source_key, channel_key) values (${kind}, ${sourceKey}, ${channelKey}) on conflict (source_kind, source_key) do update set channel_key = excluded.channel_key`);
  const kinds = kind === "BUDGET_CATEGORY" ? ["EXPENSE" as const] : kind === "AD_PLATFORM" ? ["AD_METRIC" as const] : kind === "CONTENT_PLATFORM" ? ["CONTENT" as const] : kind === "COLLABORATION" ? ["COLLABORATION" as const] : kind === "ANIMATION" ? ["ANIMATION" as const] : kind === "SAMPLE" ? ["SAMPLE" as const] : ["EXPENSE" as const];
  await refreshAfterWrite(kinds, "WORKFLOW");
  done();
}

/** Dictionnaire : libellé, description, seuils, actif. La clé et la formule (code) ne changent pas ici. */
export async function saveMetric(formData: FormData) {
  await requireAdmin();
  const key = str(formData, "key");
  if (!(METRIC_KEYS as readonly string[]).includes(key)) return;
  const label = str(formData, "label");
  if (!label) return;
  await db.execute(sql`
    update metrics_definitions set label = ${label}, description = ${str(formData, "description") || null},
      direction = ${["HIGHER_BETTER", "LOWER_BETTER", "NEUTRAL"].includes(str(formData, "direction")) ? str(formData, "direction") : "NEUTRAL"},
      warn_threshold = ${numOrNull(formData, "warnThreshold")}, alert_threshold = ${numOrNull(formData, "alertThreshold")},
      active = ${formData.get("active") === "on"}, updated_at = now()
    where key = ${key}`);
  done();
}
