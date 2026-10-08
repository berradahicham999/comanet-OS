import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { salesDocumentLines, salesDocuments } from "@/db/schema";
import { audit, type AuditActor } from "@/lib/audit";
import { notify } from "@/lib/content/notify";
import { pgArray } from "@/lib/sql-array";
import { iso, today } from "@/lib/format";
import { getSettings, type GestionSettings } from "@/lib/settings";
import { amountInWords, computeDocument, netUnitPriceHt } from "./calc";
import { billingIdentity, billingReadiness } from "./clients-shared";
import {
  DOC_TYPE_LABELS, allowedActions, blStatusAfterInvoicing, commercialIssues, defaultDiscount, dueDateOf, emitsReal, moduleOfType, orderStatusAfterDelivery,
  remainingQty, shouldProject, type CommercialIssue, type DocStatus, type DocType,
} from "./documents-shared";
import { recordStockMovements, type LedgerInput } from "./ledger";
import { allocateFefo } from "./ledger-shared";
import { SCALE, formatScaled, fromDb, parseDecimal } from "./money";
import { allocateNumber } from "./numbering";
import { attachInvoiceNumber, projectDocument, reassignProjection, removeProjection } from "./projection";
import { allocateCreditIn } from "./payments";

/**
 * Pièces de vente — SEUL module qui crée, valide, livre, annule ou facture une pièce (garde-fou
 * dans `tests/definitions-uniques.test.ts`). Une pièce validée est figée par la base (triggers de
 * la migration 0026) : ce module ne fait plus évoluer que son statut et ses compteurs.
 * Commande client (COMMANDE) : confirmée avec un numéro BC, sans stock ni vente ; `createBLFromOrder()`
 * en prépare le BL (lignes reprises, tout reste modifiable) et la validation du BL fait avancer
 * la quantité livrée de la commande.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Doc = typeof salesDocuments.$inferSelect;
type Line = typeof salesDocumentLines.$inferSelect;

export class DocumentError extends Error {}
/** Validation refusée faute de levée des blocages : la liste est affichée et peut être soumise à un validateur. */
export class CommercialBlockError extends Error {
  constructor(public issues: CommercialIssue[]) {
    super(`Validation bloquée : ${issues.map((i) => i.label).join(" ")}`);
  }
}

export type DraftLineInput = {
  productId: string | null;
  designation?: string | null;
  quantity: string;
  freeQuantity?: string | null;
  unitPriceHt: string;
  discountPct: string;
  taxRate?: string | null;
  lotId?: string | null;
  warehouseKey?: string | null;
  sourceLineId?: string | null;
  returnWarehouseKey?: string | null;
};

export type DraftInput = {
  id?: string | null;
  type: DocType;
  clientId: string;
  /** Raison sociale facturée (NULL : identité principale de la fiche). */
  legalEntityId?: string | null;
  date: string;
  site: string;
  deliveryAddress: string | null;
  salesRepId: string | null;
  paymentModeKey: string | null;
  globalDiscountPct: string;
  notes: string | null;
  reasonKey?: string | null;
  originDocumentId?: string | null;
  lines: DraftLineInput[];
};

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

export type DocumentView = Doc & {
  lines: (Line & { brandId: string | null; productKind: string | null; trackLots: boolean })[];
  client: { id: string; name: string; legalName: string | null; city: string | null; blocked: boolean; accountCode: string | null };
  origin: { id: string; number: string | null; type: string } | null;
  children: { id: string; number: string | null; type: string; status: string; ttc: string }[];
  sources: { id: string; number: string | null; date: string; type: string }[];
};

export async function getDocument(id: string): Promise<DocumentView | null> {
  const [doc] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, id));
  if (!doc) return null;
  const [lines, client, origin, children, sources] = await Promise.all([
    db.execute<Line & { brand_id: string | null; product_kind: string | null; track_lots: boolean }>(sql`
      select l.*, p.brand_id, p.kind as product_kind, coalesce(p.track_lots, false) as track_lots
      from sales_document_lines l left join products p on p.id = l.product_id where l.document_id = ${id}::uuid order by l.position`),
    db.execute<{ id: string; name: string; legal_name: string | null; city: string | null; blocked: boolean; account_code: string | null }>(sql`
      select id, name, legal_name, city, blocked, account_code from clients where id = ${doc.clientId}::uuid`),
    doc.originDocumentId ? db.execute<{ id: string; number: string | null; type: string }>(sql`select id, number, type from sales_documents where id = ${doc.originDocumentId}::uuid`) : null,
    db.execute<{ id: string; number: string | null; type: string; status: string; ttc: string }>(sql`
      select distinct d.id, d.number, d.type, d.status, d.ttc::text as ttc from sales_documents d
      left join sales_document_lines l on l.document_id = d.id
      where d.origin_document_id = ${id}::uuid
         or l.source_line_id in (select id from sales_document_lines where document_id = ${id}::uuid)
      order by d.number nulls last`),
    db.execute<{ id: string; number: string | null; date: string; type: string }>(sql`
      select distinct d.id, d.number, d.date::text as date, d.type from sales_document_lines l
      join sales_document_lines s on s.id = l.source_line_id join sales_documents d on d.id = s.document_id
      where l.document_id = ${id}::uuid order by d.number`),
  ]);
  const c = client.rows[0];
  return {
    ...doc,
    lines: lines.rows.map((l) => {
      const r = l as unknown as Record<string, unknown>;
      return {
        id: r.id, documentId: r.document_id, position: r.position, productId: r.product_id, lotId: r.lot_id, warehouseKey: r.warehouse_key, ref: r.ref,
        designation: r.designation, unit: r.unit, quantity: r.quantity, freeQuantity: r.free_quantity, unitPriceHt: r.unit_price_ht,
        publicPriceTtc: r.public_price_ttc, discountPct: r.discount_pct, grossHt: r.gross_ht, netHt: r.net_ht, taxRate: r.tax_rate,
        vatAmount: r.vat_amount, ttc: r.ttc, sourceLineId: r.source_line_id, sourceNumber: r.source_number, sourceDate: r.source_date,
        invoicedQty: r.invoiced_qty, creditedQty: r.credited_qty, deliveredQty: r.delivered_qty, returnWarehouseKey: r.return_warehouse_key, lotAllocations: r.lot_allocations,
        brandId: r.brand_id, productKind: r.product_kind, trackLots: !!r.track_lots,
      } as Line & { brandId: string | null; productKind: string | null; trackLots: boolean };
    }),
    client: { id: c.id, name: c.name, legalName: c.legal_name, city: c.city, blocked: c.blocked, accountCode: c.account_code },
    origin: origin?.rows[0] ?? null,
    children: children.rows,
    sources: sources.rows,
  };
}

export type DocumentListRow = {
  id: string; type: DocType; status: DocStatus; number: string | null; date: string; clientId: string; client: string; city: string | null;
  netHt: string; ttc: string; isSimulation: boolean; salesRep: string | null; dueDate: string | null; site: string; approvalRequested: boolean;
};

/** `ownerId` : portée « ses données » — seulement les pièces saisies par cette personne ou qui lui sont attribuées (commandes d'un commercial). */
export async function listDocuments(opts: { type?: DocType; clientIds?: string[] | null; ownerId?: string; limit?: number } = {}): Promise<DocumentListRow[]> {
  const r = await db.execute<DocumentListRow>(sql`
    select d.id, d.type, d.status, d.number, d.date::text as date, d.client_id as "clientId", coalesce(d.client_snapshot->>'legalName', c.name) as client, coalesce(d.client_snapshot->>'city', c.city) as city,
      d.net_ht::text as "netHt", d.ttc::text as ttc, d.is_simulation as "isSimulation", d.sales_rep_name as "salesRep",
      d.due_date::text as "dueDate", d.site, (d.approval_requested_at is not null and d.status = 'BROUILLON') as "approvalRequested"
    from sales_documents d join clients c on c.id = d.client_id
    where true ${opts.type ? sql`and d.type = ${opts.type}` : sql``}
      ${opts.clientIds ? (opts.clientIds.length ? sql`and d.client_id = any(${pgArray(opts.clientIds)})` : sql`and false`) : sql``}
      ${opts.ownerId ? sql`and (d.created_by_id = ${opts.ownerId}::uuid or d.sales_rep_id = ${opts.ownerId}::uuid)` : sql``}
    order by d.date desc, d.created_at desc limit ${opts.limit ?? 500}`);
  return r.rows;
}

