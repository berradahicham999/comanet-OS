"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { medicalSpecialties } from "@/db/schema";
import { requireAccess, canDo } from "@/lib/access";

export async function saveSpecialty(formData: FormData) {
  await requireAccess("medical");
  if (!(await canDo("medical", "validate"))) return;
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  if (id) {
    await db.update(medicalSpecialties).set({ name, active: formData.get("active") === "on" }).where(eq(medicalSpecialties.id, id));
  } else {
    await db.insert(medicalSpecialties).values({ name }).onConflictDoNothing();
  }
  revalidatePath("/medical/specialites");
}
