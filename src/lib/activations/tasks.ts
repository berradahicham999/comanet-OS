import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";

/**
 * Tâches My Tasks liées à une activation — idempotentes (une seule tâche ouverte par clé).
 *  - `activation-validation:<id>` : « Valider : … » pour le validateur, ouverte tant que
 *    l'activation attend une validation.
 *  - `activation-pilot:<id>` : « Piloter : … » pour le pilote, ouverte de la validation
 *    jusqu'à la fin de l'activation.
 */
export const validationTaskKey = (id: string) => `activation-validation:${id}`;
export const pilotTaskKey = (id: string) => `activation-pilot:${id}`;

type Open = { id: string }[];
async function openTasks(key: string): Promise<Open> {
  return db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.sourceKey, key), inArray(tasks.status, ["TODO", "IN_PROGRESS"])));
}
async function cancelTasks(open: Open) {
  if (open.length) await db.update(tasks).set({ status: "CANCELLED" }).where(inArray(tasks.id, open.map((t) => t.id)));
}
async function closeTasks(key: string) {
  await db.update(tasks).set({ status: "DONE", completedAt: new Date() }).where(and(eq(tasks.sourceKey, key), inArray(tasks.status, ["TODO", "IN_PROGRESS"])));
}

export type ActivationTaskInput = {
  id: string; name: string; brandId: string | null; responsibleId: string | null; createdById: string | null;
  date: string; prepDate: string | null;
};

/** Ouvre (ou met à jour) la tâche de validation pour `assigneeId` ; la clôt si `assigneeId` est nul. */
export async function syncValidationTask(a: ActivationTaskInput, assigneeId: string | null) {
  const key = validationTaskKey(a.id);
  const open = await openTasks(key);
  if (!assigneeId) { await closeTasks(key); return; }
  const values = { title: `Valider : ${a.name}`, dueDate: a.prepDate ?? a.date, assigneeId, brandId: a.brandId };
  if (open.length) await db.update(tasks).set(values).where(eq(tasks.id, open[0].id));
  else await db.insert(tasks).values({ ...values, source: "MARKETING", sourceKey: key, entityType: "activation", entityId: a.id, createdById: a.createdById, priority: "HIGH", description: "Activation proposée : vérifier le budget prévu, puis valider ou refuser avec un commentaire depuis la fiche ou la file de validation." });
}

/** Tâche du pilote, ouverte quand l'activation est validée et non terminée. */
export async function syncPilotTask(a: ActivationTaskInput, active: boolean) {
  const key = pilotTaskKey(a.id);
  const open = await openTasks(key);
  if (!active) { await closeTasks(key); return; }
  if (!a.responsibleId) { await cancelTasks(open); return; }
  const values = { title: `Piloter : ${a.name}`, dueDate: a.date, assigneeId: a.responsibleId, brandId: a.brandId };
  if (open.length) await db.update(tasks).set(values).where(eq(tasks.id, open[0].id));
  else await db.insert(tasks).values({ ...values, source: "MARKETING", sourceKey: key, entityType: "activation", entityId: a.id, createdById: a.createdById, priority: "MEDIUM", description: "Préparer l'activation : cocher la checklist, sortir le matériel, saisir les dépenses puis les résultats sur la fiche." });
}

/** Tout clore (annulation, archivage). */
export async function closeActivationTasks(activationId: string) {
  await closeTasks(validationTaskKey(activationId));
  await closeTasks(pilotTaskKey(activationId));
}