/** BL facturables d'un client (validés, ou livrés si l'étape est exigée), avec leur reste à facturer. */
export async function invoiceableBLs(clientId: string, requireDelivered: boolean) {
  const statuses = requireDelivered ? ["LIVRE", "FACTURE_PARTIEL"] : ["VALIDE", "LIVRE", "FACTURE_PARTIEL"];
  const r = await db.execute<{ id: string; number: string; date: string; status: string; ttc: string; is_simulation: boolean; global_discount_pct: string; remaining_lines: number }>(sql`
    select d.id, d.number, d.date::text as date, d.status, d.ttc::text as ttc, d.is_simulation, d.global_discount_pct::text,
      (select count(*)::int from sales_document_lines l where l.document_id = d.id and l.invoiced_qty < l.quantity) as remaining_lines
    from sales_documents d where d.type = 'BL' and d.client_id = ${clientId}::uuid and d.status = any(${pgArray(statuses, "text")})
    order by d.date, d.number`);
  return r.rows.filter((b) => b.remaining_lines > 0);
}

/* ------------------------------------------------------------------ */
/* Brouillons                                                          */
/* ------------------------------------------------------------------ */

type ProductInfo = { id: string; name: string; code: string | null; sku: string | null; unit: string; kind: string; brand_id: string | null; price_retail: string | null; rate: string | null };

async function productInfos(t: Tx | typeof db, ids: string[]): Promise<Map<string, ProductInfo>> {
  if (!ids.length) return new Map();
  const r = await t.execute<ProductInfo>(sql`
    select p.id, p.name, p.code, p.sku, p.unit, p.kind, p.brand_id, coalesce(p.price_retail, p.price_wholesale)::text as price_retail, tr.rate::text as rate
    from products p left join tax_rates tr on tr.key = p.tax_rate_key where p.id = any(${pgArray(ids)})`);
  return new Map(r.rows.map((p) => [p.id, p]));
}

async function defaultRate(t: Tx | typeof db, g: GestionSettings): Promise<string> {
  const r = await t.execute<{ rate: string }>(sql`select rate::text as rate from tax_rates where key = ${g.defaultTaxRateKey}`);
  return r.rows[0]?.rate ?? "20.00";
}

/** Crée ou remplace un brouillon (en-tête et lignes). Les montants sont toujours recalculés ici. */
export async function saveDraft(input: DraftInput, actor: AuditActor): Promise<string> {
  const g = (await getSettings()).gestion;
  if (!DOC_TYPE_LABELS[input.type]) throw new DocumentError("Type de pièce inconnu.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new DocumentError("Date invalide.");
  return db.transaction(async (tx) => {
    const client = (await tx.execute<{ active: boolean }>(sql`select active from clients where id = ${input.clientId}::uuid`)).rows[0];
    if (!client) throw new DocumentError("Client introuvable.");
    if (!client.active) throw new DocumentError("Ce client est archivé : restaurez-le avant de lui établir une pièce.");
    const legalEntityId = input.legalEntityId || null;
    if (legalEntityId) {
      const e = (await tx.execute<{ active: boolean }>(sql`select active from client_legal_entities where id = ${legalEntityId}::uuid and client_id = ${input.clientId}::uuid`)).rows[0];
      if (!e) throw new DocumentError("Cette raison sociale n'appartient pas au client choisi.");
      if (!e.active) throw new DocumentError("Cette raison sociale est archivée : choisissez-en une autre.");
    }
    const products = await productInfos(tx, input.lines.map((l) => l.productId).filter((x): x is string => !!x));
    const rate = await defaultRate(tx, g);
    // Une commande client ne porte aucune remise (décision d'Hicham) : le commercial saisit produits et
    // quantités au PPH ; la remise du client s'applique automatiquement au BL préparé depuis la commande.
    const noDiscount = input.type === "COMMANDE";
    const lines = input.lines.map((l, i) => {
      const p = l.productId ? products.get(l.productId) : null;
      if (l.productId && !p) throw new DocumentError(`Ligne ${i + 1} : article introuvable.`);
      if ((input.type === "BL" || input.type === "COMMANDE") && (!p || p.kind !== "PRODUIT")) throw new DocumentError(`Ligne ${i + 1} : ${input.type === "BL" ? "un bon de livraison" : "une commande client"} ne porte que des articles stockés.`);
      if (input.type === "FACTURE" && p && p.kind === "PRODUIT" && !l.sourceLineId) throw new DocumentError(`Ligne ${i + 1} : un article stocké se facture depuis son bon de livraison (sortie de stock).`);
      const designation = p?.name ?? l.designation?.trim();
      if (!designation) throw new DocumentError(`Ligne ${i + 1} : désignation manquante.`);
      const qty = parseDecimal(l.quantity, SCALE.qty);
      if (qty === null || qty <= 0n) throw new DocumentError(`Ligne ${i + 1} (${designation}) : quantité positive attendue.`);
      const free = parseDecimal(l.freeQuantity ?? "0", SCALE.qty) ?? 0n;
      if (free < 0n) throw new DocumentError(`Ligne ${i + 1} : UG négatives.`);
      const pu = parseDecimal(l.unitPriceHt, SCALE.money);
      if (pu === null || pu < 0n) throw new DocumentError(`Ligne ${i + 1} (${designation}) : prix unitaire HT manquant.`);
      return {
        position: i, productId: p?.id ?? null, lotId: l.lotId ?? null, warehouseKey: l.warehouseKey ?? "PRINCIPAL",
        ref: p ? (p.code ?? p.sku) : null, designation, unit: p?.unit ?? null,
        quantity: formatScaled(qty, SCALE.qty), freeQuantity: formatScaled(free, SCALE.qty), unitPriceHt: formatScaled(pu, SCALE.money),
        publicPriceTtc: p?.price_retail ?? null, discountPct: noDiscount ? formatScaled(0n, SCALE.pct) : formatScaled(parseDecimal(l.discountPct || "0", SCALE.pct) ?? 0n, SCALE.pct),
        taxRate: p?.rate ?? l.taxRate ?? rate, sourceLineId: l.sourceLineId ?? null, returnWarehouseKey: l.returnWarehouseKey ?? null,
      };
    });
    const globalDiscountPct = noDiscount ? formatScaled(0n, SCALE.pct) : formatScaled(parseDecimal(input.globalDiscountPct || "0", SCALE.pct) ?? 0n, SCALE.pct);
    const calc = computeDocument(lines.map((l) => ({ quantity: l.quantity, unitPriceHt: l.unitPriceHt, discountPct: l.discountPct, taxRate: l.taxRate })), globalDiscountPct);
    // Numéro et date d'origine des BL facturés, imprimés sur la facture.
    const sourceIds = lines.map((l) => l.sourceLineId).filter((x): x is string => !!x);
    const src = sourceIds.length ? new Map((await tx.execute<{ id: string; number: string | null; date: string }>(sql`
      select l.id, d.number, d.date::text as date from sales_document_lines l join sales_documents d on d.id = l.document_id where l.id = any(${pgArray(sourceIds)})`)).rows.map((r) => [r.id, r])) : new Map();
    const rep = input.salesRepId ? (await tx.execute<{ name: string }>(sql`select name from users where id = ${input.salesRepId}::uuid`)).rows[0]?.name ?? null : null;
    const header = {
      type: input.type, date: input.date, clientId: input.clientId, legalEntityId, site: input.site.toUpperCase(), deliveryAddress: input.deliveryAddress,
      salesRepId: input.salesRepId, salesRepName: rep, paymentModeKey: input.paymentModeKey, globalDiscountPct, notes: input.notes,
      reasonKey: input.reasonKey ?? null, originDocumentId: input.originDocumentId ?? null,
      grossHt: calc.grossHt, netHt: calc.netHt, vatTotal: calc.vatTotal, ttc: calc.ttc, vatBreakdown: calc.vatBreakdown, updatedAt: new Date(),
    };
    let id = input.id ?? null;
    if (id) {
      const [cur] = await tx.select({ status: salesDocuments.status, type: salesDocuments.type }).from(salesDocuments).where(eq(salesDocuments.id, id)).for("update");
      if (!cur) throw new DocumentError("Pièce introuvable.");
      if (cur.status !== "BROUILLON") throw new DocumentError("Seul un brouillon se modifie.");
      if (cur.type !== input.type) throw new DocumentError("Le type d'une pièce ne change pas.");
      await tx.update(salesDocuments).set(header).where(eq(salesDocuments.id, id));
      await tx.delete(salesDocumentLines).where(eq(salesDocumentLines.documentId, id));
    } else {
      const [row] = await tx.insert(salesDocuments).values({ ...header, createdById: actor.id }).returning({ id: salesDocuments.id });
      id = row.id;
    }
    if (lines.length) {
      await tx.insert(salesDocumentLines).values(lines.map((l, i) => ({
        ...l, documentId: id!, grossHt: calc.lines[i].grossHt, netHt: calc.lines[i].netHt, vatAmount: calc.lines[i].vatAmount, ttc: calc.lines[i].ttc,
        sourceNumber: l.sourceLineId ? src.get(l.sourceLineId)?.number ?? null : null, sourceDate: l.sourceLineId ? src.get(l.sourceLineId)?.date ?? null : null,
      })));
    }
    await audit({ actor, action: input.id ? "UPDATE" : "CREATE", module: moduleOfType(input.type), entity: "sales_document", entityId: id, label: `${DOC_TYPE_LABELS[input.type].one} (brouillon)`, after: { lines: lines.length, netHt: calc.netHt, ttc: calc.ttc } }, tx);
    return id!;
  });
}

const moduleOf = moduleOfType;

export async function deleteDraft(id: string, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(salesDocuments).where(eq(salesDocuments.id, id)).for("update");
    if (!d) throw new DocumentError("Pièce introuvable.");
    if (d.status !== "BROUILLON") throw new DocumentError("Seul un brouillon se supprime ; une pièce validée s'annule ou se corrige par un avoir.");
    await tx.delete(salesDocuments).where(eq(salesDocuments.id, id));
    await audit({ actor, action: "DELETE", module: moduleOf(d.type as DocType), entity: "sales_document", entityId: id, label: `${DOC_TYPE_LABELS[d.type as DocType].one} (brouillon)`, before: { ttc: d.ttc } }, tx);
  });
}

