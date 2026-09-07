import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { addMonths, iso, startOfMonth, today } from "./format";

/* ------------------------------------------------------------------ */
/* Filtres                                                             */
/* ------------------------------------------------------------------ */

export type SalesFilter = {
  brandId?: string;
  /** Portée « marques assignées » : restreint aux marques listées (vide = rien). */
  brandIds?: string[];
  clientIds?: string[];
  productId?: string;
  clientId?: string;
  city?: string;
  channel?: string;
  salesRep?: string;
  clientType?: string;
};

function whereClause(start: string, end: string, f: SalesFilter = {}): SQL {
  const parts: SQL[] = [sql`s.date >= ${start}::date`, sql`s.date < ${end}::date`];
  if (f.brandId) parts.push(sql`p.brand_id = ${f.brandId}::uuid`);
  if (f.brandIds) parts.push(f.brandIds.length ? sql`p.brand_id = any(${f.brandIds}::uuid[])` : sql`false`);
  if (f.clientIds && f.clientIds.length) parts.push(sql`s.client_id = any(${f.clientIds}::uuid[])`);
  if (f.productId) parts.push(sql`s.product_id = ${f.productId}::uuid`);
  if (f.clientId) parts.push(sql`s.client_id = ${f.clientId}::uuid`);
  if (f.city) parts.push(sql`c.city = ${f.city}`);
  if (f.channel) parts.push(sql`${SALES_CHANNEL} = ${f.channel}`);
  if (f.salesRep) parts.push(sql`${SALES_REP} = ${f.salesRep}`);
  if (f.clientType) parts.push(sql`c.type = ${f.clientType}::client_type`);
  return sql.join(parts, sql` and `);
}

const FROM = sql`from sales s join products p on p.id = s.product_id join clients c on c.id = s.client_id left join brands b on b.id = p.brand_id`;

/**
 * CLÉ DE COMMANDE — définition officielle et unique.
 *
 * Une commande, c'est une facture. Quand la ligne ne porte pas de numéro de facture, on
 * retombe sur le couple (client, date) : le même client, le même jour, c'est la même
 * commande. La clé de repli était `sales.id` ici (chaque ligne comptait pour une commande,
 * ce qui gonflait le nombre de commandes de /ventes) et `sales.date` dans `clientIntel()`
 * (deux clients servis le même jour se confondaient dès qu'on sortait d'un périmètre client).
 */
export const ORDER_KEY = sql`coalesce(s.invoice_ref, s.client_id::text || ':' || s.date::text)`;

/**
 * COMMERCIAL ET CANAL — résolution officielle.
 * La ligne de vente prime sur la fiche client : c'est ce qui a été facturé.
 */
export const SALES_REP = sql`coalesce(s.sales_rep, c.sales_rep)`;
export const SALES_CHANNEL = sql`coalesce(s.site, c.channel)`;

/* ------------------------------------------------------------------ */
/* Agrégats                                                            */
/* ------------------------------------------------------------------ */

export type Totals = { amount: number; quantity: number; orders: number; clients: number; lines: number };

export async function totals(start: string, end: string, f: SalesFilter = {}): Promise<Totals> {
  const r = await db.execute(sql`
    select coalesce(sum(s.amount),0)::float8 as amount,
           coalesce(sum(s.quantity),0)::float8 as quantity,
           count(distinct ${ORDER_KEY})::int as orders,
           count(distinct s.client_id)::int as clients,
           count(*)::int as lines
    ${FROM} where ${whereClause(start, end, f)}`);
  const row = r.rows[0] as Record<string, number>;
  return { amount: row.amount, quantity: row.quantity, orders: row.orders, clients: row.clients, lines: row.lines };
}

export type Dim = "brand" | "product" | "client" | "city" | "channel" | "rep" | "clientType";

