import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
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
  status: MedicalVisitStatus;
  productIds: string[];
  samples: { productId: string; quantity: number }[];
  createdById: string | null;
};

/**
 * Enregistre une visite (transaction) : upsert de la visite, purge/ré-insertion des produits
 * présentés et échantillons, régénération des mouvements de stock correspondants, puis
 * recalcul de `doctors.last_visit_at`/`status` depuis l'historique réel — évite toute dérive
 * entre un champ dénormalisé et les visites qui l'ont produit.
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
      status: input.status,
    };
    let visitId = input.id ?? "";
    if (visitId) {
      await tx.update(doctorVisits).set(values).where(eq(doctorVisits.id, visitId));
      await tx.delete(visitProducts).where(eq(visitProducts.visitId, visitId));
      await tx.delete(visitSamples).where(eq(visitSamples.visitId, visitId));
      await tx.delete(sampleMovements).where(eq(sampleMovements.visitId, visitId));
    } else {
      const [row] = await tx.insert(doctorVisits).values(values).returning();
      visitId = row.id;
    }
    if (input.productIds.length) {
      await tx.insert(visitProducts).values(input.productIds.map((productId) => ({ visitId, productId })));
    }
    if (input.samples.length) {
      await tx.insert(visitSamples).values(input.samples.map((s) => ({ visitId, productId: s.productId, quantity: s.quantity })));
      if (input.status === "REALISEE" && input.delegateId) {
        await tx.insert(sampleMovements).values(
          input.samples.map((s) => ({
            delegateId: input.delegateId!,
            productId: s.productId,
            type: "SORTIE_VISITE" as const,
            quantity: -Math.abs(s.quantity),
            visitId,
            date: input.date,
            createdById: input.createdById,
          })),
        );
      }
    }
    await tx.execute(sql`
      update doctors set
        last_visit_at = (select max(date) from doctor_visits where doctor_id = ${input.doctorId}::uuid and status = 'REALISEE'),
        status = case when status = 'NOUVEAU' and exists (select 1 from doctor_visits where doctor_id = ${input.doctorId}::uuid and status = 'REALISEE') then 'ACTIF' else status end,
        updated_at = now()
      where id = ${input.doctorId}::uuid`);
    return visitId;
  });
}

export async function deleteVisit(id: string, doctorId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(sampleMovements).where(eq(sampleMovements.visitId, id));
    await tx.delete(doctorVisits).where(eq(doctorVisits.id, id));
    await tx.execute(sql`
      update doctors set last_visit_at = (select max(date) from doctor_visits where doctor_id = ${doctorId}::uuid and status = 'REALISEE'), updated_at = now()
      where id = ${doctorId}::uuid`);
  });
}
