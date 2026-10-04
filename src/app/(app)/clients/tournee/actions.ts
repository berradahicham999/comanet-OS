"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess, requirePermission, canDo, clientInScope } from "@/lib/access";
import { acceptCrmGpsNotice, logClientContact, planClientVisit } from "@/lib/crm/visits";
import type { ClientVisitKind } from "@/lib/crm/visits-shared";

/** Prise de connaissance de l'information GPS (horodatée, conservée). */
export async function acceptCrmNoticeAction() {
  const user = await requireAccess("clients");
  await acceptCrmGpsNotice(user.id, (await headers()).get("user-agent"));
  revalidatePath("/clients/tournee");
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const err = (path: string, e: unknown) => redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(e instanceof Error ? e.message : "Enregistrement impossible.")}`);

/** Appel, message (ou visite ressaisie par un manager) noté après coup. */
export async function logContactAction(fd: FormData) {
  const user = await requirePermission("clients", "create");
  const clientId = str(fd, "clientId");
  const back = str(fd, "back") || "/clients/tournee";
  if (!(await clientInScope(clientId))) err("/clients/tournee/contact", new Error("Client hors de votre portée."));
  const manage = await canDo("clients", "validate");
  try {
    await logClientContact({ id: user.id, name: user.name }, {
      clientId, userId: str(fd, "userId") || null, kind: (str(fd, "kind") || "APPEL") as ClientVisitKind, date: str(fd, "date"),
      result: str(fd, "result") || null, comment: str(fd, "comment") || null, nextAction: str(fd, "nextAction") || null, nextVisitDate: str(fd, "nextVisitDate") || null,
    }, { manage });
  } catch (e) {
    err(`/clients/tournee/contact?client=${clientId}`, e);
  }
  revalidatePath("/clients/tournee");
  redirect(`${back}${back.includes("?") ? "&" : "?"}done=contact`);
}

/** Planifie une visite (date seule) pour soi, ou pour une commerciale (manager). */
export async function planVisitAction(fd: FormData) {
  const user = await requirePermission("clients", "create");
  const clientId = str(fd, "clientId");
  const back = str(fd, "back") || `/clients/${clientId}?tab=crm`;
  const manage = await canDo("clients", "validate");
  const userId = manage && str(fd, "userId") ? str(fd, "userId") : user.id;
  if (!(await clientInScope(clientId))) err(back, new Error("Client hors de votre portée."));
  try {
    await planClientVisit({ id: user.id, name: user.name }, { clientId, userId, date: str(fd, "date"), objective: str(fd, "objective") || null });
  } catch (e) {
    err(back, e);
  }
  revalidatePath("/clients/tournee");
  redirect(`${back}${back.includes("?") ? "&" : "?"}done=planned`);
}
