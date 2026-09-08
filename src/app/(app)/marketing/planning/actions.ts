"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentItems, contentProducts, contentComments, contentStatusHistory, contentAssets, briefTemplates, type BriefTemplateDefaults } from "@/db/schema";
import { requirePermission, requireAccess, brandInScope } from "@/lib/access";
import { transition, canValidateBrand } from "@/lib/content/workflow";
import { contentRefs, defaultStatusKey } from "@/lib/content/refs";
import { syncBriefTask } from "@/lib/content/tasks";
import { notify } from "@/lib/content/notify";
import { beginAsset, appendChunk, deleteAsset as removeAsset, type AssetKind } from "@/lib/content/assets";
import { applyTemplate, shiftIso, BRIEF_FIELDS } from "@/lib/content/shared";
import { fmtDate } from "@/lib/format";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
const int = (fd: FormData, k: string) => { const v = str(fd, k); if (v === null) return null; const n = Number(v.replace(/\s/g, "")); return Number.isFinite(n) ? Math.round(n) : null; };
const isUuid = (v: string | null): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);
const PLANNING = "/marketing/planning";

function revalidateContent(id?: string | null) {
  revalidatePath(PLANNING); revalidatePath(`${PLANNING}/validation`); revalidatePath("/marketing"); revalidatePath("/taches"); revalidatePath("/actions");
  if (id) revalidatePath(`${PLANNING}/${id}`);
}

async function assertBrand(brandId: string) {
  if (!(await brandInScope(brandId))) throw new Error("Cette marque n'est pas dans votre périmètre.");
}

/** Produits d'un contenu : la liste complète dans `content_products`, le premier comme produit principal. */
async function setProducts(contentId: string, productIds: string[]) {
  await db.delete(contentProducts).where(eq(contentProducts.contentId, contentId));
  const ids = [...new Set(productIds.filter(isUuid))];
  if (ids.length) await db.insert(contentProducts).values(ids.map((productId) => ({ contentId, productId }))).onConflictDoNothing();
  await db.update(contentItems).set({ productId: ids[0] ?? null }).where(eq(contentItems.id, contentId));
}

/* ------------------------------ Création rapide ------------------------------ */

/**
 * Création depuis une case du calendrier : marque, produits, plateforme, format, date, responsable.
 * Un template éventuel pré-remplit le brief. La deadline par défaut = date − délai du template (ou 3 jours).
 */
export async function quickCreateContent(formData: FormData): Promise<{ id: string } | { error: string }> {
  const user = await requirePermission("marketing", "create");
  const brandId = str(formData, "brandId"); const title = str(formData, "title"); const date = str(formData, "date");
  if (!isUuid(brandId) || !title || !date) return { error: "Titre, marque et date sont obligatoires." };
  await assertBrand(brandId);
  const refs = await contentRefs();
  const templateId = str(formData, "templateId");
  const tpl = isUuid(templateId) ? (await db.select().from(briefTemplates).where(eq(briefTemplates.id, templateId)))[0] : null;
  const d: BriefTemplateDefaults = tpl?.defaults ?? {};
  const platform = str(formData, "platform") ?? tpl?.platformKey ?? null;
  const format = str(formData, "format") ?? tpl?.formatKey ?? null;
  const objective = str(formData, "objective") ?? tpl?.objectiveKey ?? null;
  const fmt = refs.formats.find((f) => f.key === format);
  const brief = applyTemplate({ deliverables: fmt?.defaultDeliverable ?? null }, d);
  const responsibleId = str(formData, "responsibleId");
  const deadline = str(formData, "deadline") ?? shiftIso(date, -(d.deadlineOffsetDays ?? 3));
  const [row] = await db.insert(contentItems).values({
    brandId, title, date, publishTime: str(formData, "publishTime"), deadline,
    platform: refs.platforms.some((p) => p.key === platform) ? platform : null,
    format: refs.formats.some((f) => f.key === format) ? format : null,
    objective: refs.objectives.some((o) => o.key === objective) ? objective : null,
    responsibleId: isUuid(responsibleId) ? responsibleId : null,
    validatorId: isUuid(str(formData, "validatorId")) ? str(formData, "validatorId") : null,
    templateId: tpl?.id ?? null, status: await defaultStatusKey(), createdById: user.id,
    ...Object.fromEntries(BRIEF_FIELDS.map((f) => [f, (brief as Record<string, string | null | undefined>)[f] ?? null])),
  }).returning({ id: contentItems.id, status: contentItems.status });
  await db.insert(contentStatusHistory).values({ contentId: row.id, fromStatus: null, toStatus: row.status, userId: user.id, comment: "Création" });
  await setProducts(row.id, formData.getAll("productIds").map(String));
  if (isUuid(responsibleId)) {
    await syncBriefTask({ id: row.id, title, brandId, responsibleId, deadline, date, createdById: user.id });
    await notify([responsibleId], { type: "BRIEF_ASSIGNED", title: `Brief assigné : ${title}`, body: `Par ${user.name}, à livrer avant le ${fmtDate(deadline)}.`, href: `${PLANNING}/${row.id}`, entityType: "content", entityId: row.id }, { except: user.id });
  }
  revalidateContent(row.id);
  return { id: row.id };
}

