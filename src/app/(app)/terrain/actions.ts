"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { animations, animationLines } from "@/db/schema";
import { requireAccess } from "@/lib/access";

export async function saveAnimation(formData: FormData) {
  const user = await requireAccess("terrain");
  const id = String(formData.get("id") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!clientId || !date) return;
  const status = (String(formData.get("status") ?? "DONE") as "PLANNED" | "DONE" | "CANCELLED");
  const animatriceId = user.role === "ANIMATRICE" ? user.id : String(formData.get("animatriceId") ?? "") || null;
  const values = {
    clientId, date, status, animatriceId,
    brandId: String(formData.get("brandId") ?? "") || null,
    cost: String(Number(formData.get("cost") ?? 0) || 0),
    durationHours: String(formData.get("durationHours") ?? "") || null,
    customersAdvised: Number(formData.get("customersAdvised") ?? 0) || 0,
    samples: Number(formData.get("samples") ?? 0) || 0,
    comment: String(formData.get("comment") ?? "").trim() || null,
    photoUrl: String(formData.get("photoUrl") ?? "").trim() || null,
  };
  // lignes produits : product_0, qty_0, stock_0 …
  const lines: { productId: string; quantitySold: number; stockObserved: number | null }[] = [];
  for (let i = 0; i < 30; i++) {
    const pid = String(formData.get(`product_${i}`) ?? "");
    if (!pid) continue;
    const qty = Number(formData.get(`qty_${i}`) ?? 0) || 0;
    const stockRaw = String(formData.get(`stock_${i}`) ?? "");
    lines.push({ productId: pid, quantitySold: qty, stockObserved: stockRaw === "" ? null : Number(stockRaw) });
  }
  let animId = id;
  if (id) {
    await db.update(animations).set(values).where(eq(animations.id, id));
    await db.delete(animationLines).where(eq(animationLines.animationId, id));
  } else {
    const [row] = await db.insert(animations).values(values).returning();
    animId = row.id;
  }
  if (lines.length) await db.insert(animationLines).values(lines.map((l) => ({ ...l, animationId: animId })));
  revalidatePath("/terrain");
  revalidatePath("/");
  redirect(user.role === "ANIMATRICE" ? `/terrain/saisie?done=1` : `/terrain/${animId}`);
}

export async function deleteAnimation(formData: FormData) {
  const user = await requireAccess("terrain");
  if (user.role === "ANIMATRICE") return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(animations).where(eq(animations.id, id));
  revalidatePath("/terrain");
  redirect("/terrain");
}
