"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { importFiles } from "@/db/schema";
import { seedBase } from "@/db/seed-base";
import { applyMigrations, checkSetupKey, grantSetupAccess, hasSetupAccess } from "@/lib/setup";
import { appendUploadChunk, createUploadFile, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from "@/lib/import/upload";
import { importWorkbook, type WorkbookResult } from "@/lib/import/workbook";

export type ActionResult = { ok: boolean; message: string; details?: string[] };

async function guard() {
  if (!(await hasSetupAccess())) throw new Error("Accès refusé : clé d'installation requise.");
}

function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : String(e) };
}

export async function enterSetupKeyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const key = String(formData.get("key") ?? "").trim();
  if (!key || !checkSetupKey(key)) return { ok: false, message: "Clé d'installation incorrecte." };
  await grantSetupAccess();
  revalidatePath("/installation");
  return { ok: true, message: "Accès accordé." };
}

export async function applyMigrationsAction(): Promise<ActionResult> {
  try {
    await guard();
    const r = await applyMigrations();
    revalidatePath("/installation");
    const details = [...r.adopted.map((t) => `${t} : schéma existant adopté`), ...r.applied.map((t) => `${t} : appliquée`)];
    return { ok: true, message: details.length ? `${details.length} migration(s) traitée(s).` : "Schéma déjà à jour.", details };
  } catch (e) {
    return fail(e);
  }
}

export async function seedBaseAction(): Promise<ActionResult> {
  try {
    await guard();
    await seedBase();
    revalidatePath("/installation");
    return { ok: true, message: "Socle créé : utilisateurs, marques du portefeuille, paramètres par défaut." };
  } catch (e) {
    return fail(e);
  }
}

/* ---------------------- Classeur compilé (par morceaux) ---------------------- */

export async function beginWorkbookUpload(name: string, size: number) {
  await guard();
  if (size > MAX_UPLOAD_BYTES) throw new Error("Fichier trop volumineux (max 25 Mo)");
  const id = await createUploadFile(name, null);
  return { id, chunkBytes: UPLOAD_CHUNK_BYTES };
}

export async function appendWorkbookChunk(formData: FormData) {
  await guard();
  const received = await appendUploadChunk(formData);
  return { received };
}

export async function runWorkbookAction(id: string, reset: boolean): Promise<{ ok: true; result: WorkbookResult; log: string[] } | { ok: false; message: string; log: string[] }> {
  const log: string[] = [];
  try {
    await guard();
    const file = await db.query.importFiles.findFirst({ where: eq(importFiles.id, id) });
    if (!file) throw new Error("Fichier introuvable (téléversement expiré ?)");
    const result = await importWorkbook(file.data, file.name, { reset, log: (l) => log.push(l) });
    await db.delete(importFiles).where(eq(importFiles.id, id));
    revalidatePath("/", "layout");
    return { ok: true, result, log };
  } catch (e) {
    await db.delete(importFiles).where(eq(importFiles.id, id)).catch(() => {});
    return { ok: false, message: e instanceof Error ? e.message : String(e), log };
  }
}
