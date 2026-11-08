"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, isOwnOnly, canDo } from "@/lib/access";
import { saveVisit, saveVisitReport, deleteVisit, type VisitInput } from "@/lib/medical/visits";
import type { MedicalVisitStatus } from "@/db/schema";
import { readReport } from "@/lib/medical/report-input";

function revalidateMedical(doctorId: string) {
  revalidatePath("/medical", "layout");
  revalidatePath(`/medical/medecins/${doctorId}`);
}

/**
 * Formulaire de visite. Une déléguée ne choisit jamais une heure, une durée ni un statut « réalisée » :
 * elle planifie (date, reportée, annulée) ou complète le compte rendu ; une visite réalisée vient du chrono.
 * Une visite chronométrée, quelle que soit la personne, ne modifie que son compte rendu.
 */
export async function saveVisitAction(formData: FormData) {
  const user = await requireAccess("medical");
  const own = await isOwnOnly();
  const id = String(formData.get("id") ?? "") || undefined;
  const doctorId = String(formData.get("doctorId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!doctorId || !date) return;

  if (id) {
    const cur = (await db.execute<{ timing_source: string; status: MedicalVisitStatus; delegate_id: string | null }>(
      sql`select timing_source, status, delegate_id from doctor_visits where id = ${id}::uuid`,
    )).rows[0];
    if (!cur) return;
    if (own && cur.delegate_id !== user.id) return;
    const reportOnly = cur.timing_source === "CHRONO" || (own && cur.status !== "PLANIFIEE");
    if (reportOnly) {
      await saveVisitReport(id, readReport(formData, user.id));
      revalidateMedical(doctorId);
      redirect(own ? "/medical/journee?done=1" : `/medical/visites/${id}`);
    }
  }

  let status = String(formData.get("status") ?? "REALISEE") as MedicalVisitStatus;
  if (own && !["PLANIFIEE", "REPORTEE", "ANNULEE"].includes(status)) status = "PLANIFIEE";
  if (status === "EN_COURS") status = "PLANIFIEE";
  const input: VisitInput = {
    id,
    doctorId,
    delegateId: own ? user.id : String(formData.get("delegateId") ?? "") || null,
    date,
    durationMinutes: own ? null : formData.get("durationMinutes") ? Math.round(Number(formData.get("durationMinutes"))) : null,
    ...readReport(formData, user.id),
    status,
  };
  const visitId = await saveVisit(input);
  revalidateMedical(doctorId);
  redirect(own ? "/medical/journee?planned=1" : `/medical/visites/${visitId}`);
}

/** Compte rendu après « Terminer » (ou plus tard dans la journée). */
export async function saveReportAction(formData: FormData) {
  const user = await requireAccess("medical");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const cur = (await db.execute<{ delegate_id: string | null }>(sql`select delegate_id from doctor_visits where id = ${id}::uuid`)).rows[0];
  if (!cur) return;
  if ((await isOwnOnly()) && cur.delegate_id !== user.id) return;
  const res = await saveVisitReport(id, readReport(formData, user.id));
  if (!res.ok) redirect(`/medical/visites/${id}/compte-rendu?error=${encodeURIComponent(res.message ?? "Erreur")}`);
  revalidateMedical(res.doctorId!);
  redirect("/medical/journee?done=1");
}

export async function deleteVisitAction(formData: FormData) {
  await requireAccess("medical");
  if (!(await canDo("medical", "validate"))) return;
  const id = String(formData.get("id") ?? "");
  const doctorId = String(formData.get("doctorId") ?? "");
  if (!id || !doctorId) return;
  const res = await deleteVisit(id, doctorId);
  if (!res.ok) redirect(`/medical/visites/${id}?error=${encodeURIComponent(res.message ?? "")}`);
  revalidateMedical(doctorId);
  redirect("/medical/visites");
}
