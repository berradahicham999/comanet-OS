"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin, requirePermission } from "@/lib/access";
import { getSettings, saveSettings, type ComanetSettings } from "@/lib/settings";

const num = (fd: FormData, k: string, fallback: number) => { const n = Number(String(fd.get(k) ?? "").replace(",", ".")); return Number.isFinite(n) && String(fd.get(k) ?? "") !== "" ? n : fallback; };

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
