"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  budgets, budgetLines, campaigns, campaignProducts, marketingExpenses,
  influencers, collaborations, adCreatives, campaignAdLinks, adAccounts,
  type BudgetCategory,
} from "@/db/schema";
import { requirePermission, requireFlag, brandInScope } from "@/lib/access";
import { parseAmount } from "@/lib/influence-shared";
import { COLLAB_STATUS } from "@/lib/marketing-shared";
import { categoryFromLabel } from "@/lib/budget-categories";
import { matchKeyFor, backfillLink, clearLink } from "@/lib/meta/links";
import { syncAccount, syncAll } from "@/lib/meta/sync";
import { hasMetaToken, listAccounts, MetaError } from "@/lib/meta/client";
import { getSettings, saveSettings } from "@/lib/settings";
import { refreshAfterWrite } from "@/lib/analytics-marketing/refresh";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
const num = (fd: FormData, k: string) => { const s = String(fd.get(k) ?? "").replace(/\s/g, "").replace(",", "."); const n = Number(s); return s === "" || Number.isNaN(n) ? null : n; };

export async function saveBudget(formData: FormData) {
  // Enveloppe annuelle par marque : réservée à l'Administration (distincte de la saisie d'une dépense).
  await requirePermission("administration", "validate");
  const brandId = str(formData, "brandId"); const year = Number(str(formData, "year")); const amount = num(formData, "amount");
  if (!brandId || !year || amount === null) return;
  const ref = num(formData, "referenceRevenue");
  await db.insert(budgets).values({ brandId, year, amount: amount.toFixed(2), referenceRevenue: ref !== null ? ref.toFixed(2) : null, pctOfRevenue: ref ? ((amount / ref) * 100).toFixed(2) : null })
    .onConflictDoUpdate({ target: [budgets.brandId, budgets.year], set: { amount: amount.toFixed(2), referenceRevenue: ref !== null ? ref.toFixed(2) : null, pctOfRevenue: ref ? ((amount / ref) * 100).toFixed(2) : null } });
  revalidatePath("/marketing");
}

export async function saveBudgetLine(formData: FormData) {
  await requirePermission("budgets", "edit");
  const id = str(formData, "id");
  const brandId = str(formData, "brandId"); const year = Number(str(formData, "year")); const amount = num(formData, "amount"); const label = str(formData, "label");
  if (!brandId || !year || amount === null || !label) return;
  const category = (str(formData, "category") as BudgetCategory | null) ?? categoryFromLabel(label);
  if (id) await db.update(budgetLines).set({ label, category, amount: amount.toFixed(2) }).where(eq(budgetLines.id, id));
  else await db.insert(budgetLines).values({ brandId, year, label, category, amount: amount.toFixed(2) });
  revalidatePath("/marketing");
}

export async function deleteBudgetLine(formData: FormData) {
  await requirePermission("budgets", "validate");
  const id = str(formData, "id"); if (!id) return;
  await db.delete(budgetLines).where(eq(budgetLines.id, id));
  revalidatePath("/marketing");
}

export async function saveExpense(formData: FormData) {
  await requirePermission("budgets", "create");
  // Passer une dépense en « engagé » ou « dépensé » exige l'interrupteur « Valider une dépense ».
  const status = String(formData.get("status") ?? "PLANNED");
  if (status !== "PLANNED") await requireFlag("approveSpend");
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
  await refreshAfterWrite(["EXPENSE"]);
  revalidatePath("/marketing"); revalidatePath("/");
}

export async function deleteExpense(formData: FormData) {
  await requirePermission("budgets", "validate");
  const id = str(formData, "id"); if (!id) return;
  await db.delete(marketingExpenses).where(eq(marketingExpenses.id, id));
  await refreshAfterWrite(["EXPENSE"]);
  revalidatePath("/marketing");
}

export async function saveCampaign(formData: FormData) {
  await requirePermission("marketing", "create");
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
  revalidatePath("/marketing"); revalidatePath("/marketing/campagnes"); revalidatePath("/marketing/influence");
  if (campaignId) revalidatePath(`/marketing/campagnes/${campaignId}`);
  if (!id && campaignId && str(formData, "redirectToDetail")) redirect(`/marketing/campagnes/${campaignId}`);
}

