"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, objectives, type UserRole } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { hashPassword } from "@/lib/auth";
import { getSettings, saveSettings, type ComanetSettings } from "@/lib/settings";

const num = (fd: FormData, k: string, fallback: number) => { const n = Number(String(fd.get(k) ?? "").replace(",", ".")); return Number.isFinite(n) && String(fd.get(k) ?? "") !== "" ? n : fallback; };

export async function updateSettings(formData: FormData) {
  await requireAccess("parametres");
  const cur = await getSettings();
  const next: ComanetSettings = {
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
  };
  if (!next.regulatoryAlertDays.length) next.regulatoryAlertDays = cur.regulatoryAlertDays;
  await saveSettings(next);
  revalidatePath("/", "layout");
}

export async function saveUser(formData: FormData) {
  await requireAccess("parametres");
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "TRADE") as UserRole;
  const password = String(formData.get("password") ?? "");
  if (!name || !email) return;
  if (id) {
    await db.update(users).set({ name, email, role, active: formData.get("active") === "on", ...(password ? { passwordHash: await hashPassword(password) } : {}) }).where(eq(users.id, id));
  } else {
    if (!password) return;
    await db.insert(users).values({ name, email, role, passwordHash: await hashPassword(password) }).onConflictDoNothing();
  }
  revalidatePath("/parametres");
}

export async function saveObjectives(formData: FormData) {
  await requireAccess("parametres");
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
