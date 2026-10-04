/**
 * Plan marketing — constantes et logique PURE (importables côté client, testées sans base).
 *
 * Un plan ne recalcule rien : son budget est `budgets.amount`, son CA objectif la ligne `objectives`
 * annuelle, son allocation les `budget_lines`, sa consommation `budgetConsumption()`. Ce module ne fait
 * qu'assembler ces nombres (cadrage, reste à allouer, chaîne planifié → alloué → engagé → dépensé → reste)
 * et porter les référentiels du plan (objectifs, sources d'action, statuts).
 */
import type { BudgetCategory, MarketingActionSource, MarketingPlanStatus, TaskStatus } from "@/db/schema";

/* ------------------------------ Référentiels ------------------------------ */

export const PLAN_OBJECTIVE_KINDS = {
  CA: { label: "Chiffre d'affaires", unit: "MAD" },
  SELL_OUT: { label: "Sell-out", unit: "MAD" },
  VOLUME: { label: "Volume (unités)", unit: "UNITS" },
  ACQUISITION: { label: "Acquisition (nouveaux clients)", unit: "COUNT" },
  NOTORIETE: { label: "Notoriété", unit: "COUNT" },
  LANCEMENT: { label: "Lancement produit", unit: "COUNT" },
  GAMME: { label: "Développement d'une gamme", unit: "PCT" },
  CANAL: { label: "Développement d'un canal", unit: "PCT" },
} as const;
export type PlanObjectiveKind = keyof typeof PLAN_OBJECTIVE_KINDS;
export const PLAN_OBJECTIVE_KEYS = Object.keys(PLAN_OBJECTIVE_KINDS) as PlanObjectiveKind[];

export const OBJECTIVE_UNITS = { MAD: "MAD", UNITS: "unités", PCT: "%", COUNT: "" } as const;
export type ObjectiveUnit = keyof typeof OBJECTIVE_UNITS;

export const PLAN_STATUS: Record<MarketingPlanStatus, { label: string; tone: "gray" | "green" | "blue" }> = {
  DRAFT: { label: "Brouillon", tone: "gray" },
  ACTIVE: { label: "Actif", tone: "green" },
  CLOSED: { label: "Clôturé", tone: "blue" },
};

export const ACTION_SOURCE_LABELS: Record<MarketingActionSource, string> = { PLAN: "Plan", DECISION: "Décision", MANUAL: "Manuelle" };

/** Statuts d'une tâche (donc d'une action) encore à faire. */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED"];
export const isOpenStatus = (s: TaskStatus) => OPEN_TASK_STATUSES.includes(s);

/** Clé stable de la tâche portant une action (lue par les règles et l'Action Center). */
export const actionTaskKey = (actionId: string) => `marketing-action:${actionId}`;

/* ------------------------------ Cadrage ------------------------------ */

export type PlanFraming = {
  revenueTarget: number | null;
  budget: number | null;
  /** Budget ÷ CA objectif, en % ; `null` si l'un des deux manque. */
  marketingRatePct: number | null;
  allocated: number;
  /** Budget − alloué ; `null` sans budget. */
  unallocated: number | null;
  axesTotal: number;
  /** Budget − axes ; `null` sans budget. */
  unassignedToAxes: number | null;
};

export function planFraming(i: { revenueTarget: number | null; budget: number | null; allocationLines: { amount: number }[]; axes: { budget: number }[] }): PlanFraming {
  const allocated = i.allocationLines.reduce((a, l) => a + l.amount, 0);
  const axesTotal = i.axes.reduce((a, l) => a + l.budget, 0);
  const budget = i.budget !== null && i.budget > 0 ? i.budget : null;
  return {
    revenueTarget: i.revenueTarget !== null && i.revenueTarget > 0 ? i.revenueTarget : null,
    budget,
    marketingRatePct: budget !== null && i.revenueTarget !== null && i.revenueTarget > 0 ? (budget / i.revenueTarget) * 100 : null,
    allocated,
    unallocated: budget !== null ? budget - allocated : null,
    axesTotal,
    unassignedToAxes: budget !== null ? budget - axesTotal : null,
  };
}

/* ------------------------------ Chaîne budgétaire ------------------------------ */

/**
 * Planifié → alloué → engagé → dépensé → reste. `committed` et `spent` viennent de `budgetConsumption()`
 * (engagé = COMMITTED + SPENT + régie ; dépensé = SPENT) : aucune autre définition ici.
 */
export type BudgetChain = {
  planned: number | null;
  allocated: number;
  committed: number;
  spent: number;
  /** Planifié − engagé ; `null` sans budget. */
  remaining: number | null;
  committedPct: number | null;
};

export function budgetChain(i: { planned: number | null; allocated: number; committed: number; spent: number }): BudgetChain {
  const planned = i.planned !== null && i.planned > 0 ? i.planned : null;
  return {
    planned, allocated: i.allocated, committed: i.committed, spent: i.spent,
    remaining: planned !== null ? planned - i.committed : null,
    committedPct: planned !== null ? (i.committed / planned) * 100 : null,
  };
}

/* ------------------------------ Mois ------------------------------ */

/** Premiers jours des mois couverts par la période (ISO), bornes incluses. */
export function monthsBetween(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const s = new Date(startIso + "T00:00:00Z"), e = new Date(endIso + "T00:00:00Z");
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return out;
  let y = s.getUTCFullYear(), m = s.getUTCMonth();
  while (y < e.getUTCFullYear() || (y === e.getUTCFullYear() && m <= e.getUTCMonth())) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}-01`);
    m++; if (m === 12) { m = 0; y++; }
    if (out.length > 60) break;
  }
  return out;
}

export const monthKey = (iso: string) => iso.slice(0, 7);

/* ------------------------------ Actions ------------------------------ */

export type ActionLike = { status: TaskStatus; dueDate: string | null };

/** Jours de retard d'une action ouverte dont l'échéance est passée ; 0 sinon. */
export function actionLateDays(a: ActionLike, todayIso: string): number {
  if (!isOpenStatus(a.status) || !a.dueDate || a.dueDate >= todayIso) return 0;
  return Math.round((new Date(todayIso + "T00:00:00Z").getTime() - new Date(a.dueDate + "T00:00:00Z").getTime()) / 86_400_000);
}

/** Répartition d'un budget mensuel sur les canaux, au prorata d'une allocation (lignes d'un plan). Arrondi à 100 MAD, écart posé sur la plus grosse ligne. */
export function splitMonthBudget(monthBudget: number, allocation: { category: BudgetCategory; amount: number }[]): { category: BudgetCategory; amount: number }[] {
  const total = allocation.reduce((a, l) => a + Math.max(0, l.amount), 0);
  if (monthBudget <= 0 || total <= 0) return [];
  const lines = allocation.filter((l) => l.amount > 0).map((l) => ({ category: l.category, amount: Math.round((monthBudget * l.amount) / total / 100) * 100 }));
  const diff = monthBudget - lines.reduce((a, l) => a + l.amount, 0);
  if (lines.length && diff !== 0) { const big = lines.reduce((m, l) => (l.amount > m.amount ? l : m), lines[0]); big.amount += diff; }
  return lines.filter((l) => l.amount > 0);
}
