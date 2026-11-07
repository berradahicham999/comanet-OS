import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { medicalGpsConsents } from "@/db/schema";
import type { Access } from "@/lib/access";
import { animatriceScores } from "@/lib/animations";
import { addDays, iso, today } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { animatedProductCatalog, lastClientForAnimatrice, usualProductsForAnimatrice } from "@/lib/terrain/usual-products";
import { personaOf } from "./persona";
import { monthFigures, type LastStock, type MobileClient, type MobileMonth, type MobileSnapshot, type TerrainSnapshot } from "./snapshot-shared";

/** Version de l'avis GPS de la saisie terrain, dans la table de consentement commune (médical, CRM). */
export const TERRAIN_GPS_NOTICE_VERSION = "TERRAIN-1";

/** Fenêtre « points de vente récents » : au-delà, le point de vente se cherche en ligne (décision du 07/11/2026). */
const RECENT_DAYS = 90;

export async function hasAcceptedTerrainNotice(userId: string): Promise<boolean> {
  const r = await db.execute(sql`select 1 from medical_gps_consents where user_id = ${userId}::uuid and notice_version = ${TERRAIN_GPS_NOTICE_VERSION} limit 1`);
  return r.rows.length > 0;
}

export async function acceptTerrainNotice(userId: string, userAgent: string | null) {
  if (await hasAcceptedTerrainNotice(userId)) return;
  await db.insert(medicalGpsConsents).values({ userId, noticeVersion: TERRAIN_GPS_NOTICE_VERSION, userAgent: userAgent?.slice(0, 300) ?? null });
}

/** Points de vente gardés sur le téléphone : les siens, et ceux où elle a animé récemment. Rien d'autre. */
async function localClients(access: Access): Promise<MobileClient[]> {
  const since = iso(addDays(today(), -RECENT_DAYS));
  const mine = access.clientIds;
  const r = await db.execute<{ id: string; name: string; city: string | null; mine: boolean }>(sql`
    select c.id::text as id, c.name, c.city,
           ${mine.length ? sql`c.id in (${sql.join(mine.map((x) => sql`${x}::uuid`), sql`, `)})` : sql`false`} as mine
    from clients c
    where c.active and (
      ${mine.length ? sql`c.id in (${sql.join(mine.map((x) => sql`${x}::uuid`), sql`, `)})` : sql`false`}
      or exists (select 1 from animations a where a.client_id = c.id and a.animatrice_id = ${access.user.id}::uuid and a.date >= ${since}::date)
    )
    order by 4 desc, c.name
    limit 500`);
  return r.rows;
}

async function lastStockOf(clientIds: string[]): Promise<Record<string, LastStock>> {
  if (!clientIds.length) return {};
  const r = await db.execute<{ client_id: string; product_id: string; quantity: number; read_at: string }>(sql`
    select distinct on (client_id, product_id) client_id::text as client_id, product_id::text as product_id, quantity, read_at::text as read_at
    from client_stock_readings where client_id in (${sql.join(clientIds.map((x) => sql`${x}::uuid`), sql`, `)})
    order by client_id, product_id, read_at desc, created_at desc`);
  const out: Record<string, LastStock> = {};
  for (const x of r.rows) (out[x.client_id] ??= {})[x.product_id] = { quantity: x.quantity, readAt: x.read_at };
  return out;
}

async function monthOf(userId: string): Promise<MobileMonth> {
  const now = today();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const first = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm, 1, 12)));
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const scores = await animatriceScores({ start: first(y, m), end: first(y, m + 1) }, { start: first(y, m - 1), end: first(y, m) }, y);
  const me = scores.find((s) => s.id === userId);
  const ranked = scores.filter((s) => s.days > 0).length;
  return {
    label: new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(now),
    units: me?.units ?? 0,
    ...monthFigures(me?.units ?? 0, me?.objectiveUnits ?? 0, daysInMonth),
    selloutRevenue: me?.revenue ?? 0,
    days: me?.days ?? 0,
    score: me?.score ?? 0,
    // Son rang, jamais le détail des autres : le téléphone ne garde rien hors de son périmètre.
    rank: me && me.days > 0 ? me.rank : null,
    ranked,
    topProduct: me?.topProduct ?? null,
  };
}

async function terrainSnapshot(access: Access): Promise<TerrainSnapshot> {
  const id = access.user.id;
  const day = iso(today());
  const [catalog, usual, clients, last, planned, done, month] = await Promise.all([
    animatedProductCatalog(),
    usualProductsForAnimatrice(id),
    localClients(access),
    lastClientForAnimatrice(id),
    db.execute<{ id: string; client_id: string; client_name: string; city: string | null }>(sql`
      select a.id::text as id, a.client_id::text as client_id, c.name as client_name, c.city
      from animations a join clients c on c.id = a.client_id
      where a.animatrice_id = ${id}::uuid and a.status = 'PLANNED' and coalesce(a.start_date, a.date) <= ${day}::date and a.date >= ${day}::date
      order by a.date limit 5`),
    db.execute<{ units: number }>(sql`
      select coalesce(sum(l.quantity_sold), 0)::int as units from animation_lines l join animations a on a.id = l.animation_id
      where a.animatrice_id = ${id}::uuid and a.status = 'DONE' and a.date = ${day}::date`),
    monthOf(id),
  ]);
  // Les produits habituels doivent rester saisissables même s'ils sortent du catalogue des 12 derniers mois.
  const products = new Map(catalog.map((p) => [p.id, { id: p.id, name: p.name, brandName: p.brandName }]));
  for (const p of usual) if (!products.has(p.id)) products.set(p.id, { id: p.id, name: p.name, brandName: p.brandName });
  const local = clients.some((c) => c.id === last?.id) || !last ? clients : [{ id: last.id, name: last.name, city: last.city, mine: false }, ...clients];
  return {
    products: [...products.values()],
    favoriteIds: usual.map((p) => p.id),
    clients: local,
    lastClientId: last?.id ?? null,
    planned: planned.rows.map((p) => ({ id: p.id, clientId: p.client_id, clientName: p.client_name, city: p.city })),
    todayUnits: done.rows[0]?.units ?? 0,
    month,
    lastStock: await lastStockOf(local.map((c) => c.id)),
  };
}

export async function mobileSnapshot(access: Access): Promise<MobileSnapshot> {
  const persona = personaOf(access.perms, access.scope);
  const terrain = persona === "ANIMATRICE";
  const [settings, gpsNoticeAccepted, data] = await Promise.all([
    getSettings(),
    terrain ? hasAcceptedTerrainNotice(access.user.id) : Promise.resolve(false),
    terrain ? terrainSnapshot(access) : Promise.resolve(null),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    user: { id: access.user.id, name: access.user.name },
    persona,
    home: access.home,
    gpsNoticeAccepted,
    gpsTimeoutS: settings.mobile.gpsTimeoutS,
    terrain: data,
  };
}
