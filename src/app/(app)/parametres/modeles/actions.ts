"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { readConfig } from "@/lib/permissions-form";
import { AdminGuardError, deleteTemplate, saveTemplate } from "@/lib/admin-users";

function fail(path: string, e: unknown): never {
  const msg = e instanceof AdminGuardError ? e.message : e instanceof Error ? e.message : "Erreur inattendue.";
  redirect(`${path}?error=${encodeURIComponent(msg)}`);
}

export async function saveTemplateAction(fd: FormData) {
  const actor = await requireAdmin();
  const id = String(fd.get("id") ?? "").trim() || undefined;
  const cfg = readConfig(fd);
  const name = String(fd.get("name") ?? "").trim();
  if (!name) fail(id ? `/parametres/modeles/${id}` : "/parametres/modeles/nouveau", new Error("Le nom du modèle est requis."));
  let saved: string;
  try {
    saved = await saveTemplate(actor, { id, name, description: String(fd.get("description") ?? "").trim() || null, homePath: String(fd.get("homePath") ?? "/").trim() || "/", scope: cfg.scope, flags: cfg.flags, perms: cfg.perms });
  } catch (e) {
    fail(id ? `/parametres/modeles/${id}` : "/parametres/modeles/nouveau", e);
  }
  revalidatePath("/parametres/modeles");
  redirect(`/parametres/modeles/${saved}?ok=1`);
}

export async function deleteTemplateAction(fd: FormData) {
  const actor = await requireAdmin();
  const id = String(fd.get("id") ?? "").trim();
  if (!id) return;
  try {
    await deleteTemplate(actor, id);
  } catch (e) {
    fail(`/parametres/modeles/${id}`, e);
  }
  revalidatePath("/parametres/modeles");
  redirect("/parametres/modeles?ok=supprime");
}
