import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentItems, contentStatusHistory, brandValidators } from "@/db/schema";
import { getAccess } from "@/lib/permissions";
import { isAdmin } from "@/lib/permissions-shared";
import type { SessionUser } from "@/lib/auth";
import { contentRefs } from "./refs";
import { checkTransition } from "./shared";
import { notify } from "./notify";
import { closeBriefTask } from "./tasks";
import { refreshAfterWrite } from "@/lib/analytics-marketing/refresh";

/**
 * Qui peut « valider » un contenu de cette marque ?
 *  - un administrateur ;
 *  - une personne avec le droit « Valider » sur le module Marketing ;
 *  - un validateur déclaré pour la marque (`brand_validators`).
 * Définition unique : utilisée par la transition, la file de validation et l'affichage des boutons.
 */
export async function canValidateBrand(brandId: string): Promise<boolean> {
  const a = await getAccess();
  if (!a) return false;
  if (isAdmin(a.perms) || a.perms.marketing?.validate) return true;
  const r = await db.select({ b: brandValidators.brandId }).from(brandValidators).where(sql`${brandValidators.brandId} = ${brandId}::uuid and ${brandValidators.userId} = ${a.user.id}::uuid`);
  return r.length > 0;
}

/** Personnes à prévenir quand un contenu attend une validation. */
async function validatorsFor(brandId: string, validatorId: string | null): Promise<string[]> {
  if (validatorId) return [validatorId];
  const r = await db.execute<{ id: string }>(sql`
    select distinct u.id from users u
    where u.active and (
      exists (select 1 from brand_validators bv where bv.user_id = u.id and bv.brand_id = ${brandId}::uuid)
      or exists (select 1 from user_permissions p where p.user_id = u.id and p.module = 'marketing' and p.can_validate)
      or exists (select 1 from user_permissions p where p.user_id = u.id and p.module = 'administration' and p.can_validate))`);
  return r.rows.map((x) => x.id);
}

export type TransitionResult = { ok: true; to: string } | { ok: false; reason: string };

/**
 * LA fonction de changement de statut. Vérifie la transition (référentiel en base), les
 * droits, le commentaire obligatoire ; écrit l'historique ; notifie ; synchronise la tâche.
 * Aucune page ne met à jour `content_items.status` autrement.
 */
export async function transition(contentId: string, to: string, user: SessionUser, comment?: string | null): Promise<TransitionResult> {
  const rows = await db.select({
    id: contentItems.id, status: contentItems.status, brandId: contentItems.brandId, title: contentItems.title,
    responsibleId: contentItems.responsibleId, validatorId: contentItems.validatorId, createdById: contentItems.createdById,
  }).from(contentItems).where(eq(contentItems.id, contentId));
  const c = rows[0];
  if (!c) return { ok: false, reason: "Contenu introuvable." };

  const refs = await contentRefs();
  const isValidator = await canValidateBrand(c.brandId);
  const check = checkTransition(refs.transitions, c.status, to, { isValidator, comment });
  if (!check.ok) return check;

  const target = refs.statuses.find((s) => s.key === to);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(contentItems).set({
      status: to, updatedAt: now,
      ...(target?.isPublished ? { publishedAt: now } : {}),
      ...(target?.isArchived ? { archivedAt: now } : {}),
    }).where(eq(contentItems.id, contentId));
    await tx.insert(contentStatusHistory).values({ contentId, fromStatus: c.status, toStatus: to, userId: user.id, comment: comment?.trim() || null });
  });

  const href = `/marketing/planning/${contentId}`;
  const from = refs.statuses.find((s) => s.key === c.status);
  const label = target?.label ?? to;
  if (target?.awaitingValidation) {
    await notify(await validatorsFor(c.brandId, c.validatorId), { type: "VALIDATION_REQUESTED", title: `À valider : ${c.title}`, body: `${user.name} demande votre validation.`, href, entityType: "content", entityId: contentId }, { except: user.id });
  } else if (from?.awaitingValidation && target && !target.isPublished && !target.isArchived && target.inProduction) {
    await notify([c.responsibleId, c.createdById], { type: "CORRECTIONS_REQUESTED", title: `Corrections demandées : ${c.title}`, body: comment?.trim() || null, href, entityType: "content", entityId: contentId }, { except: user.id });
  } else if (from?.awaitingValidation && target && !target.inProduction) {
    await notify([c.responsibleId, c.createdById], { type: "CONTENT_VALIDATED", title: `Validé : ${c.title}`, body: comment?.trim() || `Statut : ${label}.`, href, entityType: "content", entityId: contentId }, { except: user.id });
  }
  // La production est terminée dès que le contenu est validé, publié ou archivé.
  const validatedNow = !!from?.awaitingValidation && !!target && !target.inProduction && !target.awaitingValidation;
  if (target?.isPublished || target?.isArchived || validatedNow) await closeBriefTask(contentId);
  await refreshAfterWrite(["CONTENT"]);
  return { ok: true, to };
}
