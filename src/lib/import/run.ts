import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { DELEGATE_SQL } from "@/lib/users";
import * as s from "@/db/schema";
import { saleLineHash } from "@/lib/hash";
import { categoryFromLabel } from "@/lib/budget-categories";
import { cleanText, inferClientType, normKey, toISODate, toNumber } from "./normalize";
import { matchBrand, matchBrandInText, matchClient, matchProduct, type ClientCandidate, type ProductCandidate } from "./match";
import { isComputedColumn, type ImportType } from "./fields";
import { normalizeCity, animationKey, animatriceName, animatriceEmail } from "@/lib/animations-shared";
import { emitEvents, eventKey, EVENT_TYPES, EVENT_SOURCES, type EmitInput } from "@/lib/events/emit";
import { normalizePlatform } from "@/lib/marketing-shared";
import { cityToSector } from "@/lib/sectors";
import {
  VARIANT_TYPES, normalizeBool, normalizeDocumentType, normalizeObservation,
  normalizePackaging, normalizeSize, normalizeState, normalizeVariantType, regulatoryKey,
} from "@/lib/regulatory";

export type ImportOptions = {
  year?: number; // objectifs / budgets
  /** Matrice d'animations : libellé de marque au-dessus de chaque colonne produit. */
  columnGroups?: Record<string, string>;
  /** Matrice d'animations : en-têtes de toutes les colonnes de la feuille (produits = celles non mappées). */
  headers?: string[];
  stockDate?: string; // photo de stock
  /** Régie par défaut quand le fichier ne porte pas de colonne « plateforme ». */
  adPlatform?: string;
  skipStatuses?: string[]; // ex: ["Annulé"]
  createUnknown?: boolean; // créer clients / produits inconnus (défaut true)
  fuzzyThreshold?: number;
};

export type ImportSummary = {
  importId: string;
  type: ImportType;
  fileName: string;
  totalRows: number;
  inserted: number;
  updated: number;
  duplicates: number;
  errors: { row: number; message: string }[];
  warnings: string[];
  created: { products: string[]; clients: string[]; brands: string[] };
  matched: { fuzzyProducts: { raw: string; to: string; score: number }[] };
};

type Mapping = Record<string, string>;

/* ------------------------------------------------------------------ */
/* Résolveur d'entités (cache mémoire + création à la volée)           */
/* ------------------------------------------------------------------ */

class Resolver {
  brands: { id: string; name: string; aliases: string[] }[] = [];
  brandKeys: string[] = [];
  products: ProductCandidate[] = [];
  productAlias = new Map<string, string>();
  productBySku = new Map<string, string>();
  clients: ClientCandidate[] = [];
  clientAlias = new Map<string, string>();
  clientByCode = new Map<string, string>();
  created = { products: [] as string[], clients: [] as string[], brands: [] as string[] };
  fuzzy: { raw: string; to: string; score: number }[] = [];
  pendingProductAliases = new Map<string, string>();
  pendingClientAliases = new Map<string, string>();
  threshold: number;
  /** Import en cours : marqué sur chaque fiche et alias créés, pour pouvoir les retirer à l'annulation. */
  importId: string | null;

  constructor(threshold = 0.75, importId: string | null = null) { this.threshold = threshold; this.importId = importId; }

  async load() {
    const [b, p, pa, c, ca] = await Promise.all([
      db.select({ id: s.brands.id, name: s.brands.name, aliases: s.brands.aliases }).from(s.brands),
      db.select({ id: s.products.id, name: s.products.name, brandId: s.products.brandId, key: s.products.nameKey, sku: s.products.sku }).from(s.products),
      db.select().from(s.productAliases),
      db.select({ id: s.clients.id, name: s.clients.name, key: s.clients.nameKey, code: s.clients.code }).from(s.clients),
      db.select().from(s.clientAliases),
    ]);
    this.brands = b;
    this.brandKeys = b.flatMap((br) => [normKey(br.name), ...br.aliases.map(normKey)]).filter(Boolean).sort((x, y) => y.length - x.length);
    this.products = p.map((x) => ({ id: x.id, name: x.name, brandId: x.brandId, key: x.key }));
    for (const x of p) if (x.sku) this.productBySku.set(x.sku.trim().toUpperCase(), x.id);
    for (const a of pa) this.productAlias.set(a.alias, a.productId);
    this.clients = c;
    for (const a of ca) this.clientAlias.set(a.alias, a.clientId);
    for (const x of c) if (x.code) this.clientByCode.set(x.code.trim().toUpperCase(), x.id);
  }

  brand(value: string | null, fallbackName?: string | null): string | null {
    return matchBrand(value, this.brands) ?? (fallbackName ? matchBrand(fallbackName, this.brands) : null);
  }

  /** Marque citée à l'intérieur d'un libellé libre (nom de campagne publicitaire, par ex.). */
  brandInText(text: string | null): string | null {
    return matchBrandInText(text, this.brands);
  }

  async createBrand(name: string) {
    const slug = normKey(name).toLowerCase().replace(/\s+/g, "-");
    const [row] = await db.insert(s.brands).values({ name: name.trim(), slug, aliases: [] }).onConflictDoNothing().returning();
    if (!row) return null;
    this.brands.push({ id: row.id, name: row.name, aliases: [] });
    this.brandKeys.push(normKey(row.name));
    this.created.brands.push(row.name);
    return row.id;
  }

  async product(name: string, sku: string | null, brandId: string | null, create = true, extra: Partial<typeof s.products.$inferInsert> = {}): Promise<string | null> {
    const key = normKey(name);
    if (!key || key.length < 3) return null;
    if (sku) {
      const bySku = this.productBySku.get(sku.trim().toUpperCase());
      if (bySku) { this.addProductAlias(key, bySku); return bySku; }
    }
    const m = matchProduct(name, brandId, this.products, this.productAlias, this.brandKeys, this.threshold);
    if (m) {
      if (m.method === "fuzzy") {
        const to = this.products.find((p) => p.id === m.id)!;
        this.fuzzy.push({ raw: name, to: to.name, score: m.score });
        this.addProductAlias(key, m.id);
      }
      if (sku && !this.productBySku.has(sku.trim().toUpperCase())) {
        await db.update(s.products).set({ sku }).where(eq(s.products.id, m.id)).catch(() => {});
        this.productBySku.set(sku.trim().toUpperCase(), m.id);
      }
      return m.id;
    }
    if (!create) return null;
    const [row] = await db.insert(s.products).values({
      name: name.trim(), nameKey: key, sku: sku ?? null, brandId, needsReview: !brandId, importId: this.importId, ...extra,
    }).onConflictDoNothing().returning();
    if (!row) {
      const existing = await db.query.products.findFirst({ where: eq(s.products.nameKey, key) });
      return existing?.id ?? null;
    }
    this.products.push({ id: row.id, name: row.name, brandId: row.brandId, key: row.nameKey });
    if (row.sku) this.productBySku.set(row.sku.trim().toUpperCase(), row.id);
    this.created.products.push(row.name);
    return row.id;
  }

  addProductAlias(alias: string, productId: string) {
    if (!alias || this.productAlias.has(alias)) return;
    this.productAlias.set(alias, productId);
    this.pendingProductAliases.set(alias, productId);
  }

  async client(functionalName: string | null, rawName: string | null, code: string | null, city: string | null, create = true, extra: Partial<typeof s.clients.$inferInsert> = {}): Promise<string | null> {
    const m = matchClient(functionalName ?? rawName, code, this.clients, this.clientAlias, this.clientByCode);
    if (m) {
      if (rawName) this.addClientAlias(normKey(rawName), m.id);
      if (functionalName) this.addClientAlias(normKey(functionalName), m.id);
      if (code && !this.clientByCode.has(code.trim().toUpperCase())) {
        const c = this.clients.find((x) => x.id === m.id);
        if (c && !c.code) { await db.update(s.clients).set({ code }).where(eq(s.clients.id, m.id)); c.code = code; }
        this.clientByCode.set(code.trim().toUpperCase(), m.id);
      }
      return m.id;
    }
    // le brut peut être un alias connu même si le fonctionnel ne l'est pas
    if (rawName && functionalName) {
      const viaRaw = this.clientAlias.get(normKey(rawName));
      if (viaRaw) { this.addClientAlias(normKey(functionalName), viaRaw); return viaRaw; }
    }
    if (!create) return null;
    const name = (functionalName ?? rawName ?? "").trim();
    const key = normKey(name);
    if (!key) return null;
    const [row] = await db.insert(s.clients).values({
      name, nameKey: key, code: code ?? null, city: city ?? null, sector: cityToSector(city), type: inferClientType(name), needsReview: !functionalName || !city, importId: this.importId, ...extra,
    }).onConflictDoNothing().returning();
    if (!row) {
      const existing = await db.query.clients.findFirst({ where: eq(s.clients.nameKey, key) });
      return existing?.id ?? null;
    }
    this.clients.push({ id: row.id, name: row.name, key: row.nameKey, code: row.code });
    if (row.code) this.clientByCode.set(row.code.trim().toUpperCase(), row.id);
    this.addClientAlias(key, row.id);
    if (rawName) this.addClientAlias(normKey(rawName), row.id);
    this.created.clients.push(row.name);
    return row.id;
  }

