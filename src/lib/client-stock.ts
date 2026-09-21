import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, type Db } from "@/db";
import { clientStockReadings } from "@/db/schema";
import type { ClientStockSettings } from "@/lib/settings";
import { addDays, iso } from "@/lib/format";
import {
  agingOf, ageDays, deltaOf, estimatedCoverageWeeks, latestByProduct,
  type Aging, type ClientStockChannel, type LatestReading, type Reading,
} from "./client-stock-shared";

export * from "./client-stock-shared";

/**
 * STOCK CHEZ LE CLIENT — accès base. SEUL module autorisé à écrire dans
 * `client_stock_readings` (`tests/definitions-uniques.test.ts` l'impose). Les deux canaux
 * (saisie terrain de l'animatrice, fiche client du commercial) passent par `recordReadings()`.
 * Toutes les décisions (dernier relevé, ancienneté, écart, couverture) vivent dans
 * `client-stock-shared.ts` : ici, uniquement des requêtes et de l'assemblage.
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export type ReadingInput = {
  clientId: string;
  userId: string | null;
  channel: ClientStockChannel;
  /** Jour du relevé, ISO `AAAA-MM-JJ`. */
  readAt: string;
  /** Journée d'animation d'origine : ses relevés précédents sont remplacés (correction), les autres sont conservés. */
  animationId?: string | null;
  comment?: string | null;
  lines: { productId: string; quantity: number }[];
};

/**
 * Seule écriture. Une ligne par produit relevé, jamais d'écrasement d'un relevé antérieur.
 * Exception documentée : corriger une animation remplace les relevés DE CETTE animation
 * (sinon chaque correction créerait un faux relevé daté du même jour).
 */
export async function recordReadings(input: ReadingInput, ex: Executor = db): Promise<number> {
  if (input.animationId) {
    await ex.delete(clientStockReadings).where(eq(clientStockReadings.animationId, input.animationId));
  }
  const seen = new Set<string>();
  const rows = input.lines.filter((l) => {
    if (seen.has(l.productId) || !Number.isInteger(l.quantity) || l.quantity < 0) return false;
    seen.add(l.productId);
    return true;
  });
  if (!rows.length) return 0;
  await ex.insert(clientStockReadings).values(
    rows.map((l) => ({
      clientId: input.clientId,
      productId: l.productId,
      quantity: l.quantity,
      readAt: input.readAt,
      userId: input.userId,
      channel: input.channel,
      animationId: input.animationId ?? null,
      comment: input.comment ?? null,
    })),
  );
  return rows.length;
}

/** Supprimer une animation retire ses relevés : ils n'existaient que par elle. */
export async function deleteReadingsOfAnimation(animationId: string, ex: Executor = db): Promise<void> {
  await ex.delete(clientStockReadings).where(eq(clientStockReadings.animationId, animationId));
}

/* ------------------------------------------------------------------ */
/* Lecture — fiche client                                              */
/* ------------------------------------------------------------------ */

type ReadingRow = {
  id: string; product_id: string; quantity: number; read_at: string; created_at: string;
  user_id: string | null; user_name: string | null; channel: ClientStockChannel; animation_id: string | null; comment: string | null;
};

const toReading = (r: ReadingRow): Reading => ({
  id: r.id, productId: r.product_id, quantity: r.quantity, readAt: r.read_at, createdAt: r.created_at,
  userId: r.user_id, userName: r.user_name, channel: r.channel, animationId: r.animation_id, comment: r.comment,
});

/** Tous les relevés d'un client, du plus récent au plus ancien. */
export async function readingsForClient(clientId: string): Promise<Reading[]> {
  const r = await db.execute<ReadingRow>(sql`
    select r.id::text as id, r.product_id::text as product_id, r.quantity, r.read_at::text as read_at, r.created_at::text as created_at,
           r.user_id::text as user_id, u.name as user_name, r.channel::text as channel, r.animation_id::text as animation_id, r.comment
    from client_stock_readings r left join users u on u.id = r.user_id
    where r.client_id = ${clientId}::uuid
    order by r.read_at desc, r.created_at desc`);
  return r.rows.map(toReading);
}

