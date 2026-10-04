/**
 * Statut humain des décisions — seule écriture de `marketing_decisions`.
 *
 * Approuver crée l'action marketing (donc sa tâche) et enregistre l'instantané de la recommandation ;
 * refuser garde la raison (et écarte la recommandation de l'Action Center quand elle en vient, pour que les
 * deux écrans disent la même chose) ; l'exécution est déduite de la tâche (DONE) ; mesurer note le résultat
 * observé. Une décision approuvée dont la date de revue est passée sans exécution devient EXPIRÉE à la lecture.
 */
import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { marketingDecisions, type MarketingDecisionStatus } from "@/db/schema";
import { audit, type AuditActor } from "@/lib/audit";
import { createAction, type ActionInput } from "@/lib/marketing-plan/actions";
import { dismissRecommendation, restoreRecommendation } from "@/lib/rules/dismissals";
import { allRecommendations } from "@/lib/rules";
import type { DecisionState, UnifiedDecision } from "./types";
import { effectiveStatus } from "./store-shared";

export async function decisionStates(keys: string[]): Promise<Map<string, DecisionState>> {
  if (!keys.length) return new Map();
  const r = await db.execute(sql`
    select d.key, d.status::text as status, d.decided_by_name, d.decided_at::text as decided_at, d.reason, d.action_id, a.task_id, t.status::text as task_status, d.expected_review_date::text as expected_review_date, d.measured_note
    from marketing_decisions d left join marketing_actions a on a.id = d.action_id left join tasks t on t.id = a.task_id
    where d.key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`);
  return new Map((r.rows as Record<string, unknown>[]).map((x) => [String(x.key), {
    status: x.status as MarketingDecisionStatus, decidedBy: x.decided_by_name ? String(x.decided_by_name) : null, decidedAt: x.decided_at ? String(x.decided_at) : null, reason: x.reason ? String(x.reason) : null,
    actionId: x.action_id ? String(x.action_id) : null, taskId: x.task_id ? String(x.task_id) : null, taskStatus: x.task_status ? String(x.task_status) : null,
    expectedReviewDate: x.expected_review_date ? String(x.expected_review_date) : null, measuredNote: x.measured_note ? String(x.measured_note) : null,
  }]));
}

export { effectiveStatus };

/** Décisions dont le statut effectif a changé depuis la dernière écriture : on l'enregistre pour l'historique. */
export async function persistEffectiveStatuses(states: Map<string, DecisionState>, todayIso: string): Promise<void> {
  const changed = [...states.entries()].filter(([, s]) => effectiveStatus(s, todayIso) !== s.status);
  for (const [key, s] of changed) {
    const status = effectiveStatus(s, todayIso);
    await db.update(marketingDecisions).set({ status, updatedAt: new Date() }).where(eq(marketingDecisions.key, key));
    s.status = status;
  }
}

/** Décisions de la liste des « décidées » (toutes marques du périmètre), pour l'historique de la page Priorités. */
export async function decidedDecisions(brandIds: string[] | null, limit = 50) {
  const r = await db.execute(sql`
    select d.key, d.domain, d.title, d.status::text as status, d.reason, d.decided_by_name, d.decided_at::text as decided_at, d.expected_review_date::text as expected_review_date, d.measured_note, d.snapshot, d.action_id, b.name as brand_name,
      a.task_id, t.status::text as task_status
    from marketing_decisions d left join brands b on b.id = d.brand_id left join marketing_actions a on a.id = d.action_id left join tasks t on t.id = a.task_id
    where d.status <> 'PROPOSED' ${brandIds ? sql`and (d.brand_id is null or d.brand_id = any(${sql.raw(`'{${brandIds.join(",")}}'::uuid[]`)}))` : sql``}
    order by d.decided_at desc nulls last limit ${limit}`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    key: String(x.key), domain: String(x.domain), title: String(x.title), status: x.status as MarketingDecisionStatus, reason: x.reason ? String(x.reason) : null,
    decidedBy: x.decided_by_name ? String(x.decided_by_name) : null, decidedAt: x.decided_at ? String(x.decided_at) : null, expectedReviewDate: x.expected_review_date ? String(x.expected_review_date) : null,
    measuredNote: x.measured_note ? String(x.measured_note) : null, snapshot: (x.snapshot ?? {}) as Partial<UnifiedDecision>, actionId: x.action_id ? String(x.action_id) : null, brandName: x.brand_name ? String(x.brand_name) : null,
    taskId: x.task_id ? String(x.task_id) : null, taskStatus: x.task_status ? String(x.task_status) : null,
  }));
}