/** Glisser-déposer : nouvelle date (la deadline suit du même décalage si elle existe). */
export async function moveContent(input: { id: string; date: string }): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("marketing", "edit");
  if (!isUuid(input.id) || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "Paramètres invalides." };
  const cur = (await db.select({ date: contentItems.date, deadline: contentItems.deadline, brandId: contentItems.brandId }).from(contentItems).where(eq(contentItems.id, input.id)))[0];
  if (!cur) return { ok: false, error: "Contenu introuvable." };
  await assertBrand(cur.brandId);
  const delta = Math.round((new Date(input.date + "T12:00:00Z").getTime() - new Date(cur.date + "T12:00:00Z").getTime()) / 86400000);
  await db.update(contentItems).set({ date: input.date, deadline: cur.deadline ? shiftIso(cur.deadline, delta) : null, updatedAt: new Date() }).where(eq(contentItems.id, input.id));
  revalidateContent(input.id);
  return { ok: true };
}

/** Duplication vers une autre plateforme et/ou une autre date : brief copié, livrables non. */
export async function duplicateContent(input: { id: string; date?: string | null; platform?: string | null }): Promise<{ id: string } | { error: string }> {
  const user = await requirePermission("marketing", "create");
  if (!isUuid(input.id)) return { error: "Contenu introuvable." };
  const src = (await db.select().from(contentItems).where(eq(contentItems.id, input.id)))[0];
  if (!src) return { error: "Contenu introuvable." };
  await assertBrand(src.brandId);
  const refs = await contentRefs();
  const platform = input.platform && refs.platforms.some((p) => p.key === input.platform) ? input.platform : src.platform;
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : src.date;
  const delta = Math.round((new Date(date + "T12:00:00Z").getTime() - new Date(src.date + "T12:00:00Z").getTime()) / 86400000);
  const { id: _omit, createdAt: _c, updatedAt: _u, publishedAt: _p, archivedAt: _a, link: _l, reach: _r, engagement: _e, perfNotes: _n, ...rest } = src;
  void _omit; void _c; void _u; void _p; void _a; void _l; void _r; void _e; void _n;
  const [row] = await db.insert(contentItems).values({
    ...rest, date, platform, deadline: src.deadline ? shiftIso(src.deadline, delta) : null,
    status: await defaultStatusKey(), createdById: user.id,
    title: platform !== src.platform ? `${src.title} (${refs.platforms.find((p) => p.key === platform)?.label ?? platform})` : src.title,
  }).returning({ id: contentItems.id, status: contentItems.status });
  const prods = await db.select({ productId: contentProducts.productId }).from(contentProducts).where(eq(contentProducts.contentId, src.id));
  if (prods.length) await db.insert(contentProducts).values(prods.map((p) => ({ contentId: row.id, productId: p.productId }))).onConflictDoNothing();
  await db.insert(contentStatusHistory).values({ contentId: row.id, fromStatus: null, toStatus: row.status, userId: user.id, comment: `Dupliqué depuis « ${src.title} »` });
  revalidateContent(row.id);
  return { id: row.id };
}

