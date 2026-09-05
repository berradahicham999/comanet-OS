"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { requireAccess } from "@/lib/access";

export async function updateBrand(formData: FormData) {
  await requireAccess("marques");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.update(brands).set({
    positioning: String(formData.get("positioning") ?? "").trim() || null,
    target: String(formData.get("target") ?? "").trim() || null,
    objectives: String(formData.get("objectives") ?? "").trim() || null,
    color: String(formData.get("color") ?? "#0f766e"),
    aliases: String(formData.get("aliases") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    active: formData.get("active") === "on",
  }).where(eq(brands.id, id));
  revalidatePath(`/marques/${id}`);
  revalidatePath("/marques");
}
