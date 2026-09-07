import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSettings, type ComanetSettings } from "./settings";
import { ORDER_KEY } from "./analytics";
import { addDays, addMonths, daysBetween, iso, startOfMonth, today } from "./format";

export type Segment = "CROISSANCE" | "STABLE" | "A_RISQUE" | "INACTIF" | "NOUVEAU";

export const SEGMENT_META: Record<Segment, { label: string; tone: "green" | "blue" | "orange" | "red" | "purple"; emoji: string }> = {
  CROISSANCE: { label: "En croissance", tone: "green", emoji: "🟢" },
  STABLE: { label: "Stable", tone: "blue", emoji: "🔵" },
  A_RISQUE: { label: "À risque", tone: "orange", emoji: "🟠" },
  INACTIF: { label: "Inactif", tone: "red", emoji: "🔴" },
  NOUVEAU: { label: "Nouveau", tone: "purple", emoji: "🆕" },
};

export type ClientIntel = {
  id: string;
  code: string;
  name: string;
  type: string;
  city: string | null;
  channel: string | null;
  salesRep: string | null;
  needsReview: boolean;
  revenue12: number;
  revenue3: number;
  revenuePrev3: number;
  growthPct: number | null;
  orders12: number;
  avgBasket: number;
  avgQtyPerOrder: number;
  lastOrder: string | null;
  prevOrder: string | null;
  firstOrder: string | null;
  daysSinceLast: number | null;
  avgIntervalDays: number | null;
  nextTheoretical: string | null;
  daysUntilNext: number | null; // négatif = en retard
  overdue: boolean;
  brands: string[];
  productCount: number;
  segment: Segment;
  highPotential: boolean;
  fieldStock: number | null; // dernier stock rayon constaté (somme lignes)
  fieldSellOut60: number; // sell-out constaté 60 j
  lastAnimation: string | null;
  recommendation: { title: string; detail: string; kind: "RELANCE" | "REACTIVATION" | "ANALYSE" | "DEVELOPPEMENT" | "ANIMATION" | "NONE" };
};