  addClientAlias(alias: string, clientId: string) {
    if (!alias || this.clientAlias.has(alias)) return;
    this.clientAlias.set(alias, clientId);
    this.pendingClientAliases.set(alias, clientId);
  }

  async flushAliases(source: string) {
    const pa = [...this.pendingProductAliases].map(([alias, productId]) => ({ alias, productId, source, importId: this.importId }));
    const ca = [...this.pendingClientAliases].map(([alias, clientId]) => ({ alias, clientId, source, importId: this.importId }));
    for (let i = 0; i < pa.length; i += 500) await db.insert(s.productAliases).values(pa.slice(i, i + 500)).onConflictDoNothing();
    for (let i = 0; i < ca.length; i += 500) await db.insert(s.clientAliases).values(ca.slice(i, i + 500)).onConflictDoNothing();
    this.pendingProductAliases.clear();
    this.pendingClientAliases.clear();
  }
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

const get = (row: Record<string, unknown>, mapping: Mapping, key: string) => (mapping[key] ? row[mapping[key]] : null);
const txt = (row: Record<string, unknown>, mapping: Mapping, key: string) => cleanText(get(row, mapping, key));
const num = (row: Record<string, unknown>, mapping: Mapping, key: string) => toNumber(get(row, mapping, key));

export async function runImport(params: {
  type: ImportType;
  rows: Record<string, unknown>[];
  mapping: Mapping;
  fileName: string;
  userId?: string | null;
  options?: ImportOptions;
}): Promise<ImportSummary> {
  const { type, rows, mapping, fileName } = params;
  const options = { createUnknown: true, skipStatuses: ["Annulé", "Annule", "ANNULE"], ...params.options };
  const [imp] = await db.insert(s.imports).values({ type, fileName, mapping, totalRows: rows.length, userId: params.userId ?? null }).returning();
  const summary: ImportSummary = {
    importId: imp.id, type, fileName, totalRows: rows.length, inserted: 0, updated: 0, duplicates: 0, errors: [], warnings: [],
    created: { products: [], clients: [], brands: [] }, matched: { fuzzyProducts: [] },
  };
  const resolver = new Resolver(options.fuzzyThreshold, imp.id);
  await resolver.load();

  try {
    switch (type) {
      case "SALES": await importSales(rows, mapping, options, resolver, imp.id, summary); break;
      case "CLIENTS": await importClients(rows, mapping, options, resolver, summary); break;
      case "PRODUCTS": await importProducts(rows, mapping, options, resolver, summary); break;
      case "STOCK": await importStock(rows, mapping, options, resolver, imp.id, summary); break;
      case "OBJECTIVES": await importObjectives(rows, mapping, options, resolver, summary); break;
      case "BUDGETS": await importBudgets(rows, mapping, options, resolver, summary); break;
      case "REGULATORY": await importRegulatory(rows, mapping, options, resolver, imp.id, summary); break;
      case "ANIMATIONS": await importAnimations(rows, mapping, options, resolver, imp.id, summary); break;
      case "ANIM_OBJECTIVES": await importAnimationObjectives(rows, mapping, options, resolver, summary); break;
      case "ADS": await importAds(rows, mapping, options, resolver, imp.id, summary); break;
      case "MEDECINS": await importMedecins(rows, mapping, options, imp.id, summary); break;
      case "INVENTORY": await importInventory(rows, mapping, options, resolver, imp.id, summary); break;
    }
    await resolver.flushAliases(type);
    summary.created = resolver.created;
    summary.matched.fuzzyProducts = resolver.fuzzy;
    if (resolver.created.products.length) summary.warnings.push(`${resolver.created.products.length} produit(s) créé(s) automatiquement.`);
    if (resolver.created.clients.length) summary.warnings.push(`${resolver.created.clients.length} client(s) créé(s) automatiquement.`);
    if (resolver.fuzzy.length) summary.warnings.push(`${resolver.fuzzy.length} désignation(s) rapprochée(s) automatiquement d'un produit existant — à vérifier dans l'historique d'import.`);
    await db.update(s.imports).set({
      status: "DONE", insertedRows: summary.inserted, updatedRows: summary.updated, duplicateRows: summary.duplicates,
      errorRows: summary.errors.length, errors: summary.errors.slice(0, 200), warnings: [...summary.warnings, ...resolver.fuzzy.slice(0, 300).map((f) => `≈ « ${f.raw} » → « ${f.to} » (${Math.round(f.score * 100)} %)`)],
    }).where(eq(s.imports.id, imp.id));
  } catch (e) {
    await db.update(s.imports).set({ status: "FAILED", errors: [{ row: 0, message: String((e as Error).message ?? e) }] }).where(eq(s.imports.id, imp.id));
    throw e;
  }
  return summary;
}

/* ------------------------------- Ventes ------------------------------- */

async function importSales(rows: Record<string, unknown>[], mapping: Mapping, options: ImportOptions, R: Resolver, importId: string, out: ImportSummary) {
  const skip = new Set((options.skipStatuses ?? []).map(normKey));
  // Les lignes avec code article d'abord : elles créent les produits canoniques (désignation complète + code)
  const ordered = rows.map((r, i) => ({ r, i })).sort((a, b) => {
    const ca = txt(a.r, mapping, "productCode") ? 0 : 1, cb = txt(b.r, mapping, "productCode") ? 0 : 1;
    return ca - cb || a.i - b.i;
  });
  const values: (typeof s.sales.$inferInsert)[] = [];
  const seenHash = new Set<string>();
  for (const { r, i } of ordered) {
    const rowNo = i + 2;
    const date = toISODate(get(r, mapping, "date"));
    if (!date) { out.errors.push({ row: rowNo, message: "Date invalide ou absente" }); continue; }
    const status = txt(r, mapping, "status");
    if (status && skip.has(normKey(status))) continue;
    const quantity = num(r, mapping, "quantity");
    let amount = num(r, mapping, "amount");
    const unitPrice = num(r, mapping, "unitPrice");
    if (quantity === null) { out.errors.push({ row: rowNo, message: "Quantité absente" }); continue; }
    if (amount === null && unitPrice !== null) amount = quantity * unitPrice;
    if (amount === null) { out.errors.push({ row: rowNo, message: "Montant HT absent" }); continue; }
    const productName = txt(r, mapping, "productName");
    if (!productName) { out.errors.push({ row: rowNo, message: "Désignation absente" }); continue; }
    const productCode = txt(r, mapping, "productCode");
    const brandValue = txt(r, mapping, "brand");
    let brandId = R.brand(brandValue, productName);
    if (!brandId && brandValue && options.createUnknown) brandId = await R.createBrand(brandValue);
    const productId = await R.product(productName, productCode, brandId, options.createUnknown !== false);
    if (!productId) { out.errors.push({ row: rowNo, message: `Produit non résolu : ${productName}` }); continue; }
    const clientName = txt(r, mapping, "clientName");
    const clientRaw = txt(r, mapping, "clientRaw");
    const clientCode = txt(r, mapping, "clientCode");
    const city = txt(r, mapping, "city");
    const clientId = await R.client(clientName, clientRaw, clientCode, city, options.createUnknown !== false);
    if (!clientId) { out.errors.push({ row: rowNo, message: `Client non résolu : ${clientName ?? clientRaw ?? "(vide)"}` }); continue; }
    const invoice = txt(r, mapping, "invoice");
    const lvc = txt(r, mapping, "lvc");
    const site = txt(r, mapping, "site")?.toUpperCase() ?? null;
    const rep = txt(r, mapping, "rep");
    // Dédoublonnage : lignes identiques d'un même document. Sans référence de pièce (facture / BL),
    // on garde chaque ligne du fichier (index de ligne dans la clé) : deux livraisons identiques sont possibles.
    const ref = invoice || lvc ? `${invoice ?? ""}|${lvc ?? ""}` : `row:${rowNo}`;
    const lineHash = saleLineHash({ date, clientCode: (clientRaw ?? clientName ?? "") + "|" + (clientCode ?? ""), sku: productName, quantity, amount, invoiceRef: `${ref}|${site ?? ""}` });
    if (seenHash.has(lineHash)) { out.duplicates++; continue; }
    seenHash.add(lineHash);
    values.push({
      date, clientId, productId, quantity: String(quantity), amount: amount.toFixed(2), invoiceRef: invoice, lvcRef: lvc, site, salesRep: rep,
      unitPrice: unitPrice !== null ? unitPrice.toFixed(4) : null, rawClient: clientRaw ?? clientName, rawProduct: productName, lineHash, importId,
    });
  }
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500);
    const res = await db.insert(s.sales).values(chunk).onConflictDoNothing({ target: s.sales.lineHash }).returning({ id: s.sales.id });
    out.inserted += res.length;
    out.duplicates += chunk.length - res.length;
  }
}

