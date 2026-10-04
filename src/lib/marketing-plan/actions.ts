/**
 * Actions marketing — lecture et écriture (serveur).
 *
 * Une action = une ligne `marketing_actions` (plan, axe, mois, produit, canal, budget prévu, justification,
 * résultat attendu) + UNE tâche (`tasks`, source MARKETING, `entity_type = 'marketing_action'`) qui porte
 * le responsable, l'échéance, la priorité et le statut. `createAction()` est la seule création : les deux
 * lignes naissent dans la même transaction. Le statut se change sur la tâche (`setActionStatus()`), jamais
 * ailleurs : le kanban des tâches et la page Priorités voient la même chose. La dépense réelle d'une action
 * est la somme de ses `marketing_expenses.action_id` (engagé = COMMITTED + SPENT, comme `budget.ts`).
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { marketingActions, marketingExpenses, tasks, type BudgetCategory, type MarketingActionSource, type TaskPriority, type TaskStatus } from "@/db/schema";
import { audit, type AuditActor } from "@/lib/audit";
import { engagedSql } from "@/lib/budget";
import { pgArray } from "@/lib/sql-array";
import { refreshAfterWrite } from "@/lib/analytics-marketing/refresh";
import { actionTaskKey, isOpenStatus } from "./shared";

export type ActionRow = {
  id: string; planId: string | null; planName: string | null; axisId: string | null; axisName: string | null; month: string | null;
  brandId: string; brandName: string; brandColor: string; productId: string | null; productName: string | null; campaignId: string | null; campaignName: string | null;
  category: BudgetCategory | null; title: string; objective: string | null; why: string | null; expectedResult: string | null; budgetPlanned: number;
  source: MarketingActionSource; decisionKey: string | null;
  taskId: string; status: TaskStatus; priority: TaskPriority; dueDate: string | null; assigneeId: string | null; assigneeName: string | null;
  /** Dépense engagée + dépensée rattachée (`marketing_expenses.action_id`, hors PLANNED). */
  committed: number; spent: number; expenses: number;
  createdAt: string; completedAt: string | null;
  /** Générateur d'actions : modèle, jour J, activation d'exécution, fiche figée. */
  templateKey: string | null; eventDate: string | null; activationId: string | null; spec: Record<string, unknown> | null;
  /** Tâches d'exécution (rétroplanning) rattachées à l'action, hors tâche principale. */
  stepsTotal: number; stepsDone: number;
};

export type ActionFilter = { brandIds?: string[] | null; brandId?: string | null; planId?: string | null; axisId?: string | null; month?: string | null; assigneeId?: string | null; includeDone?: boolean; limit?: number };