const DIM_SQL: Record<Dim, { id: SQL; name: SQL; extra?: SQL }> = {
  brand: { id: sql`p.brand_id::text`, name: sql`coalesce(b.name, 'Sans marque')`, extra: sql`max(b.color)` },
  product: { id: sql`s.product_id::text`, name: sql`p.name`, extra: sql`max(coalesce(b.name,''))` },
  client: { id: sql`s.client_id::text`, name: sql`c.name`, extra: sql`max(coalesce(c.city,''))` },
  city: { id: sql`coalesce(c.city,'—')`, name: sql`coalesce(c.city,'Non renseignée')` },
  channel: { id: sql`coalesce(${SALES_CHANNEL}, '—')`, name: sql`coalesce(${SALES_CHANNEL}, 'Non renseigné')` },
  rep: { id: sql`coalesce(${SALES_REP}, '—')`, name: sql`coalesce(${SALES_REP}, 'Non affecté')` },
  clientType: { id: sql`c.type::text`, name: sql`c.type::text` },
};

export type DimRow = { id: string; name: string; extra: string | null; amount: number; quantity: number; orders: number; clients: number };

export async function byDim(dim: Dim, start: string, end: string, f: SalesFilter = {}, limit = 200): Promise<DimRow[]> {
  const d = DIM_SQL[dim];
  const r = await db.execute(sql`
    select ${d.id} as id, ${d.name} as name, ${d.extra ?? sql`null`} as extra,
           coalesce(sum(s.amount),0)::float8 as amount,
           coalesce(sum(s.quantity),0)::float8 as quantity,
           count(distinct ${ORDER_KEY})::int as orders,
           count(distinct s.client_id)::int as clients
    ${FROM} where ${whereClause(start, end, f)}
    group by 1, 2 order by amount desc limit ${limit}`);
  return r.rows as DimRow[];
}

/** Série mensuelle (mois ISO 'YYYY-MM') sur N mois glissants jusqu'au mois courant inclus. */
export async function monthlySeries(monthsBack: number, f: SalesFilter = {}, ref = today()): Promise<{ month: string; amount: number; quantity: number; orders: number }[]> {
  const t = ref;
  const start = iso(addMonths(startOfMonth(t), -(monthsBack - 1)));
  const end = iso(addMonths(startOfMonth(t), 1));
  const r = await db.execute(sql`
    select to_char(s.date, 'YYYY-MM') as month,
           coalesce(sum(s.amount),0)::float8 as amount,
           coalesce(sum(s.quantity),0)::float8 as quantity,
           count(distinct ${ORDER_KEY})::int as orders
    ${FROM} where ${whereClause(start, end, f)} group by 1 order by 1`);
  const map = new Map((r.rows as { month: string; amount: number; quantity: number; orders: number }[]).map((x) => [x.month, x]));
  const out = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const m = iso(addMonths(startOfMonth(t), -i)).slice(0, 7);
    out.push(map.get(m) ?? { month: m, amount: 0, quantity: 0, orders: 0 });
  }
  return out;
}

export async function dailySeries(start: string, end: string, f: SalesFilter = {}) {
  const r = await db.execute(sql`
    select s.date::text as day, coalesce(sum(s.amount),0)::float8 as amount, coalesce(sum(s.quantity),0)::float8 as quantity
    ${FROM} where ${whereClause(start, end, f)} group by 1 order by 1`);
  return r.rows as { day: string; amount: number; quantity: number }[];
}

/* ------------------------------------------------------------------ */
/* Périodes de comparaison                                             */
/* ------------------------------------------------------------------ */

export type PeriodKey = "day" | "week" | "month" | "quarter" | "year" | "ytd";

export function periodRange(key: PeriodKey, ref = today()): { start: string; end: string; label: string } {
  const y = ref.getUTCFullYear(), m = ref.getUTCMonth(), d = ref.getUTCDate();
  const next = iso(new Date(Date.UTC(y, m, d + 1)));
  switch (key) {
    case "day": return { start: iso(ref), end: next, label: "Aujourd'hui" };
    case "week": {
      const dow = (ref.getUTCDay() + 6) % 7; // lundi = 0
      return { start: iso(new Date(Date.UTC(y, m, d - dow))), end: next, label: "Cette semaine" };
    }
    case "month": return { start: iso(new Date(Date.UTC(y, m, 1))), end: next, label: "Ce mois" };
    case "quarter": return { start: iso(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))), end: next, label: "Ce trimestre" };
    case "year": case "ytd": return { start: iso(new Date(Date.UTC(y, 0, 1))), end: next, label: "Année en cours" };
  }
}