/** Brouillon de facture regroupant le reste à facturer de plusieurs BL d'un même client. */
export async function createInvoiceFromBLs(blIds: string[], actor: AuditActor): Promise<string> {
  if (!blIds.length) throw new DocumentError("Choisissez au moins un bon de livraison.");
  const g = (await getSettings()).gestion;
  const docs = (await db.execute<{ id: string; number: string; client_id: string; legal_entity_id: string | null; status: DocStatus; is_simulation: boolean; global_discount_pct: string; site: string; sales_rep_id: string | null; payment_mode_key: string | null }>(sql`
    select id, number, client_id, legal_entity_id, status, is_simulation, global_discount_pct::text, site, sales_rep_id, payment_mode_key from sales_documents
    where id = any(${pgArray(blIds)}) and type = 'BL' order by date, number`)).rows;
  if (docs.length !== new Set(blIds).size) throw new DocumentError("Bon de livraison introuvable.");
  if (new Set(docs.map((d) => d.client_id)).size > 1) throw new DocumentError("Une facture regroupe les BL d'un seul client.");
  if (new Set(docs.map((d) => d.legal_entity_id)).size > 1) throw new DocumentError("Ces BL ne sont pas établis au nom de la même raison sociale : facturez-les séparément.");
  if (new Set(docs.map((d) => d.is_simulation)).size > 1) throw new DocumentError("On ne mélange pas BL de simulation et BL réels sur une facture.");
  if (new Set(docs.map((d) => d.global_discount_pct)).size > 1) throw new DocumentError("Ces BL n'ont pas la même remise globale : facturez-les séparément.");
  for (const d of docs) if (!allowedActions("BL", d.status, { requireDelivered: g.requireDelivered }).invoice) throw new DocumentError(`${d.number} n'est pas facturable (statut ${d.status}).`);
  const lines = (await db.execute<Line & Record<string, string>>(sql`
    select l.id, l.product_id, l.quantity::text, l.invoiced_qty::text, l.free_quantity::text, l.unit_price_ht::text, l.discount_pct::text, l.tax_rate::text, l.designation
    from sales_document_lines l join sales_documents d on d.id = l.document_id
    where l.document_id = any(${pgArray(blIds)}) and l.invoiced_qty < l.quantity order by d.date, d.number, l.position`)).rows as unknown as Record<string, string>[];
  if (!lines.length) throw new DocumentError("Ces BL sont déjà entièrement facturés.");
  const first = docs[0];
  return saveDraft({
    type: "FACTURE", clientId: first.client_id, legalEntityId: first.legal_entity_id, date: iso(today()), site: first.site, deliveryAddress: null,
    salesRepId: first.sales_rep_id, paymentModeKey: first.payment_mode_key, globalDiscountPct: first.global_discount_pct, notes: null,
    lines: lines.map((l) => ({
      productId: l.product_id, quantity: remainingQty(l.quantity, l.invoiced_qty),
      // Les UG suivent la première facturation de la ligne seulement.
      freeQuantity: l.invoiced_qty === "0.000" ? l.free_quantity : "0", unitPriceHt: l.unit_price_ht, discountPct: l.discount_pct, taxRate: l.tax_rate, sourceLineId: l.id,
    })),
  }, actor);
}

/** Brouillon d'avoir sur une facture validée : reprend les lignes non encore créditées, à ajuster. */
export async function createCreditNote(invoiceId: string, actor: AuditActor): Promise<string> {
  const inv = await getDocument(invoiceId);
  if (!inv || inv.type !== "FACTURE") throw new DocumentError("Facture introuvable.");
  if (inv.status !== "VALIDE") throw new DocumentError("Un avoir se fait sur une facture validée.");
  const lines = inv.lines.filter((l) => (parseDecimal(l.creditedQty, SCALE.qty) ?? 0n) < (parseDecimal(l.quantity, SCALE.qty) ?? 0n));
  if (!lines.length) throw new DocumentError("Toutes les lignes de cette facture ont déjà fait l'objet d'un avoir avec retour.");
  const open = (await db.execute<{ id: string }>(sql`select id from sales_documents where origin_document_id = ${invoiceId}::uuid and type = 'AVOIR' and status = 'BROUILLON' limit 1`)).rows[0];
  if (open) throw new DocumentError("Un avoir brouillon existe déjà sur cette facture : terminez-le ou supprimez-le.");
  return saveDraft({
    type: "AVOIR", clientId: inv.clientId, legalEntityId: inv.legalEntityId, date: iso(today()), site: inv.site, deliveryAddress: null, salesRepId: inv.salesRepId,
    paymentModeKey: inv.paymentModeKey, globalDiscountPct: inv.globalDiscountPct, notes: null, reasonKey: "RETOUR", originDocumentId: inv.id,
    lines: lines.map((l) => ({
      productId: l.productId, designation: l.designation, quantity: remainingQty(l.quantity, l.creditedQty), freeQuantity: "0", unitPriceHt: l.unitPriceHt,
      discountPct: l.discountPct, taxRate: l.taxRate, sourceLineId: l.id, returnWarehouseKey: l.productId ? "PRINCIPAL" : null,
    })),
  }, actor);
}

/**
 * Brouillon de BL préparé depuis une commande confirmée : en-tête repris (client, raison sociale,
 * adresse, site, commercial, règlement, note) et lignes au reste à livrer, au prix de la commande.
 * La commande ne porte pas de remise : la remise du client (sur la marque, sinon par défaut) est
 * posée ici sur chaque ligne, comme sur un BL saisi à la main. Tout reste modifiable dans l'éditeur
 * avant validation : c'est le BL qui engage, la commande n'est qu'une intention. Un seul BL
 * brouillon à la fois par commande.
 */
export async function createBLFromOrder(orderId: string, actor: AuditActor): Promise<string> {
  const order = await getDocument(orderId);
  if (!order || order.type !== "COMMANDE") throw new DocumentError("Commande introuvable.");
  if (!allowedActions("COMMANDE", order.status as DocStatus).prepareBL) throw new DocumentError("Seule une commande confirmée (et pas encore entièrement livrée) se transforme en bon de livraison.");
  const lines = order.lines.filter((l) => (parseDecimal(l.deliveredQty, SCALE.qty) ?? 0n) < (parseDecimal(l.quantity, SCALE.qty) ?? 0n));
  if (!lines.length) throw new DocumentError("Cette commande est entièrement livrée.");
  const open = (await db.execute<{ id: string }>(sql`select id from sales_documents where origin_document_id = ${orderId}::uuid and type = 'BL' and status = 'BROUILLON' limit 1`)).rows[0];
  if (open) throw new DocumentError("Un BL brouillon existe déjà pour cette commande : terminez-le ou supprimez-le.");
  const client = (await db.execute<{ default_discount_pct: string | null }>(sql`select default_discount_pct::text from clients where id = ${order.clientId}::uuid`)).rows[0];
  const brandDiscounts = new Map((await db.execute<{ brand_id: string; pct: string }>(sql`select brand_id, discount_pct::text as pct from client_brand_discounts where client_id = ${order.clientId}::uuid`)).rows.map((r) => [r.brand_id, r.pct]));
  return saveDraft({
    type: "BL", clientId: order.clientId, legalEntityId: order.legalEntityId, date: iso(today()), site: order.site, deliveryAddress: order.deliveryAddress,
    salesRepId: order.salesRepId, paymentModeKey: order.paymentModeKey, globalDiscountPct: "0", notes: order.notes, originDocumentId: order.id,
    lines: lines.map((l) => ({
      productId: l.productId, quantity: remainingQty(l.quantity, l.deliveredQty),
      // Les UG suivent la première livraison de la ligne seulement.
      freeQuantity: (parseDecimal(l.deliveredQty, SCALE.qty) ?? 0n) === 0n ? l.freeQuantity : "0",
      unitPriceHt: l.unitPriceHt, discountPct: defaultDiscount(client?.default_discount_pct ?? null, l.brandId ? brandDiscounts.get(l.brandId) ?? null : null),
      taxRate: l.taxRate, sourceLineId: l.id,
    })),
  }, actor);
}