/* --------------------------------- Brief --------------------------------- */

export async function saveBrief(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const id = str(formData, "id");
  if (!isUuid(id)) return;
  const cur = (await db.select({ brandId: contentItems.brandId, responsibleId: contentItems.responsibleId, title: contentItems.title }).from(contentItems).where(eq(contentItems.id, id)))[0];
  if (!cur) return;
  await assertBrand(cur.brandId);
  const refs = await contentRefs();
  const brandId = str(formData, "brandId"); const title = str(formData, "title"); const date = str(formData, "date");
  if (!isUuid(brandId) || !title || !date) return;
  await assertBrand(brandId);
  const platform = str(formData, "platform"), format = str(formData, "format"), objective = str(formData, "objective");
  const responsibleId = str(formData, "responsibleId"), validatorId = str(formData, "validatorId");
  const refsList = str(formData, "references");
  const references = (refsList ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [url, ...label] = l.split(/\s+/); return { url, label: label.join(" ") || undefined }; });
  const deadline = str(formData, "deadline");
  await db.update(contentItems).set({
    brandId, title, date, publishTime: str(formData, "publishTime"), deadline,
    platform: refs.platforms.some((p) => p.key === platform) ? platform : null,
    format: refs.formats.some((f) => f.key === format) ? format : null,
    objective: refs.objectives.some((o) => o.key === objective) ? objective : null,
    responsibleId: isUuid(responsibleId) ? responsibleId : null,
    validatorId: isUuid(validatorId) ? validatorId : null,
    brief: str(formData, "brief"), keyMessage: str(formData, "keyMessage"), angle: str(formData, "angle"), hook: str(formData, "hook"),
    caption: str(formData, "caption"), hashtags: str(formData, "hashtags"), cta: str(formData, "cta"),
    constraints: str(formData, "constraints"), mandatoryMentions: str(formData, "mandatoryMentions"), forbiddenClaims: str(formData, "forbiddenClaims"),
    references, deliverables: str(formData, "deliverables"),
    campaignId: isUuid(str(formData, "campaignId")) ? str(formData, "campaignId") : null,
    updatedAt: new Date(),
  }).where(eq(contentItems.id, id));
  await setProducts(id, formData.getAll("productIds").map(String));
  const newResp = isUuid(responsibleId) ? responsibleId : null;
  await syncBriefTask({ id, title, brandId, responsibleId: newResp, deadline, date, createdById: user.id });
  if (newResp && newResp !== cur.responsibleId) {
    await notify([newResp], { type: "BRIEF_ASSIGNED", title: `Brief assigné : ${title}`, body: `Par ${user.name}${deadline ? `, à livrer avant le ${fmtDate(deadline)}` : ""}.`, href: `${PLANNING}/${id}`, entityType: "content", entityId: id }, { except: user.id });
  }
  revalidateContent(id);
}

