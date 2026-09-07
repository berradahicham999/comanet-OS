import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentAssets } from "@/db/schema";

/**
 * Stockage des livrables et références d'un contenu.
 *
 * Choix actuel : le fichier est dans Postgres (`content_assets.data`, bytea), comme les
 * fichiers d'import — aucune variable d'environnement supplémentaire. Ce module est le
 * seul à lire ou écrire `data` : passer à un stockage objet (Supabase Storage) plus tard
 * ne touche que ce fichier.
 */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const ASSET_KINDS = ["LIVRABLE", "REFERENCE"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export type AssetMeta = { id: string; contentId: string; kind: string; name: string; mime: string; size: number; version: number; uploadedById: string | null; uploadedBy: string | null; createdAt: Date };

export async function listAssets(contentId: string): Promise<AssetMeta[]> {
  const r = await db.execute<AssetMeta>(sql`
    select a.id, a.content_id as "contentId", a.kind, a.name, a.mime, a.size, a.version, a.uploaded_by_id as "uploadedById", u.name as "uploadedBy", a.created_at as "createdAt"
    from content_assets a left join users u on u.id = a.uploaded_by_id
    where a.content_id = ${contentId}::uuid order by a.kind, a.version desc, a.created_at desc`);
  return r.rows;
}

/** Ajoute une version : la version = 1 + la plus haute version du même type pour ce contenu. */
export async function storeAsset(input: { contentId: string; kind: AssetKind; name: string; mime: string; data: Buffer; uploadedById: string }) {
  if (input.data.byteLength > MAX_ASSET_BYTES) throw new Error(`Fichier trop volumineux (${Math.round(input.data.byteLength / 1048576)} Mo, maximum 25 Mo).`);
  const last = await db.select({ v: sql<number>`coalesce(max(version), 0)::int` }).from(contentAssets).where(and(eq(contentAssets.contentId, input.contentId), eq(contentAssets.kind, input.kind)));
  const [row] = await db.insert(contentAssets).values({
    contentId: input.contentId, kind: input.kind, name: input.name, mime: input.mime || "application/octet-stream",
    size: input.data.byteLength, version: (last[0]?.v ?? 0) + 1, data: input.data, uploadedById: input.uploadedById,
  }).returning({ id: contentAssets.id, version: contentAssets.version });
  return row;
}

export async function readAsset(id: string): Promise<{ name: string; mime: string; data: Buffer; contentId: string } | null> {
  const rows = await db.select({ name: contentAssets.name, mime: contentAssets.mime, data: contentAssets.data, contentId: contentAssets.contentId }).from(contentAssets).where(eq(contentAssets.id, id));
  const r = rows[0];
  return r?.data ? { name: r.name, mime: r.mime, data: r.data, contentId: r.contentId } : null;
}

export async function deleteAsset(id: string) {
  await db.delete(contentAssets).where(eq(contentAssets.id, id));
}

/** Dernière version du livrable, pour l'aperçu de la file de validation. */
export async function latestDeliverable(contentId: string): Promise<AssetMeta | null> {
  const all = await listAssets(contentId);
  return all.find((a) => a.kind === "LIVRABLE") ?? null;
}

export function isPreviewable(mime: string) {
  return mime.startsWith("image/") || mime.startsWith("video/") || mime === "application/pdf";
}

