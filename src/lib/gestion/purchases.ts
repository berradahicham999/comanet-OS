import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { landedCosts, purchaseDocumentLines, purchaseDocuments } from "@/db/schema";
import { audit, type AuditActor } from "@/lib/audit";
import { recordMovement } from "@/lib/activations/inventory";
import { iso, today } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { pgArray } from "@/lib/sql-array";
import { dueDateOf } from "./documents-shared";
import { recordStockMovements, type LedgerInput } from "./ledger";
import { SCALE, formatScaled, parseDecimal, rescale } from "./money";
import { allocateNumber } from "./numbering";
import {
  PURCHASE_TYPE_LABELS, RATE_SCALE, allocateLandedCosts, computePurchase, invoiceGaps, orderStatusAfterReceipt, purchaseActions, rateError,
  receptionStatusAfterInvoice, remaining, unitCostMad, type InvoiceGap, type PurchaseStatus, type PurchaseType,
} from "./purchases-shared";

/**
 * Pièces d'achat — SEUL module qui crée, valide, solde ou annule une commande, une réception, une
 * facture ou un retour fournisseur (garde-fou dans `tests/definitions-uniques.test.ts`). Une pièce
 * validée est figée par la base (triggers de la migration 0027) : ce module ne fait plus évoluer
 * que son statut et ses compteurs (reçu, facturé, retourné).
 *
 * La réception est le seul moment où le stock entre et où le coût de revient (prix × taux + frais
 * d'approche répartis) nourrit le CMUP. La facture du fournisseur s'enregistre telle qu'elle est :
 * ses écarts avec les réceptions sont signalés, jamais corrigés en silence.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Doc = typeof purchaseDocuments.$inferSelect;
type Line = typeof purchaseDocumentLines.$inferSelect;

export class PurchaseError extends Error {}

const MODULE = "achats" as const;

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

export type PurchaseLineView = Line & { kind: string | null; trackLots: boolean; brandId: string | null; itemName: string | null };
export type PurchaseView = Doc & {
  lines: PurchaseLineView[];
  landed: (typeof landedCosts.$inferSelect)[];
  supplier: { id: string; legalName: string; currency: string; paymentDays: number | null; email: string | null; phone: string | null; code: string | null };
  origin: { id: string; number: string | null; type: string } | null;
  children: { id: string; number: string | null; type: string; status: string; netHtMad: string }[];
  sources: { id: string; number: string | null; type: string; date: string }[];
};

export async function getPurchase(id: string): Promise<PurchaseView | null> {
  const [doc] = await db.select().from(purchaseDocuments).where(eq(purchaseDocuments.id, id));
  if (!doc) return null;
  const [lines, landed, supplier, origin, children, sources] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select l.*, p.kind as product_kind, coalesce(p.track_lots, false) as track_lots, coalesce(p.brand_id, i.brand_id) as brand_id, i.name as item_name
      from purchase_document_lines l left join products p on p.id = l.product_id left join inventory_items i on i.id = l.inventory_item_id
      where l.document_id = ${id}::uuid order by l.position`),
    db.select().from(landedCosts).where(eq(landedCosts.documentId, id)),
    db.execute<{ id: string; legal_name: string; currency: string; payment_days: number | null; email: string | null; phone: string | null; code: string | null }>(sql`
      select id, legal_name, currency, payment_days, email, phone, code from suppliers where id = ${doc.supplierId}::uuid`),
    doc.originDocumentId ? db.execute<{ id: string; number: string | null; type: string }>(sql`select id, number, type from purchase_documents where id = ${doc.originDocumentId}::uuid`) : null,
    db.execute<{ id: string; number: string | null; type: string; status: string; netHtMad: string }>(sql`
      select distinct d.id, d.number, d.type, d.status, d.net_ht_mad::text as "netHtMad" from purchase_documents d
      left join purchase_document_lines l on l.document_id = d.id
      where d.origin_document_id = ${id}::uuid or l.source_line_id in (select id from purchase_document_lines where document_id = ${id}::uuid)
      order by d.number nulls last`),
    db.execute<{ id: string; number: string | null; type: string; date: string }>(sql`
      select distinct d.id, d.number, d.type, d.date::text as date from purchase_document_lines l
      join purchase_document_lines s on s.id = l.source_line_id join purchase_documents d on d.id = s.document_id
      where l.document_id = ${id}::uuid order by d.number`),
  ]);
  const s = supplier.rows[0];
  return {
    ...doc,
    lines: lines.rows.map((r) => ({
      id: r.id, documentId: r.document_id, position: r.position, productId: r.product_id, inventoryItemId: r.inventory_item_id, ref: r.ref,
      designation: r.designation, quantity: r.quantity, unitPrice: r.unit_price, discountPct: r.discount_pct, taxRate: r.tax_rate,
      netHtCurrency: r.net_ht_currency, netHtMad: r.net_ht_mad, landedMad: r.landed_mad, vatMad: r.vat_mad, unitCostMad: r.unit_cost_mad,
      lotNumber: r.lot_number, expiryDate: r.expiry_date, sourceLineId: r.source_line_id, receivedQty: r.received_qty, invoicedQty: r.invoiced_qty,
      returnedQty: r.returned_qty, kind: r.product_kind, trackLots: !!r.track_lots, brandId: r.brand_id, itemName: r.item_name,
    }) as PurchaseLineView),
    landed,
    supplier: { id: s.id, legalName: s.legal_name, currency: s.currency, paymentDays: s.payment_days, email: s.email, phone: s.phone, code: s.code },
    origin: origin?.rows[0] ?? null,
    children: children.rows,
    sources: sources.rows,
  };
}

export type PurchaseListRow = {
  id: string; type: PurchaseType; status: PurchaseStatus; number: string | null; date: string; expectedDate: string | null; supplierId: string; supplier: string;
  supplierRef: string | null; currency: string; netHtCurrency: string; netHtMad: string; landedMad: string; ttcMad: string; dueDate: string | null;
};

export async function listPurchases(opts: { type?: PurchaseType; supplierId?: string; limit?: number } = {}): Promise<PurchaseListRow[]> {
  const r = await db.execute<PurchaseListRow>(sql`
    select d.id, d.type, d.status, d.number, d.date::text as date, d.expected_date::text as "expectedDate", d.supplier_id as "supplierId", s.legal_name as supplier,
      d.supplier_ref as "supplierRef", d.currency, d.net_ht_currency::text as "netHtCurrency", d.net_ht_mad::text as "netHtMad", d.landed_mad::text as "landedMad",
      d.ttc_mad::text as "ttcMad", d.due_date::text as "dueDate"
    from purchase_documents d join suppliers s on s.id = d.supplier_id
    where true ${opts.type ? sql`and d.type = ${opts.type}` : sql``} ${opts.supplierId ? sql`and d.supplier_id = ${opts.supplierId}::uuid` : sql``}
    order by d.date desc, d.created_at desc limit ${opts.limit ?? 500}`);
  return r.rows;
}

/** Réceptions d'un fournisseur encore à facturer (en tout ou partie). */
export async function invoiceableReceptions(supplierId: string) {
  const r = await db.execute<{ id: string; number: string; date: string; status: string; currency: string; net_ht_currency: string; remaining_lines: number }>(sql`
    select d.id, d.number, d.date::text as date, d.status, d.currency, d.net_ht_currency::text,
      (select count(*)::int from purchase_document_lines l where l.document_id = d.id and l.invoiced_qty < l.quantity) as remaining_lines
    from purchase_documents d where d.type = 'RECEPTION' and d.supplier_id = ${supplierId}::uuid and d.status in ('VALIDE', 'FACTUREE_PARTIEL')
    order by d.date, d.number`);
  return r.rows.filter((x) => x.remaining_lines > 0);
}

