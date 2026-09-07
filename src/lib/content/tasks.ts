import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";

/** Clé stable de la tâche « produire ce brief » — une seule tâche ouverte par contenu. */
export const briefTaskKey = (contentId: string) => `content-brief:${contentId}`;

/**
 * Un brief assigné crée une tâche dans My Tasks pour le responsable création.
 * Idempotent : si une tâche ouverte existe déjà pour ce contenu, elle est mise à jour
 * (titre, échéance, assigné) au lieu d'être dupliquée.
 */
export async function syncBriefTask(c: { id: string; title: string; brandId: string; responsibleId: string | null; deadline: string | null; date: string; createdById: string | null }) {
  const key = briefTaskKey(c.id);
  const open = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.sourceKey, key), inArray(tasks.status, ["TODO", "IN_PROGRESS"])));
  if (!c.responsibleId) {
    // Plus de responsable : la tâche ouverte est annulée plutôt que laissée orpheline.
    if (open.length) await db.update(tasks).set({ status: "CANCELLED" }).where(inArray(tasks.id, open.map((t) => t.id)));
    return;
  }
  const values = { title: `Produire : ${c.title}`, dueDate: c.deadline ?? c.date, assigneeId: c.responsibleId, brandId: c.brandId };
  if (open.length) await db.update(tasks).set(values).where(eq(tasks.id, open[0].id));
  else await db.insert(tasks).values({ ...values, source: "MARKETING", sourceKey: key, entityType: "content", entityId: c.id, createdById: c.createdById, priority: "MEDIUM", description: "Brief à produire depuis le planning éditorial. Déposer le livrable sur la fiche contenu, puis demander la validation." });
}

/** Le contenu a atteint un statut qui clôt la production : la tâche est terminée. */
export async function closeBriefTask(contentId: string) {
  await db.update(tasks).set({ status: "DONE", completedAt: new Date() })
    .where(and(eq(tasks.sourceKey, briefTaskKey(contentId)), inArray(tasks.status, ["TODO", "IN_PROGRESS"])));
}