/** Reste à livrer d'une commande (quantités), pour les écrans et les règles. */
export function orderRemaining(lines: { quantity: string; deliveredQty: string }[]): bigint {
  return lines.reduce((a, l) => a + ((parseDecimal(l.quantity, SCALE.qty) ?? 0n) - (parseDecimal(l.deliveredQty, SCALE.qty) ?? 0n)), 0n);
}

/* ------------------------------------------------------------------ */
/* Blocages commerciaux                                                */
/* ------------------------------------------------------------------ */

/**
 * Encours de RISQUE d'un client (TTC, même nature réelle / simulation) : soldes des factures (TTC − déjà
 * réglé à la reprise − avoirs imputés − règlements ENCAISSÉS imputés) − avoirs non imputés + BL pas encore
 * facturés. Un chèque ou un effet non encaissé reste dans l'encours : le risque n'est levé qu'à l'encaissement.
 */
export async function clientOutstanding(t: Tx | typeof db, clientId: string, simulation: boolean): Promise<string> {
  const r = await t.execute<{ v: string }>(sql`
    select (
      coalesce((select sum(f.ttc - f.reprise_paid
          - coalesce((select sum(a.amount) from payment_allocations a left join payments p on p.id = a.payment_id
              where a.invoice_id = f.id and (a.credit_note_id is not null or p.status = 'ENCAISSE')), 0))
        from sales_documents f where f.client_id = ${clientId}::uuid and f.type = 'FACTURE' and f.status <> 'BROUILLON' and f.is_simulation = ${simulation}), 0)
      - coalesce((select sum(v.ttc - coalesce((select sum(a.amount) from payment_allocations a where a.credit_note_id = v.id), 0))
        from sales_documents v where v.client_id = ${clientId}::uuid and v.type = 'AVOIR' and v.status <> 'BROUILLON' and v.is_simulation = ${simulation}), 0)
      + coalesce((select sum(round(l.ttc * (l.quantity - l.invoiced_qty) / nullif(l.quantity, 0), 2)) from sales_document_lines l join sales_documents d on d.id = l.document_id
          where d.client_id = ${clientId}::uuid and d.type = 'BL' and d.status in ('VALIDE', 'LIVRE', 'FACTURE_PARTIEL') and d.is_simulation = ${simulation}), 0)
    )::text as v`);
  return r.rows[0]?.v ?? "0";
}

/** Dépassements d'une pièce (BL ou facture directe) à lever avant validation. */
export async function documentIssues(doc: DocumentView, t: Tx | typeof db = db): Promise<CommercialIssue[]> {
  if (doc.type === "AVOIR" || (doc.type === "FACTURE" && doc.lines.some((l) => l.sourceLineId))) return [];
  const g = (await getSettings()).gestion;
  const client = (await t.execute<{ blocked: boolean; blocked_reason: string | null; credit_limit: string | null; default_discount_pct: string | null }>(sql`
    select blocked, blocked_reason, credit_limit::text, default_discount_pct::text from clients where id = ${doc.clientId}::uuid`)).rows[0];
  const brandDiscounts = new Map((await t.execute<{ brand_id: string; pct: string }>(sql`select brand_id, discount_pct::text as pct from client_brand_discounts where client_id = ${doc.clientId}::uuid`)).rows.map((r) => [r.brand_id, r.pct]));
  const productIds = doc.lines.map((l) => l.productId).filter((x): x is string => !!x);
  const cmups = productIds.length ? new Map((await t.execute<{ product_id: string; cmup: string }>(sql`
    select distinct on (product_id) product_id, cmup_after::text as cmup from stock_movements where product_id = any(${pgArray(productIds)}) and cmup_after is not null order by product_id, seq desc`)).rows.map((r) => [r.product_id, r.cmup])) : new Map<string, string>();
  const simulation = !emitsReal(g.cutover, { date: doc.date, site: doc.site });
  return commercialIssues({
    clientBlocked: client.blocked, blockedReason: client.blocked_reason,
    creditLimit: g.checkCreditLimit ? client.credit_limit : null,
    outstanding: g.checkCreditLimit && client.credit_limit ? await clientOutstanding(t, doc.clientId, simulation) : "0",
    documentTtc: doc.ttc, tolerancePct: g.discountTolerancePct, globalDiscountPct: doc.globalDiscountPct,
    lines: doc.lines.map((l) => ({
      designation: l.designation, discountPct: l.discountPct,
      allowedDiscountPct: defaultDiscount(client.default_discount_pct, l.brandId ? brandDiscounts.get(l.brandId) ?? null : null),
      netUnitHt: netUnitPriceHt({ quantity: l.quantity, unitPriceHt: l.unitPriceHt, discountPct: l.discountPct, taxRate: l.taxRate }, doc.globalDiscountPct),
      cmup: l.productId ? cmups.get(l.productId) ?? null : null,
    })),
  });
}

