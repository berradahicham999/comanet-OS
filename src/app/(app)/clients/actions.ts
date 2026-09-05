"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireAccess } from "@/lib/access";

export async function updateClient(formData: FormData) {
  await requireAccess("clients");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const type = String(formData.get("type") ?? "AUTRE") as "PHARMACIE" | "PARAPHARMACIE" | "GROSSISTE" | "AUTRE";
  await db.update(clients).set({
    name: String(formData.get("name") ?? "").trim() || undefined,
    type,
    city: String(formData.get("city") ?? "").trim() || null,
    channel: String(formData.get("channel") ?? "").trim() || null,
    salesRep: String(formData.get("salesRep") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    active: formData.get("active") === "on",
    needsReview: false,
  }).where(eq(clients.id, id));
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
}
