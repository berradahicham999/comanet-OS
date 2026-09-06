"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { medicalDelegates, medicalDelegateSectors } from "@/db/schema";
import { requireAccess } from "@/lib/access";

export async function saveDelegateProfile(formData: FormData) {
  const user = await requireAccess("medical");
  if (user.role === "DELEGUE_MEDICAL") return;
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;
  const values = {
    userId,
    zone: String(formData.get("zone") ?? "").trim() || null,
    monthlyVisitObjective: Math.max(0, Math.round(Number(formData.get("monthlyVisitObjective") ?? 0) || 0)),
    weeklyVisitObjective: Math.max(0, Math.round(Number(formData.get("weeklyVisitObjective") ?? 0) || 0)),
    managerId: String(formData.get("managerId") ?? "") || null,
  };
  const [row] = await db
    .insert(medicalDelegates)
    .values(values)
    .onConflictDoUpdate({ target: medicalDelegates.userId, set: values })
    .returning();

  const sectorIds = formData.getAll("sectorIds").map(String).filter(Boolean);
  await db.delete(medicalDelegateSectors).where(eq(medicalDelegateSectors.delegateId, row.id));
  if (sectorIds.length) await db.insert(medicalDelegateSectors).values(sectorIds.map((sectorId) => ({ delegateId: row.id, sectorId })));

  revalidatePath("/medical/delegues");
  revalidatePath(`/medical/delegues/${userId}`);
}
