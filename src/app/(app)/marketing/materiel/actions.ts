"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems } from "@/db/schema";
import { requireActivationPermission } from "@/lib/activations/access";
import { activationRefs } from "@/lib/activations/refs";
import { recordMovement, consumeMaterial, removeMaterial, type MovementType, MOVEMENT_TYPES } from "@/lib/activations/inventory";
import { beginAsset, appendChunk, deleteAsset, assetMeta } from "@/lib/content/assets";
import { iso, today } from "@/lib/format";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
const int = (fd: FormData, k: string) => { const v = str(fd, k); if (v === null) return null; const n = Number(v.replace(/\s/g, "")); return Number.isFinite(n) ? Math.round(n) : null; };
const num = (fd: FormData, k: string) => { const v = str(fd, k); if (v === null) return null; const n = Number(v.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const isUuid = (v: string | null | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const BASE = "/marketing/materiel";

function revalidate(itemId?: string | null, activationId?: string | null) {
  revalidatePath(BASE); revalidatePath("/marketing/budgets"); revalidatePath("/actions");
  if (itemId) revalidatePath(`${BASE}/${itemId}`);
  if (activationId) revalidatePath(`/marketing/activations/${activationId}`);
}

/* -------------------------------- Articles -------------------------------- */

export async function saveInventoryItem(formData: FormData) {
  await requireActivationPermission("create");
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!name) throw new Error("Le nom de l'article est obligatoire.");
  const refs = await activationRefs();
  const categoryKey = str(formData, "categoryKey");
  if (!categoryKey || !refs.inventoryCategories.some((c) => c.key === categoryKey)) throw new Error("Catégorie inconnue.");
  const brandId = str(formData, "brandId"); const productId = str(formData, "productId");
  const values = {
    name, sku: str(formData, "sku"), categoryKey, brandId: isUuid(brandId) ? brandId : null, productId: isUuid(productId) ? productId : null,
    unit: str(formData, "unit") ?? "pièce", unitCost: String(num(formData, "unitCost") ?? 0), alertThreshold: int(formData, "alertThreshold"),
    location: str(formData, "location"), notes: str(formData, "notes"), active: formData.get("active") === null ? true : formData.get("active") === "on", updatedAt: new Date(),
  };
  if (isUuid(id)) {
    await db.update(inventoryItems).set(values).where(eq(inventoryItems.id, id));
    revalidate(id);
    return;
  }
  const dup = (await db.execute<{ id: string }>(sql`select id from inventory_items where lower(name) = lower(${name}) and coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(${values.brandId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`)).rows[0];
  if (dup) redirect(`${BASE}/${dup.id}?erreur=${encodeURIComponent("Cet article existe déjà pour cette marque : le voici.")}`);
  const [row] = await db.insert(inventoryItems).values({ ...values, active: true }).returning({ id: inventoryItems.id });
  const initial = int(formData, "initialStock");
  if (initial && initial > 0) await recordMovement({ itemId: row.id, type: "ENTREE", quantity: initial, unitCost: num(formData, "unitCost"), date: iso(today()), reason: "Stock initial", createdById: (await requireActivationPermission("create")).id });
  revalidate(row.id);
  redirect(`${BASE}/${row.id}`);
}

/* ------------------------------- Mouvements ------------------------------- */

/** Entrée (réception), sortie libre (dotation commercial, envoi client) ou ajustement d'inventaire. */
export async function addMovement(formData: FormData) {
  const user = await requireActivationPermission("edit");
  const itemId = str(formData, "itemId"); const type = str(formData, "type") as MovementType | null;
  if (!isUuid(itemId) || !type || !MOVEMENT_TYPES.includes(type)) throw new Error("Paramètres invalides.");
  const qtyRaw = int(formData, "quantity");
  if (qtyRaw === null || qtyRaw === 0) throw new Error("Indiquez une quantité.");
  // Le formulaire saisit une quantité positive ; le signe vient du type (l'ajustement porte le sien).
  const quantity = type === "SORTIE" ? -Math.abs(qtyRaw) : type === "ENTREE" ? Math.abs(qtyRaw) : qtyRaw;
  const date = str(formData, "date"); const clientId = str(formData, "clientId");
  await recordMovement({ itemId, type, quantity, unitCost: num(formData, "unitCost"), date: isDate(date) ? date : iso(today()), reason: str(formData, "reason"), clientId: isUuid(clientId) ? clientId : null, createdById: user.id });
  revalidate(itemId);
}

/* --------------------- Consommation par une activation --------------------- */

export async function consumeForActivation(formData: FormData) {
  const user = await requireActivationPermission("edit");
  const activationId = str(formData, "activationId"); const itemId = str(formData, "itemId"); const quantity = int(formData, "quantity");
  if (!isUuid(activationId) || !isUuid(itemId) || !quantity || quantity <= 0) throw new Error("Choisissez un article et une quantité.");
  const date = str(formData, "date");
  try {
    await consumeMaterial({ activationId, itemId, quantity, date: isDate(date) ? date : iso(today()), userId: user.id });
  } catch (e) {
    redirect(`/marketing/activations/${activationId}?erreur=${encodeURIComponent(e instanceof Error ? e.message : "Sortie refusée.")}`);
  }
  revalidate(itemId, activationId);
}

export async function returnFromActivation(formData: FormData) {
  const user = await requireActivationPermission("edit");
  const activationId = str(formData, "activationId"); const materialId = str(formData, "materialId");
  if (!isUuid(activationId) || !isUuid(materialId)) return;
  await removeMaterial({ activationId, materialId, date: iso(today()), userId: user.id });
  revalidate(null, activationId);
}

/* --------------------------------- Photo --------------------------------- */

export async function beginItemAsset(input: { ownerId: string; kind: string; name: string; size: number; mime: string }) {
  const user = await requireActivationPermission("edit");
  if (!isUuid(input.ownerId)) throw new Error("Article introuvable.");
  return beginAsset({ owner: { inventoryItemId: input.ownerId }, kind: "PHOTO", name: input.name, mime: input.mime, size: input.size, uploadedById: user.id });
}
export async function appendItemChunk(formData: FormData) {
  await requireActivationPermission("edit");
  const id = str(formData, "id"); const chunk = formData.get("chunk");
  if (!isUuid(id) || !(chunk instanceof Blob)) throw new Error("Morceau invalide.");
  const meta = await assetMeta(id);
  if (!meta?.inventoryItemId) throw new Error("Fichier introuvable.");
  return appendChunk(id, Buffer.from(await chunk.arrayBuffer()));
}
export async function finishItemAsset(input: { assetId: string }) {
  await requireActivationPermission("edit");
  const meta = await assetMeta(input.assetId);
  if (meta?.inventoryItemId) revalidate(meta.inventoryItemId);
}
export async function deleteItemAsset(formData: FormData) {
  await requireActivationPermission("edit");
  const id = str(formData, "id");
  if (!isUuid(id)) return;
  const meta = await assetMeta(id);
  if (!meta?.inventoryItemId) return;
  await deleteAsset(id);
  revalidate(meta.inventoryItemId);
}
