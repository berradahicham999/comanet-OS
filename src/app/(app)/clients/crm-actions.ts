"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, clientInScope } from "@/lib/access";
import { assignAccountManager, setVisitFrequency } from "@/lib/crm/portfolio";
import { saveClientObjective, deleteClientObjective } from "@/lib/crm/objectives";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const tab = (id: string, q: string) => redirect(`/clients/${id}?tab=crm&${q}`);
const msg = (e: unknown) => encodeURIComponent(e instanceof Error ? e.message : "Enregistrement impossible.");

async function guard(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await clientInScope(id))) throw new Error("Client hors de votre portée.");
}

/** Fréquence de visite (Modifier sur Clients). Vide = non définie. */
export async function saveFrequencyAction(fd: FormData) {
  const user = await requirePermission("clients", "edit");
  const id = str(fd, "clientId");
  try {
    await guard(id);
    const raw = str(fd, "frequency");
    await setVisitFrequency({ id: user.id, name: user.name }, [id], raw === "" ? null : Number(raw));
  } catch (e) {
    tab(id, `error=${msg(e)}`);
  }
  revalidatePath(`/clients/${id}`);
  tab(id, "done=frequency");
}

/** Commercial attitré (Valider sur Clients). */
export async function assignManagerAction(fd: FormData) {
  const user = await requirePermission("clients", "validate");
  const id = str(fd, "clientId");
  try {
    await guard(id);
    await assignAccountManager({ id: user.id, name: user.name }, [id], str(fd, "userId") || null);
  } catch (e) {
    tab(id, `error=${msg(e)}`);
  }
  revalidatePath(`/clients/${id}`);
  tab(id, "done=manager");
}

/** Objectif client : CA HT du mois ou de l'année, marque facultative (Modifier sur Clients). */
export async function saveObjectiveAction(fd: FormData) {
  const user = await requirePermission("clients", "edit");
  const id = str(fd, "clientId");
  try {
    await guard(id);
    const month = str(fd, "month");
    const units = str(fd, "units");
    await saveClientObjective({ id: user.id, name: user.name }, {
      clientId: id, brandId: str(fd, "brandId") || null, year: Number(str(fd, "year")), month: month ? Number(month) : null,
      amount: Number(str(fd, "amount").replace(/\s/g, "").replace(",", ".")), units: units ? Number(units.replace(",", ".")) : null,
    });
  } catch (e) {
    tab(id, `error=${msg(e)}`);
  }
  revalidatePath(`/clients/${id}`);
  tab(id, "done=objective");
}

export async function deleteObjectiveAction(fd: FormData) {
  const user = await requirePermission("clients", "edit");
  const id = str(fd, "clientId");
  try {
    await guard(id);
    await deleteClientObjective({ id: user.id, name: user.name }, str(fd, "objectiveId"));
  } catch (e) {
    tab(id, `error=${msg(e)}`);
  }
  revalidatePath(`/clients/${id}`);
  tab(id, "done=objective");
}