/** Applique un template sur la fiche : ne remplace jamais un champ déjà rempli. */
export async function applyTemplateToContent(formData: FormData) {
  await requirePermission("marketing", "edit");
  const id = str(formData, "id"); const templateId = str(formData, "templateId");
  if (!isUuid(id) || !isUuid(templateId)) return;
  const [cur, tpl] = await Promise.all([
    db.select().from(contentItems).where(eq(contentItems.id, id)).then((r) => r[0]),
    db.select().from(briefTemplates).where(eq(briefTemplates.id, templateId)).then((r) => r[0]),
  ]);
  if (!cur || !tpl) return;
  await assertBrand(cur.brandId);
  const merged = applyTemplate(cur, tpl.defaults);
  await db.update(contentItems).set({
    ...Object.fromEntries(BRIEF_FIELDS.map((f) => [f, merged[f] ?? null])),
    templateId: tpl.id,
    platform: cur.platform ?? tpl.platformKey, format: cur.format ?? tpl.formatKey, objective: cur.objective ?? tpl.objectiveKey,
    deadline: cur.deadline ?? (tpl.defaults.deadlineOffsetDays ? shiftIso(cur.date, -tpl.defaults.deadlineOffsetDays) : null),
    updatedAt: new Date(),
  }).where(eq(contentItems.id, id));
  revalidateContent(id);
}

/* -------------------------------- Workflow -------------------------------- */

/** Changement de statut : toute la logique est dans `transition()`. Renvoie l'erreur à afficher. */
export async function changeStatus(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const user = await requirePermission("marketing", "edit");
  const id = str(formData, "id"); const to = str(formData, "to");
  if (!isUuid(id) || !to) return { ok: false, error: "Paramètres invalides." };
  const res = await transition(id, to, user, str(formData, "comment"));
  if (!res.ok) return { ok: false, error: res.reason };
  revalidateContent(id);
  const back = str(formData, "redirectTo");
  if (back) redirect(back);
  return { ok: true };
}

/** Variante formulaire (sans retour) pour les boutons de la fiche. */
export async function changeStatusForm(formData: FormData) {
  const res = await changeStatus(formData);
  if (!res.ok) redirect(`${PLANNING}/${str(formData, "id")}?erreur=${encodeURIComponent(res.error ?? "Transition refusée")}`);
}

export async function addContentComment(formData: FormData) {
  const user = await requireAccess("marketing");
  const contentId = str(formData, "contentId"); const body = str(formData, "body");
  if (!isUuid(contentId) || !body) return;
  const c = (await db.select({ brandId: contentItems.brandId, title: contentItems.title, responsibleId: contentItems.responsibleId, validatorId: contentItems.validatorId, createdById: contentItems.createdById }).from(contentItems).where(eq(contentItems.id, contentId)))[0];
  if (!c) return;
  await assertBrand(c.brandId);
  await db.insert(contentComments).values({ contentId, userId: user.id, body });
  await notify([c.responsibleId, c.validatorId, c.createdById], { type: "COMMENT", title: `Commentaire : ${c.title}`, body: `${user.name} : ${body.slice(0, 140)}`, href: `${PLANNING}/${contentId}`, entityType: "content", entityId: contentId }, { except: user.id });
  revalidateContent(contentId);
}

/** Saisie post-publication légère : lien, portée, engagement. Jamais obligatoire. */
export async function savePostPublication(formData: FormData) {
  await requirePermission("marketing", "edit");
  const id = str(formData, "id");
  if (!isUuid(id)) return;
  await db.update(contentItems).set({ link: str(formData, "link"), reach: int(formData, "reach"), engagement: int(formData, "engagement"), perfNotes: str(formData, "perfNotes"), updatedAt: new Date() }).where(eq(contentItems.id, id));
  revalidateContent(id);
}

/** Suppression définitive : réservée à « Valider » (l'archivage est le geste normal). */
export async function deleteContentHard(formData: FormData) {
  await requirePermission("marketing", "validate");
  const id = str(formData, "id");
  if (!isUuid(id)) return;
  await db.delete(contentItems).where(eq(contentItems.id, id));
  revalidateContent();
  redirect(PLANNING);
}

/* ------------------------------- Livrables ------------------------------- */