/* ------------------------------- Clients ------------------------------ */

async function importClients(rows: Record<string, unknown>[], mapping: Mapping, _o: ImportOptions, R: Resolver, out: ImportSummary) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = txt(r, mapping, "name");
    const raw = txt(r, mapping, "rawName");
    if (!name && !raw) continue;
    const city = txt(r, mapping, "city");
    const code = txt(r, mapping, "code");
    const typeRaw = txt(r, mapping, "type");
    const type = typeRaw ? (["PHARMACIE", "PARAPHARMACIE", "GROSSISTE", "AUTRE"].find((t) => normKey(typeRaw).startsWith(t)) as "PHARMACIE" | "PARAPHARMACIE" | "GROSSISTE" | "AUTRE" | undefined) : undefined;
    const before = R.clients.length;
    const id = await R.client(name, raw, code, city, true, { channel: txt(r, mapping, "channel") ?? undefined, salesRep: txt(r, mapping, "rep") ?? undefined, phone: txt(r, mapping, "phone") ?? undefined, ...(type ? { type } : {}), needsReview: false });
    if (!id) { out.errors.push({ row: i + 2, message: "Client non résolu" }); continue; }
    if (R.clients.length > before) out.inserted++;
    else {
      // mise à jour des attributs connus
      const set: Partial<typeof s.clients.$inferInsert> = {};
      if (city) { set.city = city; const sector = cityToSector(city); if (sector) set.sector = sector; }
      if (type) set.type = type;
      const channel = txt(r, mapping, "channel"); if (channel) set.channel = channel;
      const rep = txt(r, mapping, "rep"); if (rep) set.salesRep = rep;
      const phone = txt(r, mapping, "phone"); if (phone) set.phone = phone;
      if (Object.keys(set).length) { await db.update(s.clients).set({ ...set, needsReview: false }).where(eq(s.clients.id, id)); out.updated++; }
    }
  }
}

/* ------------------------------- Produits ----------------------------- */

async function importProducts(rows: Record<string, unknown>[], mapping: Mapping, _o: ImportOptions, R: Resolver, out: ImportSummary) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = txt(r, mapping, "name");
    if (!name) continue;
    const brandValue = txt(r, mapping, "brand");
    let brandId = R.brand(brandValue, name);
    if (!brandId && brandValue) brandId = await R.createBrand(brandValue);
    const set: Partial<typeof s.products.$inferInsert> = {};
    const pr = num(r, mapping, "priceRetail"); if (pr !== null) set.priceRetail = pr.toFixed(2);
    const pw = num(r, mapping, "priceWholesale"); if (pw !== null) set.priceWholesale = pw.toFixed(2);
    const cp = num(r, mapping, "costPrice"); if (cp !== null) set.costPrice = cp.toFixed(2);
    const lt = num(r, mapping, "leadTime"); if (lt !== null) set.leadTimeDays = Math.round(lt);
    const moq = num(r, mapping, "moq"); if (moq !== null) set.moq = Math.round(moq);
    const cat = txt(r, mapping, "category"); if (cat) set.category = cat;
    const before = R.products.length;
    const id = await R.product(name, txt(r, mapping, "sku"), brandId, true, set);
    if (!id) { out.errors.push({ row: i + 2, message: "Produit non résolu" }); continue; }
    if (R.products.length > before) out.inserted++;
    else if (Object.keys(set).length || brandId) { await db.update(s.products).set({ ...set, ...(brandId ? { brandId, needsReview: false } : {}) }).where(eq(s.products.id, id)); out.updated++; }
  }
}

/* -------------------------------- Stock ------------------------------- */

async function importStock(rows: Record<string, unknown>[], mapping: Mapping, options: ImportOptions, R: Resolver, importId: string, out: ImportSummary) {
  const defaultDate = options.stockDate ?? new Date().toISOString().slice(0, 10);
  let lastBrand: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = txt(r, mapping, "productName");
    const qty = num(r, mapping, "quantity");
    if (!name || qty === null) continue;
    const brandValue: string | null = txt(r, mapping, "brand") ?? lastBrand;
    lastBrand = brandValue;
    let brandId = R.brand(brandValue, name);
    if (!brandId && brandValue) brandId = await R.createBrand(brandValue);
    const set: Partial<typeof s.products.$inferInsert> = {};
    const pw = num(r, mapping, "priceWholesale"); if (pw !== null) set.priceWholesale = pw.toFixed(2);
    const cp = num(r, mapping, "costPrice"); if (cp !== null) set.costPrice = cp.toFixed(2);
    const before = R.products.length;
    const id = await R.product(name, txt(r, mapping, "sku"), brandId, true, { ...set, shortName: name });
    if (!id) { out.errors.push({ row: i + 2, message: `Produit non résolu : ${name}` }); continue; }
    if (R.products.length === before && Object.keys(set).length) await db.update(s.products).set(set).where(eq(s.products.id, id));
    const date = toISODate(get(r, mapping, "date")) ?? defaultDate;
    const onOrder = num(r, mapping, "onOrder") ?? 0;
    await db.insert(s.stockSnapshots).values({ productId: id, quantity: String(qty), onOrder: String(onOrder), date, source: "IMPORT", importId });
    out.inserted++;
  }
}

/* ------------------------------ Objectifs ----------------------------- */

async function importObjectives(rows: Record<string, unknown>[], mapping: Mapping, options: ImportOptions, R: Resolver, out: ImportSummary) {
  const year = options.year ?? new Date().getUTCFullYear();
  let lastBrand: string | null = null;
  const brandTotals = new Map<string, { amount: number; units: number }>();
  const unmatched: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let brandValue: string | null = txt(r, mapping, "brand");
    if (brandValue && normKey(brandValue).startsWith("TOTAL")) continue; // lignes de total
    if (!brandValue) brandValue = lastBrand; else lastBrand = brandValue;
    const amount = num(r, mapping, "amount");
    if (!brandValue || amount === null) continue;
    let brandId = R.brand(brandValue);
    if (!brandId) brandId = await R.createBrand(brandValue);
    if (!brandId) continue;
    const units = num(r, mapping, "units");
    const month = num(r, mapping, "month");
    const rowYear = num(r, mapping, "year") ?? year;
    const productName = txt(r, mapping, "productName");
    let productId: string | null = null;
    if (productName && !/NON RENSEIGNE|GLOBAL/.test(normKey(productName))) {
      productId = await R.product(productName, null, brandId, false);
      if (!productId) unmatched.push(`${brandValue} / ${productName}`);
      else {
        const pw = num(r, mapping, "priceWholesale");
        if (pw !== null) await db.execute(sql`update products set price_wholesale = coalesce(price_wholesale, ${pw.toFixed(2)}::numeric) where id = ${productId}::uuid`);
      }
    }
    if (productId) {
      await upsertObjective({ brandId, productId, year: rowYear, month: month ? Math.round(month) : null, amount, units });
      out.inserted++;
    }
    const key = `${brandId}|${rowYear}|${month ?? ""}`;
    const t = brandTotals.get(key) ?? { amount: 0, units: 0 };
    t.amount += amount; t.units += units ?? 0;
    brandTotals.set(key, t);
  }
  for (const [key, t] of brandTotals) {
    const [brandId, y, m] = key.split("|");
    await upsertObjective({ brandId, productId: null, year: Number(y), month: m ? Number(m) : null, amount: t.amount, units: t.units || null });
    out.inserted++;
  }
  // total COMANET (brand null)
  const globals = new Map<string, number>();
  for (const [key, t] of brandTotals) { const [, y, m] = key.split("|"); const k = `${y}|${m}`; globals.set(k, (globals.get(k) ?? 0) + t.amount); }
  for (const [k, amount] of globals) { const [y, m] = k.split("|"); await upsertObjective({ brandId: null, productId: null, year: Number(y), month: m ? Number(m) : null, amount, units: null }); }
  if (unmatched.length) out.warnings.push(`${unmatched.length} objectif(s) produit non rapproché(s) (comptés dans l'objectif marque) : ${unmatched.slice(0, 15).join(" ; ")}${unmatched.length > 15 ? "…" : ""}`);
}

