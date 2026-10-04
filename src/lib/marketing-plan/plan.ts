/**
 * Plan marketing — lecture et écriture (serveur).
 *
 * Le plan est un CADRE posé sur des données qui existent déjà : `budgets` (enveloppe de l'année),
 * `objectives` (CA objectif annuel, mois NULL), `budget_lines` (allocation par canal). Il n'y a donc ni
 * second budget, ni second objectif : enregistrer le budget du plan met à jour la ligne `budgets`, le
 * CA objectif la ligne `objectives`, l'allocation les `budget_lines`. Consommation : `budgetConsumption()`
 * et `budgetByCategory()`, jamais une somme maison. Chaque écriture laisse une trace `audit()`.
 */
import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetLines, budgets, marketingAxes, marketingPlanMonths, marketingPlanObjectives, marketingPlans, objectives,
  type BudgetCategory, type MarketingPlanStatus,
} from "@/db/schema";
import { audit, type AuditActor } from "@/lib/audit";
import { BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import { budgetByCategory, budgetConsumption, engagedSql, type BudgetCategoryRow, type BudgetConsumption } from "@/lib/budget";
import { AD_EXPENSE_CATEGORIES } from "@/lib/ad-spend";
import { channelVerdicts } from "@/lib/analytics-marketing/decision";
import { pgArray } from "@/lib/sql-array";
import { getSettings } from "@/lib/settings";
import { addDays, iso } from "@/lib/format";
import { proposeAllocation, type AllocationProposal, type CategoryVerdict, type HistoryLine } from "./allocation";
import { budgetChain, monthsBetween, planFraming, type BudgetChain, type PlanFraming } from "./shared";
import { listActions, type ActionRow } from "./actions";

/* ------------------------------ Types ------------------------------ */

export type PlanSummary = {
  id: string; brandId: string; brandName: string; brandColor: string; name: string; periodStart: string; periodEnd: string; year: number; status: MarketingPlanStatus;
  budget: number | null; revenueTarget: number | null; allocated: number; consumed: number; consumedPct: number | null; axes: number; openActions: number;
};

export type PlanObjectiveRow = { id: string; kind: string; label: string; target: number | null; unit: string; productId: string | null; productName: string | null; notes: string | null; sort: number };
export type AxisRow = { id: string; name: string; productId: string | null; productName: string | null; productRange: string | null; objectiveId: string | null; budget: number; periodStart: string | null; periodEnd: string | null; notes: string | null; sort: number; /** Engagé + dépensé rattaché à l'axe (actions de l'axe et campagnes de l'axe). */ committed: number; actions: number };
export type MonthRow = { id: string | null; month: string; focusProductId: string | null; focusProductName: string | null; objective: string | null; budget: number; notes: string | null; actions: ActionRow[]; actionsBudget: number };
export type AllocationRow = BudgetCategoryRow & { label: string; lineIds: string[] };

export type PlanDetail = {
  plan: { id: string; brandId: string; brandName: string; brandColor: string; name: string; periodStart: string; periodEnd: string; year: number; status: MarketingPlanStatus; notes: string | null; createdAt: string };
  framing: PlanFraming;
  chain: BudgetChain;
  consumption: BudgetConsumption;
  objectives: PlanObjectiveRow[];
  allocation: AllocationRow[];
  axes: AxisRow[];
  months: MonthRow[];
  actions: ActionRow[];
};

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/* ------------------------------ Lecture ------------------------------ */

export async function listPlans(brandIds: string[] | null): Promise<PlanSummary[]> {
  const scope = brandIds ? sql`and p.brand_id = any(${pgArray(brandIds)})` : sql``;
  const r = await db.execute(sql`
    select p.id, p.brand_id, b.name as brand_name, b.color as brand_color, p.name, p.period_start::text as period_start, p.period_end::text as period_end, p.year, p.status::text as status,
      (select amount::float8 from budgets bu where bu.brand_id = p.brand_id and bu.year = p.year) as budget,
      (select amount::float8 from objectives o where o.brand_id = p.brand_id and o.product_id is null and o.year = p.year and o.month is null) as revenue_target,
      coalesce((select sum(amount) from budget_lines bl where bl.brand_id = p.brand_id and bl.year = p.year), 0)::float8 as allocated,
      (select count(*) from marketing_axes a where a.plan_id = p.id)::int as axes,
      (select count(*) from marketing_actions ma join tasks t on t.id = ma.task_id where ma.plan_id = p.id and t.status in ('TODO','IN_PROGRESS','BLOCKED'))::int as open_actions
    from marketing_plans p join brands b on b.id = p.brand_id
    where true ${scope}
    order by p.year desc, b.name, p.period_start desc`);
  const rows = r.rows as Record<string, unknown>[];
  const years = [...new Set(rows.map((x) => Number(x.year)))];
  const consumptions = new Map<string, BudgetConsumption>();
  await Promise.all(years.map(async (y) => { for (const x of rows.filter((x) => Number(x.year) === y)) consumptions.set(`${x.brand_id}:${y}`, await budgetConsumption(y, String(x.brand_id))); }));
  return rows.map((x) => {
    const c = consumptions.get(`${x.brand_id}:${x.year}`);
    return {
      id: String(x.id), brandId: String(x.brand_id), brandName: String(x.brand_name), brandColor: String(x.brand_color), name: String(x.name), periodStart: String(x.period_start), periodEnd: String(x.period_end), year: Number(x.year), status: x.status as MarketingPlanStatus,
      budget: n(x.budget), revenueTarget: n(x.revenue_target), allocated: Number(x.allocated), consumed: c?.consumed ?? 0, consumedPct: c?.consumedPct ?? null, axes: Number(x.axes), openActions: Number(x.open_actions),
    };
  });
}

export async function getPlan(id: string): Promise<PlanDetail | null> {
  const p = await db.query.marketingPlans.findFirst({ where: eq(marketingPlans.id, id), with: { brand: true } });
  if (!p) return null;
  const [budgetRow, objectiveRow, lineRows, byCat, consumption, objRows, axisRows, monthRows, actions] = await Promise.all([
    db.query.budgets.findFirst({ where: and(eq(budgets.brandId, p.brandId), eq(budgets.year, p.year)) }),
    db.query.objectives.findFirst({ where: and(eq(objectives.brandId, p.brandId), isNull(objectives.productId), eq(objectives.year, p.year), isNull(objectives.month)) }),
    db.select().from(budgetLines).where(and(eq(budgetLines.brandId, p.brandId), eq(budgetLines.year, p.year))),
    budgetByCategory(p.year, p.brandId),
    budgetConsumption(p.year, p.brandId),
    db.execute(sql`select o.*, pr.name as product_name from marketing_plan_objectives o left join products pr on pr.id = o.product_id where o.plan_id = ${id}::uuid order by o.sort, o.label`),
    db.execute(sql`
      select a.*, pr.name as product_name,
        coalesce((select sum(e.amount) from marketing_expenses e where ${engagedSql("e")} and (e.action_id in (select id from marketing_actions ma where ma.axis_id = a.id) or e.campaign_id in (select id from campaigns c where c.axis_id = a.id))), 0)::float8 as committed,
        (select count(*) from marketing_actions ma where ma.axis_id = a.id)::int as actions
      from marketing_axes a left join products pr on pr.id = a.product_id where a.plan_id = ${id}::uuid order by a.sort, a.created_at`),
    db.execute(sql`select m.*, pr.name as product_name from marketing_plan_months m left join products pr on pr.id = m.focus_product_id where m.plan_id = ${id}::uuid order by m.month`),
    listActions({ planId: id, includeDone: true }),
  ]);
  const budget = budgetRow ? Number(budgetRow.amount) : null;
  const revenueTarget = objectiveRow ? Number(objectiveRow.amount) : null;
  const allocation: AllocationRow[] = byCat.map((c) => ({ ...c, label: BUDGET_CATEGORY_LABELS[c.category as BudgetCategory] ?? c.category, lineIds: lineRows.filter((l) => l.category === c.category).map((l) => l.id) }));
  const axes: AxisRow[] = (axisRows.rows as Record<string, unknown>[]).map((a) => ({
    id: String(a.id), name: String(a.name), productId: a.product_id ? String(a.product_id) : null, productName: a.product_name ? String(a.product_name) : null, productRange: a.product_range ? String(a.product_range) : null,
    objectiveId: a.objective_id ? String(a.objective_id) : null, budget: Number(a.budget), periodStart: a.period_start ? String(a.period_start) : null, periodEnd: a.period_end ? String(a.period_end) : null, notes: a.notes ? String(a.notes) : null, sort: Number(a.sort),
    committed: Number(a.committed), actions: Number(a.actions),
  }));
  const framing = planFraming({ revenueTarget, budget, allocationLines: allocation.map((l) => ({ amount: l.planned })), axes });
  const chain = budgetChain({ planned: budget, allocated: framing.allocated, committed: consumption.consumed, spent: consumption.spent });
  const stored = new Map((monthRows.rows as Record<string, unknown>[]).map((m) => [String(m.month), m]));
  const months: MonthRow[] = monthsBetween(p.periodStart, p.periodEnd).map((month) => {
    const m = stored.get(month);
    const acts = actions.filter((a) => a.month === month);
    return {
      id: m ? String(m.id) : null, month, focusProductId: m?.focus_product_id ? String(m.focus_product_id) : null, focusProductName: m?.product_name ? String(m.product_name) : null,
      objective: m?.objective ? String(m.objective) : null, budget: m ? Number(m.budget) : 0, notes: m?.notes ? String(m.notes) : null, actions: acts, actionsBudget: acts.reduce((s, a) => s + a.budgetPlanned, 0),
    };
  });
  return {
    plan: { id: p.id, brandId: p.brandId, brandName: p.brand.name, brandColor: p.brand.color, name: p.name, periodStart: p.periodStart, periodEnd: p.periodEnd, year: p.year, status: p.status, notes: p.notes, createdAt: p.createdAt.toISOString() },
    framing, chain, consumption,
    objectives: (objRows.rows as Record<string, unknown>[]).map((o) => ({ id: String(o.id), kind: String(o.kind), label: String(o.label), target: n(o.target), unit: String(o.unit), productId: o.product_id ? String(o.product_id) : null, productName: o.product_name ? String(o.product_name) : null, notes: o.notes ? String(o.notes) : null, sort: Number(o.sort) })),
    allocation, axes, months, actions,
  };
}

/** Plan actif (sinon le plus récent) d'une marque pour une année : le Command Center et les règles s'y réfèrent. */
export async function currentPlanFor(brandId: string, year: number): Promise<{ id: string; name: string; status: MarketingPlanStatus; periodStart: string; periodEnd: string } | null> {
  const rows = await db.select({ id: marketingPlans.id, name: marketingPlans.name, status: marketingPlans.status, periodStart: marketingPlans.periodStart, periodEnd: marketingPlans.periodEnd })
    .from(marketingPlans).where(and(eq(marketingPlans.brandId, brandId), eq(marketingPlans.year, year))).orderBy(sql`case status when 'ACTIVE' then 0 when 'DRAFT' then 1 else 2 end`, asc(marketingPlans.periodStart));
  return rows[0] ?? null;
}

/* ------------------------------ Allocation proposée ------------------------------ */

/**
 * Historique réel N-1 par catégorie : dépenses engagées + dépensées (`budgetByCategory`) et, si la régie fait
 * foi cette année-là (`budgetConsumption().adSource = REGIE`), la dépense Meta à la place du média saisi.
 */
export async function allocationHistory(brandId: string, historyYear: number): Promise<HistoryLine[]> {
  const [cats, cons] = await Promise.all([budgetByCategory(historyYear, brandId), budgetConsumption(historyYear, brandId)]);
  const regie = cons.adSource === "REGIE";
  const out: HistoryLine[] = cats
    .filter((c) => !(regie && (AD_EXPENSE_CATEGORIES as readonly string[]).includes(c.category)))
    .map((c) => ({ category: c.category as BudgetCategory, amount: c.committed, source: "DEPENSES" as const }))
    .filter((c) => c.amount > 0);
  if (regie && cons.adSpend > 0) out.push({ category: "META", amount: cons.adSpend, source: "REGIE" });
  return out;
}

/** Verdict de chaque canal de la marque sur les 12 derniers mois, traduit en catégorie budgétaire (via `channel_mappings`). */
export async function categoryVerdicts(brandId: string, ref: Date): Promise<CategoryVerdict[]> {
  const end = iso(addDays(ref, 1)), start = iso(addDays(ref, -364));
  const [verdicts, mappings] = await Promise.all([
    channelVerdicts({ range: { start, end }, prev: { start: iso(addDays(ref, -729)), end: start }, brandIds: [brandId], ref }).catch(() => []),
    db.execute(sql`select source_key, channel_key from channel_mappings where source_kind = 'BUDGET_CATEGORY'`),
  ]);
  const byChannel = new Map(verdicts.map((v) => [v.channelKey, v]));
  const out: CategoryVerdict[] = [];
  for (const m of mappings.rows as { source_key: string; channel_key: string }[]) {
    const v = byChannel.get(m.channel_key);
    if (v) out.push({ category: m.source_key as BudgetCategory, verdict: v.verdict.verdict, headline: v.verdict.headline });
  }
  return out;
}

export async function proposedAllocation(planId: string, ref: Date): Promise<AllocationProposal | null> {
  const p = await db.query.marketingPlans.findFirst({ where: eq(marketingPlans.id, planId) });
  if (!p) return null;
  const [budgetRow, settings] = await Promise.all([db.query.budgets.findFirst({ where: and(eq(budgets.brandId, p.brandId), eq(budgets.year, p.year)) }), getSettings()]);
  const historyYear = p.year - 1;
  const [history, verdicts] = await Promise.all([allocationHistory(p.brandId, historyYear), categoryVerdicts(p.brandId, ref)]);
  return proposeAllocation({ budget: budgetRow ? Number(budgetRow.amount) : null, history, historyYear, verdicts, settings: settings.marketingPlan });
}

/* ------------------------------ Écritures ------------------------------ */

export type PlanInput = { brandId: string; name: string; periodStart: string; periodEnd: string; year: number; status?: MarketingPlanStatus; notes?: string | null; budget?: number | null; revenueTarget?: number | null };

export async function savePlan(input: PlanInput, actor: AuditActor, id?: string | null): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    let planId = id ?? null;
    if (planId) {
      const before = await tx.query.marketingPlans.findFirst({ where: eq(marketingPlans.id, planId) });
      if (!before) throw new Error("Plan introuvable.");
      await tx.update(marketingPlans).set({ name: input.name, periodStart: input.periodStart, periodEnd: input.periodEnd, year: input.year, status: input.status ?? before.status, notes: input.notes ?? before.notes, updatedAt: new Date() }).where(eq(marketingPlans.id, planId));
      await audit({ actor, action: "UPDATE", module: "marketing", entity: "marketing_plan", entityId: planId, label: input.name, before: { name: before.name, periodStart: before.periodStart, periodEnd: before.periodEnd, status: before.status }, after: { name: input.name, periodStart: input.periodStart, periodEnd: input.periodEnd, status: input.status ?? before.status } }, tx);
    } else {
      const [row] = await tx.insert(marketingPlans).values({ brandId: input.brandId, name: input.name, periodStart: input.periodStart, periodEnd: input.periodEnd, year: input.year, status: input.status ?? "DRAFT", notes: input.notes ?? null, createdById: actor.id }).returning({ id: marketingPlans.id });
      planId = row.id;
      await audit({ actor, action: "CREATE", module: "marketing", entity: "marketing_plan", entityId: planId, label: input.name, after: { brandId: input.brandId, year: input.year, periodStart: input.periodStart, periodEnd: input.periodEnd } }, tx);
    }
    // Budget du plan = ligne `budgets` (marque × année) ; CA objectif = ligne `objectives` annuelle. Rien n'est effacé si le champ est vide.
    if (input.budget !== undefined && input.budget !== null && input.budget > 0) {
      const before = await tx.query.budgets.findFirst({ where: and(eq(budgets.brandId, input.brandId), eq(budgets.year, input.year)) });
      const ref = input.revenueTarget && input.revenueTarget > 0 ? input.revenueTarget : before?.referenceRevenue ? Number(before.referenceRevenue) : null;
      await tx.insert(budgets).values({ brandId: input.brandId, year: input.year, amount: input.budget.toFixed(2), referenceRevenue: ref !== null ? ref.toFixed(2) : null, pctOfRevenue: ref ? ((input.budget / ref) * 100).toFixed(2) : null })
        .onConflictDoUpdate({ target: [budgets.brandId, budgets.year], set: { amount: input.budget.toFixed(2), referenceRevenue: ref !== null ? ref.toFixed(2) : null, pctOfRevenue: ref ? ((input.budget / ref) * 100).toFixed(2) : null } });
      if (!before || Number(before.amount) !== input.budget) await audit({ actor, action: before ? "UPDATE" : "CREATE", module: "budgets", entity: "budget", label: `Budget ${input.year}`, before: before ? { amount: Number(before.amount) } : undefined, after: { amount: input.budget, planId } }, tx);
    }
    if (input.revenueTarget !== undefined && input.revenueTarget !== null && input.revenueTarget > 0) {
      const before = await tx.query.objectives.findFirst({ where: and(eq(objectives.brandId, input.brandId), isNull(objectives.productId), eq(objectives.year, input.year), isNull(objectives.month)) });
      if (before) await tx.update(objectives).set({ amount: input.revenueTarget.toFixed(2) }).where(eq(objectives.id, before.id));
      else await tx.insert(objectives).values({ brandId: input.brandId, productId: null, year: input.year, month: null, amount: input.revenueTarget.toFixed(2) });
      if (!before || Number(before.amount) !== input.revenueTarget) await audit({ actor, action: before ? "UPDATE" : "CREATE", module: "marketing", entity: "objective", label: `CA objectif ${input.year}`, before: before ? { amount: Number(before.amount) } : undefined, after: { amount: input.revenueTarget, planId } }, tx);
    }
    return { id: planId };
  });
}

