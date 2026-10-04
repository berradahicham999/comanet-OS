"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { BudgetCategory, TaskPriority, TaskStatus } from "@/db/schema";
import { requirePermission, brandInScope } from "@/lib/access";
import { BUDGET_CATEGORIES } from "@/lib/budget-categories";
import { attachExpense, createAction, getAction, setActionStatus, updateAction } from "@/lib/marketing-plan/actions";
import { approveDecision, measureDecision, rejectDecision, reopenDecision } from "@/lib/decisions/store";
import { findDecision } from "@/lib/decisions/build";
import { decisionScopeFor } from "@/lib/decisions/server";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
const num = (fd: FormData, k: string) => { const s = String(fd.get(k) ?? "").replace(/\s| | /g, "").replace(",", "."); const n = Number(s); return s === "" || Number.isNaN(n) ? null : n; };
const isUuid = (v: string | null): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"];
const BASE = "/marketing/priorites";

function refresh(id?: string | null) {
  revalidatePath(BASE); revalidatePath("/marketing"); revalidatePath("/marketing/plan"); revalidatePath("/taches"); revalidatePath("/actions"); revalidatePath("/");
  if (id) revalidatePath(`${BASE}/${id}`);
}

function actionFields(fd: FormData) {
  const category = str(fd, "category");
  const priority = str(fd, "priority") as TaskPriority | null;
  return {
    title: str(fd, "title") ?? "", objective: str(fd, "objective"), why: str(fd, "why"), expectedResult: str(fd, "expectedResult"),
    budgetPlanned: num(fd, "budgetPlanned") ?? 0, category: category && (BUDGET_CATEGORIES as readonly string[]).includes(category) ? (category as BudgetCategory) : null,
    productId: isUuid(str(fd, "productId")) ? str(fd, "productId") : null, campaignId: isUuid(str(fd, "campaignId")) ? str(fd, "campaignId") : null,
    planId: isUuid(str(fd, "planId")) ? str(fd, "planId") : null, axisId: isUuid(str(fd, "axisId")) ? str(fd, "axisId") : null,
    month: isDate(str(fd, "month")) ? str(fd, "month") : null,
    priority: priority && PRIORITIES.includes(priority) ? priority : "MEDIUM" as TaskPriority, dueDate: isDate(str(fd, "dueDate")) ? str(fd, "dueDate") : null, assigneeId: isUuid(str(fd, "assigneeId")) ? str(fd, "assigneeId") : null,
  };
}

export async function createActionAction(formData: FormData) {
  const user = await requirePermission("marketing", "create");
  const brandId = str(formData, "brandId");
  if (!isUuid(brandId) || !(await brandInScope(brandId))) throw new Error("Marque obligatoire et dans votre périmètre.");
  const f = actionFields(formData);
  if (!f.title) throw new Error("Le titre de l'action est obligatoire.");
  const res = await createAction({ ...f, brandId, source: "MANUAL" }, { id: user.id, name: user.name });
  refresh(res.id);
  if (str(formData, "open")) redirect(`${BASE}/${res.id}`);
}

export async function updateActionAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const id = str(formData, "id"); if (!isUuid(id)) return;
  const cur = await getAction(id);
  if (!cur || !(await brandInScope(cur.brandId))) throw new Error("Action introuvable.");
  const f = actionFields(formData);
  if (!f.title) throw new Error("Le titre de l'action est obligatoire.");
  await updateAction(id, f, { id: user.id, name: user.name });
  refresh(id);
}

export async function setActionStatusAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const id = str(formData, "id"); const status = str(formData, "status") as TaskStatus | null;
  if (!isUuid(id) || !status || !STATUSES.includes(status)) return;
  const cur = await getAction(id);
  if (!cur || !(await brandInScope(cur.brandId))) throw new Error("Action introuvable.");
  await setActionStatus(id, status, { id: user.id, name: user.name });
  refresh(id);
}

export async function attachExpenseAction(formData: FormData) {
  const user = await requirePermission("budgets", "edit");
  const expenseId = str(formData, "expenseId"); const actionId = str(formData, "actionId");
  if (!isUuid(expenseId)) return;
  await attachExpense(expenseId, isUuid(actionId) ? actionId : null, { id: user.id, name: user.name });
  refresh(isUuid(actionId) ? actionId : null);
  const back = str(formData, "back"); if (back && back.startsWith("/")) redirect(back);
}

/** Approuver une décision = créer l'action (et sa tâche) ; la décision est enregistrée avec son instantané. */
export async function approveDecisionAction(formData: FormData) {
  const user = await requirePermission("marketing", "create");
  const key = str(formData, "key"); const brandId = str(formData, "brandId");
  if (!key) return;
  const scope = await decisionScopeFor(isUuid(brandId) ? brandId : null);
  const d = await findDecision(scope, key);
  if (!d) throw new Error("Cette recommandation n'est plus d'actualité : les données ont changé depuis l'affichage.");
  const f = actionFields(formData);
  const res = await approveDecision(d, { ...f, title: f.title || d.task.title, brandId: isUuid(brandId) ? brandId : d.brandId }, { id: user.id, name: user.name });
  refresh(res.actionId);
  const back = str(formData, "back"); if (back && back.startsWith("/")) redirect(back);
}

export async function rejectDecisionAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const key = str(formData, "key"); const brandId = str(formData, "brandId");
  if (!key) return;
  const scope = await decisionScopeFor(isUuid(brandId) ? brandId : null);
  const d = await findDecision(scope, key);
  if (!d) throw new Error("Cette recommandation n'est plus d'actualité.");
  await rejectDecision(d, str(formData, "reason"), { id: user.id, name: user.name });
  refresh();
  const back = str(formData, "back"); if (back && back.startsWith("/")) redirect(back);
}

export async function reopenDecisionAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const key = str(formData, "key"); if (!key) return;
  await reopenDecision(key, { id: user.id, name: user.name });
  refresh();
}

export async function measureDecisionAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const key = str(formData, "key"); const note = str(formData, "note");
  if (!key || !note) return;
  await measureDecision(key, note, { id: user.id, name: user.name });
  refresh();
}