async function upsertObjective(v: { brandId: string | null; productId: string | null; year: number; month: number | null; amount: number; units: number | null }) {
  await db.execute(sql`
    insert into objectives (brand_id, product_id, year, month, amount, units)
    values (${v.brandId}::uuid, ${v.productId}::uuid, ${v.year}, ${v.month}, ${v.amount.toFixed(2)}::numeric, ${v.units === null ? null : v.units.toFixed(2)}::numeric)
    on conflict (coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), year, coalesce(month, 0))
    do update set amount = excluded.amount, units = excluded.units`);
}

/* ------------------------------- Budgets ------------------------------ */

async function importBudgets(rows: Record<string, unknown>[], mapping: Mapping, options: ImportOptions, R: Resolver, out: ImportSummary) {
  const year = options.year ?? new Date().getUTCFullYear();
  let lastBrand: string | null = null;
  const lineTotals = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let brandValue: string | null = txt(r, mapping, "brand");
    if (brandValue && normKey(brandValue).startsWith("TOTAL")) continue;
    if (!brandValue) brandValue = lastBrand; else lastBrand = brandValue;
    const amount = num(r, mapping, "amount");
    if (!brandValue || amount === null) continue;
    let brandId = R.brand(brandValue);
    if (!brandId) brandId = await R.createBrand(brandValue);
    if (!brandId) continue;
    const rowYear = Math.round(num(r, mapping, "year") ?? year);
    const label = txt(r, mapping, "label");
    if (label) {
      await db.delete(s.budgetLines).where(sql`brand_id = ${brandId}::uuid and year = ${rowYear} and label = ${label}`);
      await db.insert(s.budgetLines).values({ brandId, year: rowYear, label, category: categoryFromLabel(label), amount: amount.toFixed(2) });
      lineTotals.set(`${brandId}|${rowYear}`, (lineTotals.get(`${brandId}|${rowYear}`) ?? 0) + amount);
      out.inserted++;
    } else {
      const ref = num(r, mapping, "referenceRevenue");
      let pct = num(r, mapping, "pct");
      if (pct !== null && pct <= 1) pct = pct * 100;
      await db.insert(s.budgets).values({ brandId, year: rowYear, amount: amount.toFixed(2), referenceRevenue: ref !== null ? ref.toFixed(2) : null, pctOfRevenue: pct !== null ? pct.toFixed(2) : null })
        .onConflictDoUpdate({ target: [s.budgets.brandId, s.budgets.year], set: { amount: amount.toFixed(2), ...(ref !== null ? { referenceRevenue: ref.toFixed(2) } : {}), ...(pct !== null ? { pctOfRevenue: pct.toFixed(2) } : {}) } });
      out.inserted++;
    }
  }
  // s'assurer qu'un budget total existe pour les marques n'ayant que des lignes
  for (const [key, total] of lineTotals) {
    const [brandId, y] = key.split("|");
    await db.insert(s.budgets).values({ brandId, year: Number(y), amount: total.toFixed(2) }).onConflictDoNothing();
  }
}

/* ------------------------------------------------------------------ */
/* Dossiers réglementaires (DMP)                                       */
/* ------------------------------------------------------------------ */

/**
 * Une ligne = une variante déposée (marque × référence × type × contenance).
 * Le rapprochement avec le référentiel produits est tenté mais non bloquant :
 * la référence telle qu'écrite est toujours conservée.
 */
async function importRegulatory(rows: Record<string, unknown>[], mapping: Mapping, _o: ImportOptions, R: Resolver, importId: string, out: ImportSummary) {
  let lastBrand: string | null = null;
  const brandOf = (v: string | null): string | null => v ?? lastBrand;
  const seen = new Set<string>();
  let stale = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const reference = txt(r, mapping, "reference");
    if (!reference) continue;
    const brandValue: string | null = brandOf(txt(r, mapping, "brand"));
    if (brandValue) lastBrand = brandValue;
    const variantType = normalizeVariantType(get(r, mapping, "variantType"));
    const size = normalizeSize(get(r, mapping, "size"));
    const key = regulatoryKey({ brand: brandValue, reference, variantType, size });
    if (seen.has(key)) { out.duplicates++; continue; }
    seen.add(key);

    let brandId = brandValue ? R.brand(brandValue) : null;
    // « COMANET » n'est pas une marque du portefeuille : dossier société, sans marque.
    const isCompany = variantType === "DECLARATION" || variantType === "TRANSFERT";
    if (!brandId && brandValue && !isCompany && normKey(brandValue) !== normKey("COMANET")) {
      brandId = await R.createBrand(brandValue);
    }
    // rapprochement produit : jamais de création, on ne pollue pas le référentiel de vente
    const productId = variantType === "MODELE_VENTE" ? await R.product(reference, null, brandId, false) : null;

    const state = normalizeState(get(r, mapping, "state"));
    const notesRaw = txt(r, mapping, "notes");
    // Le motif de blocage peut vivre dans « Observation » comme dans la colonne de remarques libres.
    const obs = normalizeObservation(get(r, mapping, "observation"));
    const obsNotes = normalizeObservation(notesRaw);
    const blocked = obs.blocked || obsNotes.blocked;
    const filingDate = toISODate(get(r, mapping, "filingDate"));
    const expiryDate = toISODate(get(r, mapping, "expiryDate"));
    const notes = [obs.note, notesRaw].filter(Boolean).join(" — ") || null;
    const values = {
      productId,
      brandId,
      dossier: isCompany ? reference : `Enregistrement DMP — ${VARIANT_TYPES[variantType]}`,
      reference,
      variantType,
      size,
      packaging: normalizePackaging(get(r, mapping, "packaging")),
      documentType: normalizeDocumentType(get(r, mapping, "documentType")),
      authorizationNumber: txt(r, mapping, "authorizationNumber"),
      filingDate,
      expiryDate,
      status: (state === "VALIDE" ? "VALIDE" : state === "A_DEPOSER" ? "A_DEPOSER" : "EN_COURS") as s.RegulatoryStatus,
      certificateStatus: blocked ? "NON_APPLICABLE" : state === "A_DEPOSER" ? "NON_APPLICABLE" : obs.certificateStatus,
      physicalProduct: normalizeBool(get(r, mapping, "physicalProduct")),
      blocked,
      blockedReason: blocked ? (obs.blocked ? obs.note : obsNotes.note) ?? notesRaw : null,
      notes,
      missingDocuments: null as string | null,
      dedupeKey: key,
      importId,
      updatedAt: new Date(),
    };

    const existing = await db.query.regulatoryFiles.findFirst({ where: eq(s.regulatoryFiles.dedupeKey, key) });
    if (existing) {
      // Le fichier ne doit jamais faire reculer un dossier déjà suivi dans l'application :
      // un champ vide dans le fichier ne remplace pas une valeur saisie, et un dépôt plus ancien
      // que celui enregistré est ignoré (cas du ré-import d'un fichier périmé).
      const staleFiling = Boolean(existing.filingDate && filingDate && filingDate < existing.filingDate);
      if (staleFiling) {
        values.filingDate = existing.filingDate;
        values.expiryDate = existing.expiryDate;
        values.authorizationNumber = existing.authorizationNumber;
        stale++;
      } else {
        if (!filingDate) values.filingDate = existing.filingDate;
        if (!expiryDate) values.expiryDate = existing.expiryDate;
        if (!values.authorizationNumber) values.authorizationNumber = existing.authorizationNumber;
      }
      if (existing.certificateStatus === "OBTENU") values.certificateStatus = "OBTENU";
      if (!blocked && existing.blocked) { values.blocked = true; values.blockedReason = existing.blockedReason; values.certificateStatus = "NON_APPLICABLE"; }
      if (!values.missingDocuments) values.missingDocuments = existing.missingDocuments;
      if (!values.size) values.size = existing.size;
      if (!values.packaging) values.packaging = existing.packaging;
      if (values.physicalProduct === null) values.physicalProduct = existing.physicalProduct;
      if (!values.notes) values.notes = existing.notes;
      if (!values.productId) values.productId = existing.productId;
      // Redépôt détecté : la date de dépôt a changé → on archive l'état précédent dans l'historique.
      const redeposit = !staleFiling && filingDate && existing.filingDate && filingDate !== existing.filingDate;
      await db.update(s.regulatoryFiles).set(values).where(eq(s.regulatoryFiles.id, existing.id));
      if (redeposit) {
        await db.insert(s.regulatoryEvents).values({
          fileId: existing.id, date: existing.filingDate!, kind: "DEPOT",
          label: "Dépôt précédent (remplacé par l'import)", reference: existing.authorizationNumber,
          expiryDate: existing.expiryDate, notes: "Archivé automatiquement lors d'un import.",
        });
        await db.insert(s.regulatoryEvents).values({
          fileId: existing.id, date: filingDate!, kind: "RENOUVELLEMENT",
          label: "Redépôt", expiryDate, notes: "Détecté à l'import.",
        });
      }
      out.updated++;
    } else {
      const [row] = await db.insert(s.regulatoryFiles).values(values).returning({ id: s.regulatoryFiles.id });
      if (row && filingDate) {
        await db.insert(s.regulatoryEvents).values({
          fileId: row.id, date: filingDate, kind: "DEPOT", label: "Dépôt DMP",
          reference: values.authorizationNumber, expiryDate, notes: "Repris de l'historique importé.",
        });
      }
      out.inserted++;
    }
  }
  const stats = (await db.execute(sql`
    select count(*) filter (where expiry_date is null and status = 'VALIDE')::int as no_date,
           count(*) filter (where product_id is null and variant_type = 'MODELE_VENTE')::int as unlinked
    from regulatory_files`)).rows[0] as { no_date: number; unlinked: number };
  if (stale) out.warnings.push(`${stale} dossier(s) conservent les dates saisies dans l'application : le fichier contenait un dépôt plus ancien (fichier périmé).`);
  if (stats.no_date) out.warnings.push(`${stats.no_date} dossier(s) enregistré(s) sans date de validité : à retrouver pour pouvoir anticiper les redépôts.`);
  if (stats.unlinked) out.warnings.push(`${stats.unlinked} dossier(s) non rattaché(s) à un produit du référentiel (le suivi fonctionne, mais le lien ventes/stock ne sera pas actif).`);
}

