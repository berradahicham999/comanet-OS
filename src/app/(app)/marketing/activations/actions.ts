"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activations, activationBrands, activationProducts, activationClients, activationContributors, activationBudgetLines,
  activationChecklistItems, activationComments, activationStatusHistory, activationTemplates, contentAssets,
} from "@/db/schema";
import { brandInScope } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { requireActivationAccess, requireActivationPermission, activationScope } from "@/lib/activations/access";
import { activationRefs, defaultActivationStatusKey } from "@/lib/activations/refs";
import { getActivation } from "@/lib/activations/queries";
import { transitionActivation } from "@/lib/activations/workflow";
import { syncActivationExpenses, renumberBudgetLines } from "@/lib/activations/budget";
import { syncPilotTask } from "@/lib/activations/tasks";
import { applyActivationTemplate, shiftIso } from "@/lib/activations/shared";
import { notify } from "@/lib/content/notify";
import { beginAsset, appendChunk, deleteAsset, assetMeta, ASSET_KINDS, type AssetKind } from "@/lib/content/assets";
import { fmtDate } from "@/lib/format";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
const int = (fd: FormData, k: string) => { const v = str(fd, k); if (v === null) return null; const n = Number(v.replace(/\s/g, "")); return Number.isFinite(n) ? Math.round(n) : null; };
const num = (fd: FormData, k: string) => { const v = str(fd, k); if (v === null) return null; const n = Number(v.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const isUuid = (v: string | null | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const uuids = (fd: FormData, k: string) => [...new Set(fd.getAll(k).map(String).filter(isUuid))];
const BASE = "/marketing/activations";

function revalidate(id?: string | null) {
  revalidatePath(BASE); revalidatePath(`${BASE}/validation`); revalidatePath("/marketing"); revalidatePath("/marketing/budgets"); revalidatePath("/taches"); revalidatePath("/actions");
  if (id) revalidatePath(`${BASE}/${id}`);
}

/** L'activation existe et est dans la portée de la personne ; sinon erreur explicite. */
async function assertScope(id: string) {
  const [refs, settings, scope] = await Promise.all([activationRefs(), getSettings(), activationScope()]);
  const a = await getActivation(id, scope, refs, settings.activations);
  if (!a) throw new Error("Activation introuvable ou hors de votre périmètre.");
  return a;
}

async function assertBrands(ids: string[]) {
  for (const b of ids) if (!(await brandInScope(b))) throw new Error("Une des marques n'est pas dans votre périmètre.");
}

/** Liaisons N-N : la liste complète, et le premier élément comme « principal » sur la ligne. */
async function setLinks(id: string, fd: FormData) {
  const brandIds = uuids(fd, "brandIds"), productIds = uuids(fd, "productIds"), clientIds = uuids(fd, "clientIds"), contributorIds = uuids(fd, "contributorIds");
  await db.transaction(async (tx) => {
    await tx.delete(activationBrands).where(eq(activationBrands.activationId, id));
    if (brandIds.length) await tx.insert(activationBrands).values(brandIds.map((brandId) => ({ activationId: id, brandId })));
    await tx.delete(activationProducts).where(eq(activationProducts.activationId, id));
    if (productIds.length) await tx.insert(activationProducts).values(productIds.map((productId) => ({ activationId: id, productId })));
    await tx.delete(activationClients).where(eq(activationClients.activationId, id));
    if (clientIds.length) await tx.insert(activationClients).values(clientIds.map((clientId) => ({ activationId: id, clientId })));
    await tx.delete(activationContributors).where(eq(activationContributors.activationId, id));
    if (contributorIds.length) await tx.insert(activationContributors).values(contributorIds.map((userId) => ({ activationId: id, userId })));
    await tx.update(activations).set({ brandId: brandIds[0] ?? null, productId: productIds[0] ?? null, clientId: clientIds[0] ?? null }).where(eq(activations.id, id));
  });
  return { brandIds, productIds, clientIds, contributorIds };
}

/** Champs d'identité communs à la création et à la modification. */
async function identityFrom(fd: FormData) {
  const refs = await activationRefs();
  const type = str(fd, "type"); const objectiveKey = str(fd, "objectiveKey"); const targetKey = str(fd, "targetKey");
  const date = str(fd, "date"); const endDate = str(fd, "endDate"); const prepDate = str(fd, "prepDate");
  const responsibleId = str(fd, "responsibleId"); const validatorId = str(fd, "validatorId"); const campaignId = str(fd, "campaignId"); const linkedAnimationId = str(fd, "linkedAnimationId");
  return {
    name: str(fd, "name"),
    type: refs.types.some((t) => t.key === type) ? type! : "AUTRE",
    objectiveKey: refs.objectives.some((o) => o.key === objectiveKey) ? objectiveKey : null,
    targetKey: refs.targets.some((o) => o.key === targetKey) ? targetKey : null,
    date: isDate(date) ? date : null,
    endDate: isDate(endDate) && isDate(date) && endDate >= date ? endDate : null,
    prepDate: isDate(prepDate) ? prepDate : null,
    city: str(fd, "city"), place: str(fd, "place"), description: str(fd, "description"), notes: str(fd, "notes"),
    responsibleId: isUuid(responsibleId) ? responsibleId : null,
    validatorId: isUuid(validatorId) ? validatorId : null,
    campaignId: isUuid(campaignId) ? campaignId : null,
    linkedAnimationId: isUuid(linkedAnimationId) ? linkedAnimationId : null,
  };
}

/* -------------------------------- Création -------------------------------- */

/**
 * Création (complète ou rapide depuis un téléphone). Un modèle pré-remplit objectif, cible,
 * description, dates, lignes budgétaires prévues et checklist ; à défaut la checklist du type.
 */
export async function createActivation(formData: FormData) {
  const user = await requireActivationPermission("create");
  const id = await createFrom(formData, user);
  revalidate(id);
  redirect(`${BASE}/${id}${str(formData, "rapide") ? "?photo=1" : ""}`);
}

async function createFrom(formData: FormData, user: { id: string; name: string }): Promise<string> {
  const ident = await identityFrom(formData);
  if (!ident.name || !ident.date) throw new Error("Le nom et la date sont obligatoires.");
  const brandIds = uuids(formData, "brandIds");
  await assertBrands(brandIds);
  const refs = await activationRefs();
  const templateId = str(formData, "templateId");
  const tpl = isUuid(templateId) ? (await db.select().from(activationTemplates).where(eq(activationTemplates.id, templateId)))[0] ?? null : null;
  // Le type du modèle prime sur le sélecteur (un modèle est plus précis que le type par défaut du formulaire).
  const type = tpl?.typeKey && refs.types.some((t) => t.key === tpl.typeKey) ? tpl.typeKey : ident.type;
  const typeRef = refs.types.find((t) => t.key === type) ?? null;
  const applied = applyActivationTemplate(
    { objectiveKey: ident.objectiveKey, targetKey: ident.targetKey, description: ident.description, date: ident.date, endDate: ident.endDate, prepDate: ident.prepDate },
    tpl?.defaults ?? null, typeRef,
  );
  const status = await defaultActivationStatusKey();
  const [row] = await db.insert(activations).values({
    name: ident.name, type, status, date: ident.date, endDate: applied.endDate, prepDate: applied.prepDate,
    objectiveKey: applied.objectiveKey, targetKey: applied.targetKey, description: applied.description,
    city: ident.city, place: ident.place, notes: ident.notes, responsibleId: ident.responsibleId ?? user.id, validatorId: ident.validatorId,
    campaignId: ident.campaignId, linkedAnimationId: ident.linkedAnimationId, templateId: tpl?.id ?? null, createdById: user.id,
  }).returning({ id: activations.id });
  const id = row.id;
  await setLinks(id, formData);
  if (applied.budgetLines.length) {
    const validKeys = new Set(refs.costItems.map((c) => c.key));
    const lines = applied.budgetLines.filter((l) => validKeys.has(l.costItemKey));
    if (lines.length) await db.insert(activationBudgetLines).values(lines.map((l) => ({ activationId: id, costItemKey: l.costItemKey, label: refs.costItems.find((c) => c.key === l.costItemKey)?.label ?? l.label, planned: String(l.planned), sort: l.sort, brandId: brandIds[0] ?? null })));
  }
  if (applied.checklist.length) await db.insert(activationChecklistItems).values(applied.checklist.map((c) => ({ activationId: id, label: c.label, sort: c.sort })));
  await db.insert(activationStatusHistory).values({ activationId: id, fromStatus: null, toStatus: status, userId: user.id, comment: tpl ? `Création depuis le modèle « ${tpl.name} »` : "Création" });
  await syncActivationExpenses(id);
  const resp = ident.responsibleId ?? user.id;
  if (resp !== user.id) await notify([resp], { type: "ACTIVATION_ASSIGNED", title: `Activation à piloter : ${ident.name}`, body: `Par ${user.name}, prévue le ${fmtDate(ident.date)}.`, href: `${BASE}/${id}`, entityType: "activation", entityId: id }, { except: user.id });
  return id;
}

/* ------------------------------- Modification ------------------------------- */

export async function saveActivation(formData: FormData) {
  const user = await requireActivationPermission("edit");
  const id = str(formData, "id");
  if (!isUuid(id)) return;
  const cur = await assertScope(id);
  const ident = await identityFrom(formData);
  if (!ident.name || !ident.date) throw new Error("Le nom et la date sont obligatoires.");
  const brandIds = uuids(formData, "brandIds");
  await assertBrands(brandIds);
  await db.update(activations).set({ ...ident, name: ident.name, date: ident.date, updatedAt: new Date() }).where(eq(activations.id, id));
  await setLinks(id, formData);
  // Les lignes budgétaires sans marque explicite suivent la marque principale.
  await db.update(activationBudgetLines).set({ brandId: brandIds[0] ?? null }).where(and(eq(activationBudgetLines.activationId, id), sql`${activationBudgetLines.brandId} is null or ${activationBudgetLines.brandId} = ${cur.brandId ?? "00000000-0000-0000-0000-000000000000"}::uuid`));
  await syncActivationExpenses(id);
  const refs = await activationRefs();
  const st = refs.statuses.find((s) => s.key === cur.status);
  await syncPilotTask({ id, name: ident.name, brandId: brandIds[0] ?? null, responsibleId: ident.responsibleId, createdById: cur.createdById, date: ident.date, prepDate: ident.prepDate }, !!st?.isValidated && !st.isDone);
  if (ident.responsibleId && ident.responsibleId !== cur.responsibleId) {
    await notify([ident.responsibleId], { type: "ACTIVATION_ASSIGNED", title: `Activation à piloter : ${ident.name}`, body: `Par ${user.name}, prévue le ${fmtDate(ident.date)}.`, href: `${BASE}/${id}`, entityType: "activation", entityId: id }, { except: user.id });
  }
  revalidate(id);
}

/** Duplication : même type, autre ville et/ou date. Lignes prévues et checklist copiées (non cochées), résultats et fichiers non. */
export async function duplicateActivation(formData: FormData) {
  const user = await requireActivationPermission("create");
  const srcId = str(formData, "id");
  if (!isUuid(srcId)) return;
  const src = await assertScope(srcId);
  const date = str(formData, "date"); const city = str(formData, "city");
  const newDate = isDate(date) ? date : src.date;
  const delta = Math.round((new Date(newDate + "T12:00:00Z").getTime() - new Date(src.date + "T12:00:00Z").getTime()) / 86400000);
  const status = await defaultActivationStatusKey();
  const [row] = await db.insert(activations).values({
    name: city && city !== src.city ? `${src.name} — ${city}` : `${src.name} (copie)`, type: src.type, status,
    date: newDate, endDate: src.endDate ? shiftIso(src.endDate, delta) : null, prepDate: src.prepDate ? shiftIso(src.prepDate, delta) : null,
    objectiveKey: src.objectiveKey, targetKey: src.targetKey, description: src.description, notes: src.notes,
    city: city ?? src.city, place: city && city !== src.city ? null : src.place,
    responsibleId: src.responsibleId, validatorId: src.validatorId, campaignId: src.campaignId, templateId: src.templateId,
    brandId: src.brandId, productId: src.productId, clientId: city && city !== src.city ? null : src.clientId, createdById: user.id,
  }).returning({ id: activations.id });
  const id = row.id;
  await db.transaction(async (tx) => {
    if (src.brandIds.length) await tx.insert(activationBrands).values(src.brandIds.map((brandId) => ({ activationId: id, brandId })));
    if (src.productIds.length) await tx.insert(activationProducts).values(src.productIds.map((productId) => ({ activationId: id, productId })));
    if (src.clientIds.length && !(city && city !== src.city)) await tx.insert(activationClients).values(src.clientIds.map((clientId) => ({ activationId: id, clientId })));
    if (src.contributorIds.length) await tx.insert(activationContributors).values(src.contributorIds.map((userId) => ({ activationId: id, userId })));
    await tx.execute(sql`insert into activation_budget_lines (activation_id, cost_item_key, brand_id, label, planned, sort, notes)
      select ${id}::uuid, cost_item_key, brand_id, label, planned, sort, notes from activation_budget_lines where activation_id = ${srcId}::uuid`);
    await tx.execute(sql`insert into activation_checklist_items (activation_id, label, sort, assignee_id)
      select ${id}::uuid, label, sort, assignee_id from activation_checklist_items where activation_id = ${srcId}::uuid`);
    await tx.insert(activationStatusHistory).values({ activationId: id, fromStatus: null, toStatus: status, userId: user.id, comment: `Dupliquée depuis « ${src.name} »` });
  });
  await syncActivationExpenses(id);
  revalidate(id);
  redirect(`${BASE}/${id}`);
}

/** Suppression définitive : réservée à « Valider ». Le reflet budgétaire part avec (FK en « set null » sinon). */
export async function deleteActivationHard(formData: FormData) {
  await requireActivationPermission("validate");
  const id = str(formData, "id");
  if (!isUuid(id)) return;
  await assertScope(id);
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from marketing_expenses where activation_id = ${id}::uuid and activation_ref is not null`);
    await tx.execute(sql`update tasks set status = 'CANCELLED' where entity_type = 'activation' and entity_id = ${id}::uuid and status in ('TODO','IN_PROGRESS')`);
    await tx.delete(activations).where(eq(activations.id, id));
  });
  revalidate();
  redirect(BASE);
}

/* -------------------------------- Workflow -------------------------------- */

/** Changement de statut : toute la logique est dans `transitionActivation()`. */
export async function changeActivationStatus(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const user = await requireActivationPermission("edit");
  const id = str(formData, "id"); const to = str(formData, "to");
  if (!isUuid(id) || !to) return { ok: false, error: "Paramètres invalides." };
  await assertScope(id);
  const res = await transitionActivation(id, to, user, str(formData, "comment"));
  if (!res.ok) return { ok: false, error: res.reason };
  revalidate(id);
  const back = str(formData, "redirectTo");
  if (back) redirect(back);
  return { ok: true };
}

export async function addActivationComment(formData: FormData) {
  const user = await requireActivationAccess();
  const id = str(formData, "activationId"); const body = str(formData, "body");
  if (!isUuid(id) || !body) return;
  const a = await assertScope(id);
  await db.insert(activationComments).values({ activationId: id, userId: user.id, body });
  await notify([a.responsibleId, a.validatorId, a.createdById, ...a.contributorIds], { type: "COMMENT", title: `Commentaire : ${a.name}`, body: `${user.name} : ${body.slice(0, 140)}`, href: `${BASE}/${id}`, entityType: "activation", entityId: id }, { except: user.id });
  revalidate(id);
}

/* -------------------------------- Résultats -------------------------------- */

/** Saisie post-activation légère. Rien n'est obligatoire ; `results_at` marque qu'une saisie a eu lieu. */
export async function saveResults(formData: FormData) {
  await requireActivationPermission("edit");
  const id = str(formData, "id");
  if (!isUuid(id)) return;
  await assertScope(id);
  const values = {
    participants: int(formData, "participants"), leads: int(formData, "leads"), samples: int(formData, "samples"), newClients: int(formData, "newClients"),
    pharmaciesReached: int(formData, "pharmaciesReached"), ordersOnSite: int(formData, "ordersOnSite"), ordersAmount: num(formData, "ordersAmount") == null ? null : String(num(formData, "ordersAmount")),
    pressMentions: int(formData, "pressMentions"), attributedRevenue: num(formData, "attributedRevenue") == null ? null : String(num(formData, "attributedRevenue")),
    results: str(formData, "results"), publishedLink: str(formData, "publishedLink"),
  };
  const any = Object.values(values).some((v) => v !== null);
  await db.update(activations).set({ ...values, resultsAt: any ? new Date() : null, updatedAt: new Date() }).where(eq(activations.id, id));
  revalidate(id);
}

/* --------------------------------- Budget --------------------------------- */

export async function saveBudgetLine(formData: FormData) {
  await requireActivationPermission("edit");
  const activationId = str(formData, "activationId"); const lineId = str(formData, "lineId");
  if (!isUuid(activationId)) return;
  const a = await assertScope(activationId);
  const refs = await activationRefs();
  const costItemKey = str(formData, "costItemKey");
  if (!costItemKey || !refs.costItems.some((c) => c.key === costItemKey)) throw new Error("Poste budgétaire inconnu.");
  const brandId = str(formData, "brandId");
  const values = {
    costItemKey, label: str(formData, "label") ?? refs.costItems.find((c) => c.key === costItemKey)!.label,
    brandId: isUuid(brandId) ? brandId : a.brandId,
    planned: String(num(formData, "planned") ?? 0), committed: String(num(formData, "committed") ?? 0), spent: String(num(formData, "spent") ?? 0),
    supplier: str(formData, "supplier"), quoteRef: str(formData, "quoteRef"), invoiceRef: str(formData, "invoiceRef"),
    date: isDate(str(formData, "date")) ? str(formData, "date") : null, notes: str(formData, "notes"), updatedAt: new Date(),
  };
  if (isUuid(lineId)) await db.update(activationBudgetLines).set(values).where(and(eq(activationBudgetLines.id, lineId), eq(activationBudgetLines.activationId, activationId)));
  else {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(activationBudgetLines).where(eq(activationBudgetLines.activationId, activationId));
    await db.insert(activationBudgetLines).values({ ...values, activationId, sort: n });
  }
  await syncActivationExpenses(activationId);
  revalidate(activationId);
}

export async function deleteBudgetLine(formData: FormData) {
  await requireActivationPermission("edit");
  const activationId = str(formData, "activationId"); const lineId = str(formData, "lineId");
  if (!isUuid(activationId) || !isUuid(lineId)) return;
  await assertScope(activationId);
  await db.delete(activationBudgetLines).where(and(eq(activationBudgetLines.id, lineId), eq(activationBudgetLines.activationId, activationId)));
  await renumberBudgetLines(activationId);
  await syncActivationExpenses(activationId);
  revalidate(activationId);
}

/* -------------------------------- Checklist -------------------------------- */

export async function addChecklistItem(formData: FormData) {
  await requireActivationPermission("edit");
  const activationId = str(formData, "activationId"); const label = str(formData, "label");
  if (!isUuid(activationId) || !label) return;
  await assertScope(activationId);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(activationChecklistItems).where(eq(activationChecklistItems.activationId, activationId));
  const assigneeId = str(formData, "assigneeId"); const dueDate = str(formData, "dueDate");
  await db.insert(activationChecklistItems).values({ activationId, label, sort: n, assigneeId: isUuid(assigneeId) ? assigneeId : null, dueDate: isDate(dueDate) ? dueDate : null });
  revalidate(activationId);
}

export async function toggleChecklistItem(formData: FormData) {
  const user = await requireActivationPermission("edit");
  const activationId = str(formData, "activationId"); const itemId = str(formData, "itemId");
  if (!isUuid(activationId) || !isUuid(itemId)) return;
  await assertScope(activationId);
  const [cur] = await db.select({ done: activationChecklistItems.done }).from(activationChecklistItems).where(and(eq(activationChecklistItems.id, itemId), eq(activationChecklistItems.activationId, activationId)));
  if (!cur) return;
  await db.update(activationChecklistItems).set(cur.done ? { done: false, doneAt: null, doneById: null } : { done: true, doneAt: new Date(), doneById: user.id }).where(eq(activationChecklistItems.id, itemId));
  revalidate(activationId);
}

export async function deleteChecklistItem(formData: FormData) {
  await requireActivationPermission("edit");
  const activationId = str(formData, "activationId"); const itemId = str(formData, "itemId");
  if (!isUuid(activationId) || !isUuid(itemId)) return;
  await assertScope(activationId);
  await db.delete(activationChecklistItems).where(and(eq(activationChecklistItems.id, itemId), eq(activationChecklistItems.activationId, activationId)));
  revalidate(activationId);
}

/* --------------------------------- Fichiers --------------------------------- */

export async function beginActivationAsset(input: { ownerId: string; kind: string; name: string; size: number; mime: string }) {
  const user = await requireActivationPermission("edit");
  if (!isUuid(input.ownerId)) throw new Error("Activation introuvable.");
  await assertScope(input.ownerId);
  const kind = (ASSET_KINDS as readonly string[]).includes(input.kind) ? (input.kind as AssetKind) : "PHOTO";
  return beginAsset({ owner: { activationId: input.ownerId }, kind, name: input.name, mime: input.mime, size: input.size, uploadedById: user.id });
}

export async function appendActivationChunk(formData: FormData) {
  await requireActivationPermission("edit");
  const id = str(formData, "id"); const chunk = formData.get("chunk");
  if (!isUuid(id) || !(chunk instanceof Blob)) throw new Error("Morceau invalide.");
  const meta = await assetMeta(id);
  if (!meta?.activationId) throw new Error("Fichier introuvable.");
  return appendChunk(id, Buffer.from(await chunk.arrayBuffer()));
}

export async function finishActivationAsset(input: { assetId: string }) {
  await requireActivationPermission("edit");
  const meta = await assetMeta(input.assetId);
  if (!meta?.activationId) return;
  await db.update(activations).set({ updatedAt: new Date() }).where(eq(activations.id, meta.activationId));
  revalidate(meta.activationId);
}

export async function deleteActivationAsset(formData: FormData) {
  await requireActivationPermission("edit");
  const id = str(formData, "id");
  if (!isUuid(id)) return;
  const meta = await assetMeta(id);
  if (!meta?.activationId) return;
  await assertScope(meta.activationId);
  const [row] = await db.select({ id: contentAssets.id }).from(contentAssets).where(eq(contentAssets.id, id));
  if (row) await deleteAsset(id);
  revalidate(meta.activationId);
}

/* ------------------------------ Glisser-déposer ------------------------------ */

/** Calendrier : nouvelle date de début ; la fin et la préparation suivent du même décalage. */
export async function moveActivation(input: { id: string; date: string }): Promise<{ ok: boolean; error?: string }> {
  await requireActivationPermission("edit");
  if (!isUuid(input.id) || !isDate(input.date)) return { ok: false, error: "Paramètres invalides." };
  const a = await assertScope(input.id);
  const delta = Math.round((new Date(input.date + "T12:00:00Z").getTime() - new Date(a.date + "T12:00:00Z").getTime()) / 86400000);
  if (!delta) return { ok: true };
  await db.update(activations).set({
    date: input.date, endDate: a.endDate ? shiftIso(a.endDate, delta) : null, prepDate: a.prepDate ? shiftIso(a.prepDate, delta) : null, updatedAt: new Date(),
  }).where(eq(activations.id, input.id));
  await db.update(activationChecklistItems).set({ dueDate: sql`due_date + ${delta}::int` }).where(and(eq(activationChecklistItems.activationId, input.id), sql`due_date is not null`));
  const refs = await activationRefs();
  const st = refs.statuses.find((s) => s.key === a.status);
  await syncPilotTask({ id: a.id, name: a.name, brandId: a.brandId, responsibleId: a.responsibleId, createdById: a.createdById, date: input.date, prepDate: a.prepDate ? shiftIso(a.prepDate, delta) : null }, !!st?.isValidated && !st.isDone);
  revalidate(input.id);
  return { ok: true };
}
