"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { pgArray } from "@/lib/sql-array";
import { requireAccess } from "@/lib/access";
import { fieldScope, inFieldScope } from "@/lib/medical/field-access";
import { correctVisit, validateCabinet, parseBusinessLocal } from "@/lib/medical/chrono";
import type { VerificationStatus } from "@/lib/medical/gps-shared";

/**
 * Correction d'une visite par le manager de la déléguée ou la direction : heures et / ou statut de
 * contrôle, motif obligatoire, tracée (événement CORRECTION + audit_logs). La déléguée n'y a jamais accès.
 */
export async function correctVisitAction(formData: FormData) {
  const user = await requireAccess("medical");
  const id = String(formData.get("id") ?? "");
  const back = `/medical/visites/${id}`;
  const v = (await db.execute<{ delegate_id: string | null; started_at: string | null; ended_at: string | null }>(
    sql`select delegate_id, started_at, ended_at from doctor_visits where id = ${id}::uuid`,
  )).rows[0];
  if (!v) return;
  if (!inFieldScope(await fieldScope(), v.delegate_id)) redirect(`${back}?error=${encodeURIComponent("Correction réservée à la direction et au manager de la déléguée.")}`);
  const startRaw = String(formData.get("startedAt") ?? "");
  const endRaw = String(formData.get("endedAt") ?? "");
  const forced = String(formData.get("forcedStatus") ?? "") as VerificationStatus | "";
  const sameMinute = (raw: string, cur: string | null) => {
    const d = raw ? parseBusinessLocal(raw) : null;
    if (!cur) return !d;
    return !!d && Math.abs(d.getTime() - new Date(cur).getTime()) < 60_000;
  };
  const res = await correctVisit({ id: user.id, name: user.name }, {
    visitId: id,
    reason: String(formData.get("reason") ?? ""),
    ...(sameMinute(startRaw, v.started_at) ? {} : { startedAt: startRaw ? parseBusinessLocal(startRaw) : null }),
    ...(sameMinute(endRaw, v.ended_at) ? {} : { endedAt: endRaw ? parseBusinessLocal(endRaw) : null }),
    forcedStatus: forced && ["VERIFIEE", "A_VERIFIER", "NON_VERIFIEE"].includes(forced) ? forced : null,
  });
  revalidatePath("/medical", "layout");
  redirect(res.ok ? `${back}?ok=1` : `${back}?error=${encodeURIComponent(res.message ?? "Correction refusée.")}`);
}

/** Valide (et déplace si besoin) la position du cabinet d'un médecin. Direction ou manager concerné. */
export async function validateCabinetAction(input: { doctorId: string; lat?: number | null; lng?: number | null }): Promise<{ ok: boolean; message?: string }> {
  const user = await requireAccess("medical");
  const scope = await fieldScope();
  if (!scope.all) {
    const r = await db.execute(sql`select 1 from doctor_visits where doctor_id = ${input.doctorId}::uuid and delegate_id = any(${pgArray(scope.delegateIds)}) limit 1`);
    if (!r.rows.length) return { ok: false, message: "Ce médecin n'est visité par aucune de vos déléguées." };
  }
  const pos = typeof input.lat === "number" && typeof input.lng === "number" ? { lat: input.lat, lng: input.lng } : null;
  const res = await validateCabinet({ id: user.id, name: user.name }, input.doctorId, pos);
  revalidatePath("/medical/suivi");
  revalidatePath(`/medical/medecins/${input.doctorId}`);
  return res;
}
