import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activations, activationStatusHistory } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import { notify } from "@/lib/content/notify";
import { activationRefs } from "./refs";
import { checkTransition } from "./shared";
import { canValidateActivation, activationValidators } from "./access";
import { syncActivationExpenses } from "./budget";
import { syncValidationTask, syncPilotTask, closeActivationTasks } from "./tasks";

export type TransitionResult = { ok: true; to: string } | { ok: false; reason: string };

/**
 * LA fonction de changement de statut d'une activation. Vérifie la transition (référentiel
 * en base), les droits, le commentaire obligatoire ; écrit l'historique ; synchronise le
 * reflet budgétaire, les tâches et les notifications. Aucune page ne met à jour
 * `activations.status` autrement.
 */
export async function transitionActivation(activationId: string, to: string, user: SessionUser, comment?: string | null): Promise<TransitionResult> {
  const rows = await db.select({
    id: activations.id, status: activations.status, brandId: activations.brandId, name: activations.name,
    responsibleId: activations.responsibleId, validatorId: activations.validatorId, createdById: activations.createdById,
    date: activations.date, prepDate: activations.prepDate,
  }).from(activations).where(eq(activations.id, activationId));
  const a = rows[0];
  if (!a) return { ok: false, reason: "Activation introuvable." };

  const refs = await activationRefs();
  const isValidator = await canValidateActivation(a.brandId);
  const check = checkTransition(refs.transitions, a.status, to, { isValidator, comment });
  if (!check.ok) return check;

  const from = refs.statuses.find((s) => s.key === a.status);
  const target = refs.statuses.find((s) => s.key === to);
  if (!target) return { ok: false, reason: "Statut cible inconnu." };
  const now = new Date();
  const text = comment?.trim() || null;
  await db.transaction(async (tx) => {
    await tx.update(activations).set({
      status: to, updatedAt: now,
      ...(target.isValidated && !from?.isValidated ? { validatedAt: now } : {}),
      ...(target.isMeasured && !from?.isMeasured ? { measuredAt: now } : {}),
    }).where(eq(activations.id, activationId));
    await tx.insert(activationStatusHistory).values({ activationId, fromStatus: a.status, toStatus: to, userId: user.id, comment: text });
  });

  // Reflet budgétaire : engagé dès la validation, retiré à l'annulation.
  await syncActivationExpenses(activationId);

  // Tâches : validation ouverte tant que ça attend, pilotage ouvert de la validation à la fin.
  const taskInput = { id: a.id, name: a.name, brandId: a.brandId, responsibleId: a.responsibleId, createdById: a.createdById, date: a.date, prepDate: a.prepDate };
  const validatorIds = target.awaitingValidation ? await activationValidators(a.brandId, a.validatorId) : [];
  if (target.isArchived || target.isCancelled) await closeActivationTasks(activationId);
  else {
    await syncValidationTask(taskInput, target.awaitingValidation ? (a.validatorId ?? validatorIds[0] ?? null) : null);
    await syncPilotTask(taskInput, target.isValidated && !target.isDone);
  }

  // Notifications in-app.
  const href = `/marketing/activations/${activationId}`;
  const base = { href, entityType: "activation", entityId: activationId } as const;
  const team = [a.responsibleId, a.createdById];
  if (target.awaitingValidation) {
    await notify(validatorIds, { type: "VALIDATION_REQUESTED", title: `À valider : ${a.name}`, body: `${user.name} propose cette activation.`, ...base }, { except: user.id });
  } else if (from?.awaitingValidation && target.isValidated) {
    await notify(team, { type: "ACTIVATION_VALIDATED", title: `Validée : ${a.name}`, body: text ?? "Le budget prévu est engagé. La préparation peut commencer.", ...base }, { except: user.id });
  } else if (from?.awaitingValidation && !target.isValidated && !target.isCancelled) {
    await notify(team, { type: "ACTIVATION_REFUSED", title: `Refusée : ${a.name}`, body: text, ...base }, { except: user.id });
  } else if (target.isCancelled) {
    await notify(team, { type: "ACTIVATION_CANCELLED", title: `Annulée : ${a.name}`, body: text, ...base }, { except: user.id });
  }
  return { ok: true, to };
}