export async function setPlanStatus(id: string, status: MarketingPlanStatus, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await tx.query.marketingPlans.findFirst({ where: eq(marketingPlans.id, id) });
    if (!before) throw new Error("Plan introuvable.");
    await tx.update(marketingPlans).set({ status, updatedAt: new Date() }).where(eq(marketingPlans.id, id));
    await audit({ actor, action: status === "CLOSED" ? "ARCHIVE" : "UPDATE", module: "marketing", entity: "marketing_plan", entityId: id, label: before.name, before: { status: before.status }, after: { status } }, tx);
  });
}

/**
 * Allocation par canal = `budget_lines` de la marque et de l'année. Une catégorie absente de la saisie n'est
 * pas touchée ; une catégorie à 0 supprime ses lignes ; une catégorie avec plusieurs lignes importées est
 * remplacée par une seule (libellés conservés dans le libellé de la nouvelle ligne).
 */
export async function saveAllocation(planId: string, lines: { category: BudgetCategory; amount: number }[], actor: AuditActor): Promise<void> {
  const p = await db.query.marketingPlans.findFirst({ where: eq(marketingPlans.id, planId) });
  if (!p) throw new Error("Plan introuvable.");
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(budgetLines).where(and(eq(budgetLines.brandId, p.brandId), eq(budgetLines.year, p.year)));
    const before: Record<string, number> = {}, after: Record<string, number> = {};
    for (const l of lines) {
      const cur = existing.filter((e) => e.category === l.category);
      const curAmount = cur.reduce((a, e) => a + Number(e.amount), 0);
      if (Math.abs(curAmount - l.amount) < 0.005) continue;
      before[l.category] = curAmount; after[l.category] = l.amount;
      if (l.amount <= 0) { if (cur.length) await tx.delete(budgetLines).where(inArray(budgetLines.id, cur.map((e) => e.id))); continue; }
      if (cur.length === 1) await tx.update(budgetLines).set({ amount: l.amount.toFixed(2) }).where(eq(budgetLines.id, cur[0].id));
      else {
        if (cur.length) await tx.delete(budgetLines).where(inArray(budgetLines.id, cur.map((e) => e.id)));
        const label = cur.length ? [...new Set(cur.map((e) => e.label))].join(" + ") : BUDGET_CATEGORY_LABELS[l.category];
        await tx.insert(budgetLines).values({ brandId: p.brandId, year: p.year, label, category: l.category, amount: l.amount.toFixed(2) });
      }
    }
    if (Object.keys(after).length) await audit({ actor, action: "UPDATE", module: "budgets", entity: "budget_lines", entityId: planId, label: `Allocation ${p.name}`, before, after }, tx);
  });
}

