"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can, requireAccessContext, requirePermission } from "@/lib/access";
import { bool, errorParam, isUuid, str } from "@/lib/gestion/form";
import {
  addEntry, cancelCount, createCount, deleteCount, deleteEntry, setLineReason, startCount, updateCount, validateCount, zeroUncounted, type CountInput,
} from "@/lib/gestion/counts";

/**
 * Droits : préparer, démarrer et compter = « Créer » sur Stock ; valider (écrire les ajustements
 * dans le journal) ou annuler = « Valider » sur Stock.
 */
const actorOf = (u: { id: string; name: string }) => ({ id: u.id, name: u.name });
const done = (id?: string) => { revalidatePath("/gestion/inventaires"); if (id) revalidatePath(`/gestion/inventaires/${id}`); };

function readCount(fd: FormData): CountInput {
  return {
    title: str(fd, "title") ?? "", warehouseKey: str(fd, "warehouseKey") ?? "PRINCIPAL", brandIds: fd.getAll("brandIds").map(String).filter(isUuid),
    blind: bool(fd, "blind"), countDate: str(fd, "countDate") ?? "", notes: str(fd, "notes"),
  };
}

export async function createCountAction(fd: FormData) {
  let id: string;
  try {
    id = await createCount(readCount(fd), actorOf(await requirePermission("stock", "create")));
  } catch (e) {
    redirect(`/gestion/inventaires?error=${errorParam(e)}`);
  }
  done(id);
  redirect(`/gestion/inventaires/${id}`);
}

export async function updateCountAction(fd: FormData) {
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new Error("Inventaire introuvable.");
    await updateCount(id, readCount(fd), actorOf(await requirePermission("stock", "create")));
  } catch (e) {
    redirect(`/gestion/inventaires/${id}?error=${errorParam(e)}`);
  }
  done(id!);
  redirect(`/gestion/inventaires/${id}?done=1`);
}

export async function deleteCountAction(fd: FormData) {
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new Error("Inventaire introuvable.");
    await deleteCount(id, actorOf(await requirePermission("stock", "create")));
  } catch (e) {
    redirect(`/gestion/inventaires/${id}?error=${errorParam(e)}`);
  }
  done();
  redirect("/gestion/inventaires");
}

export async function startCountAction(fd: FormData) {
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new Error("Inventaire introuvable.");
    await startCount(id, actorOf(await requirePermission("stock", "create")));
  } catch (e) {
    redirect(`/gestion/inventaires/${id}?error=${errorParam(e)}`);
  }
  done(id!);
  redirect(`/gestion/inventaires/${id}?started=1`);
}

/** Saisie d'un compteur (appelée depuis l'écran de comptage, sans rechargement). */
export async function addEntryAction(countId: string, input: { productId: string; lotNumber: string | null; expiryDate: string | null; quantity: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!isUuid(countId) || !isUuid(input.productId)) throw new Error("Saisie invalide.");
    await addEntry(countId, input, actorOf(await requirePermission("stock", "create")));
    revalidatePath(`/gestion/inventaires/${countId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteEntryAction(countId: string, entryId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const a = await requireAccessContext();
    const user = await requirePermission("stock", "create");
    await deleteEntry(entryId, actorOf(user), can(a.perms, "stock", "validate"));
    revalidatePath(`/gestion/inventaires/${countId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function setReasonAction(countId: string, lineId: string, reasonKey: string | null, comment: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    await requirePermission("stock", "validate");
    await setLineReason(lineId, reasonKey, comment);
    revalidatePath(`/gestion/inventaires/${countId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function zeroUncountedAction(fd: FormData) {
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new Error("Inventaire introuvable.");
    await zeroUncounted(id, actorOf(await requirePermission("stock", "validate")));
  } catch (e) {
    redirect(`/gestion/inventaires/${id}?error=${errorParam(e)}`);
  }
  done(id!);
  redirect(`/gestion/inventaires/${id}?done=1`);
}

export async function validateCountAction(fd: FormData) {
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new Error("Inventaire introuvable.");
    await validateCount(id, actorOf(await requirePermission("stock", "validate")));
  } catch (e) {
    redirect(`/gestion/inventaires/${id}?error=${errorParam(e)}`);
  }
  done(id!);
  redirect(`/gestion/inventaires/${id}?validated=1`);
}

export async function cancelCountAction(fd: FormData) {
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new Error("Inventaire introuvable.");
    await cancelCount(id, str(fd, "reason") ?? "", actorOf(await requirePermission("stock", "validate")));
  } catch (e) {
    redirect(`/gestion/inventaires/${id}?error=${errorParam(e)}`);
  }
  done(id!);
  redirect(`/gestion/inventaires/${id}?done=1`);
}
