import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { pgArray } from "@/lib/sql-array";
import type { CompanyIdentity, GestionSettings } from "@/lib/settings";
import { billingReadiness } from "./clients-shared";
import { listSeries, type SeriesRow } from "./numbering";

/**
 * Préparation de la bascule : ce qui manque avant d'émettre la première pièce depuis COMANET OS.
 * Le périmètre est celui des sites qui basculent (`settings.gestion.cutover.sites`) : clients et
 * articles vendus par COMANET sur la fenêtre réglée, pas tout le référentiel importé.
 */

export const COMPANY_FIELDS: { key: keyof CompanyIdentity; label: string; required: boolean }[] = [
  { key: "legalName", label: "Raison sociale", required: true },
  { key: "address", label: "Adresse", required: true },
  { key: "city", label: "Ville", required: true },
  { key: "postalCode", label: "Code postal", required: false },
  { key: "phone", label: "Téléphone", required: true },
  { key: "email", label: "E-mail", required: false },
  { key: "capital", label: "Capital", required: true },
  { key: "rc", label: "RC", required: true },
  { key: "ice", label: "ICE", required: true },
  { key: "ifNumber", label: "Identifiant fiscal (IF)", required: true },
  { key: "cnss", label: "CNSS", required: true },
  { key: "tp", label: "Taxe professionnelle (TP)", required: true },
  { key: "bankName", label: "Banque", required: true },
  { key: "rib", label: "RIB", required: true },
];

export type ClientToPrepare = { id: string; name: string; city: string | null; revenue: number; missing: string[]; recommended: string[] };
export type ProductToPrepare = { id: string; name: string; brand: string | null; code: string | null; revenue: number; missing: string[]; recommended: string[] };

export type Readiness = {
  company: { missing: string[]; hasLogo: boolean; hasCachet: boolean };
  clients: { total: number; ready: number; rows: ClientToPrepare[] };
  products: { total: number; ready: number; rows: ProductToPrepare[] };
  stock: { movements: number; products: number; lastInitial: string | null; external: { warehouseKey: string; label: string; date: string | null; products: number }[] };
  series: SeriesRow[];
  sinceDate: string;
};

export async function buildReadiness(g: GestionSettings, today: string): Promise<Readiness> {
  const since = new Date(`${today}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - g.readinessWindowDays);
  const sinceDate = since.toISOString().slice(0, 10);
  const sites = g.cutover.sites.map((x) => x.toUpperCase());
  const [clientRows, productRows, files, stock, external, series] = await Promise.all([
    db.execute<{ id: string; name: string; city: string | null; legal_name: string | null; ice: string | null; billing_address: string | null; account_code: string | null; payment_days: number | null; payment_mode_key: string | null; revenue: number }>(sql`
      select c.id, c.name, c.city, c.legal_name, c.ice, c.billing_address, c.account_code, c.payment_days, c.payment_mode_key, sum(s.amount)::float8 as revenue
      from sales s join clients c on c.id = s.client_id
      where s.date >= ${sinceDate}::date and upper(s.site) = any(${pgArray(sites, "text")}) and c.active
      group by c.id order by revenue desc`),
    db.execute<{ id: string; name: string; brand: string | null; code: string | null; ean: string | null; tax_rate_key: string | null; revenue: number }>(sql`
      select p.id, p.name, b.name as brand, p.code, p.ean, p.tax_rate_key, sum(s.amount)::float8 as revenue
      from sales s join products p on p.id = s.product_id left join brands b on b.id = p.brand_id
      where s.date >= ${sinceDate}::date and upper(s.site) = any(${pgArray(sites, "text")}) and p.active
      group by p.id, b.name order by revenue desc`),
    db.execute<{ slot: string }>(sql`select distinct company_slot as slot from content_assets where company_slot is not null`),
    db.execute<{ movements: number; products: number; last_initial: string | null }>(sql`
      select count(*)::int as movements, count(distinct product_id)::int as products,
        max(date) filter (where type = 'STOCK_INITIAL' and reversal_of is null)::text as last_initial
      from stock_movements`),
    db.execute<{ key: string; label: string; date: string | null; products: number }>(sql`
      select w.key, w.label, max(s.date)::text as date, count(distinct s.product_id)::int as products
      from warehouses w left join stock_snapshots s on s.warehouse_key = w.key
      where w.kind = 'EXTERNE' and w.active group by w.key, w.label, w.sort order by w.sort`),
    listSeries(Number(today.slice(0, 4))),
  ]);

  const company = COMPANY_FIELDS.filter((f) => f.required && !g.company[f.key]?.trim()).map((f) => f.label);
  const slots = new Set(files.rows.map((f) => f.slot));

  const clients = clientRows.rows.map((c) => {
    const r = billingReadiness({ legalName: c.legal_name, ice: c.ice, billingAddress: c.billing_address, city: c.city, accountCode: c.account_code, paymentDays: c.payment_days, paymentModeKey: c.payment_mode_key });
    return { id: c.id, name: c.name, city: c.city, revenue: c.revenue, missing: r.missing, recommended: r.recommended };
  });
  const products = productRows.rows.map((p) => ({
    id: p.id, name: p.name, brand: p.brand, code: p.code, revenue: p.revenue,
    missing: p.code ? [] : ["Réf. COMANET"],
    recommended: [...(p.ean ? [] : ["EAN"]), ...(p.tax_rate_key ? [] : ["TVA (défaut appliqué)"])],
  }));
  const s = stock.rows[0];
  return {
    company: { missing: company, hasLogo: slots.has("LOGO"), hasCachet: slots.has("CACHET") },
    clients: { total: clients.length, ready: clients.filter((c) => !c.missing.length).length, rows: clients },
    products: { total: products.length, ready: products.filter((p) => !p.missing.length).length, rows: products },
    stock: { movements: s?.movements ?? 0, products: s?.products ?? 0, lastInitial: s?.last_initial ?? null, external: external.rows.map((e) => ({ warehouseKey: e.key, label: e.label, date: e.date, products: e.products })) },
    series,
    sinceDate,
  };
}