export type ObjectiveInput = { kind: string; label: string; target: number | null; unit: string; productId: string | null; notes: string | null };

export async function saveObjective(planId: string, input: ObjectiveInput, actor: AuditActor, id?: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    if (id) {
      await tx.update(marketingPlanObjectives).set({ kind: input.kind, label: input.label, target: input.target !== null ? input.target.toFixed(2) : null, unit: input.unit, productId: input.productId, notes: input.notes }).where(and(eq(marketingPlanObjectives.id, id), eq(marketingPlanObjectives.planId, planId)));
      await audit({ actor, action: "UPDATE", module: "marketing", entity: "marketing_plan_objective", entityId: id, label: input.label, after: input }, tx);
    } else {
      const [row] = await tx.insert(marketingPlanObjectives).values({ planId, kind: input.kind, label: input.label, target: input.target !== null ? input.target.toFixed(2) : null, unit: input.unit, productId: input.productId, notes: input.notes }).returning({ id: marketingPlanObjectives.id });
      await audit({ actor, action: "CREATE", module: "marketing", entity: "marketing_plan_objective", entityId: row.id, label: input.label, after: input }, tx);
    }
  });
}

export async function deleteObjective(planId: string, id: string, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await tx.query.marketingPlanObjectives.findFirst({ where: and(eq(marketingPlanObjectives.id, id), eq(marketingPlanObjectives.planId, planId)) });
    if (!before) return;
    await tx.delete(marketingPlanObjectives).where(eq(marketingPlanObjectives.id, id));
    await audit({ actor, action: "DELETE", module: "marketing", entity: "marketing_plan_objective", entityId: id, label: before.label, before }, tx);
  });
}

