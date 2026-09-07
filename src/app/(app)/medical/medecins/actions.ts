"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { doctors, doctorBrands, type DoctorPotential, type DoctorStatus } from "@/db/schema";
import { requireAccess, isOwnOnly } from "@/lib/access";

export async function saveDoctor(formData: FormData) {
  const user = await requireAccess("medical");
  const id = String(formData.get("id") ?? "");
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  if (!firstName || !lastName) return;
  const values = {
    firstName, lastName,
    phone: String(formData.get("phone") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    specialtyId: String(formData.get("specialtyId") ?? "") || null,
    subSpecialty: String(formData.get("subSpecialty") ?? "").trim() || null,
    addressLine: String(formData.get("addressLine") ?? "").trim() || null,
    city: String(formData.get("city") ?? "").trim() || null,
    sectorId: String(formData.get("sectorId") ?? "") || null,
    delegateId: (await isOwnOnly()) ? user.id : String(formData.get("delegateId") ?? "") || null,
    status: (String(formData.get("status") ?? "NOUVEAU") as DoctorStatus),
    potential: (String(formData.get("potential") ?? "") || null) as DoctorPotential | null,
    visitFrequencyDays: formData.get("visitFrequencyDays") ? Math.round(Number(formData.get("visitFrequencyDays"))) : null,
    comments: String(formData.get("comments") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
    updatedAt: new Date(),
  };
  const brandIds = formData.getAll("brandIds").map(String).filter(Boolean);
  let doctorId = id;
  if (id) {
    await db.update(doctors).set(values).where(eq(doctors.id, id));
  } else {
    const [row] = await db.insert(doctors).values(values).returning();
    doctorId = row.id;
  }
  // Marques concernées : remplacées par la sélection du formulaire.
  await db.delete(doctorBrands).where(eq(doctorBrands.doctorId, doctorId));
  if (brandIds.length) await db.insert(doctorBrands).values(brandIds.map((brandId) => ({ doctorId, brandId })));
  revalidatePath("/medical/medecins");
  revalidatePath(`/medical/medecins/${doctorId}`);
  redirect(`/medical/medecins/${doctorId}`);
}