/** Décale une plage [start,end) de N mois (pour M-1, M-3, N-1 « à date »). */
export function shiftRange(range: { start: string; end: string }, months: number) {
  const s = new Date(range.start + "T12:00:00Z"), e = new Date(range.end + "T12:00:00Z");
  const sh = (x: Date) => {
    const t = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + months, 1));
    const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(x.getUTCDate(), lastDay))));
  };
  return { start: sh(s), end: sh(e) };
}

export type Comparison = {
  current: Totals;
  m1: Totals; // même plage, mois précédent (à date)
  m3: Totals;
  n1: Totals; // même plage, année précédente
  m1Full: number; // mois précédent complet (CA)
  avg12: number; // moyenne mensuelle 12 derniers mois complets (CA)
};

export async function compareMonth(f: SalesFilter = {}, ref = today()): Promise<Comparison> {
  const range = periodRange("month", ref);
  const r1 = shiftRange(range, -1), r3 = shiftRange(range, -3), r12 = shiftRange(range, -12);
  const som = startOfMonth(ref);
  const [current, m1, m3, n1, m1FullT, avg12T] = await Promise.all([
    totals(range.start, range.end, f),
    totals(r1.start, r1.end, f),
    totals(r3.start, r3.end, f),
    totals(r12.start, r12.end, f),
    totals(iso(addMonths(som, -1)), iso(som), f),
    totals(iso(addMonths(som, -12)), iso(som), f),
  ]);
  return { current, m1, m3, n1, m1Full: m1FullT.amount, avg12: avg12T.amount / 12 };
}

/* ------------------------------------------------------------------ */
/* Objectifs                                                           */
/* ------------------------------------------------------------------ */

/** Objectif du mois : ligne mensuelle si elle existe, sinon objectif annuel / 12. */
export async function objectiveFor(year: number, month: number, brandId?: string | null): Promise<number | null> {
  const scope = brandId ? sql`brand_id = ${brandId}::uuid` : sql`brand_id is null`;
  const r = await db.execute(sql`
    select amount::float8 as amount, month from objectives
    where year = ${year} and product_id is null and ${scope} and (month = ${month} or month is null)
    order by month nulls last limit 1`);
  const row = r.rows[0] as { amount: number; month: number | null } | undefined;
  if (!row) return null;
  return row.month === null ? row.amount / 12 : row.amount;
}

export async function annualObjective(year: number, brandId?: string | null): Promise<number | null> {
  const scope = brandId ? sql`brand_id = ${brandId}::uuid` : sql`brand_id is null`;
  const r = await db.execute(sql`select amount::float8 as amount, month from objectives where year = ${year} and product_id is null and ${scope} and month is null limit 1`);
  const row = r.rows[0] as { amount: number } | undefined;
  if (row) return row.amount;
  const m = await db.execute(sql`select sum(amount)::float8 as amount from objectives where year = ${year} and product_id is null and ${scope} and month is not null`);
  const a = (m.rows[0] as { amount: number | null }).amount;
  return a ?? null;
}

/** Projection fin de mois par rythme courant (run-rate) + réalisation vs objectif. */
export function monthProjection(mtd: number, ref = today()) {
  const day = ref.getUTCDate();
  const daysInMonth = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0)).getUTCDate();
  const runRate = day > 0 ? (mtd / day) * daysInMonth : 0;
  return { day, daysInMonth, runRate, progress: day / daysInMonth };
}

/* ------------------------------------------------------------------ */
/* Listes de référence pour les filtres                                */
/* ------------------------------------------------------------------ */

export async function filterOptions() {
  const [cities, channels, reps, brands] = await Promise.all([
    db.execute(sql`select distinct city as v from clients where city is not null and city <> '' order by 1`),
    db.execute(sql`select distinct site as v from sales where site is not null and site <> '' order by 1`),
    db.execute(sql`select distinct v from (select sales_rep as v from sales union select sales_rep from clients) x where v is not null and v <> '' order by 1`),
    db.execute(sql`select id, name, color from brands where active order by name`),
  ]);
  const vals = (r: { rows: unknown[] }) => (r.rows as { v: string }[]).map((x) => x.v);
  return { cities: vals(cities), channels: vals(channels), reps: vals(reps), brands: brands.rows as { id: string; name: string; color: string }[] };
}