export type AxisInput = { name: string; productId: string | null; productRange: string | null; objectiveId: string | null; budget: number; periodStart: string | null; periodEnd: string | null; notes: string | null };

export async function saveAxis(planId: string, input: AxisInput, actor: AuditActor, id?: string | null): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const values = { name: input.name, productId: input.productId, productRange: input.productRange, objectiveId: input.objectiveId, budget: input.budget.toFixed(2), periodStart: input.periodStart, periodEnd: input.periodEnd, notes: input.notes };
    if (id) {
      const before = await tx.query.marketingAxes.findFirst({ where: and(eq(marketingAxes.id, id), eq(marketingAxes.planId, planId)) });
      if (!before) throw new Error("Axe introuvable.");
      await tx.update(marketingAxes).set(values).where(eq(marketingAxes.id, id));
      await audit({ actor, action: "UPDATE", module: "marketing", entity: "marketing_axis", entityId: id, label: input.name, before: { name: before.name, budget: Number(before.budget), productId: before.productId }, after: { name: input.name, budget: input.budget, productId: input.productId } }, tx);
      return { id };
    }
    const [row] = await tx.insert(marketingAxes).values({ planId, ...values }).returning({ id: marketingAxes.id });
    await audit({ actor, action: "CREATE", module: "marketing", entity: "marketing_axis", entityId: row.id, label: input.name, after: { planId, ...input } }, tx);
    return { id: row.id };
  });
}

