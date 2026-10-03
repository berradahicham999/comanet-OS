import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import type { DbLike } from "@/lib/events/emit";
import { refreshDoctorVisitStats } from "./chrono";
import { doctorVisits, visitProducts, visitSamples, sampleMovements, type DoctorInterest, type MedicalVisitStatus } from "@/db/schema";

export type VisitInput = {
  id?: string;
  doctorId: string;
  delegateId: string | null;
  date: string;
  durationMinutes: number | null;
  visitType: string;
  objective: string | null;
  result: string | null;
  doctorInterest: DoctorInterest | null;
  comment: string | null;
  nextAction: string | null;
  nextVisitDate: string | null;
  /** Objections rencontrées et documentation laissée (cahier des charges, section 4). */
  objections: string | null;
  documentation: string | null;
  status: MedicalVisitStatus;
  productIds: string[];
  samples: { productId: string; quantity: number }[];
  createdById: string | null;
};

/**
 * Enregistre une visite saisie au formulaire (planification, saisie du manager) : upsert de la visite,
 * purge/ré-insertion des produits présentés et échantillons, régénération des mouvements de stock
 * correspondants, puis recalcul de `doctors.last_visit_at`/`status` depuis l'historique réel. Refuse une
 * visite chronométrée (son compte rendu passe par `saveVisitReport()`).
 */
export async function saveVisit(input: VisitInput): Promise<string> {
  return db.transaction(async (tx) => {
    const values = {
      doctorId: input.doctorId,
      delegateId: input.delegateId,
      date: input.date,
      durationMinutes: input.durationMinutes,
      visitType: input.visitType || "VISITE",
      objective: input.objective,
      result: input.result,
      doctorInterest: input.doctorInterest,
      comment: input.comment,
      nextAction: input.nextAction,
      nextVisitDate: input.nextVisitDate,
      objections: input.objections,
      documentation: input.documentation,
      status: input.status,
      reportStatus: input.status === "REALISEE" ? ("VALIDE" as const) : null,
    };
    let visitId = input.id ?? "";
    if (visitId) {
      const cur = (await tx.execute<{ timing_source: string }>(sql`select timing_source from doctor_visits where id = ${visitId}::uuid for update`)).rows[0];
      // Une visite chronométrée ne passe jamais par ici : ses heures, sa durée et son statut viennent du chrono.
      if (cur?.timing_source === "CHRONO") throw new Error("Visite chronométrée : seul son compte rendu se modifie.");
      await tx.update(doctorVisits).set(values).where(eq(doctorVisits.id, visitId));
    } else {
      const [row] = await tx.insert(doctorVisits).values({ ...values, timingSource: "SAISIE_MANUELLE" }).returning();
      visitId = row.id;
    }
    await writeDetails(tx, visitId, input.productIds, input.samples, input.status === "REALISEE" ? input.delegateId : null, input.date, input.createdById);
    await refreshDoctorVisitStats(tx, input.doctorId);
    return visitId;
  });
}

/** Produits présentés, échantillons remis et mouvements d'échantillons (purgés puis réécrits). */
async function writeDetails(
  tx: DbLike, visitId: string, productIds: string[], samples: { productId: string; quantity: number }[],
  sampleDelegateId: string | null, date: string, createdById: string | null,
) {
  await tx.delete(visitProducts).where(eq(visitProducts.visitId, visitId));
  await tx.delete(visitSamples).where(eq(visitSamples.visitId, visitId));
  await tx.delete(sampleMovements).where(eq(sampleMovements.visitId, visitId));
  if (productIds.length) {
    await tx.insert(visitProducts).values([...new Set(productIds)].map((productId) => ({ visitId, productId })));
  }
  if (samples.length) {
    await tx.insert(visitSamples).values(samples.map((s) => ({ visitId, productId: s.productId, quantity: s.quantity })));
    if (sampleDelegateId) {
      await tx.insert(sampleMovements).values(
        samples.map((s) => ({
          delegateId: sampleDelegateId,
          productId: s.productId,
          type: "SORTIE_VISITE" as const,
          quantity: -Math.abs(s.quantity),
          visitId,
          date,
          createdById,
        })),
      );
    }
  }
}

export type ReportInput = Pick<
  VisitInput,
  "visitType" | "objective" | "result" | "doctorInterest" | "comment" | "nextAction" | "nextVisitDate" | "objections" | "documentation" | "productIds" | "samples" | "createdById"
>;

/**
 * Compte rendu d'une visite (chronométrée ou non) : ne touche ni la date, ni les heures, ni la durée,
 * ni le statut. Les échantillons sortent du stock de la déléguée de la visite (logique `sample_movements`
 * inchangée). Le compte rendu passe « validé ».
 */
export async function saveVisitReport(visitId: string, input: ReportInput): Promise<{ ok: boolean; message?: string; doctorId?: string }> {
  return db.transaction(async (tx) => {
    const v = (await tx.execute<{ doctor_id: string; delegate_id: string | null; status: MedicalVisitStatus; date: string }>(
      sql`select doctor_id, delegate_id, status, date::text as date from doctor_visits where id = ${visitId}::uuid for update`,
    )).rows[0];
    if (!v) return { ok: false, message: "Visite introuvable." };
    if (v.status === "EN_COURS") return { ok: false, message: "Terminez d'abord la visite." };
    await tx.update(doctorVisits).set({
      visitType: input.visitType || "VISITE",
      objective: input.objective,
      result: input.result,
      doctorInterest: input.doctorInterest,
      comment: input.comment,
      nextAction: input.nextAction,
      nextVisitDate: input.nextVisitDate,
      objections: input.objections,
      documentation: input.documentation,
      reportStatus: v.status === "REALISEE" ? "VALIDE" : null,
    }).where(eq(doctorVisits.id, visitId));
    await writeDetails(tx, visitId, input.productIds, input.samples, v.status === "REALISEE" ? v.delegate_id : null, v.date, input.createdById);
    return { ok: true, doctorId: v.doctor_id };
  });
}

/** Supprime une visite saisie à la main. Une visite chronométrée porte des preuves (journal en écriture seule) : elle ne se supprime pas. */
export async function deleteVisit(id: string, doctorId: string): Promise<{ ok: boolean; message?: string }> {
  const ev = await db.execute(sql`select 1 from visit_events where visit_id = ${id}::uuid limit 1`);
  if (ev.rows.length) return { ok: false, message: "Visite chronométrée : elle ne se supprime pas, elle se corrige (motif tracé)." };
  await db.transaction(async (tx) => {
    await tx.delete(sampleMovements).where(eq(sampleMovements.visitId, id));
    await tx.delete(doctorVisits).where(eq(doctorVisits.id, id));
    await tx.execute(sql`
      update doctors set last_visit_at = (select max(date) from doctor_visits where doctor_id = ${doctorId}::uuid and status = 'REALISEE'), updated_at = now()
      where id = ${doctorId}::uuid`);
  });
  return { ok: true };
}
