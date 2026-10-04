"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { BudgetCategory, MarketingPlanStatus } from "@/db/schema";
import { requirePermission, requireFlag, brandInScope } from "@/lib/access";
import { requireAccessContext } from "@/lib/permissions";
import { isAdmin } from "@/lib/permissions-shared";
import { BUDGET_CATEGORIES } from "@/lib/budget-categories";
import { deleteAxis, deleteObjective, saveAllocation, saveAxis, saveMonth, saveObjective, savePlan, setPlanStatus } from "@/lib/marketing-plan/plan";
import { PLAN_OBJECTIVE_KEYS } from "@/lib/marketing-plan/shared";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
const num = (fd: FormData, k: string) => { const s = String(fd.get(k) ?? "").replace(/\s| | /g, "").replace(",", "."); const n = Number(s); return s === "" || Number.isNaN(n) ? null : n; };
const isUuid = (v: string | null): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const BASE = "/marketing/plan";

function refresh(id?: string | null) {
  revalidatePath(BASE); revalidatePath("/marketing"); revalidatePath("/marketing/budgets"); revalidatePath("/marketing/priorites");
  if (id) revalidatePath(`${BASE}/${id}`);
}

/** Enveloppe et CA objectif : « Valider une dépense » ou Administration (même règle que `saveBudget`). */
async function moneyAllowed(): Promise<boolean> {
  const a = await requireAccessContext();
  return isAdmin(a.perms) || !!a.flags.approveSpend;
}

export async function savePlanAction(formData: FormData) {
  const id = str(formData, "id");
  const user = await requirePermission("marketing", id ? "edit" : "create");
  const brandId = str(formData, "brandId"); const name = str(formData, "name");
  const periodStart = str(formData, "periodStart"); const periodEnd = str(formData, "periodEnd");
  if (!isUuid(brandId) || !name || !isDate(periodStart) || !isDate(periodEnd) || periodEnd < periodStart) throw new Error("Marque, nom et période (début ≤ fin) sont obligatoires.");
  if (!(await brandInScope(brandId))) throw new Error("Marque hors de votre périmètre.");
  const budget = num(formData, "budget"), revenueTarget = num(formData, "revenueTarget");
  if ((budget !== null || revenueTarget !== null) && !(await moneyAllowed())) await requireFlag("approveSpend");
  const year = Number(str(formData, "year")) || Number(periodStart.slice(0, 4));
  const status = (str(formData, "status") as MarketingPlanStatus | null) ?? undefined;
  const res = await savePlan({ brandId, name, periodStart, periodEnd, year, status, notes: str(formData, "notes"), budget, revenueTarget }, { id: user.id, name: user.name }, id);
  refresh(res.id);
  if (!id) redirect(`${BASE}/${res.id}`);
}

export async function setPlanStatusAction(formData: FormData) {
  const user = await requirePermission("marketing", "validate");
  const id = str(formData, "id"); const status = str(formData, "status") as MarketingPlanStatus | null;
  if (!isUuid(id) || !status || !["DRAFT", "ACTIVE", "CLOSED"].includes(status)) return;
  await setPlanStatus(id, status, { id: user.id, name: user.name });
  refresh(id);
}

/** Allocation par canal (= `budget_lines`) : droit « Modifier » sur Budgets, comme `saveBudgetLine`. */
export async function saveAllocationAction(formData: FormData) {
  const user = await requirePermission("budgets", "edit");
  const id = str(formData, "id"); if (!isUuid(id)) return;
  const lines = BUDGET_CATEGORIES.map((c) => ({ category: c as BudgetCategory, amount: num(formData, `cat_${c}`) })).filter((l): l is { category: BudgetCategory; amount: number } => l.amount !== null);
  await saveAllocation(id, lines, { id: user.id, name: user.name });
  refresh(id);
}

export async function saveObjectiveAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const planId = str(formData, "planId"); if (!isUuid(planId)) return;
  const kind = str(formData, "kind"); const label = str(formData, "label");
  if (!kind || !(PLAN_OBJECTIVE_KEYS as readonly string[]).includes(kind) || !label) throw new Error("Type et libellé de l'objectif obligatoires.");
  const objectiveId = str(formData, "objectiveId");
  await saveObjective(planId, { kind, label, target: num(formData, "target"), unit: str(formData, "unit") ?? "MAD", productId: isUuid(str(formData, "productId")) ? str(formData, "productId") : null, notes: str(formData, "notes") }, { id: user.id, name: user.name }, isUuid(objectiveId) ? objectiveId : null);
  refresh(planId);
}

export async function deleteObjectiveAction(formData: FormData) {
  const user = await requirePermission("marketing", "validate");
  const planId = str(formData, "planId"); const id = str(formData, "objectiveId");
  if (!isUuid(planId) || !isUuid(id)) return;
  await deleteObjective(planId, id, { id: user.id, name: user.name });
  refresh(planId);
}

export async function saveAxisAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const planId = str(formData, "planId"); if (!isUuid(planId)) return;
  const name = str(formData, "name"); if (!name) throw new Error("Le nom de l'axe est obligatoire.");
  const axisId = str(formData, "axisId");
  const ps = str(formData, "periodStart"), pe = str(formData, "periodEnd");
  await saveAxis(planId, {
    name, productId: isUuid(str(formData, "productId")) ? str(formData, "productId") : null, productRange: str(formData, "productRange"),
    objectiveId: isUuid(str(formData, "objectiveId")) ? str(formData, "objectiveId") : null, budget: num(formData, "budget") ?? 0,
    periodStart: isDate(ps) ? ps : null, periodEnd: isDate(pe) ? pe : null, notes: str(formData, "notes"),
  }, { id: user.id, name: user.name }, isUuid(axisId) ? axisId : null);
  refresh(planId);
}

export async function deleteAxisAction(formData: FormData) {
  const user = await requirePermission("marketing", "validate");
  const planId = str(formData, "planId"); const id = str(formData, "axisId");
  if (!isUuid(planId) || !isUuid(id)) return;
  await deleteAxis(planId, id, { id: user.id, name: user.name });
  refresh(planId);
}

export async function saveMonthAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const planId = str(formData, "planId"); const month = str(formData, "month");
  if (!isUuid(planId) || !isDate(month)) return;
  await saveMonth(planId, { month, focusProductId: isUuid(str(formData, "focusProductId")) ? str(formData, "focusProductId") : null, objective: str(formData, "objective"), budget: num(formData, "budget") ?? 0, notes: str(formData, "notes") }, { id: user.id, name: user.name });
  refresh(planId);
}