/* ------------------------------------------------------------------ */
/* Brouillons                                                          */
/* ------------------------------------------------------------------ */

export type PurchaseLineInput = {
  productId?: string | null;
  inventoryItemId?: string | null;
  designation?: string | null;
  quantity: string;
  unitPrice: string;
  discountPct?: string | null;
  taxRate?: string | null;
  lotNumber?: string | null;
  expiryDate?: string | null;
  sourceLineId?: string | null;
};

export type PurchaseInput = {
  id?: string | null;
  type: PurchaseType;
  supplierId: string;
  date: string;
  expectedDate?: string | null;
  supplierRef?: string | null;
  currency?: string | null;
  exchangeRate?: string | null;
  warehouseKey?: string | null;
  originDocumentId?: string | null;
  notes?: string | null;
  lines: PurchaseLineInput[];
  landedCosts?: { label: string; amountMad: string; allocation?: string | null; ref?: string | null }[];
};

const isDate = (v: string | null | undefined) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Crée ou remplace un brouillon (en-tête, lignes, frais d'approche). Les montants sont toujours recalculés ici. */
export async function savePurchaseDraft(input: PurchaseInput, actor: AuditActor): Promise<string> {
  if (!PURCHASE_TYPE_LABELS[input.type]) throw new PurchaseError("Type de pièce inconnu.");
  if (!isDate(input.date) || !input.date) throw new PurchaseError("Date invalide.");
  if (!isDate(input.expectedDate)) throw new PurchaseError("Date de livraison attendue invalide.");
  const g = (await getSettings()).gestion;
  return db.transaction(async (tx) => {
    const supplier = (await tx.execute<{ active: boolean; currency: string; legal_name: string }>(sql`select active, currency, legal_name from suppliers where id = ${input.supplierId}::uuid`)).rows[0];
    if (!supplier) throw new PurchaseError("Fournisseur introuvable.");
    if (!supplier.active) throw new PurchaseError("Ce fournisseur est archivé : restaurez-le avant de lui passer une pièce.");
    const currency = (input.currency || supplier.currency || "MAD").toUpperCase().trim();
    const rateText = currency === "MAD" ? "1" : (input.exchangeRate ?? "").trim();
    const rErr = rateError(currency, rateText);
    if (rErr) throw new PurchaseError(rErr);
    const rate = formatScaled(parseDecimal(rateText, RATE_SCALE)!, RATE_SCALE);
    const warehouseKey = input.warehouseKey || "PRINCIPAL";
    if (input.type === "RECEPTION") {
      const wh = (await tx.execute<{ kind: string; active: boolean }>(sql`select kind, active from warehouses where key = ${warehouseKey}`)).rows[0];
      if (!wh || !wh.active) throw new PurchaseError("Dépôt de réception introuvable.");
      if (wh.kind !== "INTERNE") throw new PurchaseError("Une réception entre dans un dépôt interne (le stock d'un dépôt externe n'est connu que par ses photos).");
    }

    const productIds = input.lines.map((l) => l.productId).filter((x): x is string => !!x);
    const itemIds = input.lines.map((l) => l.inventoryItemId).filter((x): x is string => !!x);
    const products = new Map(productIds.length ? (await tx.execute<{ id: string; name: string; ref: string | null; kind: string; rate: string | null }>(sql`
      select p.id, p.name, coalesce(p.code, p.sku) as ref, p.kind, tr.rate::text as rate from products p left join tax_rates tr on tr.key = p.tax_rate_key where p.id = any(${pgArray(productIds)})`)).rows.map((p) => [p.id, p]) : []);
    const items = new Map(itemIds.length ? (await tx.execute<{ id: string; name: string; sku: string | null }>(sql`select id, name, sku from inventory_items where id = any(${pgArray(itemIds)})`)).rows.map((i) => [i.id, i]) : []);
    const defaultRate = (await tx.execute<{ rate: string }>(sql`select rate::text as rate from tax_rates where key = ${g.defaultTaxRateKey}`)).rows[0]?.rate ?? "20.00";

    const lines = input.lines.map((l, i) => {
      const n = i + 1;
      if (l.productId && l.inventoryItemId) throw new PurchaseError(`Ligne ${n} : un article OU un matériel marketing, pas les deux.`);
      const p = l.productId ? products.get(l.productId) : null;
      const it = l.inventoryItemId ? items.get(l.inventoryItemId) : null;
      if (l.productId && !p) throw new PurchaseError(`Ligne ${n} : article introuvable.`);
      if (l.inventoryItemId && !it) throw new PurchaseError(`Ligne ${n} : matériel introuvable.`);
      const stocked = (!!p && p.kind === "PRODUIT") || !!it;
      if ((input.type === "RECEPTION" || input.type === "RETOUR") && !stocked) throw new PurchaseError(`Ligne ${n} : ${input.type === "RECEPTION" ? "une réception" : "un retour"} ne porte que des articles stockés ou du matériel ; les frais vont dans « Frais d'approche ».`);
      if ((input.type === "FACTURE" || input.type === "RETOUR") && stocked && !l.sourceLineId) throw new PurchaseError(`Ligne ${n} : un article stocké se facture ou se retourne depuis sa réception.`);
      const designation = p?.name ?? it?.name ?? l.designation?.trim();
      if (!designation) throw new PurchaseError(`Ligne ${n} : désignation manquante.`);
      const qty = parseDecimal(l.quantity, SCALE.qty);
      if (qty === null || qty <= 0n) throw new PurchaseError(`Ligne ${n} (${designation}) : quantité positive attendue.`);
      if (it && qty % 1000n !== 0n) throw new PurchaseError(`Ligne ${n} (${designation}) : le matériel se compte en unités entières.`);
      const pu = parseDecimal(l.unitPrice, 4);
      if (pu === null || pu < 0n) throw new PurchaseError(`Ligne ${n} (${designation}) : prix unitaire manquant.`);
      if (!isDate(l.expiryDate)) throw new PurchaseError(`Ligne ${n} : date de péremption invalide.`);
      return {
        position: i, productId: p?.id ?? null, inventoryItemId: it?.id ?? null, ref: p?.ref ?? it?.sku ?? null, designation,
        quantity: formatScaled(qty, SCALE.qty), unitPrice: formatScaled(pu, 4),
        discountPct: formatScaled(parseDecimal(l.discountPct || "0", SCALE.pct) ?? 0n, SCALE.pct),
        taxRate: p?.rate ?? (l.taxRate ? formatScaled(parseDecimal(l.taxRate, SCALE.pct) ?? 0n, SCALE.pct) : defaultRate),
        lotNumber: l.lotNumber?.trim() || null, expiryDate: l.expiryDate || null, sourceLineId: l.sourceLineId ?? null,
      };
    });
    const calc = computePurchase(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate })), rate);
    const costs = input.type === "RECEPTION" ? (input.landedCosts ?? []).filter((c) => c.label?.trim() || c.amountMad).map((c, i) => {
      const amount = parseDecimal(c.amountMad, SCALE.money);
      if (amount === null || amount < 0n) throw new PurchaseError(`Frais ${i + 1} : montant en dirhams attendu.`);
      if (!c.label?.trim()) throw new PurchaseError(`Frais ${i + 1} : libellé manquant (transport, douane, transit…).`);
      return { label: c.label.trim(), amountMad: formatScaled(amount, SCALE.money), allocation: (c.allocation === "QUANTITE" ? "QUANTITE" : "VALEUR") as "VALEUR" | "QUANTITE", ref: c.ref?.trim() || null };
    }) : [];
    const landed = allocateLandedCosts(lines.map((l, i) => ({ netHtMad: calc.lines[i].netHtMad, quantity: l.quantity })), costs);
    const landedTotal = formatScaled(landed.reduce((a, x) => a + (parseDecimal(x, 2) ?? 0n), 0n), 2);

    const header = {
      type: input.type, supplierId: input.supplierId, date: input.date, expectedDate: input.expectedDate || null, supplierRef: input.supplierRef?.trim() || null,
      currency, exchangeRate: rate, warehouseKey, originDocumentId: input.originDocumentId ?? null, notes: input.notes?.trim() || null,
      netHtCurrency: calc.netHtCurrency, netHtMad: calc.netHtMad, landedMad: landedTotal, vatMad: calc.vatMad, ttcMad: calc.ttcMad, vatBreakdown: calc.vatBreakdown,
      updatedAt: new Date(),
    };
    let id = input.id ?? null;
    if (id) {
      const [cur] = await tx.select({ status: purchaseDocuments.status, type: purchaseDocuments.type }).from(purchaseDocuments).where(eq(purchaseDocuments.id, id)).for("update");
      if (!cur) throw new PurchaseError("Pièce introuvable.");
      if (cur.status !== "BROUILLON") throw new PurchaseError("Seul un brouillon se modifie.");
      if (cur.type !== input.type) throw new PurchaseError("Le type d'une pièce ne change pas.");
      await tx.update(purchaseDocuments).set(header).where(eq(purchaseDocuments.id, id));
      await tx.delete(purchaseDocumentLines).where(eq(purchaseDocumentLines.documentId, id));
      await tx.delete(landedCosts).where(eq(landedCosts.documentId, id));
    } else {
      const [row] = await tx.insert(purchaseDocuments).values({ ...header, createdById: actor.id }).returning({ id: purchaseDocuments.id });
      id = row.id;
    }
    if (lines.length) {
      await tx.insert(purchaseDocumentLines).values(lines.map((l, i) => ({
        ...l, documentId: id!, netHtCurrency: calc.lines[i].netHtCurrency, netHtMad: calc.lines[i].netHtMad, vatMad: calc.lines[i].vatMad,
        landedMad: landed[i], unitCostMad: input.type === "RECEPTION" ? unitCostMad(calc.lines[i].netHtMad, landed[i], l.quantity) : null,
      })));
    }
    if (costs.length) await tx.insert(landedCosts).values(costs.map((c) => ({ ...c, documentId: id! })));
    await audit({ actor, action: input.id ? "UPDATE" : "CREATE", module: MODULE, entity: "purchase_document", entityId: id, label: `${PURCHASE_TYPE_LABELS[input.type].one} (brouillon) — ${supplier.legal_name}`, after: { lines: lines.length, netHtMad: calc.netHtMad } }, tx);
    return id!;
  });
}