/** Demande de levée des blocages : notifie les personnes qui ont l'interrupteur (et les administrateurs). */
export async function requestApproval(id: string, actor: AuditActor): Promise<void> {
  const doc = await getDocument(id);
  if (!doc || doc.status !== "BROUILLON") throw new DocumentError("Seul un brouillon peut être soumis.");
  const issues = await documentIssues(doc);
  if (!issues.length) throw new DocumentError("Aucun blocage à lever : validez directement.");
  await db.update(salesDocuments).set({ approvalRequestedAt: new Date(), approvalRequestedById: actor.id, updatedAt: new Date() }).where(eq(salesDocuments.id, id));
  const approvers = (await db.execute<{ id: string }>(sql`
    select u.id from users u join user_flags f on f.user_id = u.id where u.active and f.override_commercial`)).rows.map((r) => r.id);
  await notify(approvers, {
    type: "APPROVAL_REQUESTED", title: `${DOC_TYPE_LABELS[doc.type as DocType].one} à débloquer — ${doc.client.name}`,
    body: issues.map((i) => i.label).join(" "), href: `/gestion/pieces/${id}`, entityType: "sales_document", entityId: id,
  }, { except: actor.id });
  await audit({ actor, action: "APPROVAL_REQUESTED", module: moduleOf(doc.type as DocType), entity: "sales_document", entityId: id, label: doc.client.name, after: { issues } });
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function canonicalHash(doc: Record<string, unknown>, lines: Record<string, unknown>[]): string {
  return createHash("sha256").update(JSON.stringify({ doc, lines })).digest("hex");
}

type HashedDoc = { type: string; date: string; grossHt: string; netHt: string; vatTotal: string; ttc: string; globalDiscountPct: string };
type HashedLine = { ref: string | null; designation: string; quantity: string; freeQuantity: string; unitPriceHt: string; discountPct: string; taxRate: string; netHt: string; vatAmount: string; ttc: string };

/** Empreinte d'une pièce validée : numéro, identité figée du client, montants et lignes. */
function documentHash(number: string, doc: HashedDoc, client: Record<string, unknown>, lines: HashedLine[]): string {
  return canonicalHash(
    { number, type: doc.type, date: doc.date, client, grossHt: doc.grossHt, netHt: doc.netHt, vatTotal: doc.vatTotal, ttc: doc.ttc, globalDiscountPct: doc.globalDiscountPct },
    lines.map((l) => ({ ref: l.ref, designation: l.designation, quantity: l.quantity, free: l.freeQuantity, pu: l.unitPriceHt, discount: l.discountPct, rate: l.taxRate, net: l.netHt, vat: l.vatAmount, ttc: l.ttc })),
  );
}

/** Identité légale lue dans la fiche client (et la raison sociale choisie), au format figé sur la pièce. */
async function clientIdentitySnapshot(tx: Tx, clientId: string, legalEntityId: string | null) {
  const client = (await tx.execute<Record<string, string | number | boolean | null>>(sql`
    select id, name, legal_name, account_code, code, ice, if_number, rc, patente, billing_address, postal_code, city, phone, email, payment_days, payment_mode_key, active
    from clients where id = ${clientId}::uuid`)).rows[0];
  if (!client) throw new DocumentError("Client introuvable.");
  const entity = legalEntityId ? (await tx.execute<Record<string, string | null>>(sql`
    select legal_name, account_code, ice, if_number, rc, patente, billing_address, postal_code, city from client_legal_entities
    where id = ${legalEntityId}::uuid and client_id = ${clientId}::uuid`)).rows[0] : null;
  if (legalEntityId && !entity) throw new DocumentError("Cette raison sociale n'appartient pas au client choisi.");
  const s = (v: unknown) => (v ?? null) as string | null;
  const identity = billingIdentity(
    { name: String(client.name), code: s(client.code), legalName: s(client.legal_name), accountCode: s(client.account_code), ice: s(client.ice), ifNumber: s(client.if_number), rc: s(client.rc), patente: s(client.patente), billingAddress: s(client.billing_address), postalCode: s(client.postal_code), city: s(client.city) },
    entity ? { legalName: entity.legal_name, accountCode: entity.account_code, ice: entity.ice, ifNumber: entity.if_number, rc: entity.rc, patente: entity.patente, billingAddress: entity.billing_address, postalCode: entity.postal_code, city: entity.city } : null,
  );
  const snapshot = {
    name: identity.name, legalName: identity.legalName, accountCode: identity.accountCode, ice: identity.ice, ifNumber: identity.ifNumber,
    rc: identity.rc, patente: identity.patente, address: identity.billingAddress, postalCode: identity.postalCode, city: identity.city, phone: client.phone,
  };
  return { client, entity, identity, snapshot };
}

/**
 * Valide une pièce : contrôles, levée des blocages (si `override` et droit), numéro pris dans la
 * transaction, identités figées, sortie de stock (BL, au plus proche de la péremption) ou retour
 * (avoir), compteurs facturé / crédité, projection dans les ventes en mode ACTIF. Tout ou rien.
 */
export async function validateDocument(id: string, actor: AuditActor, opts: { override?: boolean } = {}): Promise<{ number: string; simulation: boolean }> {
  const settings = await getSettings();
  const g = settings.gestion;
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(salesDocuments).where(eq(salesDocuments.id, id)).for("update");
    if (!locked) throw new DocumentError("Pièce introuvable.");
    if (locked.status !== "BROUILLON") throw new DocumentError("Cette pièce est déjà validée.");
    const doc = (await getDocument(id))!;
    const type = doc.type as DocType;
    if (!doc.lines.length) throw new DocumentError("Une pièce sans ligne ne se valide pas.");
    const todayIso = iso(today());
    if (doc.date > todayIso) throw new DocumentError("Une pièce ne se valide pas à une date future.");

    // Identité : une facture ou un avoir porte les mentions obligatoires.
    const { client, entity, identity, snapshot: clientSnapshot } = await clientIdentitySnapshot(tx, doc.clientId, doc.legalEntityId);
    const s = (v: unknown) => (v ?? null) as string | null;
    if (type === "FACTURE" || type === "AVOIR") {
      const r = billingReadiness({ legalName: entity ? identity.legalName : s(client.legal_name), ice: identity.ice, billingAddress: identity.billingAddress, city: identity.city, accountCode: null, paymentDays: null, paymentModeKey: null });
      if (!r.ready) throw new DocumentError(`${entity ? `Raison sociale « ${identity.legalName} »` : "Fiche client"} incomplète pour facturer : ${r.missing.join(", ")}.`);
    }

    // Blocages commerciaux.
    const issues = await documentIssues(doc, tx);
    if (issues.length && !opts.override) throw new CommercialBlockError(issues);
    const approvals = opts.override ? issues.map((i) => ({ code: i.code, label: i.label, by: actor.name, byId: actor.id, at: new Date().toISOString() })) : [];

    // Numéro : série légale en mode ACTIF, série de simulation sinon. Une commande n'est pas une pièce
    // fiscale : sa série BC est toujours réelle, avant comme après la bascule.
    const simulation = type === "COMMANDE" ? false : !emitsReal(g.cutover, { date: doc.date, site: doc.site });
    const seriesKey = simulation ? DOC_TYPE_LABELS[type].simSeries : DOC_TYPE_LABELS[type].series;
    if (type === "FACTURE" && !simulation) {
      const last = (await tx.execute<{ d: string | null }>(sql`select max(date)::text as d from sales_documents where type = 'FACTURE' and series_key = ${seriesKey} and status <> 'BROUILLON'`)).rows[0]?.d;
      if (last && doc.date < last) throw new DocumentError(`Une facture ne peut pas être datée avant la dernière facture validée (${last}).`);
    }

    // Stock : BL = sortie (FEFO pour les articles suivis par lot) ; avoir avec retour = entrée.
    const movements: LedgerInput[] = [];
    const lineAllocations = new Map<string, { lotId: string; lotNumber: string; expiryDate: string | null; qty: string }[]>();
    if (type === "BL") {
      const productIds = [...new Set(doc.lines.map((l) => l.productId!).filter(Boolean))].sort();
      await tx.execute(sql`select id from products where id = any(${pgArray(productIds)}) order by id for update`);
      const lotStock = new Map<string, { lotId: string; lotNumber: string; expiryDate: string | null; available: bigint }[]>();
      for (const l of doc.lines) {
        const out = (parseDecimal(l.quantity, SCALE.qty) ?? 0n) + (parseDecimal(l.freeQuantity, SCALE.qty) ?? 0n);
        if (out <= 0n) continue;
        if (l.trackLots && !l.lotId) {
          const key = `${l.productId}|${l.warehouseKey}`;
          if (!lotStock.has(key)) {
            lotStock.set(key, (await tx.execute<{ lot_id: string; lot_number: string; expiry_date: string | null; qty: string }>(sql`
              select l.id as lot_id, l.lot_number, l.expiry_date::text, sum(m.quantity)::text as qty from stock_movements m join stock_lots l on l.id = m.lot_id
              where m.product_id = ${l.productId}::uuid and m.warehouse_key = ${l.warehouseKey} group by l.id having sum(m.quantity) > 0`)).rows
              .map((r) => ({ lotId: r.lot_id, lotNumber: r.lot_number, expiryDate: r.expiry_date, available: fromDb(r.qty, SCALE.qty) ?? 0n })));
          }
          const lots = lotStock.get(key)!;
          const alloc = allocateFefo(lots, out, todayIso);
          if (alloc.missing > 0n && g.insufficientStock === "BLOCK") {
            throw new DocumentError(`Stock insuffisant pour ${l.designation} : il manque ${formatScaled(alloc.missing, SCALE.qty).replace(/\.?0+$/, "")} unité(s) en lots non périmés.`);
          }
          for (const a of alloc.allocations) {
            const lot = lots.find((x) => x.lotId === a.lotId)!;
            lot.available -= a.qty;
            movements.push({ productId: l.productId!, type: "SORTIE_BL", quantity: formatScaled(-a.qty, SCALE.qty), warehouseKey: l.warehouseKey, lotNumber: a.lotNumber, date: doc.date, sourceType: "BL", sourceId: id, sourceLineId: l.id });
          }
          if (alloc.missing > 0n) movements.push({ productId: l.productId!, type: "SORTIE_BL", quantity: formatScaled(-alloc.missing, SCALE.qty), warehouseKey: l.warehouseKey, date: doc.date, sourceType: "BL", sourceId: id, sourceLineId: l.id, comment: "Sans lot disponible (stock insuffisant en mode alerte)" });
          lineAllocations.set(l.id, alloc.allocations.map((a) => ({ lotId: a.lotId, lotNumber: a.lotNumber, expiryDate: lots.find((x) => x.lotId === a.lotId)?.expiryDate ?? null, qty: formatScaled(a.qty, SCALE.qty) })));
        } else {
          const lotNumber = l.lotId ? (await tx.execute<{ n: string }>(sql`select lot_number as n from stock_lots where id = ${l.lotId}::uuid`)).rows[0]?.n ?? null : null;
          movements.push({ productId: l.productId!, type: "SORTIE_BL", quantity: formatScaled(-out, SCALE.qty), warehouseKey: l.warehouseKey, lotNumber, date: doc.date, sourceType: "BL", sourceId: id, sourceLineId: l.id });
        }
      }
    }
    const reason = doc.reasonKey ? (await tx.execute<{ with_return: boolean }>(sql`select with_return from credit_reasons where key = ${doc.reasonKey}`)).rows[0] : null;
    if (type === "AVOIR" && reason?.with_return) {
      for (const l of doc.lines) {
        if (!l.productId || !l.returnWarehouseKey || l.productKind !== "PRODUIT") continue;
        // Lot du retour : celui qu'avait livré le BL d'origine (facture → BL).
        const lot = l.trackLots ? (await tx.execute<{ lot: string | null }>(sql`
          select (bl.lot_allocations->0->>'lotNumber') as lot from sales_document_lines inv join sales_document_lines bl on bl.id = inv.source_line_id
          where inv.id = ${l.sourceLineId}::uuid`)).rows[0]?.lot ?? null : null;
        movements.push({ productId: l.productId, type: "RETOUR_CLIENT", quantity: l.quantity, warehouseKey: l.returnWarehouseKey, lotNumber: lot, date: doc.date, sourceType: "AVOIR", sourceId: id, sourceLineId: l.id });
      }
    }
    for (const [lineId, alloc] of lineAllocations) await tx.update(salesDocumentLines).set({ lotAllocations: alloc }).where(eq(salesDocumentLines.id, lineId));
    if (movements.length) await recordStockMovements(movements, { id: actor.id }, { tx, allowNegative: g.insufficientStock === "WARN" });

    // BL préparé depuis une commande : la quantité livrée de la commande avance (sans plafond : on peut
    // livrer plus que commandé) et son statut suit. Une commande annulée ne se livre plus.
    const touchedOrders = new Set<string>();
    if (type === "BL") {
      for (const l of doc.lines.filter((x) => x.sourceLineId)) {
        const r = (await tx.execute<{ document_id: string; status: string; number: string | null }>(sql`
          update sales_document_lines l set delivered_qty = l.delivered_qty + ${l.quantity}::numeric
          from sales_documents d where l.id = ${l.sourceLineId}::uuid and d.id = l.document_id and d.type = 'COMMANDE'
          returning d.id as document_id, d.status, d.number`)).rows[0];
        if (!r) throw new DocumentError(`${l.designation} : la ligne de commande d'origine est introuvable.`);
        if (r.status === "ANNULE") throw new DocumentError(`La commande ${r.number ?? ""} est annulée : retirez les lignes reprises ou préparez un nouveau BL.`);
        touchedOrders.add(r.document_id);
      }
    }

    // Facture : les lignes de BL avancent ; avoir : les lignes de facture et le plafond du crédit.
    const touchedBLs = new Set<string>();
    if (type === "FACTURE") {
      for (const l of doc.lines.filter((x) => x.sourceLineId)) {
        const r = (await tx.execute<{ document_id: string; left: string }>(sql`
          update sales_document_lines set invoiced_qty = invoiced_qty + ${l.quantity}::numeric where id = ${l.sourceLineId}::uuid and invoiced_qty + ${l.quantity}::numeric <= quantity
          returning document_id, (quantity - invoiced_qty)::text as left`)).rows[0];
        if (!r) throw new DocumentError(`${l.designation} : quantité facturée au-delà du reste à facturer du BL ${l.sourceNumber ?? ""}.`);
        touchedBLs.add(r.document_id);
      }
    }
    if (type === "AVOIR" && !doc.originDocumentId) {
      // Avoir financier (remise sur objectifs…) : ni facture ni stock ; un crédit client à imputer ensuite.
      if (!doc.reasonKey) throw new DocumentError("Indiquez le motif de l'avoir.");
      if (reason?.with_return) throw new DocumentError("Un avoir sans facture d'origine ne fait pas rentrer de marchandise : choisissez un motif sans retour en stock.");
      if (doc.lines.some((l) => l.productId)) throw new DocumentError("Un avoir financier se ventile par marque ou par libellé libre, sans article.");
    }
    if (type === "AVOIR" && doc.originDocumentId) {
      const room = (await tx.execute<{ room: string }>(sql`
        select (f.ttc - coalesce((select sum(a.ttc) from sales_documents a where a.origin_document_id = f.id and a.type = 'AVOIR' and a.status <> 'BROUILLON'), 0))::text as room
        from sales_documents f where f.id = ${doc.originDocumentId}::uuid`)).rows[0]?.room ?? "0";
      if ((parseDecimal(doc.ttc, SCALE.money) ?? 0n) > (parseDecimal(room, SCALE.money) ?? 0n)) throw new DocumentError(`L'avoir (${doc.ttc} MAD TTC) dépasse le reste de la facture (${room} MAD TTC).`);
      for (const l of doc.lines.filter((x) => x.sourceLineId && reason?.with_return)) {
        const ok = (await tx.execute<{ id: string }>(sql`
          update sales_document_lines set credited_qty = credited_qty + ${l.quantity}::numeric where id = ${l.sourceLineId}::uuid and credited_qty + ${l.quantity}::numeric <= quantity returning id`)).rows[0];
        if (!ok) throw new DocumentError(`${l.designation} : quantité retournée au-delà de la quantité facturée.`);
      }
    }

    // Numéro, identités figées, échéance, montant en lettres.
    const { number, year } = await allocateNumber(tx, seriesKey, doc.date);
    const files = (await tx.execute<{ slot: string; id: string }>(sql`select distinct on (company_slot) company_slot as slot, id from content_assets where company_slot is not null order by company_slot, version desc`)).rows;
    const companySnapshot = { ...g.company, logoAssetId: files.find((f) => f.slot === "LOGO")?.id ?? null, cachetAssetId: files.find((f) => f.slot === "CACHET")?.id ?? null };
    const due = type === "FACTURE" ? dueDateOf(doc.date, client.payment_days as number | null, g.defaultPaymentDays, g.maxPaymentDays) : null;
    const words = type === "BL" || type === "COMMANDE" ? null : amountInWords(doc.ttc, g.amountWords.major, g.amountWords.minor);
    const hash = documentHash(number, doc, clientSnapshot, doc.lines);
    await tx.update(salesDocuments).set({
      status: "VALIDE", number, seriesKey, fiscalYear: year, isSimulation: simulation, clientSnapshot, companySnapshot,
      paymentDays: due?.days ?? null, dueDate: due?.dueDate ?? null, paymentModeKey: doc.paymentModeKey ?? (client.payment_mode_key as string | null),
      amountInWords: words, approvals, contentHash: hash, validatedById: actor.id, validatedAt: new Date(), updatedAt: new Date(),
    }).where(eq(salesDocuments.id, id));

    for (const orderId of touchedOrders) await refreshOrderStatus(tx, orderId);
    // BL facturés : statut d'après leurs lignes ; ventes projetées : numéro de facture.
    for (const blId of touchedBLs) {
      const [bl] = await tx.select({ status: salesDocuments.status }).from(salesDocuments).where(eq(salesDocuments.id, blId));
      const bls = await tx.select({ quantity: salesDocumentLines.quantity, invoicedQty: salesDocumentLines.invoicedQty }).from(salesDocumentLines).where(eq(salesDocumentLines.documentId, blId));
      await tx.update(salesDocuments).set({ status: blStatusAfterInvoicing(bl.status as DocStatus, bls), updatedAt: new Date() }).where(eq(salesDocuments.id, blId));
    }
    // Un avoir solde d'abord sa facture d'origine (jusqu'à son solde) ; le reste est un crédit client à imputer.
    if (type === "AVOIR" && doc.originDocumentId) await allocateCreditIn(tx, id, doc.originDocumentId, parseDecimal(doc.ttc, SCALE.money) ?? 0n, actor.id);
    if (type === "FACTURE") await attachInvoiceNumber(tx, doc.lines.map((l) => l.sourceLineId).filter((x): x is string => !!x), number);
    if ((type === "BL" || type === "AVOIR") && shouldProject(g.cutover, { isSimulation: simulation, date: doc.date, site: doc.site })) {
      await projectDocument(tx, { type, number, date: doc.date, clientId: doc.clientId, site: doc.site, salesRepName: doc.salesRepName, legalName: String(clientSnapshot.legalName) },
        doc.lines.map((l) => ({ id: l.id, productId: l.productId, designation: l.designation, quantity: l.quantity, freeQuantity: l.freeQuantity, netHt: l.netHt })));
    }
    await audit({ actor, action: "VALIDATE", module: moduleOf(type), entity: "sales_document", entityId: id, label: number, after: { number, ttc: doc.ttc, simulation, approvals: approvals.length ? approvals : undefined, movements: movements.length } }, tx);
    return { number, simulation };
  });
}

