"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { sampleMovements } from "@/db/schema";
import { requireAccess, canDo } from "@/lib/access";
import { iso, today } from "@/lib/format";

export async function addSampleEntry(formData: FormData) {
  const user = await requireAccess("medical");
  if (!(await canDo("medical", "validate"))) return;
  const delegateId = String(formData.get("delegateId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const quantity = Math.round(Number(formData.get("quantity") ?? 0) || 0);
  if (!delegateId || !productId || quantity <= 0) return;
  await db.insert(sampleMovements).values({
    delegateId, productId, type: "ENTREE", quantity,
    date: iso(today()), comment: String(formData.get("comment") ?? "").trim() || null, createdById: user.id,
  });
  revalidatePath("/medical/echantillons");
}
