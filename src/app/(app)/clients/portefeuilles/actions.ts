"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { assignAccountManager, setVisitFrequency, applyDefaultFrequency, applyManagerProposals, managerProposals } from "@/lib/crm/portfolio";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const backTo = (fd: FormData) => str(fd, "back") || "/clients/portefeuilles";
const go = (fd: FormData, q: string) => { const b = backTo(fd); redirect(`${b}${b.includes("?") ? "&" : "?"}${q}`); };

/** Actions groupées sur la sélection : confier / retirer (Valider), fréquence (Modifier). */
export async function bulkPortfolioAction(fd: FormData) {
  const op = str(fd, "op");
  const ids = fd.getAll("ids").map(String);
  if (!ids.length) go(fd, `error=${encodeURIComponent("Cochez au moins un client.")}`);
  let n = 0;
  try {
    if (op === "assign" || op === "unassign") {
      const user = await requirePermission("clients", "validate");
      const target = op === "assign" ? str(fd, "userId") : null;
      if (op === "assign" && !target) throw new Error("Choisissez la commerciale à qui confier les clients.");
      n = await assignAccountManager({ id: user.id, name: user.name }, ids, target);
    } else if (op === "frequency" || op === "clearFrequency") {
      const user = await requirePermission("clients", "edit");
      const raw = str(fd, "frequency");
      const f = op === "clearFrequency" ? null : Number(raw);
      if (op === "frequency" && (raw === "" || !Number.isInteger(f))) throw new Error("Indiquez un nombre entier de visites par mois.");
      n = await setVisitFrequency({ id: user.id, name: user.name }, ids, f);
    } else if (op === "defaultFrequency") {
      const user = await requirePermission("clients", "edit");
      n = await applyDefaultFrequency({ id: user.id, name: user.name }, ids, (await getSettings()).crm);
    } else throw new Error("Action inconnue.");
  } catch (e) {
    go(fd, `error=${encodeURIComponent(e instanceof Error ? e.message : "Action impossible.")}`);
  }
  revalidatePath("/clients/portefeuilles");
  revalidatePath("/clients/visites");
  go(fd, `done=${n}`);
}

/** Reprise : applique les propositions à candidat unique (toutes, ou celles cochées). */
export async function applyProposalsAction(fd: FormData) {
  const user = await requirePermission("clients", "validate");
  const picked = fd.getAll("ids").map(String);
  const ids = picked.length ? picked : (await managerProposals()).filter((p) => p.candidates.length === 1).map((p) => p.clientId);
  const n = await applyManagerProposals({ id: user.id, name: user.name }, ids);
  revalidatePath("/clients/portefeuilles");
  redirect(`/clients/portefeuilles?done=${n}&reprise=1`);
}