export async function deletePurchaseDraft(id: string, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(purchaseDocuments).where(eq(purchaseDocuments.id, id)).for("update");
    if (!d) throw new PurchaseError("Pièce introuvable.");
    if (d.status !== "BROUILLON") throw new PurchaseError("Seul un brouillon se supprime ; une pièce validée se solde, s'annule ou se corrige par un retour.");
    await tx.delete(purchaseDocuments).where(eq(purchaseDocuments.id, id));
    await audit({ actor, action: "DELETE", module: MODULE, entity: "purchase_document", entityId: id, label: `${PURCHASE_TYPE_LABELS[d.type as PurchaseType].one} (brouillon)` }, tx);
  });
}

/** Brouillon de réception reprenant le reste à recevoir d'une commande (lots et péremptions à saisir). */
export async function createReceptionFromOrder(orderId: string, actor: AuditActor): Promise<string> {
  const o = await getPurchase(orderId);
  if (!o || o.type !== "COMMANDE") throw new PurchaseError("Commande introuvable.");
  if (!purchaseActions("COMMANDE", o.status as PurchaseStatus).receive) throw new PurchaseError("Cette commande ne se réceptionne pas (brouillon, soldée, annulée ou déjà reçue).");
  const lines = o.lines.filter((l) => (l.productId && l.kind === "PRODUIT") || l.inventoryItemId).filter((l) => (parseDecimal(l.receivedQty, SCALE.qty) ?? 0n) < (parseDecimal(l.quantity, SCALE.qty) ?? 0n));
  if (!lines.length) throw new PurchaseError("Tout ce qui est stocké sur cette commande est déjà reçu.");
  return savePurchaseDraft({
    type: "RECEPTION", supplierId: o.supplierId, date: iso(today()), currency: o.currency, exchangeRate: o.exchangeRate, warehouseKey: "PRINCIPAL", originDocumentId: o.id,
    lines: lines.map((l) => ({ productId: l.productId, inventoryItemId: l.inventoryItemId, quantity: remaining(l.quantity, l.receivedQty), unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate, sourceLineId: l.id })),
  }, actor);
}