/** Téléversement par morceaux (même mécanique que les imports) : `begin` crée la version, `append` ajoute. */
export async function beginAssetUpload(input: { contentId: string; kind: AssetKind; name: string; size: number; mime: string }) {
  const user = await requirePermission("marketing", "edit");
  if (!isUuid(input.contentId)) throw new Error("Contenu introuvable.");
  const kind: AssetKind = input.kind === "REFERENCE" ? "REFERENCE" : "LIVRABLE";
  return beginAsset({ owner: { contentId: input.contentId }, kind, name: input.name, mime: input.mime, size: input.size, uploadedById: user.id });
}

export async function appendAssetChunk(formData: FormData) {
  await requirePermission("marketing", "edit");
  const id = str(formData, "id"); const chunk = formData.get("chunk");
  if (!isUuid(id) || !(chunk instanceof Blob)) throw new Error("Morceau invalide.");
  return appendChunk(id, Buffer.from(await chunk.arrayBuffer()));
}

/** Fin de téléversement : notifie le validateur qu'un livrable est déposé. */
export async function finishAssetUpload(input: { assetId: string }) {
  const user = await requirePermission("marketing", "edit");
  const a = (await db.select({ contentId: contentAssets.contentId, kind: contentAssets.kind, name: contentAssets.name, version: contentAssets.version }).from(contentAssets).where(eq(contentAssets.id, input.assetId)))[0];
  if (!a?.contentId) return;
  await db.update(contentItems).set({ updatedAt: new Date() }).where(eq(contentItems.id, a.contentId));
  if (a.kind === "LIVRABLE") {
    const c = (await db.select({ title: contentItems.title, validatorId: contentItems.validatorId, createdById: contentItems.createdById }).from(contentItems).where(eq(contentItems.id, a.contentId)))[0];
    if (c) await notify([c.validatorId, c.createdById], { type: "DELIVERABLE_UPLOADED", title: `Livrable déposé : ${c.title}`, body: `${user.name} a déposé « ${a.name} » (v${a.version}).`, href: `${PLANNING}/${a.contentId}`, entityType: "content", entityId: a.contentId }, { except: user.id });
  }
  revalidateContent(a.contentId);
}

export async function deleteAssetAction(formData: FormData) {
  await requirePermission("marketing", "edit");
  const id = str(formData, "id"); const contentId = str(formData, "contentId");
  if (!isUuid(id)) return;
  await removeAsset(id);
  revalidateContent(contentId);
}

/* -------------------------------- Templates -------------------------------- */

export async function saveTemplate(formData: FormData) {
  await requirePermission("marketing", "edit");
  const id = str(formData, "id"); const name = str(formData, "name");
  if (!name) return;
  const defaults: BriefTemplateDefaults = Object.fromEntries(BRIEF_FIELDS.map((f) => [f, str(formData, f) ?? undefined]).filter(([, v]) => v));
  const off = int(formData, "deadlineOffsetDays"); if (off !== null) defaults.deadlineOffsetDays = off;
  const values = {
    name, brandId: isUuid(str(formData, "brandId")) ? str(formData, "brandId") : null,
    objectiveKey: str(formData, "objective"), platformKey: str(formData, "platform"), formatKey: str(formData, "format"),
    defaults, active: formData.get("active") !== "off",
  };
  if (isUuid(id)) await db.update(briefTemplates).set(values).where(eq(briefTemplates.id, id));
  else await db.insert(briefTemplates).values(values);
  revalidatePath(`${PLANNING}/modeles`); revalidatePath(PLANNING);
}

export async function deleteTemplate(formData: FormData) {
  await requirePermission("marketing", "validate");
  const id = str(formData, "id");
  if (!isUuid(id)) return;
  await db.delete(briefTemplates).where(eq(briefTemplates.id, id));
  revalidatePath(`${PLANNING}/modeles`); revalidatePath(PLANNING);
}

/** Exposé pour l'affichage des boutons (fiche, file) — même définition que la transition. */
export async function canValidate(brandId: string) {
  return canValidateBrand(brandId);
}
