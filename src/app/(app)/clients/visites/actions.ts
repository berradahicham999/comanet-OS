"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess, requirePermission, canDo } from "@/lib/access";
import { crmViewer, canSeePositions } from "@/lib/crm/access";
import { saveClientVisitReport, correctClientVisit, cancelPlannedVisit, validatePointOfSale } from "@/lib/crm/visits";
import { parseBusinessLocal } from "@/lib/medical/chrono";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import type { VerificationStatus } from "@/lib/medical/gps-shared";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (id: string, q: string) => redirect(`/clients/visites/${id}?${q}`);
const msg = (e: unknown) => encodeURIComponent(e instanceof Error ? e.message : "Enregistrement impossible.");

async function visitUser(id: string): Promise<string | null> {
  const r = await db.execute<{ user_id: string | null }>(sql`select user_id from client_visits where id = ${id}::uuid`);
  return r.rows[0]?.user_id ?? null;
}

/** Compte rendu d'une visite terminée (la commerciale, ou un manager / « Valider »). */
export async function saveReportAction(fd: FormData) {
  const user = await requirePermission("clients", "create");
  const id = str(fd, "visitId");
  const manage = await canDo("clients", "validate");
  try {
    await saveClientVisitReport({ id: user.id, name: user.name }, id, {
      objective: str(fd, "objective") || null, result: str(fd, "result") || null, comment: str(fd, "comment") || null,
      nextAction: str(fd, "nextAction") || null, nextVisitDate: str(fd, "nextVisitDate") || null,
    }, { manage });
  } catch (e) {
    back(id, `cr=1&error=${msg(e)}`);
  }
  revalidatePath("/clients/tournee");
  if (str(fd, "toTour") === "1") redirect("/clients/tournee?done=report");
  back(id, "done=report");
}

/** Correction des heures ou du statut de contrôle : direction et manager de la commerciale, motif obligatoire. */
export async function correctVisitAction(fd: FormData) {
  const user = await requireAccess("clients");
  const id = str(fd, "visitId");
  const viewer = await crmViewer();
  if (!viewer || !canSeePositions(viewer, await visitUser(id))) back(id, `error=${msg(new Error("Correction réservée à la direction et au manager de la commerciale."))}`);
  const startedRaw = str(fd, "startedAt");
  const endedRaw = str(fd, "endedAt");
  const forced = str(fd, "forcedStatus") as VerificationStatus | "";
  const r = await correctClientVisit({ id: user.id, name: user.name }, {
    visitId: id, reason: str(fd, "reason"),
    ...(startedRaw ? { startedAt: parseBusinessLocal(startedRaw) } : {}),
    ...(endedRaw ? { endedAt: parseBusinessLocal(endedRaw) } : {}),
    forcedStatus: forced && ["VERIFIEE", "A_VERIFIER", "NON_VERIFIEE"].includes(forced) ? forced : null,
  });
  if (!r.ok) back(id, `error=${encodeURIComponent(r.message ?? "Correction refusée.")}`);
  revalidatePath("/clients/visites");
  back(id, "done=correction");
}

export async function cancelVisitAction(fd: FormData) {
  const user = await requirePermission("clients", "create");
  const id = str(fd, "visitId");
  const manage = await canDo("clients", "validate");
  try {
    await cancelPlannedVisit({ id: user.id, name: user.name }, id, { manage });
  } catch (e) {
    back(id, `error=${msg(e)}`);
  }
  revalidatePath("/clients/tournee");
  back(id, "done=cancel");
}

/** Validation (et déplacement) de la position d'un point de vente depuis la carte du suivi. */
export async function validatePositionAction(input: { id: string; lat: number; lng: number }): Promise<{ ok: boolean; message?: string }> {
  const user = await requireAccess("clients");
  const viewer = await crmViewer();
  if (!viewer) return { ok: false, message: "Session expirée." };
  // Direction, ou manager d'une commerciale qui a visité ce point de vente.
  const r = await db.execute<{ user_id: string }>(sql`select distinct user_id from client_visits where client_id = ${input.id}::uuid and user_id is not null`);
  if (!viewer.admin && !r.rows.some((x) => canSeePositions(viewer, x.user_id))) return { ok: false, message: "Validation réservée à la direction et au manager de la commerciale." };
  const res = await validatePointOfSale({ id: user.id, name: user.name }, input.id, Number.isFinite(input.lat) && Number.isFinite(input.lng) ? { lat: input.lat, lng: input.lng } : null);
  if (res.ok) revalidatePath("/clients/visites");
  return res;
}