/* ------------------------------------------------------------------ */
/* Animations POS — matrice quotidienne                                */
/* ------------------------------------------------------------------ */

/**
 * Feuille « Données Journalières » : une ligne = un jour × un point de vente × une animatrice,
 * une colonne = un produit (quantité vendue). La ligne juste sous l'en-tête porte les prix unitaires TTC,
 * la ligne au-dessus porte la marque de chaque colonne.
 *
 * Ré-importable à volonté : la clé date|ville|POS|animatrice remplace les lignes déjà chargées.
 */
async function importAnimations(rows: Record<string, unknown>[], mapping: Mapping, options: ImportOptions, R: Resolver, importId: string, out: ImportSummary) {
  const headers = options.headers ?? [];
  const groups = options.columnGroups ?? {};
  const mapped = new Set(Object.values(mapping));
  const candidates = headers.filter((h) => !mapped.has(h) && !isComputedColumn(h));
  if (!candidates.length) {
    out.errors.push({ row: 0, message: "Aucune colonne produit détectée : vérifiez la ligne d'en-tête." });
    return;
  }

  /* 1) Ligne des prix : première ligne sans date comportant au moins 5 valeurs numériques. */
  const prices = new Map<string, number>();
  let priceRowIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i];
    if (toISODate(get(r, mapping, "date"))) continue;
    if (candidates.filter((c) => toNumber(r[c]) !== null).length >= 5) {
      for (const c of candidates) {
        const v = toNumber(r[c]);
        if (v !== null && v > 0) prices.set(c, v);
      }
      priceRowIndex = i;
      break;
    }
  }
  // Une colonne produit porte un prix unitaire ; les colonnes de sous-totaux par marque n'en ont pas.
  const productCols = priceRowIndex >= 0 ? candidates.filter((c) => prices.has(c)) : candidates;
  const ignored = candidates.filter((c) => !productCols.includes(c));
  if (priceRowIndex < 0) out.warnings.push("Aucune ligne de prix détectée sous l'en-tête : les montants sont calculés à partir du prix public des produits, et toutes les colonnes libres sont lues comme des produits.");
  else if (ignored.length) out.warnings.push(`${ignored.length} colonne(s) sans prix ignorée(s) (sous-totaux du classeur) : ${ignored.slice(0, 8).join(", ")}${ignored.length > 8 ? "…" : ""}.`);
  if (!productCols.length) {
    out.errors.push({ row: 0, message: "Aucune colonne produit avec prix : vérifiez la ligne des prix sous l'en-tête." });
    return;
  }

  /* 2) Colonnes produits → référentiel (la marque vient de la ligne de regroupement). */
  const productIds = new Map<string, string>();
  const createdProducts: string[] = [];
  for (const col of productCols) {
    const brandName = groups[col] ?? null;
    const brandId = brandName ? R.brand(brandName) : null;
    let id = await R.product(col, null, brandId, false);
    if (!id) {
      id = await R.product(col, null, brandId, true, { needsReview: true, priceRetail: prices.has(col) ? String(prices.get(col)) : undefined });
      if (id) createdProducts.push(col);
    }
    if (id) {
      productIds.set(col, id);
      R.addProductAlias(normKey(col), id);
      const price = prices.get(col);
      if (price) await db.execute(sql`update products set price_retail = coalesce(price_retail, ${price}) where id = ${id}::uuid`);
    }
  }

  /* 3) Animatrices et points de vente : résolus une seule fois, pas à chaque ligne. */
  const dataRows = rows.filter((r, i) => i !== priceRowIndex && toISODate(get(r, mapping, "date")) && txt(r, mapping, "pos"));
  const animatriceIds = new Map<string, string>();
  const existingUsers = await db.execute(sql`select id, name from users`);
  const usersByKey = new Map((existingUsers.rows as { id: string; name: string }[]).map((u) => [normKey(u.name), u.id]));
  for (const raw of new Set(dataRows.map((r) => txt(r, mapping, "animatrice")).filter(Boolean) as string[])) {
    const k = normKey(raw);
    let id = usersByKey.get(k) ?? null;
    // Ville de rattachement = celle où elle anime le plus, pas la première rencontrée.
    const cityCount = new Map<string, number>();
    for (const r of dataRows) {
      if (normKey(txt(r, mapping, "animatrice") ?? "") !== k) continue;
      const c = normalizeCity(get(r, mapping, "city"));
      if (c) cityCount.set(c, (cityCount.get(c) ?? 0) + 1);
    }
    const city = [...cityCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (!id) {
      const [u] = await db.insert(s.users).values({
        name: animatriceName(raw), email: animatriceEmail(raw), passwordHash: "!", role: "ANIMATRICE", city, active: true,
      }).onConflictDoNothing().returning({ id: s.users.id });
      if (u) { id = u.id; out.warnings.push(`Animatrice créée : ${animatriceName(raw)} — définissez son mot de passe dans Paramètres pour lui ouvrir la saisie mobile.`); }
    } else if (city) {
      await db.execute(sql`update users set city = ${city} where id = ${id}::uuid and role = 'ANIMATRICE'`);
    }
    if (id) animatriceIds.set(k, id);
  }

  const posIds = new Map<string, string>();
  let cityFixes = 0;
  const posSeen = new Map<string, string | null>();
  for (const r of dataRows) {
    const pos = txt(r, mapping, "pos")!;
    if (!posSeen.has(normKey(pos))) posSeen.set(normKey(pos), normalizeCity(get(r, mapping, "city")));
  }
  for (const r of dataRows) {
    const pos = txt(r, mapping, "pos")!;
    const k = normKey(pos);
    if (posIds.has(k)) continue;
    const city = posSeen.get(k) ?? null;
    const clientId = await R.client(pos, null, null, city, true, { needsReview: true });
    if (!clientId) { out.errors.push({ row: 0, message: `Point de vente illisible : ${pos}` }); continue; }
    posIds.set(k, clientId);
    if (city) {
      const upd = await db.execute(sql`update clients set city = ${city}, sector = coalesce(sector, ${cityToSector(city)}) where id = ${clientId}::uuid and (city is null or city = '')`);
      if (upd.rowCount) cityFixes++;
    }
  }

  /* 4) Animations : un seul insert par lot, avec mise à jour sur la clé date|ville|POS|animatrice. */
  type Pending = { key: string; values: typeof s.animations.$inferInsert; lines: { col: string; qty: number }[] };
  const pending: Pending[] = [];
  const seen = new Set<string>();
  for (const r of dataRows) {
    const date = toISODate(get(r, mapping, "date"))!;
    const pos = txt(r, mapping, "pos")!;
    const city = normalizeCity(get(r, mapping, "city"));
    const animatriceRaw = txt(r, mapping, "animatrice");
    const key = animationKey({ date, city, pos, animatrice: animatriceRaw });
    if (seen.has(key)) { out.duplicates++; continue; }
    const clientId = posIds.get(normKey(pos));
    if (!clientId) continue;
    seen.add(key);
    const lines: { col: string; qty: number }[] = [];
    for (const col of productCols) {
      const qty = toNumber(r[col]);
      if (qty && qty > 0 && productIds.has(col)) lines.push({ col, qty: Math.round(qty) });
    }
    pending.push({
      key,
      values: {
        date, clientId, animatriceId: animatriceRaw ? animatriceIds.get(normKey(animatriceRaw)) ?? null : null,
        city, days: Math.max(1, Math.round(toNumber(get(r, mapping, "days")) ?? 1)), status: "DONE",
        customersAdvised: Math.round(toNumber(get(r, mapping, "customers")) ?? 0),
        cost: (toNumber(get(r, mapping, "cost")) ?? 0).toFixed(2),
        comment: txt(r, mapping, "comment"), dedupeKey: key, importId,
      },
      lines,
    });
  }

  /*
   * La saisie humaine gagne toujours sur le fichier (Phase 1, protection de la bascule
   * WhatsApp → application). Une animation dont `source = 'saisie'` n'est jamais remplacée
   * par l'import : ce dernier complète au plus les champs vides et journalise le conflit,
   * sans jamais purger ni réinsérer ses lignes produit.
   */
  const pendingKeys = pending.map((p) => p.key);
  const existingRows = pendingKeys.length
    ? ((await db.execute(sql`
        select id::text as id, dedupe_key, source, city, animatrice_id::text as animatrice_id
        from animations where dedupe_key in (${sql.join(pendingKeys.map((k) => sql`${k}`), sql`, `)})`))
        .rows as { id: string; dedupe_key: string; source: string; city: string | null; animatrice_id: string | null }[])
    : [];
  const existingByKey = new Map(existingRows.map((r) => [r.dedupe_key, r]));

  const protectedItems: typeof pending = [];
  const toUpsert: typeof pending = [];
  for (const p of pending) {
    if (existingByKey.get(p.key)?.source === "saisie") protectedItems.push(p);
    else toUpsert.push(p);
  }

  const idByKey = new Map<string, string>();
  const existingKeysForUpsert = new Set(toUpsert.filter((p) => existingByKey.has(p.key)).map((p) => p.key));
  for (let i = 0; i < toUpsert.length; i += 200) {
    const chunk = toUpsert.slice(i, i + 200);
    const inserted = await db
      .insert(s.animations)
      .values(chunk.map((p) => ({ ...p.values, source: "import" })))
      .onConflictDoUpdate({
        target: s.animations.dedupeKey,
        // l'index unique est partiel : le prédicat doit être répété pour que Postgres l'identifie
        targetWhere: sql`dedupe_key is not null`,
        set: {
          clientId: sql`excluded.client_id`, animatriceId: sql`excluded.animatrice_id`, city: sql`excluded.city`,
          days: sql`excluded.days`, status: sql`excluded.status`, customersAdvised: sql`excluded.customers_advised`,
          cost: sql`excluded.cost`, importId: sql`excluded.import_id`, source: sql`excluded.source`,
        },
      })
      .returning({ id: s.animations.id, key: s.animations.dedupeKey });
    for (const row of inserted) if (row.key) idByKey.set(row.key, row.id);
  }
  out.inserted += toUpsert.filter((p) => !existingKeysForUpsert.has(p.key)).length;
  out.updated += toUpsert.filter((p) => existingKeysForUpsert.has(p.key)).length;

  // Animations protégées : compléter les seuls champs absents, ne jamais toucher aux lignes —
  // elles ne sont volontairement PAS ajoutées à `idByKey`, ce qui les exclut aussi de la purge
  // et de la réinsertion des lignes produit à l'étape suivante.
  if (protectedItems.length) {
    const conflictEvents: EmitInput[] = [];
    for (const p of protectedItems) {
      const ex = existingByKey.get(p.key)!;
      await db.execute(sql`
        update animations set
          city = coalesce(nullif(city, ''), ${p.values.city}),
          animatrice_id = coalesce(animatrice_id, ${p.values.animatriceId}::uuid)
        where id = ${ex.id}::uuid`);
      conflictEvents.push({
        type: EVENT_TYPES.ANIMATION_IMPORT_CONFLICT,
        entityType: "animation",
        entityId: ex.id,
        dedupeKey: eventKey(EVENT_TYPES.ANIMATION_IMPORT_CONFLICT, ex.id),
        source: EVENT_SOURCES.IMPORT_ANIMATIONS,
        occurredAt: new Date(`${p.values.date}T12:00:00Z`),
        status: "done",
        payload: {
          animationId: ex.id, dedupeKey: p.key, importId,
          message: "Animation saisie dans l'application : la saisie a été conservée, seuls les champs vides ont été complétés. Les lignes produit du fichier n'ont pas été appliquées.",
          importAttempted: { city: p.values.city, animatriceId: p.values.animatriceId, days: p.values.days, cost: p.values.cost, lignesProposees: p.lines.length },
        },
      });
    }
    await emitEvents(db, conflictEvents);
    out.warnings.push(`${protectedItems.length} animation(s) saisie(s) dans l'application ont été rencontrées dans ce fichier : la saisie a été conservée, seuls les champs vides ont été complétés. Détail dans le journal des événements (Paramètres → Événements).`);
  }

  /* 5) Lignes produit : purge puis insertion en masse. */
  const ids = [...idByKey.values()];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await db.execute(sql`delete from animation_lines where animation_id in (${sql.join(chunk.map((x) => sql`${x}::uuid`), sql`, `)})`);
  }
  const allLines: typeof s.animationLines.$inferInsert[] = [];
  let revenue = 0;
  for (const p of pending) {
    const animationId = idByKey.get(p.key);
    if (!animationId) continue;
    for (const l of p.lines) {
      const price = prices.get(l.col) ?? null;
      const amount = price !== null ? l.qty * price : null;
      if (amount) revenue += amount;
      allLines.push({
        animationId, productId: productIds.get(l.col)!, quantitySold: l.qty,
        unitPrice: price !== null ? price.toFixed(2) : null,
        amount: amount !== null ? amount.toFixed(2) : null,
      });
    }
  }
  for (let i = 0; i < allLines.length; i += 1000) await db.insert(s.animationLines).values(allLines.slice(i, i + 1000));

  // Valorisation de secours : prix public du produit quand le fichier ne porte pas de prix.
  await db.execute(sql`
    update animation_lines al set unit_price = p.price_retail, amount = al.quantity_sold * p.price_retail
    from products p where p.id = al.product_id and al.amount is null and p.price_retail is not null`);

  out.warnings.push(`${allLines.length} lignes produit chargées · ${Math.round(revenue).toLocaleString("fr-FR")} MAD TTC de sell-out valorisé · ${posIds.size} points de vente · ${animatriceIds.size} animatrices.`);

  // Contrôle : le total recalculé doit coller au total du classeur (colonne « Total TTC »).
  const totalCol = headers.find((h) => normKey(h) === "TOTAL TTC");
  if (totalCol) {
    const fileTotal = dataRows.reduce((sum, r) => sum + (toNumber(r[totalCol]) ?? 0), 0);
    const gap = revenue - fileTotal;
    if (fileTotal > 0 && Math.abs(gap) / fileTotal > 0.005) {
      out.warnings.push(`Contrôle : total du fichier ${Math.round(fileTotal).toLocaleString("fr-FR")} MAD, total recalculé ${Math.round(revenue).toLocaleString("fr-FR")} MAD (écart ${gap > 0 ? "+" : ""}${Math.round(gap).toLocaleString("fr-FR")} MAD). L'application recalcule chaque ligne à partir des quantités et des prix : l'écart vient de totaux saisis à la main dans le classeur.`);
    } else if (fileTotal > 0) {
      out.warnings.push(`Contrôle : total recalculé conforme au classeur (${Math.round(fileTotal).toLocaleString("fr-FR")} MAD).`);
    }
  }
  if (createdProducts.length) out.warnings.push(`${createdProducts.length} produit(s) créé(s) depuis les colonnes du fichier et marqués « à qualifier » : ${createdProducts.slice(0, 6).join(", ")}${createdProducts.length > 6 ? "…" : ""}. Fusionnez-les avec vos articles Sage depuis la fiche produit si nécessaire.`);
  if (cityFixes) out.warnings.push(`${cityFixes} point(s) de vente ont reçu leur ville depuis ce fichier.`);
}