/** Brouillon de facture fournisseur reprenant le reste à facturer de réceptions d'un même fournisseur. */
export async function createInvoiceFromReceptions(ids: string[], actor: AuditActor): Promise<string> {
  if (!ids.length) throw new PurchaseError("Choisissez au moins une réception.");
  const docs = (await db.execute<{ id: string; supplier_id: string; currency: string; exchange_rate: string; status: PurchaseStatus; type: string; number: string }>(sql`
    select id, supplier_id, currency, exchange_rate::text, status, type, number from purchase_documents where id = any(${pgArray(ids)}) order by date, number`)).rows;
  if (docs.length !== new Set(ids).size || docs.some((d) => d.type !== "RECEPTION")) throw new PurchaseError("Réception introuvable.");
  if (new Set(docs.map((d) => d.supplier_id)).size > 1) throw new PurchaseError("Une facture fournisseur regroupe les réceptions d'un seul fournisseur.");
  if (new Set(docs.map((d) => d.currency)).size > 1) throw new PurchaseError("Ces réceptions ne sont pas dans la même devise.");
  for (const d of docs) if (!purchaseActions("RECEPTION", d.status).invoice) throw new PurchaseError(`${d.number} n'est plus à facturer.`);
  const lines = (await db.execute<Record<string, string | null>>(sql`
    select l.id, l.product_id, l.inventory_item_id, l.quantity::text, l.invoiced_qty::text, l.unit_price::text, l.discount_pct::text, l.tax_rate::text
    from purchase_document_lines l join purchase_documents d on d.id = l.document_id
    where l.document_id = any(${pgArray(ids)}) and l.invoiced_qty < l.quantity order by d.date, d.number, l.position`)).rows;
  if (!lines.length) throw new PurchaseError("Ces réceptions sont déjà entièrement facturées.");
  return savePurchaseDraft({
    type: "FACTURE", supplierId: docs[0].supplier_id, date: iso(today()), currency: docs[0].currency, exchangeRate: docs[0].exchange_rate,
    lines: lines.map((l) => ({ productId: l.product_id, inventoryItemId: l.inventory_item_id, quantity: remaining(l.quantity!, l.invoiced_qty!), unitPrice: l.unit_price!, discountPct: l.discount_pct, taxRate: l.tax_rate, sourceLineId: l.id })),
  }, actor);
}

