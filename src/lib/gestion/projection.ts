import "server-only";
import { sql } from "drizzle-orm";
import { sales } from "@/db/schema";
import type { DbLike } from "@/lib/events/emit";
import { pgArray } from "@/lib/sql-array";
import { projectedLines, projectionRows, type CutoverLike, type DocType, type ProjectionDoc, type ProjectionLine, type SalesFromDocsLike } from "./documents-shared";

/**
 * Projection des pièces COMANET OS dans `sales` — SEUL écrivain des lignes `source = 'COMANET_OS'`
 * (garde-fou dans `tests/definitions-uniques.test.ts`).
 *
 * `sales` reste la table unique du sell-in : les 70 lecteurs existants (analyses, Cockpit, règles,
 * IA) voient les ventes de COMANET OS sans modification. On projette en mode ACTIF (`shouldProject()`)
 * et, avant la bascule, les seules marques choisies dans « Ventes depuis les pièces » (`projectedLines()`) ;
 * l'import ignore alors ces marques sur les sites qui basculent, sinon la même vente serait comptée deux fois.
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

/** Une pièce qui change de client (`reassignDocumentClient()`) emporte ses ventes projetées : même ligne, autre client. */
export async function reassignProjection(tx: DbLike, lineIds: string[], clientId: string, legalName: string): Promise<number> {
  if (!lineIds.length) return 0;
  const r = await tx.execute(sql`update sales set client_id = ${clientId}::uuid, raw_client = ${legalName} where source = 'COMANET_OS' and document_line_id = any(${pgArray(lineIds)})`);
  return r.rowCount ?? 0;
}

/** Marque de chaque article (pour le tri « Ventes depuis les pièces »). */
export async function productBrands(tx: DbLike, productIds: (string | null)[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(productIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const r = await tx.execute<{ id: string; brand_id: string | null }>(sql`select id, brand_id from products where id = any(${pgArray(ids)})`);
  return new Map(r.rows.map((x) => [x.id, x.brand_id]));
}

/**
 * Remet les ventes projetées en accord avec le réglage « Ventes depuis les pièces » (date, marques) et
 * la bascule : ajoute les lignes de BL et d'avoirs validés désormais couvertes (avec leur numéro de
 * facture), retire celles qui ne le sont plus (jamais celles d'une pièce légale). Idempotent.
 */
export async function resyncProjection(tx: DbLike, c: CutoverLike, f: SalesFromDocsLike): Promise<{ added: number; removed: number }> {
  const rows = (await tx.execute<{
    doc_id: string; type: DocType; number: string; date: string; client_id: string; site: string; sales_rep_name: string | null; legal_name: string | null; is_simulation: boolean;
    line_id: string; product_id: string | null; designation: string; quantity: string; free_quantity: string; net_ht: string; brand_id: string | null;
  }>(sql`
    select d.id as doc_id, d.type, d.number, d.date::text as date, d.client_id, d.site, d.sales_rep_name, d.client_snapshot->>'legalName' as legal_name, d.is_simulation,
      l.id as line_id, l.product_id, l.designation, l.quantity::text as quantity, l.free_quantity::text as free_quantity, l.net_ht::text as net_ht, p.brand_id
    from sales_documents d join sales_document_lines l on l.document_id = d.id left join products p on p.id = l.product_id
    where d.type in ('BL', 'AVOIR') and d.status not in ('BROUILLON', 'ANNULE') and d.source = 'COMANET_OS' and d.number is not null
    order by d.date, d.number, l.position`)).rows;
  const byDoc = new Map<string, typeof rows>();
  for (const r of rows) byDoc.set(r.doc_id, [...(byDoc.get(r.doc_id) ?? []), r]);
  const existing = new Set((await tx.execute<{ id: string }>(sql`select document_line_id as id from sales where source = 'COMANET_OS' and document_line_id is not null`)).rows.map((r) => r.id));
  const keep = new Set<string>();
  let added = 0;
  for (const lines of byDoc.values()) {
    const d = lines[0];
    const fed = projectedLines(c, f, { isSimulation: d.is_simulation, date: d.date, site: d.site }, lines.map((l) => ({
      id: l.line_id, productId: l.product_id, designation: l.designation, quantity: l.quantity, freeQuantity: l.free_quantity, netHt: l.net_ht, brandId: l.brand_id,
    })));
    for (const l of fed) keep.add(l.id);
    const fresh = fed.filter((l) => !existing.has(l.id));
    if (fresh.length) added += await projectDocument(tx, { type: d.type, number: d.number, date: d.date, clientId: d.client_id, site: d.site, salesRepName: d.sales_rep_name, legalName: d.legal_name }, fresh);
  }
  // Une pièce légale (hors simulation) déjà projetée le reste, même si la bascule est revenue en arrière.
  for (const r of rows) if (!r.is_simulation && existing.has(r.line_id)) keep.add(r.line_id);
  const stale = [...existing].filter((id) => !keep.has(id));
  const removed = await removeProjection(tx, stale);
  // Numéro de la facture qui reprend chaque ligne de BL projetée.
  await tx.execute(sql`
    update sales s set invoice_ref = fd.number
    from sales_document_lines fl join sales_documents fd on fd.id = fl.document_id
    where s.source = 'COMANET_OS' and s.invoice_ref is null and fl.source_line_id = s.document_line_id
      and fd.type = 'FACTURE' and fd.status not in ('BROUILLON', 'ANNULE') and fd.number is not null`);
  return { added, removed };
}
