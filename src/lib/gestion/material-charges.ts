import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/db";
import { pgArray } from "@/lib/sql-array";
import { materialChargeRows, type MaterialChargeLine } from "./material-charges-shared";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Seule écriture de `marketing_expenses.purchase_line_id` : la charge du matériel marketing d'une facture fournisseur,
 * dans la transaction de sa validation (`validatePurchase()`). Idempotente (index unique sur la ligne d'achat).
 */
export async function recordMaterialPurchaseCharges(tx: Tx, doc: { date: string; invoiceLabel: string; lines: MaterialChargeLine[] }, from: string | null) {
  const ids = [...new Set(doc.lines.map((l) => l.inventoryItemId).filter((x): x is string => !!x))];
  if (!ids.length || !from) return { written: 0, skipped: [] as { designation: string; reason: string }[] };
  const items = new Map((await tx.execute<{ id: string; brand_id: string | null; budget_category: string; name: string }>(sql`
    select i.id::text, i.brand_id::text, c.budget_category::text, i.name from inventory_items i join inventory_categories c on c.key = i.category_key
    where i.id = any(${pgArray(ids)})`)).rows.map((r) => [r.id, { brandId: r.brand_id, budgetCategory: r.budget_category, name: r.name }]));
  const { rows, skipped } = materialChargeRows({ lines: doc.lines, items, from, date: doc.date, invoiceLabel: doc.invoiceLabel });
  for (const r of rows) {
    await tx.execute(sql`
      insert into marketing_expenses (brand_id, category, label, amount, status, date, purchase_line_id, notes)
      values (${r.brandId}::uuid, ${r.category}::budget_category, ${r.label}, ${r.amount}::numeric, 'SPENT', ${doc.date}::date, ${r.purchaseLineId}::uuid,
        'Matériel marketing payé au fournisseur : charge à l''achat, sa distribution et son usage en opération ne créent aucune dépense.')
      on conflict (purchase_line_id) where purchase_line_id is not null do nothing`);
  }
  return { written: rows.length, skipped };
}
