"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, type TaskPriority } from "@/db/schema";
import { requireUser } from "@/lib/auth";

/** Transforme une recommandation de l'Action Center en tâche assignée. */
export async function createTaskFromRecommendation(formData: FormData): Promise<void> {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!key || !title) return;
  const priority = (String(formData.get("priority") ?? "MEDIUM") as TaskPriority) ?? "MEDIUM";
  const assigneeId = String(formData.get("assigneeId") ?? "") || null;
  const dueDate = String(formData.get("dueDate") ?? "") || null;
  const description = String(formData.get("description") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();
  const brandId = String(formData.get("brandId") ?? "") || null;
  const entityType = String(formData.get("entityType") ?? "") || null;
  const entityId = String(formData.get("entityId") ?? "") || null;
  const expectedImpact = String(formData.get("impact") ?? "") || null;
  const redirectTo = String(formData.get("redirectTo") ?? "") || null;

  // Une seule tâche ouverte par recommandation
  const existing = await db.query.tasks.findFirst({ where: eq(tasks.sourceKey, key) });
  if (existing && (existing.status === "TODO" || existing.status === "IN_PROGRESS")) {
    revalidatePath("/actions");
    return;
  }
  await db.insert(tasks).values({
    title, description: comment ? `${description}\n\nCommentaire : ${comment}` : description, priority, assigneeId, dueDate, brandId,
    source: "ACTION_CENTER", sourceKey: key, entityType, entityId: entityId && /^[0-9a-f-]{36}$/.test(entityId) ? entityId : null,
    expectedImpact, createdById: user.id,
  });
  revalidatePath("/actions");
  revalidatePath("/");
  revalidatePath("/taches");
  if (redirectTo) redirect(redirectTo);
}
