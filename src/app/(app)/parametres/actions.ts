"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin, requirePermission } from "@/lib/access";
import { getSettings, saveSettings, type ComanetSettings } from "@/lib/settings";
import type { ForecastSettings, SeasonEvent } from "@/lib/forecast-shared";

const num = (fd: FormData, k: string, fallback: number) => { const n = Number(String(fd.get(k) ?? "").replace(",", ".")); return Number.isFinite(n) && String(fd.get(k) ?? "") !== "" ? n : fallback; };

const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const isoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));

/** Événements saisonniers du formulaire : libellé vide = pas d'événement, case « supprimer » = retiré, dates illisibles ignorées. */
function parseForecast(fd: FormData, cur: ForecastSettings): ForecastSettings {
  const count = Math.max(0, Math.min(50, Math.round(num(fd, "fc_ev_count", 0))));
  const events: SeasonEvent[] = [];
  for (let i = 0; i < count; i++) {
    const g = (k: string) => String(fd.get(`fc_ev_${i}_${k}`) ?? "").trim();
    const label = g("label");
    if (!label || g("delete") === "1") continue;
    const key = g("key") || slug(label) || `evenement-${i}`;
    if (events.some((e) => e.key === key)) continue;
    const mult = Number(g("multiplier").replace(",", "."));
    const windows = g("windows").split(/\r?\n/).map((line) => {
      const m = line.match(/(\d{4}-\d{2}-\d{2})\s*(?:→|->|>|-|à|au)\s*(\d{4}-\d{2}-\d{2})/);
      return m && isoDate(m[1]) && isoDate(m[2]) && m[2] >= m[1] ? { start: m[1], end: m[2] } : null;
    }).filter((w): w is { start: string; end: string } => w !== null);
    const rm = g("recurring").match(/(\d{1,2})\/(\d{1,2})\s*(?:→|->|>|-|à|au)\s*(\d{1,2})\/(\d{1,2})/);
    const recurring = rm ? { startDay: Number(rm[1]), startMonth: Number(rm[2]), endDay: Number(rm[3]), endMonth: Number(rm[4]) } : null;
    const okRec = recurring && [recurring.startMonth, recurring.endMonth].every((m) => m >= 1 && m <= 12) && [recurring.startDay, recurring.endDay].every((d) => d >= 1 && d <= 31);
    events.push({
      key, label, multiplier: Number.isFinite(mult) && mult > 0 ? mult : 1,
      keywords: g("keywords").split(",").map((k) => k.trim()).filter(Boolean),
      windows, recurring: okRec ? recurring : null,
    });
  }
  return {
    baseMonths: Math.max(1, Math.min(24, Math.round(num(fd, "fc_baseMonths", cur.baseMonths)))),
    horizonMonths: Math.max(1, Math.min(18, Math.round(num(fd, "fc_horizonMonths", cur.horizonMonths)))),
    events: fd.has("fc_ev_count") ? events : cur.events,
  };
}