export async function deleteCampaign(formData: FormData) {
  await requirePermission("marketing", "validate");
  const id = str(formData, "id"); if (!id) return;
  await db.delete(campaigns).where(eq(campaigns.id, id));
  revalidatePath("/marketing"); revalidatePath("/marketing/campagnes");
  redirect("/marketing/campagnes");
}

export async function setCampaignStatus(formData: FormData) {
  await requirePermission("marketing", "validate");
  const id = str(formData, "id"); const status = str(formData, "status");
  if (!id || !status) return;
  await db.update(campaigns).set({ status: status as "DRAFT" | "PLANNED" | "ACTIVE" | "PAUSED" | "DONE" | "ANALYZED", updatedAt: new Date() }).where(eq(campaigns.id, id));
  revalidatePath("/marketing/campagnes"); revalidatePath(`/marketing/campagnes/${id}`); revalidatePath("/marketing");
}

/* ------------------------------- Influence -------------------------------- */

/** Retour vers la page Influence avec un message (`ok` ou `erreur`), en conservant les filtres. */
function backToInfluence(formData: FormData, params: Record<string, string>): never {
  const q = new URLSearchParams();
  // Page détail d'une influenceuse : `return_path` ne peut viser qu'une page du module.
  const path = str(formData, "return_path");
  const base = path && /^\/marketing\/influence\/[0-9a-f-]{36}$/i.test(path) ? path : "/marketing/influence";
  for (const k of ["brand", "period", "start", "end", "status"]) { const v = str(formData, `return_${k}`); if (v) q.set(k, v); }
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  redirect(`${base}?${q.toString()}`);
}

/** Montant saisi : `null` si vide, refus (clé `nombre`) s'il est illisible. */
function amount(fd: FormData, k: string, formData: FormData): number | null {
  const v = parseAmount(str(fd, k));
  if (v !== null && (Number.isNaN(v) || v < 0)) backToInfluence(formData, { erreur: "nombre" });
  return v;
}

/** La collaboration existe-t-elle dans le périmètre de marques de la personne ? */
async function collaborationInScope(id: string): Promise<{ id: string; brandId: string } | null> {
  const [row] = await db.select({ id: collaborations.id, brandId: collaborations.brandId }).from(collaborations).where(eq(collaborations.id, id));
  if (!row) return null;
  return (await brandInScope(row.brandId)) ? row : null;
}

export async function saveInfluencer(formData: FormData) {
  const id = str(formData, "id");
  await requirePermission("influence", id ? "edit" : "create");
  const name = str(formData, "name");
  if (!name) backToInfluence(formData, { erreur: "nom" });
  const followers = amount(formData, "followers", formData);
  const engagementRate = amount(formData, "engagementRate", formData);
  const usualRate = amount(formData, "usualRate", formData);
  const values = {
    name,
    instagram: str(formData, "instagram"), tiktok: str(formData, "tiktok"),
    followers: followers !== null ? Math.round(followers) : null,
    engagementRate: engagementRate !== null ? engagementRate.toFixed(2) : null,
    audience: str(formData, "audience"), city: str(formData, "city"), category: str(formData, "category"),
    usualRate: usualRate !== null ? usualRate.toFixed(2) : null,
    contact: str(formData, "contact"), notes: str(formData, "notes"),
    active: formData.get("active") !== "off",
  };
  // Le nom est unique (insensible à la casse) : un doublon est signalé, jamais ignoré en silence.
  const [dup] = await db.execute(sql`select id from influencers where lower(name) = lower(${name}) ${id ? sql`and id <> ${id}::uuid` : sql``} limit 1`).then((r) => r.rows as { id: string }[]);
  if (dup) backToInfluence(formData, { erreur: "doublon" });
  if (id) await db.update(influencers).set(values).where(eq(influencers.id, id));
  else await db.insert(influencers).values(values);
  revalidatePath("/marketing/influence");
  backToInfluence(formData, { ok: "fiche" });
}