export async function clientIntel(opts: { clientId?: string; clientIds?: string[] | null; brandIds?: string[] | null } = {}, ref?: Date): Promise<ClientIntel[]> {
  const s = await getSettings();
  const t = ref ?? today();
  const m12 = iso(addMonths(startOfMonth(t), -12));
  const m3 = iso(addDays(t, -90));
  const m6 = iso(addDays(t, -180));
  const d60 = iso(addDays(t, -60));
  const tomorrow = iso(addDays(t, 1));

  const r = await db.execute(sql`
    with agg as (
      select s.client_id,
        sum(case when s.date >= ${m12}::date then s.amount else 0 end)::float8 as revenue12,
        sum(case when s.date >= ${m3}::date then s.amount else 0 end)::float8 as revenue3,
        sum(case when s.date >= ${m6}::date and s.date < ${m3}::date then s.amount else 0 end)::float8 as revenue_prev3,
        count(distinct case when s.date >= ${m12}::date then ${ORDER_KEY} end)::int as orders12,
        sum(case when s.date >= ${m12}::date then s.quantity else 0 end)::float8 as qty12,
        max(s.date)::text as last_order, min(s.date)::text as first_order,
        count(distinct case when s.date >= ${m12}::date then p.brand_id end)::int as brand_count,
        count(distinct case when s.date >= ${m12}::date then s.product_id end)::int as product_count
      from sales s join products p on p.id = s.product_id
      where s.date < ${tomorrow}::date
      group by s.client_id
    ),
    orders as (select distinct client_id, date from sales where date >= ${m12}::date),
    gaps as (select client_id, date - lag(date) over (partition by client_id order by date) as gap, date,
                    row_number() over (partition by client_id order by date desc) as rn from orders),
    interval_avg as (select client_id, avg(gap)::float8 as avg_gap from gaps where gap is not null group by client_id),
    prev_order as (select client_id, date::text as prev_order from gaps where rn = 2),
    brand_names as (
      select s.client_id, string_agg(distinct b.name, ', ' order by b.name) as brands
      from sales s join products p on p.id = s.product_id join brands b on b.id = p.brand_id
      where s.date >= ${m12}::date group by s.client_id
    ),
    last_anim as (
      select distinct on (client_id) id, client_id, date::text as date from animations where status = 'DONE' order by client_id, date desc
    ),
    field_stock as (
      select la.client_id, sum(al.stock_observed)::float8 as field_stock
      from last_anim la join animation_lines al on al.animation_id = la.id where al.stock_observed is not null group by la.client_id
    ),
    field_sellout as (
      select a.client_id, sum(al.quantity_sold)::float8 as sold
      from animations a join animation_lines al on al.animation_id = a.id
      where a.status = 'DONE' and a.date >= ${d60}::date group by a.client_id
    )
    select c.id, c.code, c.name, c.type::text as type, c.city, c.channel, c.sales_rep, c.needs_review,
      coalesce(a.revenue12,0) as revenue12, coalesce(a.revenue3,0) as revenue3, coalesce(a.revenue_prev3,0) as revenue_prev3,
      coalesce(a.orders12,0) as orders12, coalesce(a.qty12,0) as qty12, a.last_order, a.first_order,
      coalesce(a.product_count,0) as product_count, ia.avg_gap, po.prev_order, bn.brands,
      fs.field_stock, coalesce(fso.sold,0) as field_sellout, la.date as last_animation
    from clients c
    left join agg a on a.client_id = c.id
    left join interval_avg ia on ia.client_id = c.id
    left join prev_order po on po.client_id = c.id
    left join brand_names bn on bn.client_id = c.id
    left join field_stock fs on fs.client_id = c.id
    left join field_sellout fso on fso.client_id = c.id
    left join last_anim la on la.client_id = c.id
    where c.active ${opts.clientId ? sql`and c.id = ${opts.clientId}::uuid` : sql``}
      ${opts.clientIds && opts.clientIds.length ? sql`and c.id = any(${opts.clientIds}::uuid[])` : sql``}
      ${opts.brandIds && !(opts.clientIds && opts.clientIds.length) ? (opts.brandIds.length ? sql`and exists (select 1 from sales s2 join products p2 on p2.id = s2.product_id where s2.client_id = c.id and p2.brand_id = any(${opts.brandIds}::uuid[]))` : sql`and false`) : sql``}
    order by revenue12 desc`);

  const rows = r.rows as Record<string, unknown>[];
  // Percentile fort potentiel
  const revs = rows.map((x) => Number(x.revenue12)).filter((v) => v > 0).sort((a, b) => a - b);
  const pIdx = Math.floor((s.clientHighPotentialPercentile / 100) * (revs.length - 1));
  const highThreshold = revs.length ? revs[Math.max(0, pIdx)] : Infinity;

  return rows.map((row) => intelFromRow(row, s, t, highThreshold));
}