export async function updateSettings(formData: FormData) {
  await requireAdmin();
  const cur = await getSettings();
  const next: ComanetSettings = {
    ...cur,
    coverage: { green: num(formData, "cov_green", cur.coverage.green), yellow: num(formData, "cov_yellow", cur.coverage.yellow), orange: num(formData, "cov_orange", cur.coverage.orange) },
    avgSalesMonths: Math.max(1, Math.round(num(formData, "avgSalesMonths", cur.avgSalesMonths))),
    clientInactiveDays: num(formData, "clientInactiveDays", cur.clientInactiveDays),
    clientRiskDropPct: num(formData, "clientRiskDropPct", cur.clientRiskDropPct),
    clientGrowthPct: num(formData, "clientGrowthPct", cur.clientGrowthPct),
    clientHighPotentialPercentile: num(formData, "clientHighPotentialPercentile", cur.clientHighPotentialPercentile),
    regulatoryAlertDays: String(formData.get("regulatoryAlertDays") ?? "").split(/[,\s/]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a),
    regulatoryRenewalDays: num(formData, "regulatoryRenewalDays", cur.regulatoryRenewalDays),
    sellOutDropPct: num(formData, "sellOutDropPct", cur.sellOutDropPct),
    budgetAlertPct: num(formData, "budgetAlertPct", cur.budgetAlertPct),
    brandDropPct: num(formData, "brandDropPct", cur.brandDropPct),
    reorderGraceDays: num(formData, "reorderGraceDays", cur.reorderGraceDays),
    defaultMarginPct: num(formData, "defaultMarginPct", cur.defaultMarginPct),
    stockCriticalRevenue: num(formData, "stockCriticalRevenue", cur.stockCriticalRevenue),
    clientStock: {
      freshDays: Math.max(1, Math.round(num(formData, "cs_freshDays", cur.clientStock.freshDays))),
      staleDays: Math.max(2, Math.round(num(formData, "cs_staleDays", cur.clientStock.staleDays))),
      coverageWindowDays: Math.max(7, Math.round(num(formData, "cs_coverageWindowDays", cur.clientStock.coverageWindowDays))),
      stockoutSelloutDays: Math.max(7, Math.round(num(formData, "cs_stockoutSelloutDays", cur.clientStock.stockoutSelloutDays))),
    },
    marketingIntel: {
      starContributionPct: num(formData, "mi_starContributionPct", cur.marketingIntel.starContributionPct),
      minPeriodRevenueMad: num(formData, "mi_minPeriodRevenueMad", cur.marketingIntel.minPeriodRevenueMad),
      lowMarginPct: num(formData, "mi_lowMarginPct", cur.marketingIntel.lowMarginPct),
      maxDecisions: Math.max(1, Math.round(num(formData, "mi_maxDecisions", cur.marketingIntel.maxDecisions))),
    },
    forecast: parseForecast(formData, cur.forecast),
    marketingPlan: {
      minHistoryMad: Math.max(0, num(formData, "mp_minHistoryMad", cur.marketingPlan.minHistoryMad)),
      scaleAdjustPct: Math.max(0, num(formData, "mp_scaleAdjustPct", cur.marketingPlan.scaleAdjustPct)),
      optimizeAdjustPct: Math.max(0, num(formData, "mp_optimizeAdjustPct", cur.marketingPlan.optimizeAdjustPct)),
      stopAdjustPct: Math.max(0, num(formData, "mp_stopAdjustPct", cur.marketingPlan.stopAdjustPct)),
      testingSharePct: Math.min(20, Math.max(0, num(formData, "mp_testingSharePct", cur.marketingPlan.testingSharePct))),
      reviewDays: Math.max(1, Math.round(num(formData, "mp_reviewDays", cur.marketingPlan.reviewDays))),
      maxDecisions: Math.max(1, Math.round(num(formData, "mp_maxDecisions", cur.marketingPlan.maxDecisions))),
    },
  };
  if (!next.regulatoryAlertDays.length) next.regulatoryAlertDays = cur.regulatoryAlertDays;
  await saveSettings(next);
  revalidatePath("/", "layout");
}

export async function saveObjectives(formData: FormData) {
  await requirePermission("ventes", "validate");
  const year = Number(formData.get("year"));
  if (!year) return;
  const brandIds = String(formData.get("brandIds") ?? "").split(",").filter(Boolean);
  const upsert = async (brandId: string | null, month: number | null, amount: number) => {
    await db.execute(sql`
      insert into objectives (brand_id, product_id, year, month, amount)
      values (${brandId}::uuid, null, ${year}, ${month}, ${amount.toFixed(2)}::numeric)
      on conflict (coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), year, coalesce(month, 0))
      do update set amount = excluded.amount`);
  };
  const del = async (brandId: string, month: number) => { await db.execute(sql`delete from objectives where brand_id = ${brandId}::uuid and product_id is null and year = ${year} and month = ${month}`); };
  let total = 0;
  for (const b of brandIds) {
    const annualRaw = String(formData.get(`annual_${b}`) ?? "").replace(/\s/g, "");
    if (annualRaw !== "") { const a = Number(annualRaw); if (Number.isFinite(a)) { await upsert(b, null, a); total += a; } }
    for (let m = 1; m <= 12; m++) {
      const raw = String(formData.get(`m_${b}_${m}`) ?? "").replace(/\s/g, "");
      if (raw === "") { await del(b, m); continue; }
      const v = Number(raw);
      if (Number.isFinite(v)) await upsert(b, m, v);
    }
  }
  if (total > 0) await upsert(null, null, total);
  revalidatePath("/parametres"); revalidatePath("/");
}