export async function deleteAxis(planId: string, id: string, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await tx.query.marketingAxes.findFirst({ where: and(eq(marketingAxes.id, id), eq(marketingAxes.planId, planId)) });
    if (!before) return;
    await tx.delete(marketingAxes).where(eq(marketingAxes.id, id)); // campagnes, contenus, activations, actions : axis_id → NULL, rien n'est supprimé
    await audit({ actor, action: "DELETE", module: "marketing", entity: "marketing_axis", entityId: id, label: before.name, before: { name: before.name, budget: Number(before.budget) } }, tx);
  });
}

export type MonthInput = { month: string; focusProductId: string | null; objective: string | null; budget: number; notes: string | null };

export async function saveMonth(planId: string, input: MonthInput, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await tx.query.marketingPlanMonths.findFirst({ where: and(eq(marketingPlanMonths.planId, planId), eq(marketingPlanMonths.month, input.month)) });
    const values = { focusProductId: input.focusProductId, objective: input.objective, budget: input.budget.toFixed(2), notes: input.notes };
    if (before) await tx.update(marketingPlanMonths).set(values).where(eq(marketingPlanMonths.id, before.id));
    else await tx.insert(marketingPlanMonths).values({ planId, month: input.month, ...values });
    await audit({ actor, action: before ? "UPDATE" : "CREATE", module: "marketing", entity: "marketing_plan_month", entityId: planId, label: input.month, before: before ? { budget: Number(before.budget), focusProductId: before.focusProductId, objective: before.objective } : undefined, after: { budget: input.budget, focusProductId: input.focusProductId, objective: input.objective } }, tx);
  });
}

/** Axes d'un plan (libellés), pour les sélecteurs des modules (campagne, contenu, collaboration, activation). */
export async function axisOptions(brandId: string | null, opts: { year?: number } = {}): Promise<{ id: string; label: string; planId: string; planName: string }[]> {
  const r = await db.execute(sql`
    select a.id, a.name, p.id as plan_id, p.name as plan_name, p.year
    from marketing_axes a join marketing_plans p on p.id = a.plan_id
    where p.status <> 'CLOSED' ${brandId ? sql`and p.brand_id = ${brandId}::uuid` : sql``} ${opts.year ? sql`and p.year = ${opts.year}` : sql``}
    order by p.year desc, p.name, a.sort, a.name`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({ id: String(x.id), label: `${x.name} · ${x.plan_name}`, planId: String(x.plan_id), planName: String(x.plan_name) }));
}
