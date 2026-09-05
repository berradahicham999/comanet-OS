import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { importFiles } from "@/db/schema";

/** Taille max d'un fichier importé (Excel / CSV). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/**
 * Taille d'un morceau envoyé par le navigateur (octets bruts). Les hébergeurs serverless limitent
 * le corps d'une requête (Vercel : 4,5 Mo) ; 1,5 Mo bruts ≈ 2 Mo en base64.
 */
export const UPLOAD_CHUNK_BYTES = 1.5 * 1024 * 1024;

/** Crée un fichier vide en base ; les morceaux sont ensuite ajoutés avec `appendUploadChunk`. */
export async function createUploadFile(name: string, userId: string | null) {
  const [row] = await db.insert(importFiles).values({ name: name.slice(0, 200), data: Buffer.alloc(0), userId }).returning({ id: importFiles.id });
  return row.id;
}

/** Ajoute un morceau (`formData` : `id` + `chunk` (Blob)) et renvoie la taille totale reçue. */
export async function appendUploadChunk(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const chunk = formData.get("chunk");
  if (!id || !(chunk instanceof Blob)) throw new Error("Morceau invalide.");
  const buf = Buffer.from(await chunk.arrayBuffer());
  if (!buf.length) throw new Error("Morceau vide.");
  const size = ((await db.execute(sql`select octet_length(data)::int as n from import_files where id = ${id}`)).rows[0] as { n: number } | undefined)?.n;
  if (size === undefined) throw new Error("Fichier introuvable (expiré ?)");
  if (size + buf.length > MAX_UPLOAD_BYTES) {
    await db.delete(importFiles).where(eq(importFiles.id, id));
    throw new Error("Fichier trop volumineux (max 25 Mo)");
  }
  await db.execute(sql`update import_files set data = data || ${buf}::bytea where id = ${id}`);
  return size + buf.length;
}

/** Nettoie les fichiers temporaires de plus de 24 h. */
export async function purgeStaleUploads() {
  await db.execute(sql`delete from import_files where created_at < now() - interval '24 hours'`);
}