export async function saveCollaboration(formData: FormData) {
  const id = str(formData, "id");
  await requirePermission("influence", id ? "edit" : "create");
  const influencerId = str(formData, "influencerId"); const brandId = str(formData, "brandId"); const date = str(formData, "date");
  if (!influencerId) backToInfluence(formData, { erreur: "influenceuse" });
  if (!brandId || !(await brandInScope(brandId))) backToInfluence(formData, { erreur: "marque" });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) backToInfluence(formData, { erreur: "date" });
  const status = str(formData, "status") ?? "PROSPECT";
  if (!(status in COLLAB_STATUS)) backToInfluence(formData, { erreur: "statut" });
  if (id && !(await collaborationInScope(id))) backToInfluence(formData, { erreur: "introuvable" });

  // Campagne et produit doivent appartenir à la marque de la collaboration.
  const campaignId = str(formData, "campaignId"); const productId = str(formData, "productId");
  if (campaignId) {
    const [c] = await db.select({ brandId: campaigns.brandId }).from(campaigns).where(eq(campaigns.id, campaignId));
    if (!c || c.brandId !== brandId) backToInfluence(formData, { erreur: "campagne" });
  }
  if (productId) {
    const [p] = await db.execute(sql`select brand_id from products where id = ${productId}::uuid`).then((r) => r.rows as { brand_id: string | null }[]);
    if (!p || (p.brand_id && p.brand_id !== brandId)) backToInfluence(formData, { erreur: "produit" });
  }

  const int = (k: string) => { const v = amount(formData, k, formData); return v === null ? null : Math.round(v); };
  const values: Partial<typeof collaborations.$inferInsert> = {
    influencerId, brandId, date, productId, campaignId,
    contentType: str(formData, "contentType"),
    stories: int("stories") ?? 0, reels: int("reels") ?? 0, posts: int("posts") ?? 0,
    productValue: (amount(formData, "productValue", formData) ?? 0).toFixed(2),
    status,
    reach: int("reach"), impressions: int("impressions"), views: int("views"),
    likes: int("likes"), comments: int("comments"), shares: int("shares"), saves: int("saves"),
    linkClicks: int("linkClicks"), promoCode: str(formData, "promoCode"), conversions: int("conversions"),
    attributedRevenue: (() => { const v = amount(formData, "attributedRevenue", formData); return v !== null ? v.toFixed(2) : null; })(),
    notes: str(formData, "notes"),
    updatedAt: new Date(),
  };
  // Le cachet n'est envoyé que par les comptes qui voient les coûts internes : son absence
  // du formulaire ne remet jamais un cachet existant à zéro.
  if (formData.has("fee")) values.fee = (amount(formData, "fee", formData) ?? 0).toFixed(2);
  if (id) await db.update(collaborations).set(values).where(eq(collaborations.id, id));
  else await db.insert(collaborations).values(values as typeof collaborations.$inferInsert);
  await refreshAfterWrite(["COLLABORATION"]);
  revalidatePath("/marketing/influence"); revalidatePath("/marketing");
  backToInfluence(formData, { ok: id ? "collab_maj" : "collab" });
}

export async function setCollaborationStatus(formData: FormData) {
  await requirePermission("influence", "edit");
  const id = str(formData, "id"); const status = str(formData, "status");
  if (!id || !status) return;
  if (!(status in COLLAB_STATUS)) backToInfluence(formData, { erreur: "statut" });
  if (!(await collaborationInScope(id))) backToInfluence(formData, { erreur: "introuvable" });
  await db.update(collaborations).set({ status, updatedAt: new Date() }).where(eq(collaborations.id, id));
  await refreshAfterWrite(["COLLABORATION"]);
  revalidatePath("/marketing/influence");
  backToInfluence(formData, { ok: "statut" });
}

export async function deleteCollaboration(formData: FormData) {
  await requirePermission("influence", "validate");
  const id = str(formData, "id"); if (!id) return;
  if (!(await collaborationInScope(id))) backToInfluence(formData, { erreur: "introuvable" });
  await db.delete(collaborations).where(eq(collaborations.id, id));
  await refreshAfterWrite(["COLLABORATION"]);
  revalidatePath("/marketing/influence");
  backToInfluence(formData, { ok: "suppr" });
}

/* ------------------------------ Créatives Ads ------------------------------ */

export async function saveAdCreative(formData: FormData) {
  await requirePermission("marketing", "edit");
  const platform = str(formData, "platform"); const adName = str(formData, "adName");
  if (!platform || !adName) return;
  const values = { platform, adName, format: str(formData, "format"), hook: str(formData, "hook"), productId: str(formData, "productId"), notes: str(formData, "notes") };
  await db.insert(adCreatives).values(values).onConflictDoUpdate({ target: [adCreatives.platform, adCreatives.adName], set: { format: values.format, hook: values.hook, productId: values.productId, notes: values.notes } });
  revalidatePath("/marketing/ads");
}