/** Dernier relevé par produit, pour pré-remplir un formulaire (animatrice ou commercial). */
export async function lastReadingsForClient(clientId: string): Promise<Record<string, { quantity: number; readAt: string }>> {
  const r = await db.execute<{ product_id: string; quantity: number; read_at: string }>(sql`
    select distinct on (product_id) product_id::text as product_id, quantity, read_at::text as read_at
    from client_stock_readings where client_id = ${clientId}::uuid
    order by product_id, read_at desc, created_at desc`);
  const out: Record<string, { quantity: number; readAt: string }> = {};
  for (const row of r.rows) out[row.product_id] = { quantity: row.quantity, readAt: row.read_at };
  return out;
}

export type ClientStockProduct = {
  productId: string;
  name: string;
  sku: string | null;
  brandId: string | null;
  brandName: string | null;
  brandColor: string | null;
  latest: Reading;
  previous: Reading | null;
  history: Reading[];
  aging: Aging;
  ageDays: number | null;
  delta: number | null;
  /** Unités livrées en sell-in Sage sur la fenêtre (`settings.clientStock.coverageWindowDays`). */
  sellInUnits: number;
  /** Unités vendues en animation sur la même fenêtre. */
  selloutUnits: number;
  /** Estimation, jamais une mesure : `null` sans sell-in sur la fenêtre. */
  coverageWeeks: number | null;
};

export type ClientStockOverview = {
  products: ClientStockProduct[];
  lastReadAt: string | null;
  windowDays: number;
};

/** Lecture complète du stock chez un client : dernier relevé par produit, historique, croisement sell-in / sell-out. */
export async function clientStockOverview(clientId: string, today: Date, s: ClientStockSettings): Promise<ClientStockOverview> {
  const since = iso(addDays(today, -s.coverageWindowDays));
  const [readings, prods, sellIn, sellout] = await Promise.all([
    readingsForClient(clientId),
    db.execute<{ id: string; name: string; sku: string | null; brand_id: string | null; brand_name: string | null; brand_color: string | null }>(sql`
      select p.id::text as id, p.name, p.sku, p.brand_id::text as brand_id, b.name as brand_name, b.color as brand_color
      from products p left join brands b on b.id = p.brand_id
      where p.id in (select distinct product_id from client_stock_readings where client_id = ${clientId}::uuid)`),
    db.execute<{ product_id: string; units: number }>(sql`
      select product_id::text as product_id, sum(quantity)::float8 as units from sales
      where client_id = ${clientId}::uuid and date >= ${since}::date and date <= ${iso(today)}::date group by product_id`),
    db.execute<{ product_id: string; units: number }>(sql`
      select al.product_id::text as product_id, sum(al.quantity_sold)::float8 as units
      from animation_lines al join animations a on a.id = al.animation_id
      where a.client_id = ${clientId}::uuid and a.status = 'DONE' and a.date >= ${since}::date and a.date <= ${iso(today)}::date
      group by al.product_id`),
  ]);
  const latest = latestByProduct(readings);
  const sellInBy = new Map(sellIn.rows.map((r) => [r.product_id, r.units]));
  const selloutBy = new Map(sellout.rows.map((r) => [r.product_id, r.units]));
  const products: ClientStockProduct[] = [];
  for (const p of prods.rows) {
    const l = latest.get(p.id);
    if (!l) continue;
    const sellInUnits = sellInBy.get(p.id) ?? 0;
    products.push({
      productId: p.id, name: p.name, sku: p.sku, brandId: p.brand_id, brandName: p.brand_name, brandColor: p.brand_color,
      latest: l.latest, previous: l.previous, history: l.history,
      aging: agingOf(l.latest.readAt, today, s), ageDays: ageDays(l.latest.readAt, today), delta: deltaOf(l.latest, l.previous),
      sellInUnits, selloutUnits: selloutBy.get(p.id) ?? 0,
      coverageWeeks: estimatedCoverageWeeks({ stock: l.latest.quantity, sellInUnits, windowDays: s.coverageWindowDays }),
    });
  }
  products.sort((a, b) => (a.brandName ?? "").localeCompare(b.brandName ?? "", "fr") || a.name.localeCompare(b.name, "fr"));
  return { products, lastReadAt: readings[0]?.readAt ?? null, windowDays: s.coverageWindowDays };
}

