"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { importFiles, imports } from "@/db/schema";
import { requireAnyModule, requirePermission, getAccess } from "@/lib/access";
import { parseSheet } from "@/lib/import/parse";
import { runImport } from "@/lib/import/run";
import { FIELDS, IMPORT_MODULE, missingRequired, type ImportType } from "@/lib/import/fields";
import { appendUploadChunk, createUploadFile, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES, purgeStaleUploads } from "@/lib/import/upload";
import { isReversible, rollbackRows, rollbackOrphans } from "@/lib/import/rollback";

/**
 * Étape 1 : téléversement par morceaux (voir src/lib/chunked-upload.ts) → stockage temporaire en base
 * → écran de mapping. Le découpage contourne la limite de taille des requêtes des hébergeurs serverless.
 */
export async function beginImportUpload(name: string, size: number) {
  const user = await requireAnyModule();
  if (size <= 0) throw new Error("Fichier vide.");
  if (size > MAX_UPLOAD_BYTES) throw new Error("Fichier trop volumineux (max 25 Mo).");
  await purgeStaleUploads().catch(() => {});
  const id = await createUploadFile(name, user.id);
  return { id, chunkBytes: UPLOAD_CHUNK_BYTES };
}

export async function appendImportChunk(formData: FormData) {
  await requireAnyModule();
  const received = await appendUploadChunk(formData);
  return { received };
}

/** Étape 2 : mapping validé → import. */
export async function runImportAction(formData: FormData) {
  const fileId = String(formData.get("fileId") ?? "");
  const type = String(formData.get("type") ?? "SALES") as ImportType;
  const user = await requirePermission(IMPORT_MODULE[type], "create");
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
      warehouseKey: String(formData.get("warehouseKey") ?? "") || undefined,
      adPlatform: String(formData.get("adPlatform") ?? "") || undefined,
      createUnknown: formData.get("createUnknown") !== "off",
      // Matrices (animations, objectifs par ville) : les colonnes non mappées portent les données.
      headers: parsed.headers,
      columnGroups: parsed.groups,
    },
  });
  await db.delete(importFiles).where(eq(importFiles.id, fileId));
  revalidatePath("/imports"); revalidatePath("/"); revalidatePath("/produits"); revalidatePath("/clients"); revalidatePath("/stock"); revalidatePath("/terrain"); revalidatePath("/reglementaire"); revalidatePath("/marketing"); revalidatePath("/marketing/ads"); revalidatePath("/marketing/influence");
  redirect(`/imports/${summary.importId}`);
}

/**
 * Annule un import : supprime les enregistrements qu'il a créés (ventes, photos de stock,
 * journées d'animation, lignes de régie), puis les produits, clients et alias créés au passage
 * s'ils ne sont plus référencés nulle part. Une fiche utilisée par un autre import ou une
 * saisie est conservée. Les marques créées sont toujours conservées.
 */
export async function rollbackImport(formData: FormData) {
  const user = await requireAnyModule();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const imp = await db.query.imports.findFirst({ where: eq(imports.id, id) });
  if (!imp) redirect("/imports?error=" + encodeURIComponent("Import introuvable."));
  const access = await getAccess();
  if (!access || !(access.perms[IMPORT_MODULE[imp.type as ImportType]]?.validate || access.perms.administration.validate)) {
    redirect("/imports?error=" + encodeURIComponent("Annuler cet import demande le droit « Valider » sur son module."));
  }
  if (!isReversible(imp.type)) redirect(`/imports/${id}?error=` + encodeURIComponent("Ce type d'import ne peut pas être annulé."));

  let removed = 0;
  let orphans = { products: 0, clients: 0, aliases: 0 };
  try {
    removed = await rollbackRows(id, imp.type, { id: user.id });
    orphans = await rollbackOrphans(id);
  } catch (e) {
    redirect(`/imports/${id}?error=` + encodeURIComponent(`Annulation impossible : ${(e as Error).message}`));
  }
  await db
    .update(imports)
    .set({
      status: "FAILED",
      warnings: [
        ...imp.warnings,
        imp.type === "STOCK_INITIAL"
          ? `Import annulé le ${new Date().toLocaleDateString("fr-FR")} : ${removed} mouvement(s) contrepassé(s) dans le journal de stock.`
          : `Import annulé le ${new Date().toLocaleDateString("fr-FR")} : ${removed} enregistrement(s) supprimé(s).`,
        ...(orphans.products || orphans.clients || orphans.aliases
          ? [`Fiches créées par cet import et retirées : ${orphans.products} produit(s), ${orphans.clients} client(s), ${orphans.aliases} alias.`]
          : []),
      ],
    })
    .where(eq(imports.id, id));

  for (const p of ["/imports", "/", "/ventes", "/stock", "/terrain", "/marketing", "/marketing/ads", "/produits", "/clients", "/actions"]) revalidatePath(p);
  redirect(`/imports?annule=${removed}`);
}

/**
 * Retire les fiches (produits, clients, alias) créées par un import déjà annulé et utilisées
 * nulle part. Sert aux imports annulés avant que l'annulation ne s'en charge elle-même.
 */
export async function cleanupImportOrphans(formData: FormData) {
  await requireAnyModule();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const imp = await db.query.imports.findFirst({ where: eq(imports.id, id) });
  if (!imp) redirect("/imports?error=" + encodeURIComponent("Import introuvable."));
  const access = await getAccess();
  if (!access || !(access.perms[IMPORT_MODULE[imp.type as ImportType]]?.validate || access.perms.administration.validate)) {
    redirect(`/imports/${id}?error=` + encodeURIComponent("Retirer ces fiches demande le droit « Valider » sur le module de l'import."));
  }
  if (imp.status !== "FAILED") redirect(`/imports/${id}?error=` + encodeURIComponent("Annulez d'abord l'import : tant que ses lignes existent, ses fiches ne sont pas orphelines."));
  let orphans = { products: 0, clients: 0, aliases: 0 };
  try {
    orphans = await rollbackOrphans(id);
  } catch (e) {
    redirect(`/imports/${id}?error=` + encodeURIComponent(`Nettoyage impossible : ${(e as Error).message}`));
  }
  await db.update(imports).set({
    warnings: [...imp.warnings, `Fiches orphelines retirées le ${new Date().toLocaleDateString("fr-FR")} : ${orphans.products} produit(s), ${orphans.clients} client(s), ${orphans.aliases} alias.`],
  }).where(eq(imports.id, id));
  for (const p of ["/imports", `/imports/${id}`, "/stock", "/produits", "/clients", "/"]) revalidatePath(p);
  redirect(`/imports/${id}`);
}