/* ------------------------------------------------------------------ */
/* Cycle de vie du BL                                                  */
/* ------------------------------------------------------------------ */

export async function markDelivered(id: string, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(salesDocuments).where(eq(salesDocuments.id, id)).for("update");
    if (!d || d.type !== "BL") throw new DocumentError("Bon de livraison introuvable.");
    if (d.status !== "VALIDE") throw new DocumentError("Seul un BL validé passe à « Livré ».");
    await tx.update(salesDocuments).set({ status: "LIVRE", deliveredAt: new Date(), updatedAt: new Date() }).where(eq(salesDocuments.id, id));
    await audit({ actor, action: "DELIVER", module: "livraisons", entity: "sales_document", entityId: id, label: d.number }, tx);
  });
}

/** Annule un BL validé non facturé : contre-mouvements de stock, retrait des ventes projetées. Le numéro reste pris. */
export async function cancelBL(id: string, reason: string, actor: AuditActor): Promise<void> {
  if (!reason.trim()) throw new DocumentError("Indiquez le motif de l'annulation.");
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(salesDocuments).where(eq(salesDocuments.id, id)).for("update");
    if (!d || d.type !== "BL") throw new DocumentError("Bon de livraison introuvable.");
    const lines = await tx.select().from(salesDocumentLines).where(eq(salesDocumentLines.documentId, id));
    const anyInvoiced = lines.some((l) => (parseDecimal(l.invoicedQty, SCALE.qty) ?? 0n) > 0n);
    if (!allowedActions("BL", d.status as DocStatus, { anyInvoiced }).cancel) throw new DocumentError(anyInvoiced ? "Ce BL est (en partie) facturé : il ne s'annule plus, passez par un avoir." : "Ce BL ne peut pas être annulé.");
    const moves = (await tx.execute<{ id: string; product_id: string; type: "SORTIE_BL"; quantity: string; warehouse_key: string; lot_number: string | null }>(sql`
      select m.id, m.product_id, m.type, m.quantity::text, m.warehouse_key, l.lot_number from stock_movements m left join stock_lots l on l.id = m.lot_id
      where m.source_type = 'BL' and m.source_id = ${id}::uuid and m.reversal_of is null
        and not exists (select 1 from stock_movements x where x.reversal_of = m.id)`)).rows;
    if (moves.length) {
      await recordStockMovements(moves.map((m) => ({
        productId: m.product_id, type: m.type, quantity: formatScaled(-(parseDecimal(m.quantity, SCALE.qty) ?? 0n), SCALE.qty), warehouseKey: m.warehouse_key,
        lotNumber: m.lot_number, date: iso(today()), sourceType: "BL", sourceId: id, reversalOf: m.id, comment: `Annulation du ${d.number} : ${reason.trim()}`,
      })), { id: actor.id }, { tx, allowNegative: true });
    }
    await removeProjection(tx, lines.map((l) => l.id));
    // Les lignes de commande reprises par ce BL redeviennent à livrer.
    const orders = new Set<string>();
    for (const l of lines.filter((x) => x.sourceLineId)) {
      const r = (await tx.execute<{ id: string }>(sql`
        update sales_document_lines l set delivered_qty = greatest(l.delivered_qty - ${l.quantity}::numeric, 0)
        from sales_documents d where l.id = ${l.sourceLineId}::uuid and d.id = l.document_id and d.type = 'COMMANDE' returning d.id`)).rows[0];
      if (r) orders.add(r.id);
    }
    for (const orderId of orders) await refreshOrderStatus(tx, orderId);
    await tx.update(salesDocuments).set({ status: "ANNULE", cancelledAt: new Date(), cancelledById: actor.id, cancelReason: reason.trim(), updatedAt: new Date() }).where(eq(salesDocuments.id, id));
    await audit({ actor, action: "CANCEL", module: "livraisons", entity: "sales_document", entityId: id, label: d.number, after: { reason, reversed: moves.length, orders: orders.size || undefined } }, tx);
  });
}