export async function listActions(f: ActionFilter = {}): Promise<ActionRow[]> {
  const r = await db.execute(sql`
    select a.id, a.plan_id, p.name as plan_name, a.axis_id, ax.name as axis_name, a.month::text as month,
      a.brand_id, b.name as brand_name, b.color as brand_color, a.product_id, pr.name as product_name, a.campaign_id, c.name as campaign_name,
      a.category::text as category, a.title, a.objective, a.why, a.expected_result, a.budget_planned::float8 as budget_planned, a.source::text as source, a.decision_key,
      a.task_id, t.status::text as status, t.priority::text as priority, t.due_date::text as due_date, t.assignee_id, u.name as assignee_name, a.created_at::text as created_at, t.completed_at::text as completed_at,
      coalesce((select sum(e.amount) from marketing_expenses e where (e.action_id = a.id or (a.activation_id is not null and e.activation_id = a.activation_id and e.action_id is null)) and ${engagedSql("e")}), 0)::float8 as committed,
      coalesce((select sum(e.amount) from marketing_expenses e where (e.action_id = a.id or (a.activation_id is not null and e.activation_id = a.activation_id and e.action_id is null)) and e.status = 'SPENT'), 0)::float8 as spent,
      (select count(*) from marketing_expenses e where e.action_id = a.id or (a.activation_id is not null and e.activation_id = a.activation_id and e.action_id is null))::int as expenses,
      a.template_key, a.event_date::text as event_date, a.activation_id, a.spec,
      (select count(*) from tasks st where st.entity_type = 'marketing_action' and st.entity_id = a.id and st.id <> a.task_id and st.status <> 'CANCELLED')::int as steps_total,
      (select count(*) from tasks st where st.entity_type = 'marketing_action' and st.entity_id = a.id and st.id <> a.task_id and st.status = 'DONE')::int as steps_done
    from marketing_actions a
    join tasks t on t.id = a.task_id
    join brands b on b.id = a.brand_id
    left join marketing_plans p on p.id = a.plan_id
    left join marketing_axes ax on ax.id = a.axis_id
    left join products pr on pr.id = a.product_id
    left join campaigns c on c.id = a.campaign_id
    left join users u on u.id = t.assignee_id
    where true
      ${f.brandIds ? sql`and a.brand_id = any(${pgArray(f.brandIds)})` : sql``}
      ${f.brandId ? sql`and a.brand_id = ${f.brandId}::uuid` : sql``}
      ${f.planId ? sql`and a.plan_id = ${f.planId}::uuid` : sql``}
      ${f.axisId ? sql`and a.axis_id = ${f.axisId}::uuid` : sql``}
      ${f.month ? sql`and a.month = ${f.month}::date` : sql``}
      ${f.assigneeId ? sql`and t.assignee_id = ${f.assigneeId}::uuid` : sql``}
      ${f.includeDone ? sql`` : sql`and t.status in ('TODO','IN_PROGRESS','BLOCKED')`}
    order by case t.status when 'BLOCKED' then 0 when 'IN_PROGRESS' then 1 when 'TODO' then 2 else 3 end,
      case t.priority when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end, t.due_date nulls last, a.budget_planned desc
    ${f.limit ? sql`limit ${f.limit}` : sql``}`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), planId: x.plan_id ? String(x.plan_id) : null, planName: x.plan_name ? String(x.plan_name) : null, axisId: x.axis_id ? String(x.axis_id) : null, axisName: x.axis_name ? String(x.axis_name) : null, month: x.month ? String(x.month) : null,
    brandId: String(x.brand_id), brandName: String(x.brand_name), brandColor: String(x.brand_color), productId: x.product_id ? String(x.product_id) : null, productName: x.product_name ? String(x.product_name) : null, campaignId: x.campaign_id ? String(x.campaign_id) : null, campaignName: x.campaign_name ? String(x.campaign_name) : null,
    category: (x.category as BudgetCategory | null) ?? null, title: String(x.title), objective: x.objective ? String(x.objective) : null, why: x.why ? String(x.why) : null, expectedResult: x.expected_result ? String(x.expected_result) : null, budgetPlanned: Number(x.budget_planned),
    source: x.source as MarketingActionSource, decisionKey: x.decision_key ? String(x.decision_key) : null,
    taskId: String(x.task_id), status: x.status as TaskStatus, priority: x.priority as TaskPriority, dueDate: x.due_date ? String(x.due_date) : null, assigneeId: x.assignee_id ? String(x.assignee_id) : null, assigneeName: x.assignee_name ? String(x.assignee_name) : null,
    committed: Number(x.committed), spent: Number(x.spent), expenses: Number(x.expenses), createdAt: String(x.created_at), completedAt: x.completed_at ? String(x.completed_at) : null,
    templateKey: x.template_key ? String(x.template_key) : null, eventDate: x.event_date ? String(x.event_date) : null, activationId: x.activation_id ? String(x.activation_id) : null,
    spec: (x.spec as Record<string, unknown> | null) ?? null, stepsTotal: Number(x.steps_total), stepsDone: Number(x.steps_done),
  }));
}

export async function getAction(id: string): Promise<ActionRow | null> {
  const r = await db.execute(sql`select brand_id from marketing_actions where id = ${id}::uuid`);
  if (!r.rows.length) return null;
  const rows = await listActions({ brandId: String((r.rows[0] as { brand_id: string }).brand_id), includeDone: true });
  return rows.find((a) => a.id === id) ?? null;
}