/* Les contenus du planning éditorial vivent dans `planning/actions.ts` : un seul chemin pour
   changer un statut (`transition()`), aucune mise à jour directe de `content_items.status`. */

/* ------------------------------------------------------------------ */
/* Régie Meta : rattachement et synchronisation                        */
/* ------------------------------------------------------------------ */

const COMPTES = "/marketing/ads/comptes";

/**
 * Rattache une ou plusieurs campagnes de régie à une campagne COMANET.
 *
 * Chaque case cochée porte `platform|externalCampaignId|nom` : l'identifiant peut être vide
 * (lignes venues d'un import fichier, qui n'en portent pas), auquel cas on rattache par nom.
 */
export async function linkAdCampaigns(formData: FormData) {
  await requirePermission("marketing", "edit");
  const campaignId = str(formData, "campaignId");
  if (!campaignId) return;
  const picks = formData.getAll("pick").map(String).filter(Boolean);
  if (!picks.length) return;

  for (const raw of picks) {
    const sep = raw.indexOf("|");
    const sep2 = raw.indexOf("|", sep + 1);
    if (sep < 0 || sep2 < 0) continue;
    const platform = raw.slice(0, sep);
    const externalCampaignId = raw.slice(sep + 1, sep2) || null;
    const name = raw.slice(sep2 + 1);
    if (!platform || !name) continue;

    await db
      .insert(campaignAdLinks)
      .values({
        campaignId, platform, externalCampaignId, externalCampaignName: name,
        matchKey: matchKeyFor(externalCampaignId, name),
        accountId: str(formData, "accountId"),
      })
      // Une campagne de régie n'appartient qu'à une campagne COMANET : re-cocher la déplace.
      .onConflictDoUpdate({
        target: [campaignAdLinks.platform, campaignAdLinks.matchKey],
        set: { campaignId, externalCampaignName: name, externalCampaignId },
      });

    await backfillLink({ campaignId, platform, externalCampaignId, externalCampaignName: name });
  }
  revalidatePath(`/marketing/campagnes/${campaignId}`);
  revalidatePath("/marketing/campagnes");
  revalidatePath("/marketing/ads");
}

export async function unlinkAdCampaign(formData: FormData) {
  await requirePermission("marketing", "edit");
  const linkId = str(formData, "linkId");
  const campaignId = str(formData, "campaignId");
  if (!linkId) return;
  await clearLink(linkId);
  if (campaignId) revalidatePath(`/marketing/campagnes/${campaignId}`);
  revalidatePath("/marketing/campagnes");
  revalidatePath("/marketing/ads");
}

/** Déclare (ou met à jour) un compte publicitaire Meta et son activation de synchronisation. */
export async function saveAdAccount(formData: FormData) {
  await requirePermission("administration", "validate");
  const externalId = str(formData, "externalId");
  const name = str(formData, "name");
  if (!externalId || !name) return;
  const values = {
    platform: "META",
    name,
    externalId: externalId.replace(/^act_/, ""),
    brandId: str(formData, "brandId"),
    businessId: str(formData, "businessId"),
    businessName: str(formData, "businessName"),
    currency: str(formData, "currency") ?? "MAD",
    syncEnabled: formData.get("syncEnabled") === "on",
  };
  await db
    .insert(adAccounts)
    .values(values)
    .onConflictDoUpdate({
      target: [adAccounts.platform, adAccounts.externalId],
      set: {
        name: values.name, brandId: values.brandId, syncEnabled: values.syncEnabled,
        businessId: values.businessId, businessName: values.businessName, currency: values.currency,
      },
    });
  revalidatePath("/marketing/ads/comptes");
}

export async function setAdAccountSync(formData: FormData) {
  await requirePermission("administration", "validate");
  const id = str(formData, "id");
  if (!id) return;
  const enabled = str(formData, "enabled") === "1";
  await db.update(adAccounts).set({ syncEnabled: enabled }).where(eq(adAccounts.id, id));
  revalidatePath("/marketing/ads/comptes");
}

/** Synchronisation immédiate d'un compte, sans attendre le passage quotidien. */
export async function syncAdAccountNow(formData: FormData) {
  await requirePermission("marketing", "edit");
  const id = str(formData, "id");
  if (!id) return;
  const rows = await db
    .select({ id: adAccounts.id, name: adAccounts.name, externalId: adAccounts.externalId, brandId: adAccounts.brandId, currency: adAccounts.currency })
    .from(adAccounts)
    .where(eq(adAccounts.id, id));
  const a = rows[0];
  if (!a?.externalId) return;
  await syncAccount({ id: a.id, name: a.name, externalId: a.externalId, brandId: a.brandId, currency: a.currency });
  revalidatePath("/marketing/ads/comptes");
  revalidatePath("/marketing/ads");
}

