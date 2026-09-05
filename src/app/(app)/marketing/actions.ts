"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  budgets, budgetLines, campaigns, campaignProducts, marketingExpenses, contentItems,
  influencers, collaborations, adCreatives,
  type BudgetCategory, type ContentStatus,
} from "@/db/schema";
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
    type: str(formData, "type") ?? "AWARENESS",
    channel: (str(formData, "channel") as "META" | "TIKTOK" | "GOOGLE" | "INFLUENCE" | "TRADE" | "EVENEMENT" | "AUTRE" | null) ?? "META",
    objective: str(formData, "objective"), startDate: str(formData, "startDate"), endDate: str(formData, "endDate"),
    budget: num(formData, "budget") !== null ? num(formData, "budget")!.toFixed(2) : null,
    status: (str(formData, "status") as "DRAFT" | "PLANNED" | "ACTIVE" | "PAUSED" | "DONE" | "ANALYZED" | null) ?? "DRAFT",
    audience: str(formData, "audience"), message: str(formData, "message"), offer: str(formData, "offer"),
    kpiTarget: str(formData, "kpiTarget"), kpiActual: str(formData, "kpiActual"),
    responsibleId: str(formData, "responsibleId"),
    notes: str(formData, "notes"),
    updatedAt: new Date(),
  };
  let campaignId = id;
  if (id) await db.update(campaigns).set(values).where(eq(campaigns.id, id));
  else { const [row] = await db.insert(campaigns).values(values).returning({ id: campaigns.id }); campaignId = row?.id ?? null; }
  // Produits poussés par la campagne (référentiel produits existant, aucune duplication).
  if (campaignId && formData.has("productIds")) {
    const ids = formData.getAll("productIds").map((v) => String(v)).filter(Boolean);
    await db.delete(campaignProducts).where(eq(campaignProducts.campaignId, campaignId));
    if (ids.length) await db.insert(campaignProducts).values(ids.map((productId) => ({ campaignId: campaignId!, productId }))).onConflictDoNothing();
  }
  revalidatePath("/marketing"); revalidatePath("/marketing/campagnes");
  if (campaignId) revalidatePath(`/marketing/campagnes/${campaignId}`);
  if (!id && campaignId && str(formData, "redirectToDetail")) redirect(`/marketing/campagnes/${campaignId}`);
}

export async function deleteCampaign(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id"); if (!id) return;
  await db.delete(campaigns).where(eq(campaigns.id, id));
  revalidatePath("/marketing"); revalidatePath("/marketing/campagnes");
  redirect("/marketing/campagnes");
}

export async function setCampaignStatus(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id"); const status = str(formData, "status");
  if (!id || !status) return;
  await db.update(campaigns).set({ status: status as "DRAFT" | "PLANNED" | "ACTIVE" | "PAUSED" | "DONE" | "ANALYZED", updatedAt: new Date() }).where(eq(campaigns.id, id));
  revalidatePath("/marketing/campagnes"); revalidatePath(`/marketing/campagnes/${id}`); revalidatePath("/marketing");
}

/* ------------------------------- Influence -------------------------------- */

export async function saveInfluencer(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id"); const name = str(formData, "name");
  if (!name) return;
  const values = {
    name,
    instagram: str(formData, "instagram"), tiktok: str(formData, "tiktok"),
    followers: num(formData, "followers") !== null ? Math.round(num(formData, "followers")!) : null,
    engagementRate: num(formData, "engagementRate") !== null ? num(formData, "engagementRate")!.toFixed(2) : null,
    audience: str(formData, "audience"), city: str(formData, "city"), category: str(formData, "category"),
    usualRate: num(formData, "usualRate") !== null ? num(formData, "usualRate")!.toFixed(2) : null,
    contact: str(formData, "contact"), notes: str(formData, "notes"),
    active: formData.get("active") !== "off",
  };
  if (id) await db.update(influencers).set(values).where(eq(influencers.id, id));
  else await db.insert(influencers).values(values).onConflictDoNothing();
  revalidatePath("/marketing/influence");
}

export async function saveCollaboration(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id");
  const influencerId = str(formData, "influencerId"); const brandId = str(formData, "brandId"); const date = str(formData, "date");
  if (!influencerId || !brandId || !date) return;
  const int = (k: string) => { const v = num(formData, k); return v === null ? null : Math.round(v); };
  const values = {
    influencerId, brandId, date,
    productId: str(formData, "productId"), campaignId: str(formData, "campaignId"),
    contentType: str(formData, "contentType"),
    stories: int("stories") ?? 0, reels: int("reels") ?? 0, posts: int("posts") ?? 0,
    fee: (num(formData, "fee") ?? 0).toFixed(2),
    productValue: (num(formData, "productValue") ?? 0).toFixed(2),
    status: str(formData, "status") ?? "PROSPECT",
    reach: int("reach"), impressions: int("impressions"), views: int("views"),
    likes: int("likes"), comments: int("comments"), shares: int("shares"), saves: int("saves"),
    linkClicks: int("linkClicks"), promoCode: str(formData, "promoCode"), conversions: int("conversions"),
    attributedRevenue: num(formData, "attributedRevenue") !== null ? num(formData, "attributedRevenue")!.toFixed(2) : null,
    notes: str(formData, "notes"),
    updatedAt: new Date(),
  };
  if (id) await db.update(collaborations).set(values).where(eq(collaborations.id, id));
  else await db.insert(collaborations).values(values);
  revalidatePath("/marketing/influence"); revalidatePath("/marketing");
}

export async function setCollaborationStatus(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id"); const status = str(formData, "status");
  if (!id || !status) return;
  await db.update(collaborations).set({ status, updatedAt: new Date() }).where(eq(collaborations.id, id));
  revalidatePath("/marketing/influence");
}

export async function deleteCollaboration(formData: FormData) {
  await requireAccess("marketing");
  const id = str(formData, "id"); if (!id) return;
  await db.delete(collaborations).where(eq(collaborations.id, id));
  revalidatePath("/marketing/influence");
}

/* ------------------------------ Créatives Ads ------------------------------ */

export async function saveAdCreative(formData: FormData) {
  await requireAccess("marketing");
  const platform = str(formData, "platform"); const adName = str(formData, "adName");
  if (!platform || !adName) return;
  const values = { platform, adName, format: str(formData, "format"), hook: str(formData, "hook"), productId: str(formData, "productId"), notes: str(formData, "notes") };
  await db.insert(adCreatives).values(values).onConflictDoUpdate({ target: [adCreatives.platform, adCreatives.adName], set: { format: values.format, hook: values.hook, productId: values.productId, notes: values.notes } });
  revalidatePath("/marketing/ads");
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
