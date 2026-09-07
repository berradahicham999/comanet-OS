import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activations, activationBudgetLines } from "@/db/schema";
import { pgArray } from "@/lib/sql-array";
import { activationRefs } from "./refs";
import { budgetTotals, expenseRowsFor, type BudgetTotals, type ExpenseRow } from "./shared";

/**
 * Budget d'une activation et son reflet dans les budgets marketing existants.
 *
 * Le Command Center lit `marketing_expenses` via `budgetConsumption()` (src/lib/budget.ts) :
 * ce module y écrit une ligne par poste (`activation_ref = 'LINE:<id>'`) et une par catégorie
 * de matériel consommé (`'MATERIAL:<catégorie>:<marque>'`), de façon idempotente. Aucune autre
 * table de dépenses n'existe pour les activations.
 */

export type BudgetLineRow = {
  id: string; activationId: string; costItemKey: string; costItem: string; budgetCategory: string; brandId: string | null; brand: string | null;
  label: string; planned: number; committed: number; spent: number; supplier: string | null; quoteRef: string | null; invoiceRef: string | null;
  date: string | null; notes: string | null; sort: number;
};
export type MaterialRow = {
  id: string; itemId: string; item: string; categoryKey: string; category: string; brandId: string | null; unit: string;
  quantity: number; unitCost: number; total: number; createdAt: Date; createdBy: string | null;
};

export async function activationBudgetLinesOf(activationId: string): Promise<BudgetLineRow[]> {
  const r = await db.execute<BudgetLineRow>(sql`
    select l.id, l.activation_id as "activationId", l.cost_item_key as "costItemKey", ci.label as "costItem", ci.budget_category as "budgetCategory",
      l.brand_id as "brandId", b.name as brand, l.label, l.planned::float8 as planned, l.committed::float8 as committed, l.spent::float8 as spent,
      l.supplier, l.quote_ref as "quoteRef", l.invoice_ref as "invoiceRef", l.date::text as date, l.notes, l.sort
    from activation_budget_lines l join activation_cost_items ci on ci.key = l.cost_item_key left join brands b on b.id = l.brand_id
    where l.activation_id = ${activationId}::uuid order by l.sort, l.created_at`);
  return r.rows;
}

export async function activationMaterialsOf(activationId: string): Promise<MaterialRow[]> {
  const r = await db.execute<MaterialRow>(sql`
    select m.id, m.item_id as "itemId", i.name as item, i.category_key as "categoryKey", c.label as category, i.brand_id as "brandId", i.unit,
      m.quantity, m.unit_cost::float8 as "unitCost", (m.quantity * m.unit_cost)::float8 as total, m.created_at as "createdAt", u.name as "createdBy"
    from activation_materials m join inventory_items i on i.id = m.item_id join inventory_categories c on c.key = i.category_key
    left join users u on u.id = m.created_by_id
    where m.activation_id = ${activationId}::uuid order by m.created_at`);
  return r.rows;
}

export type ActivationBudget = { lines: BudgetLineRow[]; materials: MaterialRow[]; totals: BudgetTotals };

/** Budget complet d'une activation : lignes, matériel consommé et totaux (définition unique). */
export async function activationBudget(activationId: string): Promise<ActivationBudget> {
  const [lines, materials, refs, a] = await Promise.all([
    activationBudgetLinesOf(activationId), activationMaterialsOf(activationId), activationRefs(),
    db.select({ status: activations.status }).from(activations).where(eq(activations.id, activationId)).then((r) => r[0]),
  ]);
  const st = refs.statuses.find((s) => s.key === a?.status);
  return { lines, materials, totals: budgetTotals(lines, materials, { validated: !!st?.isValidated && !st.isCancelled }) };
}

/** Lignes attendues dans `marketing_expenses` pour cette activation (sans écrire). */
export async function expectedExpenses(activationId: string): Promise<{ rows: ExpenseRow[]; planned: number }> {
  const [a] = await db.select({ status: activations.status, brandId: activations.brandId, productId: activations.productId, date: activations.date }).from(activations).where(eq(activations.id, activationId));
  if (!a) return { rows: [], planned: 0 };
  const [refs, lines, materials] = await Promise.all([activationRefs(), activationBudgetLinesOf(activationId), activationMaterialsOf(activationId)]);
  const rows = expenseRowsFor({
    status: refs.statuses.find((s) => s.key === a.status), brandId: a.brandId, productId: a.productId, date: a.date,
    lines, costItems: refs.costItems, materials, inventoryCategories: refs.inventoryCategories,
  });
  return { rows, planned: budgetTotals(lines, materials).planned };
}

/**
 * Synchronise le reflet budgétaire d'une activation : à appeler après tout changement de
 * statut, de ligne budgétaire ou de matériel consommé. Idempotent.
 */
export async function syncActivationExpenses(activationId: string): Promise<void> {
  const { rows, planned } = await expectedExpenses(activationId);
  await db.transaction(async (tx) => {
    const refs = rows.map((r) => r.ref);
    await tx.execute(sql`delete from marketing_expenses where activation_id = ${activationId}::uuid and activation_ref is not null
      ${refs.length ? sql`and activation_ref <> all(${pgArray(refs, "text")})` : sql``}`);
    for (const r of rows) {
      await tx.execute(sql`
        insert into marketing_expenses (brand_id, activation_id, activation_ref, product_id, category, label, amount, status, date)
        values (${r.brandId}::uuid, ${activationId}::uuid, ${r.ref}, ${r.productId}::uuid, ${r.category}::budget_category, ${r.label}, ${r.amount}, ${r.status}::expense_status, ${r.date}::date)
        on conflict (activation_id, activation_ref) where activation_ref is not null do update set
          brand_id = excluded.brand_id, product_id = excluded.product_id, category = excluded.category, label = excluded.label,
          amount = excluded.amount, status = excluded.status, date = excluded.date`);
    }
    await tx.update(activations).set({ budgetPlanned: String(planned), updatedAt: new Date() }).where(eq(activations.id, activationId));
  });
}

/** Réordonne les lignes budgétaires après suppression (tri stable, sans trou). */
export async function renumberBudgetLines(activationId: string) {
  const lines = await db.select({ id: activationBudgetLines.id }).from(activationBudgetLines).where(eq(activationBudgetLines.activationId, activationId)).orderBy(activationBudgetLines.sort, activationBudgetLines.createdAt);
  for (let i = 0; i < lines.length; i++) await db.update(activationBudgetLines).set({ sort: i }).where(eq(activationBudgetLines.id, lines[i].id));
}
