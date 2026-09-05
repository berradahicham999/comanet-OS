"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { importFiles, imports } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { parseSheet } from "@/lib/import/parse";
import { runImport } from "@/lib/import/run";
import { FIELDS, missingRequired, type ImportType } from "@/lib/import/fields";
import { appendUploadChunk, createUploadFile, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES, purgeStaleUploads } from "@/lib/import/upload";
import { isReversible, rollbackRows } from "@/lib/import/rollback";

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
      adPlatform: String(formData.get("adPlatform") ?? "") || undefined,
      createUnknown: formData.get("createUnknown") !== "off",
      // Matrices (animations, objectifs par ville) : les colonnes non mappées portent les données.
      headers: parsed.headers,
      columnGroups: parsed.groups,
    },
  });
  await db.delete(importFiles).where(eq(importFiles.id, fileId));
  revalidatePath("/imports"); revalidatePath("/"); revalidatePath("/produits"); revalidatePath("/clients"); revalidatePath("/stock"); revalidatePath("/terrain"); revalidatePath("/reglementaire"); revalidatePath("/marketing"); revalidatePath("/marketing/ads");
  redirect(`/imports/${summary.importId}`);
}

/**
 * Annule un import : supprime les enregistrements qu'il a créés (ventes, photos de stock,
 * journées d'animation, lignes de régie). Les produits, clients et marques créés au passage
 * sont conservés — ils peuvent être utilisés ailleurs.
 */
export async function rollbackImport(formData: FormData) {
  const user = await requireAccess("imports");
  if (user.role !== "ADMIN") redirect("/imports?error=" + encodeURIComponent("Seul un administrateur peut annuler un import."));
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const imp = await db.query.imports.findFirst({ where: eq(imports.id, id) });
  if (!imp) redirect("/imports?error=" + encodeURIComponent("Import introuvable."));
  if (!isReversible(imp.type)) redirect(`/imports/${id}?error=` + encodeURIComponent("Ce type d'import ne peut pas être annulé."));

  let removed = 0;
  try {
    removed = await rollbackRows(id, imp.type);
  } catch (e) {
    redirect(`/imports/${id}?error=` + encodeURIComponent(`Annulation impossible : ${(e as Error).message}`));
  }
  await db
    .update(imports)
    .set({
      status: "FAILED",
      warnings: [...imp.warnings, `Import annulé le ${new Date().toLocaleDateString("fr-FR")} : ${removed} enregistrement(s) supprimé(s).`],
    })
    .where(eq(imports.id, id));

  for (const p of ["/imports", "/", "/ventes", "/stock", "/terrain", "/marketing", "/marketing/ads", "/produits", "/clients", "/actions"]) revalidatePath(p);
  redirect(`/imports?annule=${removed}`);
}