export type ActionInput = {
  brandId: string; title: string; planId?: string | null; axisId?: string | null; month?: string | null; productId?: string | null; campaignId?: string | null;
  category?: BudgetCategory | null; objective?: string | null; why?: string | null; expectedResult?: string | null; budgetPlanned?: number;
  source?: MarketingActionSource; decisionKey?: string | null;
  priority?: TaskPriority; dueDate?: string | null; assigneeId?: string | null;
  /** Générateur d'actions (source GENERATOR). */
  templateKey?: string | null; spec?: Record<string, unknown> | null; activationId?: string | null; eventDate?: string | null;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * LA création d'une action : la ligne et sa tâche dans la même transaction (celle de l'appelant si `tx` est fourni,
 * ex. l'ajout au plan d'une action générée, qui crée aussi activation, campagne, contenus et tâches d'exécution).
 */
export async function createAction(input: ActionInput, actor: AuditActor, tx?: Tx, presetId?: string): Promise<{ id: string; taskId: string }> {
  if (!input.title.trim()) throw new Error("Le titre de l'action est obligatoire.");
  const id = presetId ?? randomUUID();
  const description = [input.why ? `Pourquoi : ${input.why}` : null, input.objective ? `Objectif : ${input.objective}` : null, input.expectedResult ? `Résultat attendu : ${input.expectedResult}` : null, input.budgetPlanned ? `Budget prévu : ${Math.round(input.budgetPlanned).toLocaleString("fr-FR")} MAD` : null].filter(Boolean).join("\n");
  const run = async (tx: Tx) => {
    const [task] = await tx.insert(tasks).values({
      title: input.title.trim(), description: description || null, priority: input.priority ?? "MEDIUM", dueDate: input.dueDate ?? null, assigneeId: input.assigneeId ?? null, brandId: input.brandId,
      source: "MARKETING", sourceKey: actionTaskKey(id), entityType: "marketing_action", entityId: id, expectedImpact: input.expectedResult ?? null, createdById: actor.id,
    }).returning({ id: tasks.id });
    await tx.insert(marketingActions).values({
      id, planId: input.planId ?? null, axisId: input.axisId ?? null, month: input.month ?? null, brandId: input.brandId, productId: input.productId ?? null, campaignId: input.campaignId ?? null,
      category: input.category ?? null, title: input.title.trim(), objective: input.objective ?? null, why: input.why ?? null, expectedResult: input.expectedResult ?? null,
      budgetPlanned: (input.budgetPlanned ?? 0).toFixed(2), source: input.source ?? "MANUAL", decisionKey: input.decisionKey ?? null, taskId: task.id, createdById: actor.id,
      templateKey: input.templateKey ?? null, spec: input.spec ?? null, activationId: input.activationId ?? null, eventDate: input.eventDate ?? null,
    });
    const { spec: _spec, ...auditable } = input;
    void _spec;
    await audit({ actor, action: "CREATE", module: "marketing", entity: "marketing_action", entityId: id, label: input.title, after: { ...auditable, taskId: task.id } }, tx);
    return { id, taskId: task.id };
  };
  return tx ? run(tx) : db.transaction(run);
}

export type ActionPatch = Partial<Omit<ActionInput, "brandId" | "source" | "decisionKey">>;

export async function updateAction(id: string, patch: ActionPatch, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await tx.query.marketingActions.findFirst({ where: eq(marketingActions.id, id) });
    if (!before) throw new Error("Action introuvable.");
    const set: Partial<typeof marketingActions.$inferInsert> = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title.trim();
    if (patch.planId !== undefined) set.planId = patch.planId;
    if (patch.axisId !== undefined) set.axisId = patch.axisId;
    if (patch.month !== undefined) set.month = patch.month;
    if (patch.productId !== undefined) set.productId = patch.productId;
    if (patch.campaignId !== undefined) set.campaignId = patch.campaignId;
    if (patch.category !== undefined) set.category = patch.category;
    if (patch.objective !== undefined) set.objective = patch.objective;
    if (patch.why !== undefined) set.why = patch.why;
    if (patch.expectedResult !== undefined) set.expectedResult = patch.expectedResult;
    if (patch.budgetPlanned !== undefined) set.budgetPlanned = patch.budgetPlanned.toFixed(2);
    await tx.update(marketingActions).set(set).where(eq(marketingActions.id, id));
    const taskSet: Partial<typeof tasks.$inferInsert> = {};
    if (patch.title !== undefined) taskSet.title = patch.title.trim();
    if (patch.priority !== undefined) taskSet.priority = patch.priority;
    if (patch.dueDate !== undefined) taskSet.dueDate = patch.dueDate;
    if (patch.assigneeId !== undefined) taskSet.assigneeId = patch.assigneeId;
    if (patch.expectedResult !== undefined) taskSet.expectedImpact = patch.expectedResult;
    if (Object.keys(taskSet).length) await tx.update(tasks).set(taskSet).where(eq(tasks.id, before.taskId));
    await audit({ actor, action: "UPDATE", module: "marketing", entity: "marketing_action", entityId: id, label: patch.title ?? before.title, before: { title: before.title, budgetPlanned: Number(before.budgetPlanned), category: before.category, productId: before.productId }, after: patch }, tx);
  });
}

