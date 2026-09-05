import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { saleLineHash } from "@/lib/hash";
import { categoryFromLabel } from "@/lib/budget-categories";
import { cleanText, inferClientType, normKey, toISODate, toNumber } from "./normalize";
import { matchBrand, matchClient, matchProduct, type ClientCandidate, type ProductCandidate } from "./match";
import type { ImportType } from "./fields";

export type ImportOptions = {
  year?: number; // objectifs / budgets
  stockDate?: string; // photo de stock
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

  constructor(threshold = 0.75) { this.threshold = threshold; }

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
      name: name.trim(), nameKey: key, sku: sku ?? null, brandId, needsReview: !brandId, ...extra,
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
      name, nameKey: key, code: code ?? null, city: city ?? null, type: inferClientType(name), needsReview: !functionalName || !city, ...extra,
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
    const pa = [...this.pendingProductAliases].map(([alias, productId]) => ({ alias, productId, source }));
    const ca = [...this.pendingClientAliases].map(([alias, clientId]) => ({ alias, clientId, source }));
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
  const resolver = new Resolver(options.fuzzyThreshold);
  await resolver.load();

  try {
    switch (type) {
      case "SALES": await importSales(rows, mapping, options, resolver, imp.id, summary); break;
      case "CLIENTS": await importClients(rows, mapping, options, resolver, summary); break;
      case "PRODUCTS": await importProducts(rows, mapping, options, resolver, summary); break;
      case "STOCK": await importStock(rows, mapping, options, resolver, imp.id, summary); break;
      case "OBJECTIVES": await importObjectives(rows, mapping, options, resolver, summary); break;
      case "BUDGETS": await importBudgets(rows, mapping, options, resolver, summary); break;
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
      if (city) set.city = city;
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