/** Statut d'une commande confirmée d'après ses quantités livrées (une commande annulée ne bouge plus). */
async function refreshOrderStatus(tx: Tx, orderId: string): Promise<void> {
  const [o] = await tx.select({ status: salesDocuments.status }).from(salesDocuments).where(eq(salesDocuments.id, orderId)).for("update");
  if (!o || o.status === "ANNULE" || o.status === "BROUILLON") return;
  const lines = await tx.select({ quantity: salesDocumentLines.quantity, deliveredQty: salesDocumentLines.deliveredQty }).from(salesDocumentLines).where(eq(salesDocumentLines.documentId, orderId));
  const next = orderStatusAfterDelivery(lines);
  if (next !== o.status) await tx.update(salesDocuments).set({ status: next, deliveredAt: next === "LIVRE" ? new Date() : null, updatedAt: new Date() }).where(eq(salesDocuments.id, orderId));
}

/**
 * Annule une commande confirmée : ce qui restait à livrer ne le sera plus ; les BL déjà validés
 * depuis cette commande restent (ils ont sorti le stock). Refusée tant qu'un BL brouillon en dépend.
 */
export async function cancelOrder(id: string, reason: string, actor: AuditActor): Promise<void> {
  if (!reason.trim()) throw new DocumentError("Indiquez le motif de l'annulation.");
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(salesDocuments).where(eq(salesDocuments.id, id)).for("update");
    if (!d || d.type !== "COMMANDE") throw new DocumentError("Commande introuvable.");
    if (!allowedActions("COMMANDE", d.status as DocStatus).cancel) throw new DocumentError("Seule une commande confirmée et pas encore entièrement livrée s'annule.");
    const open = (await tx.execute<{ id: string }>(sql`select id from sales_documents where origin_document_id = ${id}::uuid and type = 'BL' and status = 'BROUILLON' limit 1`)).rows[0];
    if (open) throw new DocumentError("Un BL brouillon dépend de cette commande : supprimez-le d'abord.");
    await tx.update(salesDocuments).set({ status: "ANNULE", cancelledAt: new Date(), cancelledById: actor.id, cancelReason: reason.trim(), updatedAt: new Date() }).where(eq(salesDocuments.id, id));
    await audit({ actor, action: "CANCEL", module: "livraisons", entity: "sales_document", entityId: id, label: d.number, after: { reason } }, tx);
  });
}

/** Le PDF figé est rattaché après coup (génération hors transaction) : seule colonne encore modifiable. */
export async function attachPdf(id: string, assetId: string): Promise<void> {
  await db.update(salesDocuments).set({ pdfAssetId: assetId }).where(eq(salesDocuments.id, id));
}

/* ------------------------------------------------------------------ */
/* Bascule : reprise des factures ouvertes de Sage                     */
/* ------------------------------------------------------------------ */

export type OpeningInvoice = { clientId: string; number: string; date: string; dueDate: string | null; ttc: string; balance: string; site: string };

/**
 * Reprend les factures Sage non soldées à la bascule : une pièce FACTURE validée, source SAGE_REPRISE,
 * avec son numéro Sage, son TTC et ce qui en était déjà réglé (`reprise_paid` = TTC − reste). Sans ligne
 * ni projection dans les ventes : elles sont déjà dans `sales` par l'import Sage. Idempotent : un numéro
 * déjà présent est ignoré.
 */
export async function importOpeningInvoices(rows: OpeningInvoice[], actor: AuditActor): Promise<{ inserted: number; skipped: string[] }> {
  return db.transaction(async (tx) => {
    const existing = new Set((await tx.execute<{ number: string }>(sql`select number from sales_documents where number = any(${pgArray(rows.map((r) => r.number), "text")})`)).rows.map((r) => r.number));
    const skipped: string[] = [];
    let inserted = 0;
    for (const r of rows) {
      if (existing.has(r.number)) { skipped.push(`${r.number} : déjà présente`); continue; }
      const ttc = parseDecimal(r.ttc, SCALE.money) ?? 0n, bal = parseDecimal(r.balance, SCALE.money) ?? 0n;
      if (ttc <= 0n || bal <= 0n || bal > ttc) { skipped.push(`${r.number} : montants incohérents (TTC ${r.ttc}, reste ${r.balance})`); continue; }
      const client = (await tx.execute<Record<string, string | null>>(sql`
        select name, legal_name, coalesce(account_code, code) as account_code, ice, billing_address, postal_code, city from clients where id = ${r.clientId}::uuid`)).rows[0];
      await tx.insert(salesDocuments).values({
        type: "FACTURE", status: "VALIDE", number: r.number, isSimulation: false, date: r.date, dueDate: r.dueDate, clientId: r.clientId, site: r.site,
        clientSnapshot: { name: client.name, legalName: client.legal_name ?? client.name, accountCode: client.account_code, ice: client.ice, address: client.billing_address, postalCode: client.postal_code, city: client.city },
        grossHt: "0", netHt: "0", vatTotal: "0", ttc: formatScaled(ttc, SCALE.money), reprisePaid: formatScaled(ttc - bal, SCALE.money), source: "SAGE_REPRISE",
        notes: "Facture Sage reprise à la bascule (solde repris, détail dans Sage).", createdById: actor.id, validatedById: actor.id, validatedAt: new Date(),
      });
      inserted++;
    }
    await audit({ actor, action: "IMPORT", module: "facturation", entity: "sales_document", label: "Reprise des factures ouvertes Sage", after: { inserted, skipped: skipped.length } }, tx);
    return { inserted, skipped };
  });
}