/* ------------------------------------------------------------------ */
/* Régie publicitaire (Meta / TikTok / Google)                         */
/* ------------------------------------------------------------------ */

/**
 * Une ligne = un jour × une publicité (ou × une campagne si le fichier
 * n'a pas le détail créative). L'import est idempotent : réimporter le même
 * export met à jour les lignes au lieu de les dupliquer.
 *
 * La marque est prise dans la colonne « marque » si elle existe, sinon
 * déduite du nom de la campagne (« KLORANE - Acquisition mars » → KLORANE).
 */
async function importAds(rows: Record<string, unknown>[], mapping: Mapping, options: ImportOptions, R: Resolver, importId: string, out: ImportSummary) {
  const fallbackPlatform = normalizePlatform(options.adPlatform ?? "");
  const accounts = new Map<string, string>(); // platform|name -> id
  const campaignIds = new Map<string, string | null>(); // platform|campaignName -> campaign uuid
  const unmatchedBrands = new Set<string>();

  const getAccount = async (platform: string, name: string, brandId: string | null): Promise<string | null> => {
    const key = `${platform}|${name}`;
    if (accounts.has(key)) return accounts.get(key)!;
    const res = await db.execute(sql`
      insert into ad_accounts (platform, name, brand_id) values (${platform}, ${name}, ${brandId}::uuid)
      on conflict (platform, name) do update set brand_id = coalesce(ad_accounts.brand_id, excluded.brand_id)
      returning id`);
    const id = (res.rows[0] as { id: string } | undefined)?.id ?? null;
    if (id) accounts.set(key, id);
    return id;
  };

  /** Rattache la ligne à une campagne existante du même nom (même marque), sans en créer. */
  const getCampaign = async (name: string, brandId: string | null): Promise<string | null> => {
    const key = `${brandId ?? ""}|${normKey(name)}`;
    if (campaignIds.has(key)) return campaignIds.get(key)!;
    let id: string | null = null;
    if (brandId) {
      const res = await db.execute(sql`
        select id from campaigns
        where brand_id = ${brandId}::uuid and (upper(name) = upper(${name}) or upper(${name}) like '%' || upper(name) || '%')
        order by length(name) desc limit 1`);
      id = (res.rows[0] as { id: string } | undefined)?.id ?? null;
    }
    campaignIds.set(key, id);
    return id;
  };

  type Row = {
    date: string; platform: string; accountId: string | null; brandId: string | null; campaignId: string | null;
    campaignName: string; adsetName: string | null; adName: string | null;
    spend: number; impressions: number; reach: number; clicks: number; linkClicks: number;
    landingPageViews: number; leads: number; purchases: number; revenue: number; dedupeKey: string;
  };
  const batch: Row[] = [];
  const flush = async () => {
    if (!batch.length) return;
    await db
      .insert(s.adMetrics)
      .values(batch.map((b) => ({
        date: b.date, platform: b.platform, accountId: b.accountId, brandId: b.brandId, campaignId: b.campaignId,
        campaignName: b.campaignName, adsetName: b.adsetName, adName: b.adName,
        spend: b.spend.toFixed(2), impressions: b.impressions, reach: b.reach, clicks: b.clicks, linkClicks: b.linkClicks,
        landingPageViews: b.landingPageViews, leads: b.leads, purchases: b.purchases, revenue: b.revenue.toFixed(2),
        dedupeKey: b.dedupeKey, importId,
      })))
      .onConflictDoUpdate({
        target: s.adMetrics.dedupeKey,
        set: {
          spend: sql`excluded.spend`, impressions: sql`excluded.impressions`, reach: sql`excluded.reach`,
          clicks: sql`excluded.clicks`, linkClicks: sql`excluded.link_clicks`, landingPageViews: sql`excluded.landing_page_views`,
          leads: sql`excluded.leads`, purchases: sql`excluded.purchases`, revenue: sql`excluded.revenue`,
          brandId: sql`coalesce(excluded.brand_id, ad_metrics.brand_id)`,
          campaignId: sql`coalesce(excluded.campaign_id, ad_metrics.campaign_id)`,
          adsetName: sql`coalesce(excluded.adset_name, ad_metrics.adset_name)`,
          adName: sql`coalesce(excluded.ad_name, ad_metrics.ad_name)`,
          accountId: sql`coalesce(excluded.account_id, ad_metrics.account_id)`,
          importId: sql`excluded.import_id`,
        },
      });
    batch.length = 0;
  };

  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const date = toISODate(get(r, mapping, "date"));
    const campaignName = txt(r, mapping, "campaign");
    if (!date || !campaignName) continue;
    if (normKey(campaignName).startsWith("TOTAL")) continue;

    const platform = mapping.platform ? normalizePlatform(get(r, mapping, "platform")) : fallbackPlatform;
    const adsetName = txt(r, mapping, "adset");
    const adName = txt(r, mapping, "ad");

    // Marque : colonne dédiée, sinon un nom de marque connu présent dans le libellé de campagne.
    const brandRaw = txt(r, mapping, "brand");
    let brandId = brandRaw ? R.brand(brandRaw) : null;
    if (!brandId) brandId = R.brandInText(campaignName);
    if (!brandId && brandRaw) unmatchedBrands.add(brandRaw);

    const accountName = txt(r, mapping, "account");
    const accountId = accountName ? await getAccount(platform, accountName, brandId) : null;
    const campaignId = await getCampaign(campaignName, brandId);

    const dedupeKey = [platform, date, normKey(campaignName), normKey(adsetName ?? ""), normKey(adName ?? "")].join("|");
    if (seen.has(dedupeKey)) { out.duplicates++; continue; }
    seen.add(dedupeKey);

    const int = (k: string) => Math.round(num(r, mapping, k) ?? 0);
    batch.push({
      date, platform, accountId, brandId, campaignId, campaignName, adsetName, adName,
      spend: num(r, mapping, "spend") ?? 0,
      impressions: int("impressions"), reach: int("reach"), clicks: int("clicks"), linkClicks: int("linkClicks"),
      landingPageViews: int("landingPageViews"), leads: int("leads"), purchases: int("purchases"),
      revenue: num(r, mapping, "revenue") ?? 0,
      dedupeKey,
    });
    out.inserted++;
    if (batch.length >= 400) await flush();
  }
  await flush();

  for (const id of accounts.values()) {
    await db.execute(sql`
      update ad_accounts set last_sync_at = now(), sync_status = 'OK',
        imported_rows = (select count(*) from ad_metrics where account_id = ${id}::uuid)
      where id = ${id}::uuid`);
  }
  const orphan = await db.execute(sql`select count(*)::int as n from ad_metrics where import_id = ${importId}::uuid and brand_id is null`);
  const n = (orphan.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n) out.warnings.push(`${n} ligne(s) sans marque identifiée : nommez vos campagnes en commençant par la marque (ex : « KLORANE — Acquisition ») ou ajoutez une colonne « Marque » au fichier.`);
  if (unmatchedBrands.size) out.warnings.push(`Marque(s) non reconnue(s) : ${[...unmatchedBrands].slice(0, 10).join(", ")}.`);
  const linked = await db.execute(sql`select count(*)::int as n from ad_metrics where import_id = ${importId}::uuid and campaign_id is not null`);
  const l = (linked.rows[0] as { n: number } | undefined)?.n ?? 0;
  out.warnings.push(`${l} ligne(s) rattachée(s) à une campagne du module Campagnes. Les autres restent analysables par nom de campagne publicitaire.`);
}

