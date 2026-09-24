"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clientInScope, requirePermission } from "@/lib/access";
import { errorParam, isUuid, str } from "@/lib/gestion/form";
import { allocateCredit, allocatePayment, createPayment, getPayment, recordReminder, setPaymentStatus, unallocate } from "@/lib/gestion/payments";
import { PAYMENT_STATUSES, type PaymentStatus } from "@/lib/gestion/receivables-shared";

/**
 * Droits (module Facturation) : saisir un règlement = Créer ; imputer, désimputer, remettre en banque,
 * encaisser, relancer = Modifier ; déclarer un impayé ou annuler = Valider.
 */
const actorOf = (u: { id: string; name: string }) => ({ id: u.id, name: u.name });
const done = (...paths: string[]) => { revalidatePath("/gestion/reglements"); for (const p of paths) revalidatePath(p); };

export async function createPaymentAction(fd: FormData) {
  const clientId = str(fd, "clientId");
  let id: string;
  try {
    const user = await requirePermission("facturation", "create");
    if (!isUuid(clientId) || !(await clientInScope(clientId))) throw new Error("Client introuvable ou hors de votre périmètre.");
    const allocations = [...fd.entries()].filter(([k, v]) => k.startsWith("alloc_") && String(v).trim()).map(([k, v]) => ({ invoiceId: k.slice(6), amount: String(v).replace(",", ".") })).filter((a) => isUuid(a.invoiceId));
    id = await createPayment({
      clientId, date: str(fd, "date") ?? "", modeKey: str(fd, "modeKey") ?? "", amount: (str(fd, "amount") ?? "").replace(",", "."),
      reference: str(fd, "reference"), bank: str(fd, "bank"), dueDate: str(fd, "dueDate"), notes: str(fd, "notes"), allocations,
    }, actorOf(user));
  } catch (e) {
    redirect(`/gestion/reglements/nouveau?${clientId ? `client=${clientId}&` : ""}error=${errorParam(e)}`);
  }
  done();
  redirect(`/gestion/reglements/${id}?done=1`);
}

export async function allocateAction(fd: FormData) {
  const id = str(fd, "paymentId");
  try {
    const user = await requirePermission("facturation", "edit");
    if (!isUuid(id)) throw new Error("Règlement introuvable.");
    await allocatePayment(id, str(fd, "invoiceId") ?? "", (str(fd, "amount") ?? "").replace(",", "."), actorOf(user));
  } catch (e) {
    redirect(`/gestion/reglements/${id}?error=${errorParam(e)}`);
  }
  done(`/gestion/reglements/${id}`);
  redirect(`/gestion/reglements/${id}?done=1`);
}

export async function unallocateAction(fd: FormData) {
  const back = str(fd, "back") ?? "/gestion/reglements";
  try {
    const user = await requirePermission("facturation", "edit");
    const allocationId = str(fd, "allocationId");
    if (!isUuid(allocationId)) throw new Error("Imputation introuvable.");
    await unallocate(allocationId, actorOf(user));
  } catch (e) {
    redirect(`${back}?error=${errorParam(e)}`);
  }
  done(back);
  redirect(`${back}?done=1`);
}

export async function setPaymentStatusAction(fd: FormData) {
  const id = str(fd, "id");
  const to = str(fd, "to") as PaymentStatus;
  try {
    if (!isUuid(id) || !PAYMENT_STATUSES.includes(to)) throw new Error("Demande invalide.");
    const user = await requirePermission("facturation", to === "IMPAYE" || to === "ANNULE" ? "validate" : "edit");
    const p = await getPayment(id);
    if (!p || !(await clientInScope(p.clientId))) throw new Error("Règlement introuvable.");
    await setPaymentStatus(id, to, { date: str(fd, "date") ?? "", reason: str(fd, "reason") }, actorOf(user));
  } catch (e) {
    redirect(`/gestion/reglements/${id}?error=${errorParam(e)}`);
  }
  done(`/gestion/reglements/${id}`);
  redirect(`${str(fd, "back") ?? `/gestion/reglements/${id}`}${(str(fd, "back") ?? "").includes("?") ? "&" : "?"}done=1`);
}

export async function allocateCreditAction(fd: FormData) {
  const creditId = str(fd, "creditId");
  const back = `/gestion/pieces/${creditId}`;
  try {
    const user = await requirePermission("facturation", "edit");
    if (!isUuid(creditId)) throw new Error("Avoir introuvable.");
    await allocateCredit(creditId, str(fd, "invoiceId") ?? "", (str(fd, "amount") ?? "").replace(",", "."), actorOf(user));
  } catch (e) {
    redirect(`${back}?error=${errorParam(e)}`);
  }
  revalidatePath(back);
  redirect(`${back}?done=1`);
}

/** Enregistre une relance (appelée juste avant d'ouvrir WhatsApp ou l'e-mail pré-rempli). */
export async function recordReminderAction(clientId: string, level: number, channel: "WHATSAPP" | "EMAIL" | "TELEPHONE" | "COURRIER", invoices: { id: string; number: string; dueDate: string | null; balance: string }[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requirePermission("facturation", "edit");
    if (!isUuid(clientId) || !(await clientInScope(clientId))) throw new Error("Client hors de votre périmètre.");
    await recordReminder(clientId, level, channel, invoices, actorOf(user));
    revalidatePath("/gestion/relances");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
