"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { medicalSectors } from "@/db/schema";
import { requireAccess, canDo } from "@/lib/access";

export async function saveSector(formData: FormData) {
  await requireAccess("medical");
  if (!(await canDo("medical", "validate"))) return;
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim() || null;
  if (!name) return;
  if (id) {
    await db.update(medicalSectors).set({ name, city, active: formData.get("active") === "on" }).where(eq(medicalSectors.id, id));
  } else {
    await db.insert(medicalSectors).values({ name, city });
  }
  revalidatePath("/medical/secteurs");
}