/** Catalogue actif pour le mode relevé, avec le dernier relevé connu par produit. */
export async function catalogWithLastReadings(clientId: string) {
  const [prods, last] = await Promise.all([
    db.execute<{ id: string; name: string; sku: string | null; brand_id: string | null; brand_name: string | null }>(sql`
      select p.id::text as id, p.name, p.sku, p.brand_id::text as brand_id, b.name as brand_name
      from products p left join brands b on b.id = p.brand_id
      where p.active order by b.name nulls last, p.name`),
    lastReadingsForClient(clientId),
  ]);
  return prods.rows.map((p) => ({ id: p.id, name: p.name, sku: p.sku, brandId: p.brand_id, brandName: p.brand_name, last: last[p.id] ?? null }));
}

/* ------------------------------------------------------------------ */
/* Lecture — vue transversale                                          */
/* ------------------------------------------------------------------ */

export type StockClientsFilters = {
  brandId?: string | null;
  city?: string | null;
  /** Auteur du dernier relevé (animatrice ou commercial). */
  authorId?: string | null;
  /** Commercial en charge (client dans son portefeuille `user_client_assignments`). */
  commercialId?: string | null;
  channel?: ClientStockChannel | null;
  aging?: Aging | null;
  /** Portée : clients autorisés, `null` = tous. */
  clientIds?: string[] | null;
};

export type StockClientRow = {
  clientId: string;
  name: string;
  city: string | null;
  type: string;
  lastReadAt: string | null;
  ageDays: number | null;
  aging: Aging;
  productsRead: number;
  stockouts: number;
  lastAuthor: string | null;
  lastChannel: ClientStockChannel | null;
  commercials: string[];
};

/**
 * Un point de vente par ligne : date du dernier relevé, produits relevés, ruptures (dernier
 * relevé = 0), dernier auteur et canal. Les clients actifs jamais relevés apparaissent en
 * « jamais relevé » (hors grossistes : on ne relève pas le stock d'un grossiste).
 */
