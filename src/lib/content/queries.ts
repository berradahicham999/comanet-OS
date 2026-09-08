import "server-only";
import { pgArray } from "@/lib/sql-array";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { iso, addDays } from "@/lib/format";
import type { ContentRefs } from "./shared";
import { lateness } from "./shared";

export type ContentFilters = {
  start: string; end: string; // ISO, fin exclusive
  brandIds?: string[] | null; // portée (null = tout)
  brand?: string | null; platform?: string | null; format?: string | null; status?: string | null; responsible?: string | null;
  includeArchived?: boolean;
};

export type ContentCard = {
  id: string; date: string; publishTime: string | null; deadline: string | null; title: string;
  brandId: string; brand: string; color: string; platform: string | null; format: string | null; objective: string | null; status: string;
  responsibleId: string | null; responsible: string | null; validatorId: string | null; productId: string | null; product: string | null;
  productCount: number; hasDeliverable: boolean; hasCaption: boolean; link: string | null;
  late: "LIVRABLE" | "PUBLICATION" | null;
};

/** Contenus d'une période, filtrés. Une requête, indexée sur (brand_id, date). */
export async function listContents(f: ContentFilters, refs: ContentRefs, todayIso = iso(new Date())): Promise<ContentCard[]> {
  const r = await db.execute<Omit<ContentCard, "late">>(sql`
    select c.id, c.date::text as date, c.publish_time::text as "publishTime", c.deadline::text as deadline, c.title,
      c.brand_id as "brandId", b.name as brand, b.color, c.platform, c.format, c.objective, c.status,
      c.responsible_id as "responsibleId", u.name as responsible, c.validator_id as "validatorId",
      c.product_id as "productId", p.name as product,
      (select count(*) from content_products cp where cp.content_id = c.id)::int as "productCount",
      exists (select 1 from content_assets a where a.content_id = c.id and a.kind = 'LIVRABLE') as "hasDeliverable",
      coalesce(c.caption, '') <> '' as "hasCaption", c.link
    from content_items c
    join brands b on b.id = c.brand_id
    left join users u on u.id = c.responsible_id
    left join products p on p.id = c.product_id
    where c.date >= ${f.start}::date and c.date < ${f.end}::date
      ${f.brandIds ? sql`and c.brand_id = any(${pgArray(f.brandIds)})` : sql``}
      ${f.brand ? sql`and c.brand_id = ${f.brand}::uuid` : sql``}
      ${f.platform ? sql`and c.platform = ${f.platform}` : sql``}
      ${f.format ? sql`and c.format = ${f.format}` : sql``}
      ${f.status ? sql`and c.status = ${f.status}` : sql``}
      ${f.responsible ? sql`and c.responsible_id = ${f.responsible}::uuid` : sql``}
      ${f.includeArchived ? sql`` : sql`and c.status not in (select key from content_statuses where is_archived)`}
    order by c.date, c.publish_time nulls last, b.name, c.title`);
  return r.rows.map((x) => ({ ...x, late: lateness({ date: x.date, deadline: x.deadline, status: x.status, hasDeliverable: x.hasDeliverable }, refs.statuses, todayIso) }));
}

export type PeriodIndicators = {
  planned: number; published: number; late: number; awaiting: number;
  byBrand: { brandId: string; brand: string; color: string; n: number }[];
  /** Marques actives sans aucun contenu sur les 7 prochains jours. */
  silentBrands: { id: string; name: string; color: string }[];
};

export function indicators(cards: ContentCard[], refs: ContentRefs, brands: { id: string; name: string; color: string; active: boolean }[], todayIso: string): PeriodIndicators {
  const st = new Map(refs.statuses.map((s) => [s.key, s]));
  const byBrand = new Map<string, { brandId: string; brand: string; color: string; n: number }>();
  for (const c of cards) {
    const e = byBrand.get(c.brandId) ?? { brandId: c.brandId, brand: c.brand, color: c.color, n: 0 };
    e.n++; byBrand.set(c.brandId, e);
  }
  const weekEnd = iso(addDays(new Date(todayIso + "T12:00:00Z"), 7));
  const covered = new Set(cards.filter((c) => c.date >= todayIso && c.date < weekEnd).map((c) => c.brandId));
  return {
    planned: cards.filter((c) => !st.get(c.status)?.isPublished && !st.get(c.status)?.isArchived).length,
    published: cards.filter((c) => st.get(c.status)?.isPublished).length,
    late: cards.filter((c) => c.late).length,
    awaiting: cards.filter((c) => st.get(c.status)?.awaitingValidation).length,
    byBrand: [...byBrand.values()].sort((a, b) => b.n - a.n),
    silentBrands: brands.filter((b) => b.active && !covered.has(b.id)).map((b) => ({ id: b.id, name: b.name, color: b.color })),
  };
}

/** Contenus en attente de validation (file du DG), dans la portée donnée. */
export async function validationQueue(brandIds: string[] | null) {
  const r = await db.execute<{ id: string; date: string; title: string; brand: string; color: string; brandId: string; platform: string | null; format: string | null; caption: string | null; hashtags: string | null; responsible: string | null; since: string; assetId: string | null; assetMime: string | null; assetName: string | null }>(sql`
    select c.id, c.date::text as date, c.title, b.name as brand, b.color, c.brand_id as "brandId", c.platform, c.format, c.caption, c.hashtags, u.name as responsible,
      coalesce((select max(h.created_at) from content_status_history h where h.content_id = c.id and h.to_status = c.status), c.updated_at)::text as since,
      a.id as "assetId", a.mime as "assetMime", a.name as "assetName"
    from content_items c join brands b on b.id = c.brand_id left join users u on u.id = c.responsible_id
    left join lateral (select id, mime, name from content_assets x where x.content_id = c.id and x.kind = 'LIVRABLE' order by version desc limit 1) a on true
    where c.status in (select key from content_statuses where awaiting_validation)
      ${brandIds ? sql`and c.brand_id = any(${pgArray(brandIds)})` : sql``}
    order by since asc`);
  return r.rows;
}