/** Brouillon de retour fournisseur sur une réception (quantités à ajuster). */
export async function createReturnFromReception(receptionId: string, actor: AuditActor): Promise<string> {
  const r = await getPurchase(receptionId);
  if (!r || r.type !== "RECEPTION") throw new PurchaseError("Réception introuvable.");
  if (r.status === "BROUILLON") throw new PurchaseError("Une réception non validée ne se retourne pas : modifiez-la.");
  const lines = r.lines.filter((l) => (parseDecimal(l.returnedQty, SCALE.qty) ?? 0n) < (parseDecimal(l.quantity, SCALE.qty) ?? 0n));
  if (!lines.length) throw new PurchaseError("Tout a déjà été retourné.");
  return savePurchaseDraft({
    type: "RETOUR", supplierId: r.supplierId, date: iso(today()), currency: r.currency, exchangeRate: r.exchangeRate, warehouseKey: r.warehouseKey, originDocumentId: r.id,
    lines: lines.map((l) => ({ productId: l.productId, inventoryItemId: l.inventoryItemId, quantity: remaining(l.quantity, l.returnedQty), unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate, lotNumber: l.lotNumber, expiryDate: l.expiryDate, sourceLineId: l.id })),
  }, actor);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** Coût d'un matériel marketing en dirhams (le module Activations tient ses coûts au centime). */
const itemCost = (unitCost4: string | null) => Number(formatScaled(rescale(parseDecimal(unitCost4, 4) ?? 0n, 4, 2), 2));
const qtyInt = (q: string) => Number((parseDecimal(q, SCALE.qty) ?? 0n) / 1000n);

/**
 * Valide une pièce d'achat, tout ou rien : numéro pris dans la transaction, identité du fournisseur
 * figée ; réception = entrée en stock au coût de revient (CMUP, `cost_price`), compteurs de la
 * commande ; facture = rapprochement et compteurs des réceptions ; retour = sortie de stock.
 */
export async function validatePurchase(id: string, actor: AuditActor): Promise<{ number: string; gaps: InvoiceGap[] }> {
  const g = (await getSettings()).gestion;
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(purchaseDocuments).where(eq(purchaseDocuments.id, id)).for("update");
    if (!locked) throw new PurchaseError("Pièce introuvable.");
    if (locked.status !== "BROUILLON") throw new PurchaseError("Cette pièce est déjà validée.");
    const doc = (await getPurchase(id))!;
    const type = doc.type as PurchaseType;
    if (!doc.lines.length) throw new PurchaseError("Une pièce sans ligne ne se valide pas.");
    if (doc.date > iso(today())) throw new PurchaseError("Une pièce ne se valide pas à une date future.");
    const rErr = rateError(doc.currency, doc.exchangeRate);
    if (rErr) throw new PurchaseError(rErr);
    const supplier = (await tx.execute<Record<string, string | number | null>>(sql`
      select legal_name, code, ice, if_number, rc, address, city, country, currency, payment_days, email, phone from suppliers where id = ${doc.supplierId}::uuid`)).rows[0];

    let gaps: InvoiceGap[] = [];
    let dueDate: string | null = null;
    const touched = new Set<string>();

    if (type === "RECEPTION") {
      // Compteurs de la commande : jamais au-delà du commandé.
      for (const l of doc.lines.filter((x) => x.sourceLineId)) {
        const r = (await tx.execute<{ document_id: string }>(sql`
          update purchase_document_lines set received_qty = received_qty + ${l.quantity}::numeric
          where id = ${l.sourceLineId}::uuid and received_qty + ${l.quantity}::numeric <= quantity returning document_id`)).rows[0];
        if (!r) throw new PurchaseError(`${l.designation} : quantité reçue au-delà du reste à recevoir de la commande. Réceptionnez l'excédent sur une ligne sans commande.`);
        touched.add(r.document_id);
      }
      // Coût de revient recalculé à partir des frais enregistrés (jamais repris du navigateur).
      const landed = allocateLandedCosts(doc.lines.map((l) => ({ netHtMad: l.netHtMad, quantity: l.quantity })), doc.landed.map((c) => ({ amountMad: c.amountMad, allocation: c.allocation as "VALEUR" | "QUANTITE" })));
      const costs = doc.lines.map((l, i) => unitCostMad(l.netHtMad, landed[i], l.quantity));
      for (const [i, l] of doc.lines.entries()) {
        await tx.update(purchaseDocumentLines).set({ landedMad: landed[i], unitCostMad: costs[i] }).where(eq(purchaseDocumentLines.id, l.id));
      }
      const moves: LedgerInput[] = doc.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.productId).map(({ l, i }) => ({
        productId: l.productId!, type: "ENTREE_ACHAT", quantity: l.quantity, unitCost: costs[i], warehouseKey: doc.warehouseKey,
        lotNumber: l.lotNumber, expiryDate: l.expiryDate, date: doc.date, sourceType: "RECEPTION", sourceId: id, sourceLineId: l.id,
      }));
      if (moves.length) await recordStockMovements(moves, { id: actor.id }, { tx });
      for (const [i, l] of doc.lines.entries()) {
        if (!l.inventoryItemId) continue;
        await recordMovement({ itemId: l.inventoryItemId, type: "ENTREE", quantity: qtyInt(l.quantity), unitCost: itemCost(costs[i]), date: doc.date, createdById: actor.id, reason: `Réception fournisseur (${supplier.legal_name})` }, tx);
      }
      // Le CMUP devient le prix de revient de référence de l'article (marges, valeur du stock).
      const pids = [...new Set(moves.map((m) => m.productId))];
      if (pids.length) {
        await tx.execute(sql`
          update products p set cost_price = round(c.cmup, 2), last_purchase_price = round(c.last_cost, 2)
          from (select distinct on (product_id) product_id, cmup_after as cmup, unit_cost as last_cost from stock_movements
                where product_id = any(${pgArray(pids)}) and cmup_after is not null order by product_id, seq desc) c
          where p.id = c.product_id`);
      }
      await tx.update(purchaseDocuments).set({ landedMad: formatScaled(landed.reduce((a, x) => a + (parseDecimal(x, 2) ?? 0n), 0n), 2) }).where(eq(purchaseDocuments.id, id));
    }

    if (type === "FACTURE") {
      if (!doc.supplierRef) throw new PurchaseError("Saisissez le numéro de la facture du fournisseur.");
      const dup = (await tx.execute<{ number: string }>(sql`
        select number from purchase_documents where supplier_id = ${doc.supplierId}::uuid and type = 'FACTURE' and status <> 'BROUILLON' and supplier_ref = ${doc.supplierRef} and id <> ${id}::uuid`)).rows[0];
      if (dup) throw new PurchaseError(`La facture ${doc.supplierRef} de ce fournisseur est déjà enregistrée (${dup.number}).`);
      const srcIds = doc.lines.map((l) => l.sourceLineId).filter((x): x is string => !!x);
      const src = new Map(srcIds.length ? (await tx.execute<{ id: string; quantity: string; invoiced_qty: string; unit_price: string; discount_pct: string; number: string | null }>(sql`
        select l.id, l.quantity::text, l.invoiced_qty::text, l.unit_price::text, l.discount_pct::text, d.number from purchase_document_lines l
        join purchase_documents d on d.id = l.document_id where l.id = any(${pgArray(srcIds)})`)).rows.map((r) => [r.id, r]) : []);
      gaps = invoiceGaps(doc.lines.map((l) => {
        const s = l.sourceLineId ? src.get(l.sourceLineId) : null;
        return { designation: l.designation, productId: l.productId ?? l.inventoryItemId, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, source: s ? { quantityLeft: remaining(s.quantity, s.invoiced_qty), unitPrice: s.unit_price, discountPct: s.discount_pct, number: s.number } : null };
      }), g.purchases.priceGapTolerancePct);
      for (const l of doc.lines.filter((x) => x.sourceLineId)) {
        const r = (await tx.execute<{ document_id: string }>(sql`
          update purchase_document_lines set invoiced_qty = invoiced_qty + ${l.quantity}::numeric
          where id = ${l.sourceLineId}::uuid and invoiced_qty + ${l.quantity}::numeric <= quantity returning document_id`)).rows[0];
        if (!r) throw new PurchaseError(`${l.designation} : quantité facturée au-delà du reste à facturer de la réception. Un excédent se facture sur une ligne libre.`);
        touched.add(r.document_id);
      }
      dueDate = dueDateOf(doc.date, supplier.payment_days as number | null, g.defaultPaymentDays, g.maxPaymentDays).dueDate;
    }

    if (type === "RETOUR") {
      const srcIds = doc.lines.map((l) => l.sourceLineId).filter((x): x is string => !!x);
      const src = new Map((await tx.execute<{ id: string; warehouse_key: string; lot_number: string | null }>(sql`
        select l.id, d.warehouse_key, l.lot_number from purchase_document_lines l join purchase_documents d on d.id = l.document_id where l.id = any(${pgArray(srcIds)})`)).rows.map((r) => [r.id, r]));
      for (const l of doc.lines) {
        const r = (await tx.execute<{ id: string }>(sql`
          update purchase_document_lines set returned_qty = returned_qty + ${l.quantity}::numeric
          where id = ${l.sourceLineId}::uuid and returned_qty + ${l.quantity}::numeric <= quantity returning id`)).rows[0];
        if (!r) throw new PurchaseError(`${l.designation} : quantité retournée au-delà de la quantité reçue.`);
      }
      const moves: LedgerInput[] = doc.lines.filter((l) => l.productId).map((l) => ({
        productId: l.productId!, type: "RETOUR_FOURNISSEUR", quantity: formatScaled(-(parseDecimal(l.quantity, SCALE.qty) ?? 0n), SCALE.qty),
        warehouseKey: src.get(l.sourceLineId!)?.warehouse_key ?? doc.warehouseKey, lotNumber: src.get(l.sourceLineId!)?.lot_number ?? l.lotNumber,
        date: doc.date, sourceType: "RETOUR", sourceId: id, sourceLineId: l.id,
      }));
      if (moves.length) await recordStockMovements(moves, { id: actor.id }, { tx });
      for (const l of doc.lines) {
        if (!l.inventoryItemId) continue;
        await recordMovement({ itemId: l.inventoryItemId, type: "SORTIE", quantity: -qtyInt(l.quantity), date: doc.date, createdById: actor.id, reason: `Retour fournisseur (${supplier.legal_name})` }, tx);
      }
    }

    const seriesKey = PURCHASE_TYPE_LABELS[type].series;
    const { number, year } = await allocateNumber(tx, seriesKey, doc.date);
    await tx.update(purchaseDocuments).set({
      status: "VALIDE", number, seriesKey, fiscalYear: year, supplierSnapshot: supplier, dueDate, gaps,
      validatedById: actor.id, validatedAt: new Date(), updatedAt: new Date(),
    }).where(eq(purchaseDocuments.id, id));

    // Pièces amont : statut d'après leurs compteurs.
    for (const upId of touched) {
      const [up] = await tx.select({ type: purchaseDocuments.type, status: purchaseDocuments.status }).from(purchaseDocuments).where(eq(purchaseDocuments.id, upId));
      const ls = await tx.select({ quantity: purchaseDocumentLines.quantity, receivedQty: purchaseDocumentLines.receivedQty, invoicedQty: purchaseDocumentLines.invoicedQty, productId: purchaseDocumentLines.productId, inventoryItemId: purchaseDocumentLines.inventoryItemId })
        .from(purchaseDocumentLines).where(eq(purchaseDocumentLines.documentId, upId));
      const stockedLines = ls.filter((x) => x.productId || x.inventoryItemId);
      const next = up.type === "COMMANDE" ? orderStatusAfterReceipt(stockedLines.length ? stockedLines : ls) : receptionStatusAfterInvoice(ls);
      if (next !== up.status && up.status !== "CLOTUREE") await tx.update(purchaseDocuments).set({ status: next, updatedAt: new Date() }).where(eq(purchaseDocuments.id, upId));
    }
    await audit({ actor, action: "VALIDATE", module: MODULE, entity: "purchase_document", entityId: id, label: `${number} — ${supplier.legal_name}`, after: { number, netHtMad: doc.netHtMad, currency: doc.currency, rate: doc.exchangeRate, gaps: gaps.length ? gaps : undefined } }, tx);
    return { number, gaps };
  });
}