/** Statut d'une action = statut de sa tâche. `completed_at` est posé à DONE, effacé sinon (même règle que /taches). */
export async function setActionStatus(id: string, status: TaskStatus, actor: AuditActor): Promise<void> {
  if (status === "PROPOSED") throw new Error("Une action ne peut pas revenir au statut « proposée ».");
  await db.transaction(async (tx) => {
    const before = await tx.query.marketingActions.findFirst({ where: eq(marketingActions.id, id), with: { task: true } });
    if (!before) throw new Error("Action introuvable.");
    await tx.update(tasks).set({ status, completedAt: status === "DONE" ? new Date() : null }).where(eq(tasks.id, before.taskId));
    // Action annulée : ses tâches d'exécution encore ouvertes sont annulées avec elle (rien n'est supprimé).
    if (status === "CANCELLED") await tx.update(tasks).set({ status: "CANCELLED" }).where(and(eq(tasks.entityType, "marketing_action"), eq(tasks.entityId, id), sql`${tasks.status} in ('TODO','IN_PROGRESS','BLOCKED')`));
    await audit({ actor, action: "UPDATE", module: "marketing", entity: "marketing_action", entityId: id, label: before.title, before: { status: before.task.status }, after: { status } }, tx);
  });
}

/**
 * Rattache une dépense existante à une action (ou l'en détache avec `actionId = null`). La dépense doit
 * être de la même marque : le budget d'une marque ne porte jamais la dépense d'une autre.
 */
export async function attachExpense(expenseId: string, actionId: string | null, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const e = await tx.query.marketingExpenses.findFirst({ where: eq(marketingExpenses.id, expenseId) });
    if (!e) throw new Error("Dépense introuvable.");
    if (actionId) {
      const a = await tx.query.marketingActions.findFirst({ where: and(eq(marketingActions.id, actionId), eq(marketingActions.brandId, e.brandId)) });
      if (!a) throw new Error("Action introuvable ou d'une autre marque.");
    }
    await tx.update(marketingExpenses).set({ actionId }).where(eq(marketingExpenses.id, expenseId));
    await audit({ actor, action: "UPDATE", module: "budgets", entity: "marketing_expense", entityId: expenseId, label: e.label, before: { actionId: e.actionId }, after: { actionId } }, tx);
  });
  await refreshAfterWrite(["EXPENSE"]);
}

/** Compteurs d'actions d'une marque (Command Center) : ouvertes, en retard, bloquées, budget prévu ouvert. */
export function actionCounters(rows: ActionRow[], todayIso: string) {
  const open = rows.filter((a) => isOpenStatus(a.status));
  return {
    open: open.length,
    late: open.filter((a) => a.dueDate && a.dueDate < todayIso).length,
    blocked: open.filter((a) => a.status === "BLOCKED").length,
    budgetOpen: open.reduce((s, a) => s + a.budgetPlanned, 0),
    budgetCommitted: rows.reduce((s, a) => s + a.committed, 0),
  };
}
