"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentPlatforms, contentFormats, contentObjectives, contentStatuses, contentStatusTransitions, brandValidators } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { refKey } from "@/lib/content/shared";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
const int = (fd: FormData, k: string, d = 0) => { const n = Number(str(fd, k)); return Number.isFinite(n) ? Math.round(n) : d; };
const PAGE = "/parametres/contenus";
function done() { revalidatePath(PAGE); revalidatePath("/marketing/planning"); }

/** Une clé stable : celle saisie (existante) ou dérivée du libellé (création). */
function keyOf(fd: FormData) { const k = str(fd, "key"); const label = str(fd, "label"); return k ?? (label ? refKey(label) : null); }

export async function savePlatform(fd: FormData) {
  await requireAdmin();
  const key = keyOf(fd); const label = str(fd, "label"); if (!key || !label) return;
  const ratios = (str(fd, "ratios") ?? "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
  const maxDurationSec = Number(str(fd, "maxDurationSec")); const notes = str(fd, "notes");
  const specs = { ...(ratios.length ? { ratios } : {}), ...(Number.isFinite(maxDurationSec) && maxDurationSec > 0 ? { maxDurationSec } : {}), ...(notes ? { notes } : {}) };
  const values = { label, icon: str(fd, "icon"), sort: int(fd, "sort"), active: fd.get("active") !== null, specs };
  await db.insert(contentPlatforms).values({ key, ...values }).onConflictDoUpdate({ target: contentPlatforms.key, set: values });
  done();
}

export async function saveFormat(fd: FormData) {
  await requireAdmin();
  const key = keyOf(fd); const label = str(fd, "label"); if (!key || !label) return;
  const values = { label, sort: int(fd, "sort"), active: fd.get("active") !== null, defaultDeliverable: str(fd, "defaultDeliverable") };
  await db.insert(contentFormats).values({ key, ...values }).onConflictDoUpdate({ target: contentFormats.key, set: values });
  done();
}

export async function saveObjective(fd: FormData) {
  await requireAdmin();
  const key = keyOf(fd); const label = str(fd, "label"); if (!key || !label) return;
  const values = { label, sort: int(fd, "sort"), active: fd.get("active") !== null };
  await db.insert(contentObjectives).values({ key, ...values }).onConflictDoUpdate({ target: contentObjectives.key, set: values });
  done();
}

export async function saveStatus(fd: FormData) {
  await requireAdmin();
  const key = keyOf(fd); const label = str(fd, "label"); if (!key || !label) return;
  const values = {
    label, tone: str(fd, "tone") ?? "gray", sort: int(fd, "sort"), active: fd.get("active") !== null,
    isPublished: fd.get("isPublished") !== null, isArchived: fd.get("isArchived") !== null,
    awaitingValidation: fd.get("awaitingValidation") !== null, inProduction: fd.get("inProduction") !== null,
  };
  await db.insert(contentStatuses).values({ key, ...values }).onConflictDoUpdate({ target: contentStatuses.key, set: values });
  done();
}

/** Désactiver plutôt que supprimer : un statut référencé par des contenus ne peut pas disparaître. */
export async function deleteRef(fd: FormData) {
  await requireAdmin();
  const kind = str(fd, "kind"); const key = str(fd, "key"); if (!kind || !key) return;
  try {
    if (kind === "platform") await db.delete(contentPlatforms).where(eq(contentPlatforms.key, key));
    else if (kind === "format") await db.delete(contentFormats).where(eq(contentFormats.key, key));
    else if (kind === "objective") await db.delete(contentObjectives).where(eq(contentObjectives.key, key));
    else if (kind === "status") await db.delete(contentStatuses).where(eq(contentStatuses.key, key));
  } catch {
    // Référencé par des contenus (clé étrangère) : on le désactive à la place.
    const t = { platform: contentPlatforms, format: contentFormats, objective: contentObjectives, status: contentStatuses }[kind];
    if (t) await db.update(t).set({ active: false }).where(eq(t.key, key));
  }
  done();
}

export async function saveTransition(fd: FormData) {
  await requireAdmin();
  const fromKey = str(fd, "fromKey"); const toKey = str(fd, "toKey"); if (!fromKey || !toKey || fromKey === toKey) return;
  const values = { requiresValidator: fd.get("requiresValidator") !== null, requiresComment: fd.get("requiresComment") !== null, label: str(fd, "label") };
  await db.insert(contentStatusTransitions).values({ fromKey, toKey, ...values }).onConflictDoUpdate({ target: [contentStatusTransitions.fromKey, contentStatusTransitions.toKey], set: values });
  done();
}

export async function deleteTransition(fd: FormData) {
  await requireAdmin();
  const fromKey = str(fd, "fromKey"); const toKey = str(fd, "toKey"); if (!fromKey || !toKey) return;
  await db.delete(contentStatusTransitions).where(and(eq(contentStatusTransitions.fromKey, fromKey), eq(contentStatusTransitions.toKey, toKey)));
  done();
}

export async function saveBrandValidators(fd: FormData) {
  await requireAdmin();
  const brandId = str(fd, "brandId"); if (!brandId) return;
  const ids = fd.getAll("userIds").map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  await db.transaction(async (tx) => {
    await tx.delete(brandValidators).where(eq(brandValidators.brandId, brandId));
    if (ids.length) await tx.insert(brandValidators).values(ids.map((userId) => ({ brandId, userId }))).onConflictDoNothing();
  });
  revalidatePath(PAGE); revalidatePath("/marketing/planning/validation");
}

/** Petit garde-fou : au moins un statut « en attente de validation » actif, sinon la file de validation est vide par construction. */
export async function checkConsistency() {
  const r = await db.execute<{ awaiting: number; published: number; archived: number }>(sql`select
    (select count(*) from content_statuses where active and awaiting_validation)::int as awaiting,
    (select count(*) from content_statuses where active and is_published)::int as published,
    (select count(*) from content_statuses where active and is_archived)::int as archived`);
  return r.rows[0];
}