/* ------------------------------------------------------------------ */
/* Correction du nom du client imprimé                                 */
/* ------------------------------------------------------------------ */

/**
 * Corrige le nom (raison sociale) du client imprimé sur une pièce validée — seule donnée d'une pièce
 * figée qui se corrige (migration 0030). Client rattaché, ICE, adresse, montants et numéro ne bougent
 * pas. Motif obligatoire, ancien et nouveau nom dans l'historique ; le PDF figé est détaché pour être
 * régénéré (l'ancien reste archivé dans les fichiers de la pièce).
 */
export async function renameDocumentClient(id: string, name: string, reason: string, actor: AuditActor): Promise<void> {
  const next = name.trim();
  if (!next) throw new DocumentError("Indiquez le nom à imprimer.");
  if (!reason.trim()) throw new DocumentError("Indiquez le motif de la correction.");
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(salesDocuments).where(eq(salesDocuments.id, id)).for("update");
    if (!d) throw new DocumentError("Pièce introuvable.");
    if (d.status === "BROUILLON") throw new DocumentError("Un brouillon prend le nom de la fiche client : corrigez la fiche.");
    const snap = (d.clientSnapshot ?? {}) as Record<string, unknown>;
    const before = String(snap.legalName ?? "");
    if (before === next) throw new DocumentError("Le nom est inchangé.");
    await tx.update(salesDocuments).set({ clientSnapshot: { ...snap, legalName: next }, pdfAssetId: null, updatedAt: new Date() }).where(eq(salesDocuments.id, id));
    await audit({ actor, action: "RENAME_CLIENT", module: moduleOf(d.type as DocType), entity: "sales_document", entityId: id, label: d.number, before: { legalName: before }, after: { legalName: next, reason: reason.trim() } }, tx);
  });
}

/* ------------------------------------------------------------------ */
/* Changement de client d'une pièce validée                            */
/* ------------------------------------------------------------------ */

/**
 * Rattache un BL ou une commande validés à un autre client (pièce saisie sur la mauvaise fiche), ou
 * reprend l'identité actuelle de la même fiche (ICE ou adresse corrigés après coup). Tout suit : client,
 * raison sociale, identité figée (nom, ICE, adresse, code), empreinte, ventes projetées, PDF détaché pour
 * être régénéré. Une commande emporte ses BL. Montants, numéro, lignes et stock ne bougent pas.
 * Refusé pour une facture ou un avoir (pièce fiscale : avoir puis nouvelle facture), un BL facturé, un BL
 * issu d'une commande (on change la commande), une pièce annulée (sauf une commande : ses BL livrés la suivent).
 * Motif obligatoire, `audit()` par pièce.
 * Rend les pièces validées dont le PDF est à régénérer.
 */
export async function reassignDocumentClient(
  id: string,
  input: { clientId: string; legalEntityId: string | null; reason: string },
  actor: AuditActor,
  opts: { canCascadeBL?: boolean } = {},
): Promise<string[]> {
  const reason = input.reason.trim();
  if (!reason) throw new DocumentError("Indiquez le motif du changement de client.");
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(salesDocuments).where(eq(salesDocuments.id, id)).for("update");
    if (!d) throw new DocumentError("Pièce introuvable.");
    const type = d.type as DocType;
    if (d.status === "BROUILLON") throw new DocumentError("Un brouillon change de client dans sa saisie.");
    // Une commande annulée garde ses BL déjà livrés : elle change encore de client pour les emporter.
    if (d.status === "ANNULE" && type !== "COMMANDE") throw new DocumentError("Une pièce annulée ne change plus de client.");
    if (type === "FACTURE" || type === "AVOIR") throw new DocumentError("Une facture ou un avoir ne change pas de client : faites un avoir sur la pièce, puis refacturez au bon client.");
    if (type === "BL" && d.originDocumentId) {
      const o = (await tx.execute<{ number: string | null; type: string }>(sql`select number, type from sales_documents where id = ${d.originDocumentId}::uuid`)).rows[0];
      if (o?.type === "COMMANDE") throw new DocumentError(`Ce BL vient de la commande ${o.number} : changez le client sur la commande, ses BL suivent.`);
    }

    const { client, snapshot, identity } = await clientIdentitySnapshot(tx, input.clientId, input.legalEntityId);
    if (client.active === false) throw new DocumentError("Ce client est archivé : réactivez sa fiche d'abord.");

    // Pièces concernées : la pièce, et pour une commande les BL qui en sont issus (non annulés).
    const children = type === "COMMANDE"
      ? await tx.select().from(salesDocuments).where(sql`${salesDocuments.originDocumentId} = ${id}::uuid and ${salesDocuments.type} = 'BL' and ${salesDocuments.status} <> 'ANNULE'`).for("update")
      : [];
    const docs = [d, ...children];
    const validated = docs.filter((x) => x.status !== "BROUILLON");
    if (children.some((x) => x.status !== "BROUILLON") && !opts.canCascadeBL) throw new DocumentError("Des BL validés suivent cette commande : il faut aussi le droit « Valider » sur les bons de livraison.");
    const linesByDoc = new Map<string, (typeof salesDocumentLines.$inferSelect)[]>();
    for (const x of validated) {
      const lines = await tx.select().from(salesDocumentLines).where(eq(salesDocumentLines.documentId, x.id)).orderBy(salesDocumentLines.position);
      if (x.type === "BL" && lines.some((l) => (parseDecimal(l.invoicedQty, SCALE.qty) ?? 0n) > 0n)) {
        throw new DocumentError(`Le BL ${x.number} est (en partie) facturé : il ne change plus de client. Faites un avoir sur la facture, puis refacturez.`);
      }
      linesByDoc.set(x.id, lines);
    }

    const same = (x: typeof d) => x.clientId === input.clientId && (x.legalEntityId ?? null) === (input.legalEntityId ?? null)
      && Object.entries(snapshot).every(([k, v]) => ((x.clientSnapshot ?? {}) as Record<string, unknown>)[k] == v);
    if (same(d)) throw new DocumentError("Rien à changer : la pièce porte déjà ce client et son identité actuelle.");

    // Le garde-fou de la table ne laisse bouger client, identité et empreinte que dans cette transaction.
    await tx.execute(sql`select set_config('comanet.reassign_client', 'on', true)`);
    const regen: string[] = [];
    for (const x of docs) {
      if (x.status === "BROUILLON") {
        await tx.update(salesDocuments).set({ clientId: input.clientId, legalEntityId: input.legalEntityId, updatedAt: new Date() }).where(eq(salesDocuments.id, x.id));
        continue;
      }
      const lines = linesByDoc.get(x.id)!;
      const hash = documentHash(x.number!, x, snapshot, lines);
      await tx.update(salesDocuments).set({
        clientId: input.clientId, legalEntityId: input.legalEntityId, clientSnapshot: snapshot, contentHash: hash, pdfAssetId: null, updatedAt: new Date(),
      }).where(eq(salesDocuments.id, x.id));
      const projected = await reassignProjection(tx, lines.map((l) => l.id), input.clientId, String(identity.legalName));
      const before = (x.clientSnapshot ?? {}) as Record<string, unknown>;
      await audit({
        actor, action: "REASSIGN_CLIENT", module: moduleOf(x.type as DocType), entity: "sales_document", entityId: x.id, label: x.number,
        before: { clientId: x.clientId, legalName: before.legalName ?? null, ice: before.ice ?? null, city: before.city ?? null },
        after: { clientId: input.clientId, legalName: snapshot.legalName, ice: snapshot.ice, city: snapshot.city, reason, viaOrder: x.id === id ? undefined : d.number, sales: projected || undefined },
      }, tx);
      regen.push(x.id);
    }
    return regen;
  });
}

/* ------------------------------------------------------------------ */
/* Fusion de clients                                                   */
/* ------------------------------------------------------------------ */

/**
 * Brouillons d'un client fusionné (`mergeClients()`) : rattachés à la fiche gardée ; ceux qui
 * facturaient l'identité principale de la fiche absorbée pointent sur la raison sociale qui la
 * remplace. Une pièce validée ne change jamais de client (triggers) : la fusion la refuse avant.
 */
export async function reassignDrafts(tx: Tx, fromClientId: string, toClientId: string, legalEntityId: string | null): Promise<number> {
  const r = await tx.execute(sql`update sales_documents set client_id = ${toClientId}::uuid, legal_entity_id = coalesce(legal_entity_id, ${legalEntityId}::uuid), updated_at = now()
    where client_id = ${fromClientId}::uuid and status = 'BROUILLON'`);
  return r.rowCount ?? 0;
}
