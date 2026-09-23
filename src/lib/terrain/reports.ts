import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { selloutAmountSql } from "@/lib/sellout";
import type { RevisionChange } from "./revisions";

/**
 * RAPPORTS D'ANIMATION — une ligne par rapport saisi ou importé, pour les retrouver, les
 * corriger ou les supprimer. Le sell-out passe par la définition officielle (`selloutAmountSql`).
 * Une période est rattachée par son dernier jour (`date`), comme partout ailleurs.
 */

export type ReportFilter = {
  start: string;
  /** Exclusive. */
  end: string;
  animatriceId?: string;
  city?: string;
  brandId?: string;
  /** Recherche sur le nom du point de vente. */
  q?: string;
  source?: "saisie" | "import";
  /** Seulement les rapports à vérifier (prix manquant ou chevauchement). */
  issues?: boolean;
};

export type ReportRow = {
  id: string;
  startDate: string | null;
  date: string;
  days: number;
  status: string;
  animatriceId: string | null;
  animatrice: string | null;
  clientId: string;
  client: string;
  city: string | null;
  brand: string | null;
  units: number;
  sellout: number;
  /** Des unités vendues sans prix connu : le sell-out affiché est incomplet. */
  missingPrice: boolean;
  /** La même animatrice a une autre animation non annulée sur les mêmes jours. */
  overlap: boolean;
  source: string;
  createdAt: string;
  /** Dernière écriture tracée (création, correction), si l'historique en a une. */
  lastRevision: { action: string; actorName: string; at: string } | null;
};

export const REPORTS_LIMIT = 300;

export async function listAnimationReports(f: ReportFilter): Promise<{ rows: ReportRow[]; total: number }> {
  const parts: SQL[] = [sql`a.date >= ${f.start}::date and a.date < ${f.end}::date`];
  if (f.animatriceId) parts.push(sql`a.animatrice_id = ${f.animatriceId}::uuid`);
  if (f.city) parts.push(sql`a.city = ${f.city}`);
  if (f.brandId) parts.push(sql`a.brand_id = ${f.brandId}::uuid`);
  if (f.source) parts.push(sql`a.source = ${f.source}`);
  if (f.q) parts.push(sql`c.name ilike ${`%${f.q}%`}`);
  const where = sql.join(parts, sql` and `);

  const r = await db.execute(sql`
    with base as (
      select a.id, a.start_date::text as start_date, a.date::text as date, a.days, a.status::text as status,
             a.animatrice_id::text as animatrice_id, u.name as animatrice, a.client_id::text as client_id, c.name as client,
             a.city, b.name as brand, a.source, a.created_at,
             coalesce((select sum(al.quantity_sold) from animation_lines al where al.animation_id = a.id), 0)::int as units,
             coalesce((select sum(${selloutAmountSql("al", "p")}) from animation_lines al left join products p on p.id = al.product_id where al.animation_id = a.id), 0)::float8 as sellout,
             exists (select 1 from animation_lines al left join products p on p.id = al.product_id
                     where al.animation_id = a.id and al.quantity_sold > 0 and ${selloutAmountSql("al", "p")} is null) as missing_price,
             (a.status <> 'CANCELLED' and a.animatrice_id is not null and exists (
                select 1 from animations o where o.animatrice_id = a.animatrice_id and o.id <> a.id and o.status <> 'CANCELLED'
                  and coalesce(o.start_date, o.date) <= a.date and o.date >= coalesce(a.start_date, a.date))) as overlap
      from animations a
      join clients c on c.id = a.client_id
      left join users u on u.id = a.animatrice_id
      left join brands b on b.id = a.brand_id
      where ${where}
    ),
    filtered as (select * from base ${f.issues ? sql`where missing_price or overlap` : sql``})
    select f.*, (select count(*) from filtered)::int as total,
           (select json_build_object('action', r.action, 'actorName', r.actor_name, 'at', r.created_at)
              from animation_revisions r where r.animation_id = f.id order by r.created_at desc limit 1) as last_revision
    from filtered f
    order by f.date desc, f.created_at desc
    limit ${REPORTS_LIMIT}`);

  const rows = (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id),
    startDate: (x.start_date as string | null) ?? null,
    date: String(x.date),
    days: Number(x.days),
    status: String(x.status),
    animatriceId: (x.animatrice_id as string | null) ?? null,
    animatrice: (x.animatrice as string | null) ?? null,
    clientId: String(x.client_id),
    client: String(x.client),
    city: (x.city as string | null) ?? null,
    brand: (x.brand as string | null) ?? null,
    units: Number(x.units),
    sellout: Number(x.sellout),
    missingPrice: Boolean(x.missing_price),
    overlap: Boolean(x.overlap),
    source: String(x.source),
    createdAt: new Date(x.created_at as string).toISOString(),
    lastRevision: (x.last_revision as ReportRow["lastRevision"]) ?? null,
  }));
  return { rows, total: rows.length ? Number((r.rows[0] as { total: number }).total) : 0 };
}

export type RevisionRow = { id: string; action: string; actorName: string; summary: string; changes: RevisionChange[]; createdAt: string };

/** Historique d'un rapport, du plus récent au plus ancien. */
export async function animationHistory(animationId: string): Promise<RevisionRow[]> {
  const r = await db.execute(sql`
    select id::text as id, action, actor_name, summary, changes, created_at
    from animation_revisions where animation_id = ${animationId}::uuid order by created_at desc`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), action: String(x.action), actorName: String(x.actor_name), summary: String(x.summary),
    changes: (x.changes as RevisionChange[]) ?? [], createdAt: new Date(x.created_at as string).toISOString(),
  }));
}

/** Rapports supprimés pendant la période (date de suppression) : le contenu effacé reste lisible. */
export async function deletedReports(start: string, end: string): Promise<RevisionRow[]> {
  const r = await db.execute(sql`
    select r.id::text as id, r.action, r.actor_name, r.summary, r.changes, r.created_at
    from animation_revisions r
    where r.action = 'SUPPRESSION' and r.created_at >= ${start}::date and r.created_at < ${end}::date
    order by r.created_at desc limit 50`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), action: String(x.action), actorName: String(x.actor_name), summary: String(x.summary),
    changes: (x.changes as RevisionChange[]) ?? [], createdAt: new Date(x.created_at as string).toISOString(),
  }));
}