/**
 * Objectifs animation : tableau croisé ville × marque, en unités par an.
 * L'objectif mensuel est déduit (annuel ÷ 12) — inutile de charger un second tableau.
 */
async function importAnimationObjectives(rows: Record<string, unknown>[], mapping: Mapping, options: ImportOptions, R: Resolver, out: ImportSummary) {
  const headers = options.headers ?? [];
  const mapped = new Set(Object.values(mapping));
  const year = options.year ?? new Date().getUTCFullYear();
  const brandCols: { col: string; brandId: string }[] = [];
  for (const h of headers) {
    if (mapped.has(h) || isComputedColumn(h)) continue;
    const brandId = R.brand(h);
    if (brandId) brandCols.push({ col: h, brandId });
  }
  if (!brandCols.length) {
    out.errors.push({ row: 0, message: "Aucune colonne de marque reconnue sur cette ligne d'en-tête." });
    return;
  }
  const seenCities = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const city = normalizeCity(get(r, mapping, "city"));
    if (!city) continue;
    if (["GRAND TOTAL", "TOTAL", "MONTHLY", "YEARLY"].includes(city)) continue;
    // Le classeur enchaîne souvent un bloc ANNUEL puis un bloc MENSUEL avec les mêmes villes :
    // dès qu'une ville se répète, le premier tableau est terminé — on s'arrête là.
    if (seenCities.has(city)) {
      out.warnings.push(`Second tableau détecté à partir de « ${city} » : seul le premier bloc (annuel) a été lu.`);
      break;
    }
    seenCities.add(city);
    const rowYear = year;
    for (const { col, brandId } of brandCols) {
      const units = toNumber(r[col]);
      if (units === null || units <= 0) continue;
      await db.execute(sql`
        insert into animation_objectives (brand_id, city, year, month, units)
        values (${brandId}::uuid, ${city}, ${rowYear}, null, ${units.toFixed(2)}::numeric)
        on conflict (brand_id, city, year, coalesce(month, 0)) do update set units = excluded.units`);
      out.inserted++;
    }
  }
  out.warnings.push(`Objectifs ${year} enregistrés en unités par ville et par marque. L'objectif mensuel affiché est l'annuel divisé par 12.`);
}

/* ------------------------------- Médical ------------------------------ */