export async function stockClientsSummary(f: StockClientsFilters, today: Date, s: ClientStockSettings): Promise<StockClientRow[]> {
  const brandCond = f.brandId ? sql`and exists (select 1 from products p where p.id = r.product_id and p.brand_id = ${f.brandId}::uuid)` : sql``;
  const r = await db.execute<{
    client_id: string; name: string; city: string | null; type: string; last_read_at: string | null;
    products_read: number; stockouts: number; last_author: string | null; last_channel: ClientStockChannel | null; commercials: string[] | null;
  }>(sql`
    with latest as (
      select distinct on (r.client_id, r.product_id) r.client_id, r.product_id, r.quantity, r.read_at, r.created_at, r.user_id, r.channel
      from client_stock_readings r
      where true ${brandCond}
      order by r.client_id, r.product_id, r.read_at desc, r.created_at desc
    ),
    per_client as (
      select client_id, count(*)::int as products_read, sum(case when quantity = 0 then 1 else 0 end)::int as stockouts, max(read_at)::text as last_read_at
      from latest group by client_id
    ),
    last_reading as (
      select distinct on (client_id) client_id, user_id, channel from latest order by client_id, read_at desc, created_at desc
    ),
    reps as (
      select a.client_id, array_agg(u.name order by u.name) as names
      from user_client_assignments a join users u on u.id = a.user_id and u.active
      join user_permissions p on p.user_id = u.id and p.module = 'clients' and p.can_create
      group by a.client_id
    )
    select c.id::text as client_id, c.name, c.city, c.type::text as type, pc.last_read_at,
           coalesce(pc.products_read, 0) as products_read, coalesce(pc.stockouts, 0) as stockouts,
           u.name as last_author, lr.channel::text as last_channel, reps.names as commercials
    from clients c
    left join per_client pc on pc.client_id = c.id
    left join last_reading lr on lr.client_id = c.id
    left join users u on u.id = lr.user_id
    left join reps on reps.client_id = c.id
    where c.active and c.type <> 'GROSSISTE'
      ${f.clientIds ? sql`and c.id in (${f.clientIds.length ? sql.join(f.clientIds.map((x) => sql`${x}::uuid`), sql`, `) : sql`null`})` : sql``}
      ${f.city ? sql`and c.city = ${f.city}` : sql``}
      ${f.authorId ? sql`and lr.user_id = ${f.authorId}::uuid` : sql``}
      ${f.channel ? sql`and lr.channel = ${f.channel}` : sql``}
      ${f.commercialId ? sql`and exists (select 1 from user_client_assignments a where a.client_id = c.id and a.user_id = ${f.commercialId}::uuid)` : sql``}
      ${f.brandId ? sql`and pc.client_id is not null` : sql``}
    order by pc.last_read_at desc nulls last, c.name`);
  const rows = r.rows.map((row): StockClientRow => ({
    clientId: row.client_id, name: row.name, city: row.city, type: row.type,
    lastReadAt: row.last_read_at, ageDays: ageDays(row.last_read_at, today), aging: agingOf(row.last_read_at, today, s),
    productsRead: row.products_read, stockouts: row.stockouts, lastAuthor: row.last_author, lastChannel: row.last_channel,
    commercials: row.commercials ?? [],
  }));
  return f.aging ? rows.filter((x) => x.aging === f.aging) : rows;
}

/** Personnes ayant déjà relevé un stock (pour le filtre « auteur »). */
export async function readingAuthors(): Promise<{ id: string; name: string }[]> {
  const r = await db.execute<{ id: string; name: string }>(sql`
    select distinct u.id::text as id, u.name from client_stock_readings r join users u on u.id = r.user_id order by u.name`);
  return r.rows;
}

/** Commerciaux : comptes actifs avec Créer sur Clients et au moins un client en portefeuille. */
export async function listCommercials(): Promise<{ id: string; name: string }[]> {
  const r = await db.execute<{ id: string; name: string }>(sql`
    select u.id::text as id, u.name from users u
    join user_permissions p on p.user_id = u.id and p.module = 'clients' and p.can_create
    where u.active and exists (select 1 from user_client_assignments a where a.user_id = u.id)
    order by u.name`);
  return r.rows;
}