async function upsertState(d: UnifiedDecision, patch: { status: MarketingDecisionStatus; reason?: string | null; actionId?: string | null; measuredNote?: string | null; expectedReviewDate?: string | null }, actor: AuditActor) {
  const snapshot = { ...d, state: undefined } as unknown as Record<string, unknown>;
  const values = {
    key: d.id, domain: d.domain, brandId: d.brandId, productId: d.productId, title: d.title, snapshot, status: patch.status, reason: patch.reason ?? null,
    decidedById: actor.id, decidedByName: actor.name, decidedAt: new Date(), actionId: patch.actionId ?? null, expectedReviewDate: patch.expectedReviewDate ?? d.expectedReviewDate,
    measuredNote: patch.measuredNote ?? null, measuredAt: patch.status === "MEASURED" ? new Date() : null, updatedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    const before = await tx.query.marketingDecisions.findFirst({ where: eq(marketingDecisions.key, d.id) });
    await tx.insert(marketingDecisions).values(values).onConflictDoUpdate({ target: marketingDecisions.key, set: { ...values, actionId: patch.actionId ?? before?.actionId ?? null, measuredNote: patch.measuredNote ?? before?.measuredNote ?? null } });
    await audit({ actor, action: patch.status, module: "marketing", entity: "marketing_decision", entityId: before?.id ?? null, label: d.title, before: before ? { status: before.status } : undefined, after: { status: patch.status, reason: patch.reason ?? null, actionId: patch.actionId ?? null } }, tx);
  });
}

/** Approuver = créer l'action (et sa tâche) puis enregistrer la décision avec son instantané. */
export async function approveDecision(d: UnifiedDecision, input: Omit<ActionInput, "brandId" | "source" | "decisionKey"> & { brandId?: string | null }, actor: AuditActor): Promise<{ actionId: string; taskId: string }> {
  const brandId = input.brandId ?? d.brandId;
  if (!brandId) throw new Error("Cette décision n'a pas de marque : choisir la marque de l'action.");
  const created = await createAction({ ...input, brandId, source: "DECISION", decisionKey: d.id, productId: input.productId ?? d.productId, category: input.category ?? d.category, why: input.why ?? d.why.join(" ; "), expectedResult: input.expectedResult ?? d.impact }, actor);
  await upsertState(d, { status: "APPROVED", actionId: created.id }, actor);
  return { actionId: created.id, taskId: created.taskId };
}

/** Refuser = statut REJETÉE avec la raison ; une recommandation de l'Action Center est aussi écartée (30 j). */
export async function rejectDecision(d: UnifiedDecision, reason: string | null, actor: AuditActor): Promise<void> {
  await upsertState(d, { status: "REJECTED", reason }, actor);
  if (d.domain === "RULES" || d.domain === "ANALYTICS") {
    const rec = (await allRecommendations()).find((r) => r.key === d.id);
    if (rec && !rec.dismissed) await dismissRecommendation(rec, actor, reason);
  }
}

/** Revenir sur un refus : la décision redevient proposée (et la recommandation revient dans l'Action Center). */
export async function reopenDecision(key: string, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await tx.query.marketingDecisions.findFirst({ where: eq(marketingDecisions.key, key) });
    if (!before) return;
    await tx.update(marketingDecisions).set({ status: "PROPOSED", reason: null, decidedById: actor.id, decidedByName: actor.name, decidedAt: new Date(), updatedAt: new Date() }).where(eq(marketingDecisions.key, key));
    await audit({ actor, action: "RESTORE", module: "marketing", entity: "marketing_decision", entityId: before.id, label: before.title, before: { status: before.status }, after: { status: "PROPOSED" } }, tx);
  });
  await restoreRecommendation(key, actor);
}

/** Mesurer = noter le résultat observé (corrélation observée, jamais une attribution inventée). */
export async function measureDecision(key: string, note: string, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await tx.query.marketingDecisions.findFirst({ where: eq(marketingDecisions.key, key) });
    if (!before) throw new Error("Décision introuvable.");
    await tx.update(marketingDecisions).set({ status: "MEASURED", measuredNote: note, measuredAt: new Date(), updatedAt: new Date() }).where(eq(marketingDecisions.key, key));
    await audit({ actor, action: "MEASURED", module: "marketing", entity: "marketing_decision", entityId: before.id, label: before.title, before: { status: before.status }, after: { status: "MEASURED", note } }, tx);
  });
}

export async function decisionsByAction(actionIds: string[]): Promise<Map<string, { key: string; status: MarketingDecisionStatus; domain: string }>> {
  if (!actionIds.length) return new Map();
  const rows = await db.select({ key: marketingDecisions.key, status: marketingDecisions.status, domain: marketingDecisions.domain, actionId: marketingDecisions.actionId }).from(marketingDecisions).where(inArray(marketingDecisions.actionId, actionIds));
  return new Map(rows.filter((r) => r.actionId).map((r) => [r.actionId as string, { key: r.key, status: r.status, domain: r.domain }]));
}
