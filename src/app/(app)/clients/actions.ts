"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { asSector, cityToSector } from "@/lib/sectors";

export async function updateClient(formData: FormData) {
  await requireAccess("clients");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const type = String(formData.get("type") ?? "AUTRE") as "PHARMACIE" | "PARAPHARMACIE" | "GROSSISTE" | "AUTRE";
  const city = String(formData.get("city") ?? "").trim() || null;
  // Secteur choisi à la main, sinon déduit de la ville.
  const sector = asSector(formData.get("sector")) ?? cityToSector(city);
  await db.update(clients).set({
    name: String(formData.get("name") ?? "").trim() || undefined,
    type,
    city,
    sector,
    channel: String(formData.get("channel") ?? "").trim() || null,
    salesRep: String(formData.get("salesRep") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    active: formData.get("active") === "on",
    needsReview: false,
  }).where(eq(clients.id, id));
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
}
