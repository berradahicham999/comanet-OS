import { sql } from "drizzle-orm";
import { db } from "@/db";
import { byDim, compareMonth, monthlySeries, objectiveFor, annualObjective, periodRange, shiftRange, totals, monthProjection } from "./analytics";
import { productStocks, stockSummary } from "./stock";
import { getRecommendations } from "./rules";
import { getRefDate } from "./ref-date";
import { addDays, iso, today } from "./format";

export async function cockpitData() {
  const refDate = await getRefDate();
  const ref = refDate.ref;
  const year = ref.getUTCFullYear(), month = ref.getUTCMonth() + 1;
  const monthRange = periodRange("month", ref);
  const ytd = periodRange("ytd", ref);
  const ytdN1 = shiftRange(ytd, -12);
  // Les données opérationnelles (terrain, réglementaire, tâches) sont temps réel : elles se calent sur aujourd'hui.
  const now = today();
  const d30 = iso(addDays(now, -30)), tomorrow = iso(addDays(now, 1));

  const [cmp, objective, annualObj, ytdT, ytdN1T, series, seriesN1, brandRows, brands, stocks, recs, marketing, terrain, digital, regulatory, prevMonthBrands] = await Promise.all([
    compareMonth({}, ref),
    objectiveFor(year, month, null),
    annualObjective(year, null),
    totals(ytd.start, ytd.end),
    totals(ytdN1.start, ytdN1.end),
    monthlySeries(13, {}, ref),
    monthlySeries(13, {}, new Date(Date.UTC(ref.getUTCFullYear() - 1, ref.getUTCMonth(), ref.getUTCDate(), 12))),
    byDim("brand", monthRange.start, monthRange.end),
    db.execute(sql`select id, name, color from brands where active order by name`),
    productStocks({}, ref),
    getRecommendations(),
    marketingBlock(year),
    terrainBlock(now, d30, tomorrow),
    digitalBlock(d30, tomorrow),
    regulatoryBlock(now),
    byDim("brand", shiftRange(monthRange, -1).start, shiftRange(monthRange, -1).end),
  ]);

  const proj = monthProjection(cmp.current.amount, ref);
  const prevByBrand = new Map(prevMonthBrands.map((b) => [b.id, b.amount]));
  const brandObjectives = await Promise.all((brands.rows as { id: string; name: string; color: string }[]).map(async (b) => ({ id: b.id, objective: await objectiveFor(year, month, b.id) })));
  const objByBrand = new Map(brandObjectives.map((b) => [b.id, b.objective]));
  const brandTable = (brands.rows as { id: string; name: string; color: string }[]).map((b) => {
    const row = brandRows.find((r) => r.id === b.id);
    return { id: b.id, name: b.name, color: b.color, amount: row?.amount ?? 0, quantity: row?.quantity ?? 0, prev: prevByBrand.get(b.id) ?? 0, objective: objByBrand.get(b.id) ?? null };
  }).sort((a, b) => b.amount - a.amount);

  const stockSum = stockSummary(stocks);
  const terrainSales7 = terrain.sales7;

  return {
    refDate, year, month, monthRange, proj,
    commercial: { cmp, objective, annualObj, ytd: ytdT, ytdN1: ytdN1T, series, seriesN1 },
    brandTable,
    marketing, terrain: { ...terrain, sales7: terrainSales7 }, digital, regulatory,
    stock: { ...stockSum, list: stocks },
    recs,
  };
}

export async function marketingBlock(year: number) {
  const r = await db.execute(sql`
    select coalesce(sum(bu.amount),0)::float8 as budget,
      (select coalesce(sum(amount),0)::float8 from marketing_expenses where extract(year from date) = ${year} and status in ('COMMITTED','SPENT')) as engaged,
      (select coalesce(sum(amount),0)::float8 from marketing_expenses where extract(year from date) = ${year} and status = 'SPENT') as spent,
      (select coalesce(sum(amount),0)::float8 from marketing_expenses where extract(year from date) = ${year}) as planned
    from budgets bu where bu.year = ${year}`);
  const row = r.rows[0] as { budget: number; engaged: number; spent: number; planned: number };
  return { ...row, available: row.budget - row.engaged };
}

async function terrainBlock(ref: Date, d30: string, tomorrow: string) {
  const day = iso(ref);
  const [todayAnims, sales7, top] = await Promise.all([
    db.execute(sql`select a.id, a.status::text as status, c.name as client, c.city, u.name as animatrice, b.name as brand from animations a join clients c on c.id = a.client_id left join users u on u.id = a.animatrice_id left join brands b on b.id = a.brand_id where a.date = ${day}::date order by a.status`),
    db.execute(sql`select coalesce(sum(al.quantity_sold),0)::int as units, count(distinct a.id)::int as animations from animations a join animation_lines al on al.animation_id = a.id where a.status = 'DONE' and a.date >= ${iso(addDays(ref, -7))}::date and a.date < ${tomorrow}::date`),
    db.execute(sql`
      with lines as (
        select a.animatrice_id, a.client_id, al.product_id, al.quantity_sold from animations a join animation_lines al on al.animation_id = a.id
        where a.status = 'DONE' and a.date >= ${d30}::date and a.date < ${tomorrow}::date
      )
      select 'animatrice' as kind, u.name as name, sum(l.quantity_sold)::int as units from lines l join users u on u.id = l.animatrice_id group by u.name
      union all
      select 'product', p.name, sum(l.quantity_sold)::int from lines l join products p on p.id = l.product_id group by p.name
      union all
      select 'client', c.name, sum(l.quantity_sold)::int from lines l join clients c on c.id = l.client_id group by c.name
      order by units desc`),
  ]);
  const tops = top.rows as { kind: string; name: string; units: number }[];
  const first = (k: string) => tops.find((t) => t.kind === k) ?? null;
  return {
    today: todayAnims.rows as { id: string; status: string; client: string; city: string | null; animatrice: string | null; brand: string | null }[],
    sales7: sales7.rows[0] as { units: number; animations: number },
    topAnimatrice: first("animatrice"), topProduct: first("product"), topClient: first("client"),
  };
}

async function digitalBlock(d30: string, tomorrow: string) {
  const r = await db.execute(sql`
    select coalesce(sum(amount),0)::float8 as spend, coalesce(sum(attributed_revenue),0)::float8 as revenue, coalesce(sum(conversions),0)::float8 as conversions
    from marketing_expenses where category in ('META','TIKTOK','GOOGLE','DIGITAL') and date >= ${d30}::date and date < ${tomorrow}::date`);
  const row = r.rows[0] as { spend: number; revenue: number; conversions: number };
  return { ...row, roas: row.spend ? row.revenue / row.spend : null, cpa: row.conversions ? row.spend / row.conversions : null };
}

async function regulatoryBlock(ref: Date) {
  const r = await db.execute(sql`
    select
      count(*) filter (where status = 'EXPIRE' or expiry_date < ${iso(ref)}::date or expiry_date <= ${iso(addDays(ref, 30))}::date)::int as critical,
      count(*) filter (where expiry_date > ${iso(addDays(ref, 30))}::date and expiry_date <= ${iso(addDays(ref, 120))}::date)::int as soon,
      count(*) filter (where missing_documents is not null and missing_documents <> '')::int as missing,
      count(*)::int as total
    from regulatory_files`);
  return r.rows[0] as { critical: number; soon: number; missing: number; total: number };
}