/* ------------------------------------------------------------------ */
/* Commandes : solder, annuler                                         */
/* ------------------------------------------------------------------ */

async function setOrderEnd(id: string, reason: string, actor: AuditActor, target: "CLOTUREE" | "ANNULE") {
  if (!reason.trim()) throw new PurchaseError("Indiquez le motif.");
  await db.transaction(async (tx: Tx) => {
    const [d] = await tx.select().from(purchaseDocuments).where(eq(purchaseDocuments.id, id)).for("update");
    if (!d || d.type !== "COMMANDE") throw new PurchaseError("Commande introuvable.");
    const anyReceived = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from purchase_document_lines where document_id = ${id}::uuid and received_qty > 0`)).rows[0].n > 0;
    const a = purchaseActions("COMMANDE", d.status as PurchaseStatus, { anyReceived });
    if (target === "CLOTUREE" && !a.close) throw new PurchaseError("Seule une commande reçue en partie se solde.");
    if (target === "ANNULE" && !a.cancel) throw new PurchaseError(anyReceived ? "Une partie est reçue : soldez la commande au lieu de l'annuler." : "Cette commande ne s'annule pas.");
    await tx.update(purchaseDocuments).set({ status: target, closedAt: new Date(), closedById: actor.id, closeReason: reason.trim(), updatedAt: new Date() }).where(eq(purchaseDocuments.id, id));
    await audit({ actor, action: target === "ANNULE" ? "CANCEL" : "CLOSE", module: MODULE, entity: "purchase_document", entityId: id, label: d.number, after: { reason } }, tx);
  });
}
export const closeOrder = (id: string, reason: string, actor: AuditActor) => setOrderEnd(id, reason, actor, "CLOTUREE");
export const cancelOrder = (id: string, reason: string, actor: AuditActor) => setOrderEnd(id, reason, actor, "ANNULE");

/** PDF figé rattaché après coup (seule colonne encore modifiable d'une pièce validée). */
export async function attachPurchasePdf(id: string, assetId: string): Promise<void> {
  await db.update(purchaseDocuments).set({ pdfAssetId: assetId }).where(eq(purchaseDocuments.id, id));
}

/* ------------------------------------------------------------------ */
/* Suivi des achats                                                    */
/* ------------------------------------------------------------------ */

/**
 * Achats entrés en stock (réceptions validées, coût de revient = HT en dirhams + frais d'approche),
 * nets des retours, par mois, fournisseur et marque. Ce que COMANET a réellement fait entrer,
 * pas ce qu'elle a commandé.
 */
export async function purchaseStats(opts: { from: string; to: string }) {
  const r = await db.execute<{ month: string; supplier_id: string; supplier: string; brand_id: string | null; brand: string | null; color: string | null; amount: string; qty: string }>(sql`
    select to_char(d.date, 'YYYY-MM') as month, d.supplier_id, s.legal_name as supplier, b.id as brand_id, b.name as brand, b.color,
      sum(case when d.type = 'RETOUR' then -(l.net_ht_mad + l.landed_mad) else l.net_ht_mad + l.landed_mad end)::text as amount,
      sum(case when d.type = 'RETOUR' then -l.quantity else l.quantity end)::text as qty
    from purchase_document_lines l join purchase_documents d on d.id = l.document_id join suppliers s on s.id = d.supplier_id
    left join products p on p.id = l.product_id left join inventory_items i on i.id = l.inventory_item_id
    left join brands b on b.id = coalesce(p.brand_id, i.brand_id)
    where d.type in ('RECEPTION', 'RETOUR') and d.status <> 'BROUILLON' and d.date between ${opts.from}::date and ${opts.to}::date
    group by 1, 2, 3, 4, 5, 6 order by 1`);
  return r.rows;
}
