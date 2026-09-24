import "server-only";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { contentAssets } from "@/db/schema";

/**
 * Stockage des fichiers versionnés : livrables et références d'un contenu éditorial,
 * devis / factures / photos / comptes rendus d'une activation, photo d'un article d'inventaire,
 * logo et cachet de la société (imprimés sur les pièces de la gestion commerciale).
 *
 * Choix actuel : le fichier est dans Postgres (`content_assets.data`, bytea), comme les
 * fichiers d'import — aucune variable d'environnement supplémentaire. Ce module est le
 * seul à lire ou écrire `data` : passer à un stockage objet (Supabase Storage) plus tard
 * ne touche que ce fichier.
 *
 * Un fichier appartient à exactement un propriétaire (`AssetOwner`). Les appels historiques
 * du planning passent l'identifiant du contenu en chaîne : ils restent valides.
 */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const ASSET_KINDS = ["LIVRABLE", "REFERENCE", "DEVIS", "FACTURE", "VISUEL", "PHOTO", "COMPTE_RENDU", "PIECE"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  LIVRABLE: "Livrable", REFERENCE: "Référence", DEVIS: "Devis", FACTURE: "Facture", VISUEL: "Visuel", PHOTO: "Photo", COMPTE_RENDU: "Compte rendu", PIECE: "PDF de la pièce",
};

export type AssetOwner = { contentId: string } | { activationId: string } | { inventoryItemId: string } | { companySlot: CompanySlot } | { salesDocumentId: string } | { purchaseDocumentId: string };

/** Fichiers de la société imprimés sur les pièces (gestion commerciale). Jamais dans le dépôt de code : le cachet signé y serait public. */
export const COMPANY_SLOTS = ["LOGO", "CACHET"] as const;
export type CompanySlot = (typeof COMPANY_SLOTS)[number];

export type AssetMeta = {
  id: string; contentId: string | null; activationId: string | null; inventoryItemId: string | null; companySlot: string | null; salesDocumentId: string | null; purchaseDocumentId: string | null;
  kind: string; name: string; mime: string; size: number; version: number; uploadedById: string | null; uploadedBy: string | null; createdAt: Date;
};

function ownerOf(owner: AssetOwner | string): AssetOwner {
  return typeof owner === "string" ? { contentId: owner } : owner;
}
function ownerColumns(owner: AssetOwner): { contentId: string | null; activationId: string | null; inventoryItemId: string | null; companySlot: string | null; salesDocumentId: string | null; purchaseDocumentId: string | null } {
  return {
    contentId: "contentId" in owner ? owner.contentId : null,
    activationId: "activationId" in owner ? owner.activationId : null,
    inventoryItemId: "inventoryItemId" in owner ? owner.inventoryItemId : null,
    companySlot: "companySlot" in owner ? owner.companySlot : null,
    salesDocumentId: "salesDocumentId" in owner ? owner.salesDocumentId : null,
    purchaseDocumentId: "purchaseDocumentId" in owner ? owner.purchaseDocumentId : null,
  };
}
function ownerWhere(owner: AssetOwner): SQL {
  if ("contentId" in owner) return sql`a.content_id = ${owner.contentId}::uuid`;
  if ("activationId" in owner) return sql`a.activation_id = ${owner.activationId}::uuid`;
  if ("companySlot" in owner) return sql`a.company_slot = ${owner.companySlot}`;
  if ("salesDocumentId" in owner) return sql`a.sales_document_id = ${owner.salesDocumentId}::uuid`;
  if ("purchaseDocumentId" in owner) return sql`a.purchase_document_id = ${owner.purchaseDocumentId}::uuid`;
  return sql`a.inventory_item_id = ${owner.inventoryItemId}::uuid`;
}
function ownerCondition(owner: AssetOwner) {
  if ("contentId" in owner) return eq(contentAssets.contentId, owner.contentId);
  if ("activationId" in owner) return eq(contentAssets.activationId, owner.activationId);
  if ("companySlot" in owner) return eq(contentAssets.companySlot, owner.companySlot);
  if ("salesDocumentId" in owner) return eq(contentAssets.salesDocumentId, owner.salesDocumentId);
  if ("purchaseDocumentId" in owner) return eq(contentAssets.purchaseDocumentId, owner.purchaseDocumentId);
  return eq(contentAssets.inventoryItemId, owner.inventoryItemId);
}

export async function listAssets(owner: AssetOwner | string): Promise<AssetMeta[]> {
  const r = await db.execute<AssetMeta>(sql`
    select a.id, a.content_id as "contentId", a.activation_id as "activationId", a.inventory_item_id as "inventoryItemId", a.company_slot as "companySlot", a.sales_document_id as "salesDocumentId", a.purchase_document_id as "purchaseDocumentId",
      a.kind, a.name, a.mime, a.size, a.version, a.uploaded_by_id as "uploadedById", u.name as "uploadedBy", a.created_at as "createdAt"
    from content_assets a left join users u on u.id = a.uploaded_by_id
    where ${ownerWhere(ownerOf(owner))} order by a.kind, a.version desc, a.created_at desc`);
  return r.rows;
}

