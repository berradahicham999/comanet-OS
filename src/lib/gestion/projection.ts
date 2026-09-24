import "server-only";
import { sql } from "drizzle-orm";
import { sales } from "@/db/schema";
import type { DbLike } from "@/lib/events/emit";
import { pgArray } from "@/lib/sql-array";
import { projectionRows, type ProjectionDoc, type ProjectionLine } from "./documents-shared";

/**
 * Projection des pièces COMANET OS dans `sales` — SEUL écrivain des lignes `source = 'COMANET_OS'`
 * (garde-fou dans `tests/definitions-uniques.test.ts`).
 *
 * `sales` reste la table unique du sell-in : les 70 lecteurs existants (analyses, Cockpit, règles,
 * IA) voient les ventes de COMANET OS sans modification. On ne projette qu'en mode ACTIF
 * (`shouldProject()`), sinon Sage fait foi et les mêmes ventes seraient comptées deux fois.
 * Clé stable `COS:<ligne>` : reprojeter une pièce ne duplique rien.
 */

export async function projectDocument(tx: DbLike, doc: ProjectionDoc, lines: ProjectionLine[]): Promise<number> {
  const rows = projectionRows(doc, lines);
  if (!rows.length) return 0;
  await tx.insert(sales).values(rows).onConflictDoNothing({ target: sales.lineHash });
  return rows.length;
}

/** À la facturation d'un BL projeté, la ligne de vente reçoit le numéro de facture. */
export async function attachInvoiceNumber(tx: DbLike, blLineIds: string[], invoiceNumber: string): Promise<void> {
  if (!blLineIds.length) return;
  await tx.execute(sql`update sales set invoice_ref = ${invoiceNumber} where source = 'COMANET_OS' and document_line_id = any(${pgArray(blLineIds)})`);
}

/** Un BL annulé sort des ventes : ses lignes projetées sont retirées (la pièce, elle, reste, au statut Annulé). */
export async function removeProjection(tx: DbLike, lineIds: string[]): Promise<number> {
  if (!lineIds.length) return 0;
  const r = await tx.execute(sql`delete from sales where source = 'COMANET_OS' and document_line_id = any(${pgArray(lineIds)})`);
  return r.rowCount ?? 0;
}
