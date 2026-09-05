import { sql } from "drizzle-orm";
import { db } from "@/db";
import { addDays, iso } from "./format";

export type ProductRow = {
  id: string; name: string; sku: string | null; shortName: string | null; category: string | null; active: boolean; needsReview: boolean;
  brandId: string | null; brandName: string | null; brandColor: string | null;
  priceWholesale: number | null; costPrice: number | null; priceRetail: number | null;
  revenue12: number; qty12: number; revenue3: number; qtyPrev3: number; qty3: number; clients12: number; lastSale: string | null;
};

/** Liste des produits avec CA / volumes 12 mois et 3 mois (à la date de référence). */
export async function productList(ref: Date, opts: { brandId?: string } = {}): Promise<ProductRow[]> {
  const m12 = iso(addDays(ref, -365)), m3 = iso(addDays(ref, -90)), m6 = iso(addDays(ref, -180)), tomorrow = iso(addDays(ref, 1));
  const r = await db.execute(sql`
    select p.id, p.name, p.sku, p.short_name, p.category, p.active, p.needs_review, p.brand_id, b.name as brand_name, b.color as brand_color,
      p.price_wholesale::float8 as price_wholesale, p.cost_price::float8 as cost_price, p.price_retail::float8 as price_retail,
      coalesce(sum(case when s.date >= ${m12}::date then s.amount end),0)::float8 as revenue12,
      coalesce(sum(case when s.date >= ${m12}::date then s.quantity end),0)::float8 as qty12,
      coalesce(sum(case when s.date >= ${m3}::date then s.amount end),0)::float8 as revenue3,
      coalesce(sum(case when s.date >= ${m3}::date then s.quantity end),0)::float8 as qty3,
      coalesce(sum(case when s.date >= ${m6}::date and s.date < ${m3}::date then s.quantity end),0)::float8 as qty_prev3,
      count(distinct case when s.date >= ${m12}::date then s.client_id end)::int as clients12,
      max(s.date)::text as last_sale
    from products p left join brands b on b.id = p.brand_id
    left join sales s on s.product_id = p.id and s.date < ${tomorrow}::date
    ${opts.brandId ? sql`where p.brand_id = ${opts.brandId}::uuid` : sql``}
    group by p.id, b.name, b.color order by revenue12 desc, p.name`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), name: String(x.name), sku: x.sku ? String(x.sku) : null, shortName: x.short_name ? String(x.short_name) : null,
    category: x.category ? String(x.category) : null, active: Boolean(x.active), needsReview: Boolean(x.needs_review),
    brandId: x.brand_id ? String(x.brand_id) : null, brandName: x.brand_name ? String(x.brand_name) : null, brandColor: x.brand_color ? String(x.brand_color) : null,
    priceWholesale: x.price_wholesale === null ? null : Number(x.price_wholesale), costPrice: x.cost_price === null ? null : Number(x.cost_price), priceRetail: x.price_retail === null ? null : Number(x.price_retail),
    revenue12: Number(x.revenue12), qty12: Number(x.qty12), revenue3: Number(x.revenue3), qty3: Number(x.qty3), qtyPrev3: Number(x.qty_prev3), clients12: Number(x.clients12), lastSale: x.last_sale ? String(x.last_sale) : null,
  }));
}
