import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSettings } from "@/lib/settings";
import { pgArray } from "@/lib/sql-array";
import { listPaymentModes } from "./refs";
import { stockState } from "./ledger";

/**
 * Données de la saisie d'une pièce (BL, facture directe) : clients actifs avec leurs remises,
 * articles actifs avec PPH, TVA et stock disponible, modes de règlement, commerciaux, sites.
 * Aucun calcul ici : le formulaire utilise `calc.ts`, le serveur recalcule à l'enregistrement.
 */
export type EditorClient = { id: string; name: string; legalName: string | null; city: string | null; blocked: boolean; defaultDiscountPct: string | null; paymentModeKey: string | null; brandDiscounts: Record<string, string> };
export type EditorProduct = { id: string; name: string; ref: string | null; ean: string | null; kind: string; brandId: string | null; brand: string | null; publicPriceTtc: string | null; taxRate: string; available: string | null; trackLots: boolean };

export async function editorData(opts: { clientIds?: string[] | null } = {}) {
  const g = (await getSettings()).gestion;
  const scope = opts.clientIds ? (opts.clientIds.length ? sql`and c.id = any(${pgArray(opts.clientIds)})` : sql`and false`) : sql``;
  const [clients, discounts, products, modes, reps, stock, defaultRate] = await Promise.all([
    db.execute<{ id: string; name: string; legal_name: string | null; city: string | null; blocked: boolean; default_discount_pct: string | null; payment_mode_key: string | null }>(sql`
      select c.id, c.name, c.legal_name, c.city, c.blocked, c.default_discount_pct::text, c.payment_mode_key from clients c where c.active ${scope} order by c.name`),
    db.execute<{ client_id: string; brand_id: string; pct: string }>(sql`select client_id, brand_id, discount_pct::text as pct from client_brand_discounts`),
    db.execute<{ id: string; name: string; ref: string | null; ean: string | null; kind: string; brand_id: string | null; brand: string | null; price_retail: string | null; rate: string | null; track_lots: boolean }>(sql`
      select p.id, p.name, coalesce(p.code, p.sku) as ref, p.ean, p.kind, p.brand_id, b.name as brand, p.price_retail::text, tr.rate::text as rate, p.track_lots
      from products p left join brands b on b.id = p.brand_id left join tax_rates tr on tr.key = p.tax_rate_key where p.active order by b.name nulls last, p.name`),
    listPaymentModes(),
    db.execute<{ id: string; name: string }>(sql`select id, name from users where active order by name`),
    stockState(),
    db.execute<{ rate: string }>(sql`select rate::text as rate from tax_rates where key = ${g.defaultTaxRateKey}`),
  ]);
  const byClient = new Map<string, Record<string, string>>();
  for (const d of discounts.rows) {
    const m = byClient.get(d.client_id) ?? {};
    m[d.brand_id] = d.pct;
    byClient.set(d.client_id, m);
  }
  const available = new Map(stock.map((s) => [s.productId, s.byWarehouse.PRINCIPAL ?? "0"]));
  const rate = defaultRate.rows[0]?.rate ?? "20.00";
  return {
    clients: clients.rows.map((c): EditorClient => ({ id: c.id, name: c.name, legalName: c.legal_name, city: c.city, blocked: c.blocked, defaultDiscountPct: c.default_discount_pct, paymentModeKey: c.payment_mode_key, brandDiscounts: byClient.get(c.id) ?? {} })),
    products: products.rows.map((p): EditorProduct => ({ id: p.id, name: p.name, ref: p.ref, ean: p.ean, kind: p.kind, brandId: p.brand_id, brand: p.brand, publicPriceTtc: p.price_retail, taxRate: p.rate ?? rate, available: p.kind === "PRODUIT" ? available.get(p.id) ?? "0" : null, trackLots: p.track_lots })),
    paymentModes: modes.filter((m) => m.active).map((m) => ({ key: m.key, label: m.label })),
    reps: reps.rows,
    sites: g.cutover.sites.length ? g.cutover.sites : ["COMANET"],
    defaultRate: rate,
  };
}
export type EditorData = Awaited<ReturnType<typeof editorData>>;