/** Commercial en charge d'un client : premier compte actif (Créer sur Clients) qui l'a en portefeuille. */
export async function commercialForClient(clientId: string): Promise<{ id: string; name: string } | null> {
  const r = await db.execute<{ id: string; name: string }>(sql`
    select u.id::text as id, u.name from user_client_assignments a
    join users u on u.id = a.user_id and u.active
    join user_permissions p on p.user_id = u.id and p.module = 'clients' and p.can_create
    where a.client_id = ${clientId}::uuid order by u.name limit 1`);
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Lecture — règles Action Center                                      */
/* ------------------------------------------------------------------ */

export type StockoutRow = {
  clientId: string; clientName: string; city: string | null; productId: string; productName: string; brandId: string | null; brandName: string | null;
  readAt: string; userName: string | null; channel: ClientStockChannel; selloutUnits: number; commercialId: string | null; commercialName: string | null;
};

/** Produits dont le DERNIER relevé chez un client est 0 alors que ce client en a vendu en animation sur la fenêtre. */
export async function stockoutsAtActiveClients(today: Date, s: ClientStockSettings): Promise<StockoutRow[]> {
  const since = iso(addDays(today, -s.stockoutSelloutDays));
  const r = await db.execute<StockoutRow & { sellout_units: number }>(sql`
    with latest as (
      select distinct on (client_id, product_id) client_id, product_id, quantity, read_at, user_id, channel
      from client_stock_readings order by client_id, product_id, read_at desc, created_at desc
    ),
    sold as (
      select a.client_id, al.product_id, sum(al.quantity_sold)::float8 as units
      from animation_lines al join animations a on a.id = al.animation_id
      where a.status = 'DONE' and a.date >= ${since}::date and a.date <= ${iso(today)}::date
      group by a.client_id, al.product_id
    ),
    rep as (
      select distinct on (a.client_id) a.client_id, u.id as user_id, u.name
      from user_client_assignments a join users u on u.id = a.user_id and u.active
      join user_permissions p on p.user_id = u.id and p.module = 'clients' and p.can_create
      order by a.client_id, u.name
    )
    select l.client_id::text as "clientId", c.name as "clientName", c.city, l.product_id::text as "productId", p.name as "productName",
           p.brand_id::text as "brandId", b.name as "brandName", l.read_at::text as "readAt", u.name as "userName", l.channel::text as channel,
           sold.units as "selloutUnits", rep.user_id::text as "commercialId", rep.name as "commercialName"
    from latest l
    join sold on sold.client_id = l.client_id and sold.product_id = l.product_id and sold.units > 0
    join clients c on c.id = l.client_id and c.active
    join products p on p.id = l.product_id
    left join brands b on b.id = p.brand_id
    left join users u on u.id = l.user_id
    left join rep on rep.client_id = l.client_id
    where l.quantity = 0
    order by sold.units desc`);
  return r.rows;
}

export type StaleClientRow = {
  clientId: string; clientName: string; city: string | null; lastReadAt: string; productsRead: number;
  plannedAnimationDate: string | null; animatriceId: string | null; animatriceName: string | null; commercialId: string | null; commercialName: string | null;
};

/** Clients déjà relevés au moins une fois dont le dernier relevé date de plus de `staleDays`. */
export async function staleClients(today: Date, s: ClientStockSettings): Promise<StaleClientRow[]> {
  const limit = iso(addDays(today, -s.staleDays));
  const r = await db.execute<StaleClientRow>(sql`
    with last as (
      select client_id, max(read_at) as last_read_at, count(distinct product_id)::int as products_read
      from client_stock_readings group by client_id
    ),
    planned as (
      select distinct on (a.client_id) a.client_id, a.date, a.animatrice_id, u.name
      from animations a left join users u on u.id = a.animatrice_id
      where a.status = 'PLANNED' and a.date >= ${iso(today)}::date
      order by a.client_id, a.date
    ),
    rep as (
      select distinct on (a.client_id) a.client_id, u.id as user_id, u.name
      from user_client_assignments a join users u on u.id = a.user_id and u.active
      join user_permissions p on p.user_id = u.id and p.module = 'clients' and p.can_create
      order by a.client_id, u.name
    )
    select l.client_id::text as "clientId", c.name as "clientName", c.city, l.last_read_at::text as "lastReadAt", l.products_read as "productsRead",
           pl.date::text as "plannedAnimationDate", pl.animatrice_id::text as "animatriceId", pl.name as "animatriceName",
           rep.user_id::text as "commercialId", rep.name as "commercialName"
    from last l join clients c on c.id = l.client_id and c.active
    left join planned pl on pl.client_id = l.client_id
    left join rep on rep.client_id = l.client_id
    where l.last_read_at < ${limit}::date
    order by l.last_read_at asc`);
  return r.rows;
}

export type { LatestReading };
