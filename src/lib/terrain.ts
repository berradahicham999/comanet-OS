import { sql } from "drizzle-orm";
import { db } from "@/db";
import { addDays, iso } from "./format";

export type AnimatricePerf = {
  id: string; name: string;
  animations: number; units: number; revenue: number; customers: number; samples: number; days: number;
  unitsPerAnimation: number; revenuePerDay: number; conversion: number | null;
  units30: number; unitsPrev30: number; progressionPct: number | null;
  reportingQuality: number; // 0..1 : part des animations avec commentaire + stock constaté
  topClient: string | null; topProduct: string | null;
  score: number; // 0..100
};

/** Performance des animatrices sur une fenêtre (par défaut 90 jours) + score composite. */
export async function animatricePerformance(ref: Date, windowDays = 90): Promise<AnimatricePerf[]> {
  const start = iso(addDays(ref, -windowDays)), d30 = iso(addDays(ref, -30)), d60 = iso(addDays(ref, -60)), tomorrow = iso(addDays(ref, 1));
  const r = await db.execute(sql`
    with anims as (
      select a.*, coalesce((select sum(al.quantity_sold) from animation_lines al where al.animation_id = a.id),0)::float8 as sold,
        coalesce((select sum(al.quantity_sold * coalesce(p.price_wholesale,0)) from animation_lines al join products p on p.id = al.product_id where al.animation_id = a.id),0)::float8 as revenue,
        (a.comment is not null and a.comment <> '' and exists (select 1 from animation_lines al where al.animation_id = a.id and al.stock_observed is not null))::int as reported
      from animations a where a.status = 'DONE' and a.date >= ${start}::date and a.date < ${tomorrow}::date and a.animatrice_id is not null
    ),
    top_client as (
      select distinct on (animatrice_id) animatrice_id, c.name from anims a join clients c on c.id = a.client_id group by animatrice_id, c.name order by animatrice_id, sum(sold) desc
    ),
    top_product as (
      select distinct on (a.animatrice_id) a.animatrice_id, p.name from anims a join animation_lines al on al.animation_id = a.id join products p on p.id = al.product_id group by a.animatrice_id, p.name order by a.animatrice_id, sum(al.quantity_sold) desc
    )
    select u.id, u.name,
      count(a.id)::int as animations, coalesce(sum(a.sold),0)::float8 as units, coalesce(sum(a.revenue),0)::float8 as revenue,
      coalesce(sum(a.customers_advised),0)::int as customers, coalesce(sum(a.samples),0)::int as samples,
      count(distinct a.date)::int as days,
      coalesce(sum(case when a.date >= ${d30}::date then a.sold end),0)::float8 as units30,
      coalesce(sum(case when a.date >= ${d60}::date and a.date < ${d30}::date then a.sold end),0)::float8 as units_prev30,
      coalesce(avg(a.reported),0)::float8 as reporting,
      tc.name as top_client, tp.name as top_product
    from users u
    left join anims a on a.animatrice_id = u.id
    left join top_client tc on tc.animatrice_id = u.id
    left join top_product tp on tp.animatrice_id = u.id
    where u.role = 'ANIMATRICE' and u.active
    group by u.id, u.name, tc.name, tp.name`);
  const rows = (r.rows as Record<string, unknown>[]).map((x) => {
    const animations = Number(x.animations), units = Number(x.units), revenue = Number(x.revenue), customers = Number(x.customers), days = Number(x.days);
    const units30 = Number(x.units30), unitsPrev30 = Number(x.units_prev30);
    return {
      id: String(x.id), name: String(x.name), animations, units, revenue, customers, samples: Number(x.samples), days,
      unitsPerAnimation: animations ? units / animations : 0, revenuePerDay: days ? revenue / days : 0,
      conversion: customers ? (units / customers) * 100 : null,
      units30, unitsPrev30, progressionPct: unitsPrev30 ? ((units30 - unitsPrev30) / unitsPrev30) * 100 : null,
      reportingQuality: Number(x.reporting), topClient: x.top_client ? String(x.top_client) : null, topProduct: x.top_product ? String(x.top_product) : null,
      score: 0,
    };
  });
  // Score composite (0-100) : CA 40 % · productivité 25 % · progression 15 % · qualité du reporting 20 %
  const maxRev = Math.max(1, ...rows.map((r) => r.revenue)), maxProd = Math.max(1, ...rows.map((r) => r.unitsPerAnimation));
  for (const r of rows) {
    const prog = r.progressionPct === null ? 0.5 : Math.max(0, Math.min(1, 0.5 + r.progressionPct / 100));
    r.score = Math.round(100 * (0.4 * (r.revenue / maxRev) + 0.25 * (r.unitsPerAnimation / maxProd) + 0.15 * prog + 0.2 * r.reportingQuality));
  }
  return rows.sort((a, b) => b.score - a.score);
}

/** Impact d'une animation : sell-in du client sur la marque 30 j avant / après, sell-out le jour J. */
export async function animationImpact(animationId: string) {
  const r = await db.execute(sql`
    with a as (select * from animations where id = ${animationId}::uuid)
    select
      (select coalesce(sum(s.quantity),0)::float8 from sales s join products p on p.id = s.product_id, a where s.client_id = a.client_id and (a.brand_id is null or p.brand_id = a.brand_id) and s.date >= a.date - 30 and s.date < a.date) as before_qty,
      (select coalesce(sum(s.quantity),0)::float8 from sales s join products p on p.id = s.product_id, a where s.client_id = a.client_id and (a.brand_id is null or p.brand_id = a.brand_id) and s.date > a.date and s.date <= a.date + 30) as after_qty,
      (select coalesce(sum(s.amount),0)::float8 from sales s join products p on p.id = s.product_id, a where s.client_id = a.client_id and (a.brand_id is null or p.brand_id = a.brand_id) and s.date >= a.date - 30 and s.date < a.date) as before_amount,
      (select coalesce(sum(s.amount),0)::float8 from sales s join products p on p.id = s.product_id, a where s.client_id = a.client_id and (a.brand_id is null or p.brand_id = a.brand_id) and s.date > a.date and s.date <= a.date + 30) as after_amount,
      (select coalesce(sum(al.quantity_sold),0)::float8 from animation_lines al where al.animation_id = ${animationId}::uuid) as during_qty,
      (select coalesce(sum(al.quantity_sold * coalesce(p.price_wholesale,0)),0)::float8 from animation_lines al join products p on p.id = al.product_id where al.animation_id = ${animationId}::uuid) as during_revenue,
      -- sell-out TTC : montant porté par la ligne (prix du fichier d'animation), sinon prix public du produit
      (select coalesce(sum(coalesce(al.amount, al.quantity_sold * coalesce(p.price_retail, p.price_wholesale * 1.6, 0))),0)::float8 from animation_lines al join products p on p.id = al.product_id where al.animation_id = ${animationId}::uuid) as during_retail`);
  return r.rows[0] as { before_qty: number; after_qty: number; before_amount: number; after_amount: number; during_qty: number; during_revenue: number; during_retail: number };
}
