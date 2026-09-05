"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { budgets, budgetLines, campaigns, marketingExpenses, contentItems, type BudgetCategory, type ContentStatus } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { categoryFromLabel } from "@/lib/budget-categories";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
const num = (fd: FormData, k: string) => { const s = String(fd.get(k) ?? "").replace(/\s/g, "").replace(",", "."); const n = Number(s); return s === "" || Number.isNaN(n) ? null : n; };

export async function saveBudget(formData: FormData) {
  await requireAccess("marketing");
  const brandId = str(formData, "brandId"); const year = Number(str(formData, "year")); const amount = num(formData, "amount");
  if (!brandId || !year || amount === null) return;
  const ref = num(formData, "referenceRevenue");
  await db.insert(budgets).values({ brandId, year, amount: amount.toFixed(2), referenceRevenue: ref !== null ? ref.toFixed(2) : null, pctOfRevenue: ref ? ((amount / ref) * 100).toFixed(2) : null })
    .onConflictDoUpdate({ target: [budgets.brandId, budgets.year], set: { amount: amount.toFixed(2), referenceRevenue: ref !== null ? ref.toFixed(2) : null, pctOfRevenue: ref ? ((amount / ref) * 100).toFixed(2) : null } });
  revalidatePath("/marketing");
}

export async function saveBudgetLine(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id");
  const brandId = str(formData, "brandId"); const year = Number(str(formData, "year")); const amount = num(formData, "amount"); const label = str(formData, "label");
  if (!brandId || !year || amount === null || !label) return;
  const category = (str(formData, "category") as BudgetCategory | null) ?? categoryFromLabel(label);
  if (id) await db.update(budgetLines).set({ label, category, amount: amount.toFixed(2) }).where(eq(budgetLines.id, id));
  else await db.insert(budgetLines).values({ brandId, year, label, category, amount: amount.toFixed(2) });
  revalidatePath("/marketing");
}

export async function deleteBudgetLine(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id"); if (!id) return;
  await db.delete(budgetLines).where(eq(budgetLines.id, id));
  revalidatePath("/marketing");
}

export async function saveExpense(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id");
  const brandId = str(formData, "brandId"); const amount = num(formData, "amount"); const label = str(formData, "label"); const date = str(formData, "date");
  if (!brandId || amount === null || !label || !date) return;
  const values = {
    brandId, label, amount: amount.toFixed(2), date,
    category: (str(formData, "category") as BudgetCategory | null) ?? categoryFromLabel(label),
    status: (str(formData, "status") as "PLANNED" | "COMMITTED" | "SPENT" | null) ?? "PLANNED",
    campaignId: str(formData, "campaignId"),
    attributedRevenue: num(formData, "attributedRevenue") !== null ? num(formData, "attributedRevenue")!.toFixed(2) : null,
    conversions: num(formData, "conversions") !== null ? Math.round(num(formData, "conversions")!) : null,
    notes: str(formData, "notes"),
  };
  if (id) await db.update(marketingExpenses).set(values).where(eq(marketingExpenses.id, id));
  else await db.insert(marketingExpenses).values(values);
  revalidatePath("/marketing"); revalidatePath("/");
}

export async function deleteExpense(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id"); if (!id) return;
  await db.delete(marketingExpenses).where(eq(marketingExpenses.id, id));
  revalidatePath("/marketing");
}

export async function saveCampaign(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id");
  const brandId = str(formData, "brandId"); const name = str(formData, "name");
  if (!brandId || !name) return;
  const values = {
    brandId, name,
    channel: (str(formData, "channel") as "META" | "TIKTOK" | "GOOGLE" | "INFLUENCE" | "TRADE" | "EVENEMENT" | "AUTRE" | null) ?? "META",
    objective: str(formData, "objective"), startDate: str(formData, "startDate"), endDate: str(formData, "endDate"),
    budget: num(formData, "budget") !== null ? num(formData, "budget")!.toFixed(2) : null,
    status: (str(formData, "status") as "DRAFT" | "ACTIVE" | "PAUSED" | "DONE" | null) ?? "DRAFT",
    notes: str(formData, "notes"),
  };
  if (id) await db.update(campaigns).set(values).where(eq(campaigns.id, id));
  else await db.insert(campaigns).values(values);
  revalidatePath("/marketing");
}

export async function saveContent(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id");
  const brandId = str(formData, "brandId"); const title = str(formData, "title"); const date = str(formData, "date");
  if (!brandId || !title || !date) return;
  const values = {
    brandId, title, date, productId: str(formData, "productId"), format: str(formData, "format"), platform: str(formData, "platform"), objective: str(formData, "objective"),
    brief: str(formData, "brief"), responsibleId: str(formData, "responsibleId"), status: (str(formData, "status") as ContentStatus | null) ?? "IDEE", link: str(formData, "link"),
  };
  if (id) await db.update(contentItems).set(values).where(eq(contentItems.id, id));
  else await db.insert(contentItems).values(values);
  revalidatePath("/marketing/planning");
}

export async function setContentStatus(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id"); const status = str(formData, "status") as ContentStatus | null;
  if (!id || !status) return;
  await db.update(contentItems).set({ status }).where(eq(contentItems.id, id));
  revalidatePath("/marketing/planning");
}

export async function deleteContent(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id"); if (!id) return;
  await db.delete(contentItems).where(eq(contentItems.id, id));
  revalidatePath("/marketing/planning");
}
