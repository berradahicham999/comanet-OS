"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/access";
import { createPreviewToken, resolveAccessFor } from "@/lib/permissions";
import { PREVIEW_COOKIE } from "@/lib/access-shared";
import { readConfig } from "@/lib/permissions-form";
import {
  AdminGuardError, applyCityScopeToAnimatrices, createUser, duplicateUser, saveUserConfig, setUserActive, updateProfile,
} from "@/lib/admin-users";

function templatesOf(fd: FormData) {
  return String(fd.get("templates") ?? "").split("|").map((s) => s.trim()).filter(Boolean);
}

function str(fd: FormData, k: string) {
  return String(fd.get(k) ?? "").trim();
}

function fail(path: string, e: unknown): never {
  const msg = e instanceof AdminGuardError ? e.message : e instanceof Error ? e.message : "Erreur inattendue.";
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
}

function refresh(id?: string) {
  revalidatePath("/parametres/utilisateurs");
  revalidatePath("/parametres/recapitulatif");
  if (id) revalidatePath(`/parametres/utilisateurs/${id}`);
  revalidatePath("/", "layout");
}

export async function createUserAction(fd: FormData) {
  const actor = await requireAdmin();
  const config = readConfig(fd);
  let id: string;
  try {
    id = await createUser(actor, { name: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password"), city: str(fd, "city"), phone: str(fd, "phone"), jobTitle: str(fd, "jobTitle") }, config, templatesOf(fd));
  } catch (e) {
    fail("/parametres/utilisateurs/nouveau", e);
  }
  refresh(id);
  redirect(`/parametres/utilisateurs/${id}?ok=cree`);
}

export async function saveConfigAction(fd: FormData) {
  const actor = await requireAdmin();
  const id = str(fd, "id");
  if (!id) return;
  const config = readConfig(fd);
  try {
    await saveUserConfig(actor, id, config, { templateNames: templatesOf(fd) });
  } catch (e) {
    fail(`/parametres/utilisateurs/${id}`, e);
  }
  refresh(id);
  redirect(`/parametres/utilisateurs/${id}?ok=droits`);
}

export async function updateProfileAction(fd: FormData) {
  const actor = await requireAdmin();
  const id = str(fd, "id");
  if (!id) return;
  try {
    await updateProfile(actor, id, { name: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password") || undefined, city: str(fd, "city"), phone: str(fd, "phone"), jobTitle: str(fd, "jobTitle") });
  } catch (e) {
    fail(`/parametres/utilisateurs/${id}`, e);
  }
  refresh(id);
  redirect(`/parametres/utilisateurs/${id}?ok=profil`);
}

export async function setActiveAction(fd: FormData) {
  const actor = await requireAdmin();
  const id = str(fd, "id");
  const active = fd.get("active") === "1";
  if (!id) return;
  try {
    await setUserActive(actor, id, active);
  } catch (e) {
    fail(`/parametres/utilisateurs/${id}`, e);
  }
  refresh(id);
  redirect(`/parametres/utilisateurs/${id}?ok=${active ? "reactive" : "suspendu"}`);
}

export async function duplicateUserAction(fd: FormData) {
  const actor = await requireAdmin();
  const source = str(fd, "source");
  if (!source) return;
  let id: string;
  try {
    id = await duplicateUser(actor, source, { name: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password") });
  } catch (e) {
    fail(`/parametres/utilisateurs/${source}`, e);
  }
  refresh(id);
  redirect(`/parametres/utilisateurs/${id}?ok=duplique`);
}

/** Raccourci : chaque animatrice reçoit sa ville (tous ses clients) et toutes les marques. */
export async function cityScopeAnimatricesAction() {
  const actor = await requireAdmin();
  let res: Awaited<ReturnType<typeof applyCityScopeToAnimatrices>>;
  try {
    res = await applyCityScopeToAnimatrices(actor);
  } catch (e) {
    fail("/parametres/utilisateurs", e);
  }
  refresh();
  const skipped = res.skipped.filter((s) => s.reason !== "déjà configurée").map((s) => `${s.name} (${s.reason})`);
  const msg = `${res.updated.length} animatrice${res.updated.length > 1 ? "s" : ""} configurée${res.updated.length > 1 ? "s" : ""}${res.updated.length ? ` : ${res.updated.join(", ")}` : ""}.`
    + (skipped.length ? ` Non modifiées : ${skipped.join(", ")}.` : "");
  redirect(`/parametres/utilisateurs?ok=${encodeURIComponent(msg)}`);
}

/**
 * Prévisualiser en tant que : pose un cookie signé (administrateur + compte simulé, deux
 * heures), puis ouvre la page d'accueil de ce compte. Toute action mutante est refusée
 * tant que le cookie est présent (voir `requireView` / `requirePermission`).
 */
export async function previewAsAction(fd: FormData) {
  const actor = await requireAdmin();
  const id = str(fd, "id");
  if (!id || id === actor.id) return;
  const token = await createPreviewToken(actor.id, id);
  const jar = await cookies();
  jar.set(PREVIEW_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 2 * 3600 });
  const target = await resolveAccessFor(id);
  redirect(target.home);
}
