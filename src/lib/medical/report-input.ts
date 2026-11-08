import type { DoctorInterest } from "@/db/schema";
import type { ReportInput } from "./visits";

/** Champs d'un compte rendu, lus du formulaire : une seule lecture pour le bureau et pour la file hors connexion. */
export function readReport(formData: FormData, createdById: string): ReportInput {
  const sampleCount = Number(formData.get("sampleCount") ?? 0) || 0;
  const samples: { productId: string; quantity: number }[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const productId = String(formData.get(`sample_product_${i}`) ?? "");
    const qty = Number(formData.get(`sample_qty_${i}`) ?? 0) || 0;
    if (productId && qty > 0) samples.push({ productId, quantity: Math.round(qty) });
  }
  return {
    visitType: String(formData.get("visitType") ?? "VISITE").trim() || "VISITE",
    objective: String(formData.get("objective") ?? "").trim() || null,
    result: String(formData.get("result") ?? "").trim() || null,
    doctorInterest: (String(formData.get("doctorInterest") ?? "") || null) as DoctorInterest | null,
    comment: String(formData.get("comment") ?? "").trim() || null,
    nextAction: String(formData.get("nextAction") ?? "").trim() || null,
    nextVisitDate: String(formData.get("nextVisitDate") ?? "") || null,
    objections: String(formData.get("objections") ?? "").trim() || null,
    documentation: String(formData.get("documentation") ?? "").trim() || null,
    productIds: formData.getAll("productId").map(String).filter(Boolean),
    samples,
    createdById,
  };
}

/** Un compte rendu mis en file : les paires du formulaire, reconstruites côté serveur et lues par `readReport()`. */
export function formDataFromPairs(pairs: unknown): FormData {
  const fd = new FormData();
  if (!Array.isArray(pairs)) return fd;
  for (const p of pairs.slice(0, 300)) {
    if (Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string") fd.append(p[0].slice(0, 60), p[1].slice(0, 4000));
  }
  return fd;
}