/** Version suivante pour ce propriétaire et ce type : 1 + la plus haute existante. */
export async function nextVersion(owner: AssetOwner | string, kind: string): Promise<number> {
  const last = await db.select({ v: sql<number>`coalesce(max(version), 0)::int` }).from(contentAssets).where(and(ownerCondition(ownerOf(owner)), eq(contentAssets.kind, kind)));
  return (last[0]?.v ?? 0) + 1;
}

/** Ajoute une version complète (fichier déjà en mémoire). */
export async function storeAsset(input: { owner: AssetOwner | string; kind: AssetKind; name: string; mime: string; data: Buffer; uploadedById: string | null }) {
  if (input.data.byteLength > MAX_ASSET_BYTES) throw new Error(`Fichier trop volumineux (${Math.round(input.data.byteLength / 1048576)} Mo, maximum 25 Mo).`);
  const owner = ownerOf(input.owner);
  const [row] = await db.insert(contentAssets).values({
    ...ownerColumns(owner), kind: input.kind, name: input.name, mime: input.mime || "application/octet-stream",
    size: input.data.byteLength, version: await nextVersion(owner, input.kind), data: input.data, uploadedById: input.uploadedById,
  }).returning({ id: contentAssets.id, version: contentAssets.version });
  return row;
}

/**
 * Téléversement par morceaux (server actions limitées en taille) : on crée la ligne vide,
 * puis `appendChunk()` concatène. `finish` côté appelant notifie si besoin.
 */
export async function beginAsset(input: { owner: AssetOwner | string; kind: AssetKind; name: string; mime: string; size: number; uploadedById: string }) {
  if (input.size <= 0) throw new Error("Fichier vide.");
  if (input.size > MAX_ASSET_BYTES) throw new Error("Fichier trop volumineux (max 25 Mo).");
  const owner = ownerOf(input.owner);
  const [row] = await db.insert(contentAssets).values({
    ...ownerColumns(owner), kind: input.kind, name: input.name.slice(0, 200), mime: input.mime || "application/octet-stream", size: 0,
    version: await nextVersion(owner, input.kind), data: Buffer.alloc(0), uploadedById: input.uploadedById,
  }).returning({ id: contentAssets.id });
  return { id: row.id, chunkBytes: 1.5 * 1024 * 1024 };
}

export async function appendChunk(id: string, buf: Buffer): Promise<{ received: number }> {
  const cur = (await db.execute<{ n: number }>(sql`select octet_length(data)::int as n from content_assets where id = ${id}::uuid`)).rows[0];
  if (!cur) throw new Error("Fichier introuvable.");
  if (cur.n + buf.length > MAX_ASSET_BYTES) { await deleteAsset(id); throw new Error("Fichier trop volumineux (max 25 Mo)."); }
  await db.execute(sql`update content_assets set data = data || ${buf}::bytea, size = octet_length(data || ${buf}::bytea) where id = ${id}::uuid`);
  return { received: cur.n + buf.length };
}

export async function assetMeta(id: string): Promise<AssetMeta | null> {
  const r = await db.execute<AssetMeta>(sql`
    select a.id, a.content_id as "contentId", a.activation_id as "activationId", a.inventory_item_id as "inventoryItemId", a.company_slot as "companySlot", a.sales_document_id as "salesDocumentId", a.purchase_document_id as "purchaseDocumentId",
      a.kind, a.name, a.mime, a.size, a.version, a.uploaded_by_id as "uploadedById", u.name as "uploadedBy", a.created_at as "createdAt"
    from content_assets a left join users u on u.id = a.uploaded_by_id where a.id = ${id}::uuid`);
  return r.rows[0] ?? null;
}

export async function readAsset(id: string): Promise<{ name: string; mime: string; data: Buffer; contentId: string | null; activationId: string | null; inventoryItemId: string | null; companySlot: string | null } | null> {
  const rows = await db.select({
    name: contentAssets.name, mime: contentAssets.mime, data: contentAssets.data,
    contentId: contentAssets.contentId, activationId: contentAssets.activationId, inventoryItemId: contentAssets.inventoryItemId, companySlot: contentAssets.companySlot,
  }).from(contentAssets).where(eq(contentAssets.id, id));
  const r = rows[0];
  return r?.data ? { name: r.name, mime: r.mime, data: r.data, contentId: r.contentId, activationId: r.activationId, inventoryItemId: r.inventoryItemId, companySlot: r.companySlot } : null;
}

export async function deleteAsset(id: string) {
  await db.delete(contentAssets).where(eq(contentAssets.id, id));
}

/** Dernière version du livrable, pour l'aperçu de la file de validation. */
export async function latestDeliverable(contentId: string): Promise<AssetMeta | null> {
  const all = await listAssets({ contentId });
  return all.find((a) => a.kind === "LIVRABLE") ?? null;
}

/** Dernière version d'un type donné pour un propriétaire (photo d'article, visuel d'activation…). */
export async function latestOfKind(owner: AssetOwner, kind: AssetKind): Promise<AssetMeta | null> {
  const all = await listAssets(owner);
  return all.find((a) => a.kind === kind) ?? null;
}

export function isPreviewable(mime: string) {
  return mime.startsWith("image/") || mime.startsWith("video/") || mime === "application/pdf";
}
