"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { importFiles, imports, sales, stockSnapshots } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { parseSheet } from "@/lib/import/parse";
import { runImport } from "@/lib/import/run";
import { FIELDS, missingRequired, type ImportType } from "@/lib/import/fields";
import { appendUploadChunk, createUploadFile, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES, purgeStaleUploads } from "@/lib/import/upload";

/**
 * Étape 1 : téléversement par morceaux (voir src/lib/chunked-upload.ts) → stockage temporaire en base
 * → écran de mapping. Le découpage contourne la limite de taille des requêtes des hébergeurs serverless.
 */
export async function beginImportUpload(name: string, size: number) {
  const user = await requireAccess("imports");
  if (size <= 0) throw new Error("Fichier vide.");
  if (size > MAX_UPLOAD_BYTES) throw new Error("Fichier trop volumineux (max 25 Mo).");
  await purgeStaleUploads().catch(() => {});
  const id = await createUploadFile(name, user.id);
  return { id, chunkBytes: UPLOAD_CHUNK_BYTES };
}

export async function appendImportChunk(formData: FormData) {
  await requireAccess("imports");
  const received = await appendUploadChunk(formData);
  return { received };
}

/** Étape 2 : mapping validé → import. */
export async function runImportAction(formData: FormData) {
  const user = await requireAccess("imports");
  const fileId = String(formData.get("fileId") ?? "");
  const type = String(formData.get("type") ?? "SALES") as ImportType;
  const sheet = String(formData.get("sheet") ?? "") || undefined;
  const headerRow = Number(formData.get("headerRow") ?? -1);
  const file = await db.query.importFiles.findFirst({ where: eq(importFiles.id, fileId) });
  if (!file) redirect("/imports?error=expire");
  const mapping: Record<string, string> = {};
  for (const f of FIELDS[type]) {
    const v = String(formData.get(`map_${f.key}`) ?? "");
    if (v) mapping[f.key] = v;
  }
  const missing = missingRequired(type, mapping);
  if (missing.length) redirect(`/imports/nouveau?file=${fileId}&type=${type}${sheet ? `&sheet=${encodeURIComponent(sheet)}` : ""}&error=${encodeURIComponent("Champs requis : " + missing.join(", "))}`);
  const parsed = parseSheet(file.data, sheet, { headerRow: headerRow >= 0 ? headerRow : undefined });
  const summary = await runImport({
    type, rows: parsed.rows, mapping, fileName: `${file.name}${parsed.name ? " · " + parsed.name : ""}`, userId: user.id,
    options: {
      year: Number(formData.get("year")) || undefined,
      stockDate: String(formData.get("stockDate") ?? "") || undefined,
      createUnknown: formData.get("createUnknown") !== "off",
      // Matrices (animations, objectifs par ville) : les colonnes non mappées portent les données.
      headers: parsed.headers,
      columnGroups: parsed.groups,
    },
  });
  await db.delete(importFiles).where(eq(importFiles.id, fileId));
  revalidatePath("/imports"); revalidatePath("/"); revalidatePath("/produits"); revalidatePath("/clients"); revalidatePath("/stock"); revalidatePath("/terrain"); revalidatePath("/reglementaire");
  redirect(`/imports/${summary.importId}`);
}

/** Annule un import : supprime les lignes de vente / stock qu'il a créées (les entités créées sont conservées). */
export async function rollbackImport(formData: FormData) {
  await requireAccess("imports");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(sales).where(eq(sales.importId, id));
  await db.delete(stockSnapshots).where(eq(stockSnapshots.importId, id));
  await db.update(imports).set({ status: "FAILED", warnings: sql`array_to_json(array_append(array(select json_array_elements_text(warnings)), 'Import annulé : lignes supprimées.'))::jsonb` }).where(eq(imports.id, id));
  revalidatePath("/imports"); revalidatePath("/");
  redirect("/imports");
}