function intelFromRow(row: Record<string, unknown>, s: ComanetSettings, t: Date, highThreshold: number): ClientIntel {
  const revenue12 = Number(row.revenue12), revenue3 = Number(row.revenue3), revenuePrev3 = Number(row.revenue_prev3);
  const orders12 = Number(row.orders12), qty12 = Number(row.qty12);
  const lastOrder = row.last_order ? String(row.last_order) : null;
  const daysSinceLast = lastOrder ? daysBetween(new Date(lastOrder + "T12:00:00Z"), t) : null;
  const avgInterval = row.avg_gap === null || row.avg_gap === undefined ? null : Number(row.avg_gap);
  const nextTheoretical = lastOrder && avgInterval ? iso(addDays(new Date(lastOrder + "T12:00:00Z"), Math.round(avgInterval))) : null;
  const daysUntilNext = nextTheoretical ? daysBetween(t, new Date(nextTheoretical + "T12:00:00Z")) : null;
  const growthPct = revenuePrev3 > 0 ? ((revenue3 - revenuePrev3) / revenuePrev3) * 100 : revenue3 > 0 ? null : null;
  const firstOrder = row.first_order ? String(row.first_order) : null;
  const isNew = firstOrder ? daysBetween(new Date(firstOrder + "T12:00:00Z"), t) < 90 : false;
  const overdue = daysUntilNext !== null && daysUntilNext < -s.reorderGraceDays;

  let segment: Segment;
  if (daysSinceLast === null || daysSinceLast > s.clientInactiveDays) segment = "INACTIF";
  else if (isNew) segment = "NOUVEAU";
  else if ((growthPct !== null && growthPct < -s.clientRiskDropPct) || (overdue && avgInterval !== null && daysSinceLast > avgInterval * 1.5)) segment = "A_RISQUE";
  else if (growthPct !== null && growthPct > s.clientGrowthPct) segment = "CROISSANCE";
  else segment = "STABLE";

  const highPotential = revenue12 >= highThreshold && revenue12 > 0;
  const fieldStock = row.field_stock === null || row.field_stock === undefined ? null : Number(row.field_stock);
  const fieldSellOut60 = Number(row.field_sellout);
  const brands = row.brands ? String(row.brands).split(", ") : [];

  // Recommandation (§9 : ne jamais pousser une commande juste parce que le stock est disponible)
  let recommendation: ClientIntel["recommendation"];
  const highFieldStock = fieldStock !== null && fieldStock > 0 && fieldSellOut60 < fieldStock * 0.5;
  if (segment === "INACTIF") {
    recommendation = { kind: "REACTIVATION", title: "Réactivation commerciale", detail: `Aucune commande depuis ${daysSinceLast === null ? "toujours" : daysSinceLast + " jours"}. Visite ou appel du commercial avec offre de réassort ciblée sur les marques historiques${brands.length ? ` (${brands.slice(0, 3).join(", ")})` : ""}.` };
  } else if (highFieldStock) {
    recommendation = { kind: "ANIMATION", title: "Ne pas pousser de commande — activer le sell-out", detail: `Stock rayon constaté élevé (${fieldStock} u.) pour un sell-out faible (${fieldSellOut60} u. / 60 j). Programmer une animation ou une activation marketing locale et analyser les produits concernés avant toute relance.` };
  } else if (segment === "A_RISQUE") {
    recommendation = { kind: "ANALYSE", title: "Analyser la baisse et visiter", detail: `CA 3 mois ${growthPct !== null ? Math.round(growthPct) + " %" : "en baisse"} vs 3 mois précédents. Vérifier stock dormant, concurrence et visibilité rayon ; proposer animation si la rotation est bonne.` };
  } else if (overdue) {
    recommendation = { kind: "RELANCE", title: "Relance commerciale", detail: `Commande théorique dépassée de ${Math.abs(daysUntilNext!)} j (rythme habituel : tous les ${Math.round(avgInterval!)} j). Rotation ${growthPct !== null && growthPct > 0 ? "en hausse" : "normale"} → proposer le réassort.` };
  } else if (daysUntilNext !== null && daysUntilNext <= 5) {
    recommendation = { kind: "RELANCE", title: "Anticiper la prochaine commande", detail: `Prochaine commande théorique dans ${daysUntilNext} j. Contact proactif du commercial pour préparer le réassort.` };
  } else if (segment === "CROISSANCE" || (highPotential && brands.length < 4)) {
    recommendation = { kind: "DEVELOPPEMENT", title: "Élargir la gamme", detail: `Client ${segment === "CROISSANCE" ? "en croissance" : "à fort potentiel"} (${brands.length} marque${brands.length > 1 ? "s" : ""} achetée${brands.length > 1 ? "s" : ""}). Proposer les marques non référencées et un présentoir.` };
  } else {
    recommendation = { kind: "NONE", title: "Rien à signaler", detail: "Rythme de commande normal. Prochain contact au rythme habituel." };
  }

  return {
    id: String(row.id), code: String(row.code), name: String(row.name), type: String(row.type),
    city: row.city ? String(row.city) : null, channel: row.channel ? String(row.channel) : null,
    salesRep: row.sales_rep ? String(row.sales_rep) : null, needsReview: Boolean(row.needs_review),
    revenue12, revenue3, revenuePrev3, growthPct, orders12,
    avgBasket: orders12 ? revenue12 / orders12 : 0, avgQtyPerOrder: orders12 ? qty12 / orders12 : 0,
    lastOrder, prevOrder: row.prev_order ? String(row.prev_order) : null, firstOrder,
    daysSinceLast, avgIntervalDays: avgInterval, nextTheoretical, daysUntilNext, overdue,
    brands, productCount: Number(row.product_count), segment, highPotential,
    fieldStock, fieldSellOut60, lastAnimation: row.last_animation ? String(row.last_animation) : null,
    recommendation,
  };
}

export function segmentCounts(list: ClientIntel[]) {
  const c: Record<Segment | "FORT_POTENTIEL", number> = { CROISSANCE: 0, STABLE: 0, A_RISQUE: 0, INACTIF: 0, NOUVEAU: 0, FORT_POTENTIEL: 0 };
  for (const x of list) {
    c[x.segment]++;
    if (x.highPotential) c.FORT_POTENTIEL++;
  }
  return c;
}