/**
 * Rafraîchissement de la journée en cours, depuis l'écran de reporting.
 *
 * Mode `intraday` : seules la veille et la journée du jour sont relues. C'est le geste qu'on
 * fait plusieurs fois par jour ; relire 28 jours à chaque clic brûlerait le quota de l'API
 * pour deux journées qui bougent. Un compte déjà en cours de synchronisation est ignoré par
 * le verrou, sans erreur.
 */
export async function refreshMetaNow() {
  await requirePermission("marketing", "edit");
  if (!hasMetaToken()) return;
  await syncAll({ mode: "intraday" });
  revalidatePath("/marketing/ads");
  revalidatePath("/marketing/ads/comptes");
}

/**
 * Découverte des comptes auxquels le jeton donne accès, enregistrés sans être activés :
 * activer une synchronisation reste un choix explicite (chaque compte consomme du quota).
 */
export async function discoverAdAccounts() {
  await requirePermission("administration", "validate");
  if (!hasMetaToken()) {
    redirect(`${COMPTES}?erreur=${encodeURIComponent("Aucun jeton Meta n'est configuré : ajoutez META_ACCESS_TOKEN aux variables d'environnement, puis redéployez.")}`);
  }

  // Meta refuse pour des raisons très concrètes (jeton expiré, permission absente, compte hors
  // du business émetteur). Sans ce filet, l'erreur remontait en page 500 anonyme : Hicham
  // voyait « A server error occurred » là où Meta disait précisément ce qui manquait.
  let found: Awaited<ReturnType<typeof listAccounts>> = [];
  let echec: string | null = null;
  try {
    found = await listAccounts();
  } catch (err) {
    echec =
      err instanceof MetaError
        ? err.isAuth
          ? `Jeton refusé par Meta : ${err.message}. Vérifiez qu'il porte la permission « ads_read » et qu'il n'a pas été copié avec un espace en trop.`
          : `Meta : ${err.message}`
        : err instanceof Error ? err.message : String(err);
  }
  if (echec) redirect(`${COMPTES}?erreur=${encodeURIComponent(echec)}`);

  for (const a of found) {
    await db
      .insert(adAccounts)
      .values({
        platform: "META", name: a.name, externalId: a.accountId, currency: a.currency,
        timezone: a.timezone, businessId: a.businessId, businessName: a.businessName,
      })
      .onConflictDoUpdate({
        target: [adAccounts.platform, adAccounts.externalId],
        set: {
          name: a.name, currency: a.currency, timezone: a.timezone,
          // Le business n'est plus lu (permission trop large) : ne jamais écraser
          // avec du vide ce qui a pu être renseigné à la main.
          businessId: sql`coalesce(excluded.business_id, ad_accounts.business_id)`,
          businessName: sql`coalesce(excluded.business_name, ad_accounts.business_name)`,
        },
      });
  }
  revalidatePath("/marketing/ads/comptes");
  // Zéro compte n'est pas une erreur de l'application : le jeton est valide mais ne donne accès
  // à rien. Le dire explicitement évite de chercher la panne du mauvais côté.
  redirect(`${COMPTES}?decouverts=${found.length}`);
}

/**
 * Taux de conversion vers le MAD.
 *
 * Meta facture les comptes COMANET en EUR et en USD. Aucun taux n'est deviné par
 * l'application : tant qu'une devise n'a pas de taux ici, la synchronisation du compte
 * concerné est refusée plutôt que de produire une dépense en dirhams inventée.
 */
export async function saveFxRates(formData: FormData) {
  await requirePermission("marketing", "edit");
  const cur = await getSettings();
  const rates: Record<string, number> = { ...cur.fxRates };
  for (const code of ["EUR", "USD"]) {
    const v = num(formData, `fx_${code}`);
    if (v !== null && v > 0) rates[code] = v;
    else delete rates[code];
  }
  await saveSettings({ ...cur, fxRates: rates });
  revalidatePath("/marketing/ads/comptes");
  revalidatePath("/marketing/ads");
}