/**
 * Référentiel médecins : import non réversible (comme CLIENTS/PRODUCTS). Secteurs et spécialités
 * sont créés à la volée s'ils n'existent pas encore ; le délégué doit déjà exister (créé dans
 * Paramètres) — l'import ne crée jamais d'utilisateur silencieusement.
 */
async function importMedecins(rows: Record<string, unknown>[], mapping: Mapping, _options: ImportOptions, importId: string, out: ImportSummary) {
  const [sectorsRes, specialtiesRes, delegatesRes] = await Promise.all([
    db.select({ id: s.medicalSectors.id, name: s.medicalSectors.name, city: s.medicalSectors.city }).from(s.medicalSectors),
    db.select({ id: s.medicalSpecialties.id, name: s.medicalSpecialties.name }).from(s.medicalSpecialties),
    db.execute(sql`select u.id, u.name from users u where ${DELEGATE_SQL}`),
  ]);
  const sectorByKey = new Map(sectorsRes.map((x) => [`${normKey(x.name)}|${normKey(x.city ?? "")}`, x.id]));
  const specialtyByKey = new Map(specialtiesRes.map((x) => [normKey(x.name), x.id]));
  const delegateByKey = new Map((delegatesRes.rows as { id: string; name: string }[]).map((x) => [normKey(x.name), x.id]));

  type Pending = { key: string; values: typeof s.doctors.$inferInsert };
  const pending: Pending[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const firstName = txt(r, mapping, "firstName");
    const lastName = txt(r, mapping, "lastName");
    const city = normalizeCity(get(r, mapping, "city"));
    if (!firstName || !lastName) { out.errors.push({ row: i + 2, message: "Nom ou prénom manquant" }); continue; }
    const key = normKey(`${firstName} ${lastName} ${city ?? ""}`);
    if (seen.has(key)) { out.duplicates++; continue; }
    seen.add(key);

    const specialtyName = txt(r, mapping, "specialty");
    let specialtyId: string | null = null;
    if (specialtyName) {
      const sk = normKey(specialtyName);
      specialtyId = specialtyByKey.get(sk) ?? null;
      if (!specialtyId) {
        const [row] = await db.insert(s.medicalSpecialties).values({ name: specialtyName }).onConflictDoNothing().returning();
        if (row) { specialtyId = row.id; specialtyByKey.set(sk, row.id); }
      }
    }

    const sectorName = txt(r, mapping, "sector");
    let sectorId: string | null = null;
    if (sectorName) {
      const ck = `${normKey(sectorName)}|${normKey(city ?? "")}`;
      sectorId = sectorByKey.get(ck) ?? null;
      if (!sectorId) {
        const [row] = await db.insert(s.medicalSectors).values({ name: sectorName, city }).returning();
        if (row) { sectorId = row.id; sectorByKey.set(ck, row.id); }
      }
    }

    const delegateName = txt(r, mapping, "delegate");
    const delegateId = delegateName ? delegateByKey.get(normKey(delegateName)) ?? null : null;
    if (delegateName && !delegateId) out.warnings.push(`Délégué inconnu (créez-le dans Paramètres) : « ${delegateName} » — médecin importé sans délégué assigné.`);

    pending.push({
      key,
      values: {
        firstName, lastName, city,
        phone: txt(r, mapping, "phone"), email: txt(r, mapping, "email"),
        specialtyId, subSpecialty: txt(r, mapping, "subSpecialty"), addressLine: txt(r, mapping, "addressLine"),
        sectorId, delegateId, comments: txt(r, mapping, "comments"),
        dedupeKey: key, importId,
      },
    });
  }

  const existingKeys = new Set(
    ((await db.execute(sql`select dedupe_key from doctors where dedupe_key is not null`)).rows as { dedupe_key: string }[]).map((x) => x.dedupe_key),
  );
  for (let i = 0; i < pending.length; i += 200) {
    const chunk = pending.slice(i, i + 200);
    await db
      .insert(s.doctors)
      .values(chunk.map((p) => p.values))
      .onConflictDoUpdate({
        target: s.doctors.dedupeKey,
        targetWhere: sql`dedupe_key is not null`,
        set: {
          phone: sql`coalesce(excluded.phone, doctors.phone)`,
          email: sql`coalesce(excluded.email, doctors.email)`,
          specialtyId: sql`coalesce(excluded.specialty_id, doctors.specialty_id)`,
          subSpecialty: sql`coalesce(excluded.sub_specialty, doctors.sub_specialty)`,
          addressLine: sql`coalesce(excluded.address_line, doctors.address_line)`,
          sectorId: sql`coalesce(excluded.sector_id, doctors.sector_id)`,
          delegateId: sql`coalesce(excluded.delegate_id, doctors.delegate_id)`,
          comments: sql`coalesce(excluded.comments, doctors.comments)`,
          importId: sql`excluded.import_id`,
          updatedAt: sql`now()`,
        },
      });
  }
  out.inserted += pending.filter((p) => !existingKeys.has(p.key)).length;
  out.updated += pending.filter((p) => existingKeys.has(p.key)).length;
}

/* ------------------------------ Inventaire matériel ------------------------------ */

/**
 * Inventaire initial du matériel marketing. Idempotent : un article est identifié par son
 * nom (insensible à la casse) et sa marque ; recharger le fichier ajuste le stock au lieu de
 * dupliquer. Chaque changement de stock passe par un mouvement (`inventory_movements`), jamais
 * par une écriture directe — même règle que l'application (`src/lib/activations/inventory.ts`).
 * Anti-régression : un coût, une unité ou un seuil absents du fichier ne remplacent pas ce qui
 * a été saisi dans l'application.
 */
async function importInventory(rows: Record<string, unknown>[], mapping: Mapping, options: ImportOptions, R: Resolver, importId: string, out: ImportSummary) {
  const { recordMovement } = await import("@/lib/activations/inventory");
  const cats = (await db.execute<{ key: string; label: string }>(sql`select key, label from inventory_categories`)).rows;
  const catOf = (v: string | null): string => {
    if (!v) return "PLV";
    const k = normKey(v);
    const hit = cats.find((c) => normKey(c.key) === k || normKey(c.label) === k) ?? cats.find((c) => k.includes(normKey(c.key)) || k.includes(normKey(c.label)));
    if (hit) return hit.key;
    if (/echant|sample|dose/.test(k)) return "ECHANTILLON";
    if (/good|cadeau|gift/.test(k)) return "GOODIE";
    if (/print|impr|flyer|brochure|affiche/.test(k)) return "PRINT";
    return "PLV";
  };
  const date = options.stockDate ?? new Date().toISOString().slice(0, 10);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = txt(r, mapping, "name");
    const qty = num(r, mapping, "quantity");
    if (!name || qty === null) continue;
    const brandValue = txt(r, mapping, "brand");
    let brandId = brandValue ? R.brand(brandValue, name) : null;
    if (!brandId && brandValue) brandId = await R.createBrand(brandValue);
    const productName = txt(r, mapping, "productName");
    const productId = productName ? await R.product(productName, null, brandId, false) : null;
    const unitCost = num(r, mapping, "unitCost");
    const threshold = num(r, mapping, "alertThreshold");
    const set: Record<string, unknown> = { categoryKey: catOf(txt(r, mapping, "category")), updatedAt: new Date() };
    if (productId) set.productId = productId;
    const sku = txt(r, mapping, "sku"); if (sku) set.sku = sku;
    const unit = txt(r, mapping, "unit"); if (unit) set.unit = unit;
    const location = txt(r, mapping, "location"); if (location) set.location = location;
    if (unitCost !== null) set.unitCost = unitCost.toFixed(2);
    if (threshold !== null) set.alertThreshold = Math.round(threshold);
    const existing = (await db.execute<{ id: string; stock: number }>(sql`select id, stock from inventory_items where lower(name) = lower(${name}) and coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(${brandId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`)).rows[0];
    let id: string;
    if (existing) {
      await db.update(s.inventoryItems).set(set).where(eq(s.inventoryItems.id, existing.id));
      id = existing.id;
      const delta = Math.round(qty) - existing.stock;
      if (delta !== 0) await recordMovement({ itemId: id, type: "AJUSTEMENT", quantity: delta, unitCost, date, reason: "Import d'inventaire", importId });
      out.updated++;
    } else {
      const [row] = await db.insert(s.inventoryItems).values({ name, brandId, categoryKey: set.categoryKey as string, productId, sku, unit: unit ?? "pièce", location, unitCost: unitCost !== null ? unitCost.toFixed(2) : "0", alertThreshold: threshold !== null ? Math.round(threshold) : null, importId }).returning({ id: s.inventoryItems.id });
      id = row.id;
      if (qty !== 0) await recordMovement({ itemId: id, type: "ENTREE", quantity: Math.round(qty), unitCost, date, reason: "Inventaire initial (import)", importId });
      out.inserted++;
    }
  }
}
