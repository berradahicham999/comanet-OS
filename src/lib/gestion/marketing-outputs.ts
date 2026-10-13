import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { recordMovement } from "@/lib/activations/inventory";
import { pgArray } from "@/lib/sql-array";
import { outputCharges, type OutputLineLike } from "./marketing-outputs-shared";

/**
 * Sorties marketing par BL — SEUL écrivain des charges `marketing_expenses.document_line_id` et des mouvements de
 * matériel `inventory_movements.document_line_id` (garde-fou dans `tests/definitions-uniques.test.ts`). Appelé
 * par `documents.ts` dans la transaction de validation et d'annulation du BL. Règles : `marketing-outputs-shared.ts`.
 */

type DbLike = Pick<typeof db, "execute">;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class OutputError extends Error {}

/** Sortie du matériel d'un BL : un mouvement SORTIE par ligne, au coût figé de la ligne, rattaché au client. */
export async function recordMaterialOutputs(
  tx: Tx,
  doc: { id: string; date: string; clientId: string; activationId: string | null },
  lines: { id: string; inventoryItemId: string; quantity: string; unitCost: string | null; designation: string }[],
  opts: { allowNegative: boolean; userId: string | null },
): Promise<number> {
  let n = 0;
  for (const l of lines) {
    const qty = Number(l.quantity);
    if (!Number.isInteger(qty) || qty <= 0) throw new OutputError(`${l.designation} : le matériel se sort à l'unité (quantité entière).`);
    try {
      await recordMovement({
        itemId: l.inventoryItemId, type: "SORTIE", quantity: -qty, unitCost: l.unitCost === null ? null : Number(l.unitCost),
        clientId: doc.clientId, activationId: doc.activationId, date: doc.date, createdById: opts.userId, reason: "Sortie par BL", documentLineId: l.id,
      }, tx, { allowNegative: opts.allowNegative });
    } catch (e) {
      throw new OutputError(e instanceof Error ? e.message : String(e));
    }
    n++;
  }
  return n;
}

/** Annulation d'un BL : un contre-mouvement ENTREE par sortie de matériel non encore annulée. */
export async function reverseMaterialOutputs(tx: Tx, lineIds: string[], date: string, userId: string | null, reason: string): Promise<number> {
  if (!lineIds.length) return 0;
  const moves = (await tx.execute<{ id: string; item_id: string; quantity: number; unit_cost: string | null; client_id: string | null; activation_id: string | null; document_line_id: string }>(sql`
    select m.id, m.item_id, m.quantity, m.unit_cost::text, m.client_id, m.activation_id, m.document_line_id from inventory_movements m
    where m.document_line_id = any(${pgArray(lineIds)}) and m.reversal_of is null and m.type = 'SORTIE'
      and not exists (select 1 from inventory_movements x where x.reversal_of = m.id)`)).rows;
  for (const m of moves) {
    await recordMovement({
      itemId: m.item_id, type: "ENTREE", quantity: -m.quantity, unitCost: m.unit_cost === null ? null : Number(m.unit_cost), clientId: m.client_id,
      activationId: m.activation_id, date, createdById: userId, reason, documentLineId: m.document_line_id, reversalOf: m.id,
    }, tx);
  }
  return moves.length;
}

/**
 * Charges d'échantillons d'un BL validé (client interne seulement) : une dépense SPENT par ligne produit valorisée.
 * Idempotent (clé `document_line_id`). Refuse la validation si une charge ne peut pas être rattachée.
 */
export async function recordOutputCharges(
  tx: DbLike,
  doc: { number: string; date: string; clientId: string; activationId: string | null },
  client: { isInternal: boolean; outputNatureKey: string | null },
  lines: OutputLineLike[],
): Promise<number> {
  const { charges, errors } = outputCharges(client, lines, doc.number);
  if (errors.length) throw new OutputError(errors.join(" "));
  for (const c of charges) {
    await tx.execute(sql`
      insert into marketing_expenses (brand_id, activation_id, product_id, document_line_id, client_id, output_nature, category, label, amount, status, date)
      values (${c.brandId}::uuid, ${doc.activationId}::uuid, ${c.productId}::uuid, ${c.documentLineId}::uuid, ${doc.clientId}::uuid, ${c.nature},
        'ECHANTILLONS'::budget_category, ${c.label}, ${c.amount}::numeric, 'SPENT'::expense_status, ${doc.date}::date)
      on conflict (document_line_id) where document_line_id is not null do nothing`);
  }
  return charges.length;
}

/** Annulation d'un BL : ses charges d'échantillons disparaissent (la pièce reste, au statut Annulé). */
export async function removeOutputCharges(tx: DbLike, lineIds: string[]): Promise<number> {
  if (!lineIds.length) return 0;
  const r = await tx.execute(sql`delete from marketing_expenses where document_line_id = any(${pgArray(lineIds)})`);
  return r.rowCount ?? 0;
}

/* ------------------------------------------------------------------ lecture */

export type ActivationOutputRow = {
  documentId: string; number: string | null; date: string; client: string; kind: "PRODUIT" | "MATERIEL"; designation: string;
  quantity: number; unitCost: number | null; value: number | null; charged: number;
};

/** Sorties par BL rattachées à une activation (BL validés, non annulés) : produits passés en charge, matériel tracé. */
export async function activationOutputs(activationId: string): Promise<ActivationOutputRow[]> {
  const r = await db.execute<ActivationOutputRow>(sql`
    select d.id as "documentId", d.number, d.date::text as date, c.name as client,
      case when l.inventory_item_id is not null then 'MATERIEL' else 'PRODUIT' end as kind, l.designation,
      (l.quantity + l.free_quantity)::float8 as quantity, l.unit_cost::float8 as "unitCost",
      ((l.quantity + l.free_quantity) * l.unit_cost)::float8 as value,
      coalesce((select sum(e.amount) from marketing_expenses e where e.document_line_id = l.id), 0)::float8 as charged
    from sales_documents d join sales_document_lines l on l.document_id = d.id join clients c on c.id = d.client_id
    where d.activation_id = ${activationId}::uuid and d.type = 'BL' and d.status not in ('BROUILLON', 'ANNULE')
    order by d.date, d.number, l.position`);
  return r.rows;
}
