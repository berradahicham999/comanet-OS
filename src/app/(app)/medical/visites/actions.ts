"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { saveVisit, deleteVisit, type VisitInput } from "@/lib/medical/visits";
import type { DoctorInterest, MedicalVisitStatus } from "@/db/schema";

export async function saveVisitAction(formData: FormData) {
  const user = await requireAccess("medical");
  const doctorId = String(formData.get("doctorId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!doctorId || !date) return;

  const sampleCount = Number(formData.get("sampleCount") ?? 0) || 0;
  const samples: { productId: string; quantity: number }[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const productId = String(formData.get(`sample_product_${i}`) ?? "");
    const qty = Number(formData.get(`sample_qty_${i}`) ?? 0) || 0;
    if (productId && qty > 0) samples.push({ productId, quantity: qty });
  }

  const input: VisitInput = {
    id: String(formData.get("id") ?? "") || undefined,
    doctorId,
    delegateId: user.role === "DELEGUE_MEDICAL" ? user.id : String(formData.get("delegateId") ?? "") || null,
    date,
    durationMinutes: formData.get("durationMinutes") ? Math.round(Number(formData.get("durationMinutes"))) : null,
    visitType: String(formData.get("visitType") ?? "VISITE").trim() || "VISITE",
    objective: String(formData.get("objective") ?? "").trim() || null,
    result: String(formData.get("result") ?? "").trim() || null,
    doctorInterest: (String(formData.get("doctorInterest") ?? "") || null) as DoctorInterest | null,
    comment: String(formData.get("comment") ?? "").trim() || null,
    nextAction: String(formData.get("nextAction") ?? "").trim() || null,
    nextVisitDate: String(formData.get("nextVisitDate") ?? "") || null,
    status: (String(formData.get("status") ?? "REALISEE") as MedicalVisitStatus),
    productIds: formData.getAll("productId").map(String).filter(Boolean),
    samples,
    createdById: user.id,
  };
  const visitId = await saveVisit(input);
  revalidatePath("/medical/visites");
  revalidatePath(`/medical/medecins/${doctorId}`);
  revalidatePath("/medical");
  redirect(user.role === "DELEGUE_MEDICAL" ? "/medical/visites/saisie?done=1" : `/medical/visites/${visitId}`);
}

export async function deleteVisitAction(formData: FormData) {
  const user = await requireAccess("medical");
  if (user.role === "DELEGUE_MEDICAL") return;
  const id = String(formData.get("id") ?? "");
  const doctorId = String(formData.get("doctorId") ?? "");
  if (!id || !doctorId) return;
  await deleteVisit(id, doctorId);
  revalidatePath("/medical/visites");
  revalidatePath(`/medical/medecins/${doctorId}`);
  redirect("/medical/visites");
}
