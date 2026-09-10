"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, taskComments, type TaskPriority, type TaskStatus } from "@/db/schema";
import { requireAccess, isOwnOnly, canDo, requirePermission } from "@/lib/access";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;

export async function saveTask(formData: FormData) {
  const user = await requireAccess("taches");
  const id = str(formData, "id");
  const title = str(formData, "title");
  if (!title) return;
  const entityId = str(formData, "entityId");
  const values = {
    title,
    description: str(formData, "description"),
    priority: (str(formData, "priority") ?? "MEDIUM") as TaskPriority,
    dueDate: str(formData, "dueDate"),
    assigneeId: (await isOwnOnly()) ? user.id : str(formData, "assigneeId"),
    brandId: str(formData, "brandId"),
    entityType: str(formData, "entityType"),
    entityId: entityId && /^[0-9a-f-]{36}$/.test(entityId) ? entityId : null,
    expectedImpact: str(formData, "expectedImpact"),
  };
  if (id) {
    await db.update(tasks).set(values).where(eq(tasks.id, id));
    revalidatePath(`/taches/${id}`);
    revalidatePath("/taches");
  } else {
    const [row] = await db.insert(tasks).values({ ...values, createdById: user.id, source: (str(formData, "source") as "MANUAL" | null) ?? "MANUAL" }).returning();
    revalidatePath("/taches");
    const back = str(formData, "redirectTo");
    redirect(back ?? `/taches/${row.id}`);
  }
}

export async function setTaskStatus(formData: FormData) {
  await requireAccess("taches");
  const id = str(formData, "id");
  const status = str(formData, "status") as TaskStatus | null;
  if (!id || !status) return;
  await db.update(tasks).set({ status, completedAt: status === "DONE" ? new Date() : null }).where(eq(tasks.id, id));
  revalidatePath(`/taches/${id}`);
  revalidatePath("/taches");
  revalidatePath("/actions");
  revalidatePath("/");
  const back = str(formData, "redirectTo");
  if (back) redirect(back);
}

export async function addComment(formData: FormData) {
  const user = await requireAccess("taches");
  const taskId = str(formData, "taskId");
  const body = str(formData, "body");
  if (!taskId || !body) return;
  await db.insert(taskComments).values({ taskId, userId: user.id, body });
  revalidatePath(`/taches/${taskId}`);
}

export async function deleteTask(formData: FormData) {
  await requireAccess("taches");
  if (!(await canDo("taches", "validate"))) return;
  const id = str(formData, "id");
  if (!id) return;
  await db.delete(tasks).where(eq(tasks.id, id));
  revalidatePath("/taches");
  redirect("/taches");
}

/** Tâche proposée par le copilote : accepter (→ À faire) ou refuser (→ annulée). Une personne, jamais l'IA, décide. */
export async function decideProposedTask(formData: FormData) {
  const user = await requirePermission("taches", "edit");
  const id = str(formData, "id");
  const decision = str(formData, "decision");
  if (!id || (decision !== "accept" && decision !== "refuse")) return;
  const assigneeId = str(formData, "assigneeId") || null;
  await db.update(tasks)
    .set(decision === "accept" ? { status: "TODO", assigneeId: assigneeId ?? user.id } : { status: "CANCELLED", completedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.status, "PROPOSED")));
  revalidatePath("/taches");
  revalidatePath("/");
  redirect("/taches?view=proposed");
}
