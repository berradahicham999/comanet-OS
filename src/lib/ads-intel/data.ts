/**
 * Couche de données de l'intelligence publicitaire : lit `ad_metrics` (dépense officielle,
 * voir `ad-spend.ts`) croisé avec le catalogue `ad_entities`. Aucune décision ici — des
 * agrégats, des séries, des bornes. Les KPI viennent de `kpis()` (`lib/ads.ts`), unique définition.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { kpis, type AdRow } from "@/lib/ads";
import type { DailyPoint, EntityLevel, EntityPerf, Range } from "./types";

export type PerfFilter = {
  brandId?: string | null;
  productId?: string | null;
  externalCampaignId?: string | null;
  externalAdsetId?: string | null;
  externalAdId?: string | null;
  externalCreativeId?: string | null;
  platform?: string | null;
  includePartial?: boolean;
  /** Ne garder que les objets dont l'état de diffusion est actif (catalogue). */
  activeOnly?: boolean;
  /** Recherche plein texte (nom de campagne, d'ensemble, de publicité, texte de créative). */
  search?: string | null;
  objective?: string | null;
};

const LEVEL_ENTITY: Record<EntityLevel, { entityLevel: string | null; key: SQL; join: SQL }> = {
  campaign: { entityLevel: "CAMPAIGN", key: sql`coalesce(m.external_campaign_id, m.platform || '|' || m.campaign_name)`, join: sql`e.level = 'CAMPAIGN' and e.external_id = m.external_campaign_id` },
  adset: { entityLevel: "ADSET", key: sql`coalesce(m.external_adset_id, m.platform || '|' || m.campaign_name || '|' || coalesce(m.adset_name, ''))`, join: sql`e.level = 'ADSET' and e.external_id = m.external_adset_id` },
  ad: { entityLevel: "AD", key: sql`coalesce(m.external_ad_id, m.platform || '|' || m.campaign_name || '|' || coalesce(m.ad_name, ''))`, join: sql`e.level = 'AD' and e.external_id = m.external_ad_id` },
  creative: { entityLevel: "CREATIVE", key: sql`coalesce(m.external_creative_id, m.external_ad_id, m.platform || '|' || coalesce(m.ad_name, m.campaign_name))`, join: sql`e.level = 'CREATIVE' and e.external_id = m.external_creative_id` },
  brand: { entityLevel: null, key: sql`coalesce(coalesce(bt.id, b.id)::text, 'none')`, join: sql`e.level = 'AD' and e.external_id = m.external_ad_id` },
  product: { entityLevel: null, key: sql`coalesce(e.product_id::text, 'none')`, join: sql`e.level = 'AD' and e.external_id = m.external_ad_id` },
};

function whereOf(range: Range, f: PerfFilter): SQL {
  const parts: SQL[] = [
    sql`m.date >= ${range.start}::date and m.date < ${range.end}::date`,
    // L'API fait foi dès qu'elle existe : un cumul importé (souvent mensuel, daté du 1er) daté après
    // la première journée lue par l'API décrirait les mêmes dépenses une seconde fois. Les imports
    // antérieurs restent l'historique.
    sql`(m.source = 'API' or m.date < coalesce((select min(x.date) from ad_metrics x where x.source = 'API' and x.platform = m.platform), '2100-01-01'::date))`,
  ];
  if (!f.includePartial) parts.push(sql`m.is_partial = false`);
  if (f.brandId) parts.push(sql`coalesce(bt.id, b.id) = ${f.brandId}::uuid`);
  if (f.platform) parts.push(sql`m.platform = ${f.platform}`);
  if (f.externalCampaignId) parts.push(sql`m.external_campaign_id = ${f.externalCampaignId}`);
  if (f.externalAdsetId) parts.push(sql`m.external_adset_id = ${f.externalAdsetId}`);
  if (f.externalAdId) parts.push(sql`m.external_ad_id = ${f.externalAdId}`);
  if (f.externalCreativeId) parts.push(sql`m.external_creative_id = ${f.externalCreativeId}`);
  if (f.productId) parts.push(sql`ea.product_id = ${f.productId}::uuid`);
  if (f.objective) parts.push(sql`coalesce(ec.objective, cs.objective) = ${f.objective}`);
  if (f.search) {
    const like = `%${f.search.trim()}%`;
    parts.push(sql`(m.campaign_name ilike ${like} or m.adset_name ilike ${like} or m.ad_name ilike ${like} or ea.body ilike ${like} or ea.title ilike ${like} or ea.name ilike ${like})`);
  }
  return sql.join(parts, sql` and `);
}

/** Jointures communes : marque (fusion comprise), catalogue publicité (produit, texte), campagne (objectif), état courant. */
const JOINS = sql`
  left join brands b on b.id = m.brand_id
  left join brands bt on bt.id = b.merged_into_id
  left join ad_entities ea on ea.platform = m.platform and ea.level = 'AD' and ea.external_id = m.external_ad_id
  left join ad_entities ec on ec.platform = m.platform and ec.level = 'CAMPAIGN' and ec.external_id = m.external_campaign_id
  left join ad_campaign_states cs on cs.platform = m.platform and cs.external_campaign_id = m.external_campaign_id
  left join ad_accounts a on a.id = m.account_id`;

function toRow(x: Record<string, unknown>, level: EntityLevel): EntityPerf {
  let tags: Record<string, string> = {};
  try { tags = x.tags ? (typeof x.tags === "string" ? JSON.parse(x.tags) : (x.tags as Record<string, string>)) : {}; } catch { tags = {}; }
  const base: AdRow = {
    key: String(x.key), platform: String(x.platform ?? "META"), campaignName: String(x.name ?? ""),
    campaignId: x.campaign_id ? String(x.campaign_id) : null,
    brandId: x.brand_id ? String(x.brand_id) : null, brandName: x.brand_name ? String(x.brand_name) : null, brandColor: x.brand_color ? String(x.brand_color) : null,
    spend: Number(x.spend), impressions: Number(x.impressions), reach: Number(x.reach), clicks: Number(x.clicks), linkClicks: Number(x.link_clicks),
    landingPageViews: Number(x.landing_page_views), leads: Number(x.leads), purchases: Number(x.purchases), messagingStarted: Number(x.messaging_started),
    revenue: Number(x.revenue), days: Number(x.days), objective: x.objective ? String(x.objective) : null,
    videoViews: Number(x.video_views ?? 0), postEngagement: Number(x.post_engagement ?? 0),
  };
  return {
    ...kpis(base),
    level,
    externalId: x.external_id ? String(x.external_id) : null,
    externalCampaignId: x.external_campaign_id ? String(x.external_campaign_id) : null,
    externalAdsetId: x.external_adset_id ? String(x.external_adset_id) : null,
    externalCreativeId: x.external_creative_id ? String(x.external_creative_id) : null,
    accountName: x.account_name ? String(x.account_name) : null,
    status: x.status ? String(x.status) : null,
    effectiveStatus: x.effective_status ? String(x.effective_status) : null,
    productId: x.product_id ? String(x.product_id) : null,
    productName: x.product_name ? String(x.product_name) : null,
    thumbnailUrl: x.thumbnail_url ? String(x.thumbnail_url) : null,
    imageUrl: x.image_url ? String(x.image_url) : null,
    title: x.title ? String(x.title) : null,
    body: x.body ? String(x.body) : null,
    tags,
    firstDay: x.first_day ? String(x.first_day) : null,
    lastDay: x.last_day ? String(x.last_day) : null,
    adCount: Number(x.ad_count ?? 0),
    hasPartial: Boolean(x.has_partial),
  };
}

/**
 * Performance agrégée par entité sur une période. La journée en cours est exclue par défaut
 * (sa dépense est là, ses résultats arrivent après).
 */
export async function perfByLevel(level: EntityLevel, range: Range, f: PerfFilter = {}): Promise<EntityPerf[]> {
  const L = LEVEL_ENTITY[level];
  const entityJoin = L.entityLevel
    ? sql`left join ad_entities e on e.platform = m.platform and ${L.join}`
    : sql`left join ad_entities e on e.platform = m.platform and ${L.join}`;
  const name =
    level === "campaign" ? sql`max(coalesce(e.name, m.campaign_name))`
      : level === "adset" ? sql`max(coalesce(e.name, m.adset_name, m.campaign_name))`
        : level === "ad" ? sql`max(coalesce(e.name, m.ad_name, m.campaign_name))`
          : level === "creative" ? sql`max(coalesce(e.title, e.name, m.ad_name, m.campaign_name))`
            : level === "brand" ? sql`max(coalesce(bt.name, b.name, 'Sans marque'))`
              : sql`max(coalesce(p.name, 'Sans produit'))`;
  const externalId =
    level === "campaign" ? sql`max(m.external_campaign_id)`
      : level === "adset" ? sql`max(m.external_adset_id)`
        : level === "ad" ? sql`max(m.external_ad_id)`
          : level === "creative" ? sql`max(m.external_creative_id)`
            : level === "brand" ? sql`max(coalesce(bt.id, b.id)::text)`
              : sql`max(e.product_id::text)`;
  const activeClause = f.activeOnly ? sql`and coalesce(e.effective_status, cs.effective_status) = 'ACTIVE'` : sql``;
  const res = await db.execute(sql`
    select ${L.key} as key, ${name} as name, ${externalId} as external_id, max(m.platform) as platform,
      max(m.campaign_id::text) as campaign_id,
      max(coalesce(bt.id, b.id)::text) as brand_id, max(coalesce(bt.name, b.name)) as brand_name, max(coalesce(bt.color, b.color)) as brand_color,
      max(m.external_campaign_id) as external_campaign_id, max(m.external_adset_id) as external_adset_id, max(m.external_creative_id) as external_creative_id,
      max(a.name) as account_name,
      max(coalesce(e.status, cs.status)) as status, max(coalesce(e.effective_status, cs.effective_status)) as effective_status,
      max(coalesce(e.objective, ec.objective, cs.objective)) as objective,
      max(coalesce(e.product_id, ea.product_id)::text) as product_id, max(coalesce(p.name, pa.name)) as product_name,
      max(coalesce(e.thumbnail_url, ea.thumbnail_url)) as thumbnail_url, max(coalesce(e.image_url, ea.image_url)) as image_url,
      max(coalesce(e.title, ea.title)) as title, max(coalesce(e.body, ea.body)) as body,
      max(coalesce(e.tags, ea.tags)::text) as tags,
      coalesce(sum(m.spend), 0)::float8 as spend,
      coalesce(sum(m.impressions), 0)::float8 as impressions,
      coalesce(sum(m.reach), 0)::float8 as reach,
      coalesce(sum(m.clicks), 0)::float8 as clicks,
      coalesce(sum(m.link_clicks), 0)::float8 as link_clicks,
      coalesce(sum(m.landing_page_views), 0)::float8 as landing_page_views,
      coalesce(sum(m.leads), 0)::float8 as leads,
      coalesce(sum(m.purchases), 0)::float8 as purchases,
      coalesce(sum(m.messaging_started), 0)::float8 as messaging_started,
      coalesce(sum(m.video_views), 0)::float8 as video_views,
      coalesce(sum(m.post_engagement), 0)::float8 as post_engagement,
      coalesce(sum(m.revenue), 0)::float8 as revenue,
      count(distinct m.date)::int as days,
      min(m.date)::text as first_day, max(m.date)::text as last_day,
      count(distinct m.external_ad_id)::int as ad_count,
      bool_or(m.is_partial) as has_partial
    from ad_metrics m
    ${JOINS}
    ${entityJoin}
    left join products p on p.id = e.product_id
    left join products pa on pa.id = ea.product_id
    where ${whereOf(range, f)} ${activeClause}
    group by 1
    order by spend desc`);
  return (res.rows as Record<string, unknown>[]).map((x) => toRow(x, level));
}

/** Série journalière d'un périmètre (journée en cours incluse, marquée par `partial`). */
export async function dailySeries(range: Range, f: PerfFilter = {}): Promise<(DailyPoint & { partial: boolean })[]> {
  const res = await db.execute(sql`
    select m.date::text as date,
      coalesce(sum(m.spend), 0)::float8 as spend, coalesce(sum(m.impressions), 0)::float8 as impressions,
      coalesce(sum(m.reach), 0)::float8 as reach, coalesce(sum(m.clicks), 0)::float8 as clicks,
      coalesce(sum(m.link_clicks), 0)::float8 as link_clicks, coalesce(sum(m.landing_page_views), 0)::float8 as landing_page_views,
      coalesce(sum(m.leads), 0)::float8 as leads, coalesce(sum(m.purchases), 0)::float8 as purchases,
      coalesce(sum(m.messaging_started), 0)::float8 as messaging_started, coalesce(sum(m.revenue), 0)::float8 as revenue,
      coalesce(sum(m.video_views), 0)::float8 as video_views, coalesce(sum(m.post_engagement), 0)::float8 as post_engagement,
      bool_or(m.is_partial) as partial
    from ad_metrics m
    ${JOINS}
    where ${whereOf(range, { ...f, includePartial: true })}
    group by 1 order by 1`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    date: String(r.date), spend: Number(r.spend), impressions: Number(r.impressions), reach: Number(r.reach), clicks: Number(r.clicks),
    linkClicks: Number(r.link_clicks), landingPageViews: Number(r.landing_page_views), leads: Number(r.leads), purchases: Number(r.purchases),
    messagingStarted: Number(r.messaging_started), revenue: Number(r.revenue), videoViews: Number(r.video_views), postEngagement: Number(r.post_engagement),
    partial: Boolean(r.partial),
  }));
}

export type MonthRow = { month: string; spend: number; impressions: number; clicks: number; linkClicks: number; landingPageViews: number; leads: number; purchases: number; messagingStarted: number; reach: number; revenue: number; videoViews: number; postEngagement: number; days: number };

/** Historique mensuel d'un périmètre, toutes années confondues (journées closes). */
export async function monthlyHistory(f: PerfFilter = {}, since = "2000-01-01"): Promise<MonthRow[]> {
  const res = await db.execute(sql`
    select to_char(m.date, 'YYYY-MM') as month,
      coalesce(sum(m.spend), 0)::float8 as spend, coalesce(sum(m.impressions), 0)::float8 as impressions,
      coalesce(sum(m.reach), 0)::float8 as reach, coalesce(sum(m.clicks), 0)::float8 as clicks,
      coalesce(sum(m.link_clicks), 0)::float8 as link_clicks, coalesce(sum(m.landing_page_views), 0)::float8 as landing_page_views,
      coalesce(sum(m.leads), 0)::float8 as leads, coalesce(sum(m.purchases), 0)::float8 as purchases,
      coalesce(sum(m.messaging_started), 0)::float8 as messaging_started, coalesce(sum(m.revenue), 0)::float8 as revenue,
      coalesce(sum(m.video_views), 0)::float8 as video_views, coalesce(sum(m.post_engagement), 0)::float8 as post_engagement,
      count(distinct m.date)::int as days
    from ad_metrics m
    ${JOINS}
    where ${whereOf({ start: since, end: "2100-01-01" }, f)}
    group by 1 order by 1`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    month: String(r.month), spend: Number(r.spend), impressions: Number(r.impressions), reach: Number(r.reach), clicks: Number(r.clicks),
    linkClicks: Number(r.link_clicks), landingPageViews: Number(r.landing_page_views), leads: Number(r.leads), purchases: Number(r.purchases),
    messagingStarted: Number(r.messaging_started), revenue: Number(r.revenue), videoViews: Number(r.video_views), postEngagement: Number(r.post_engagement), days: Number(r.days),
  }));
}

export type HistoryBounds = { firstDay: string | null; lastDay: string | null; rows: number; closedRows: number; months: string[] };

/** Sources présentes sur une plage : sert à refuser une comparaison entre un cumul importé et des journées API. */
export async function sourcesIn(range: Range, f: PerfFilter = {}): Promise<{ api: boolean; import: boolean }> {
  const res = await db.execute(sql`
    select bool_or(m.source = 'API') as api, bool_or(m.source = 'IMPORT') as imp
    from ad_metrics m ${JOINS} where ${whereOf(range, f)}`);
  const r = res.rows[0] as { api: boolean | null; imp: boolean | null } | undefined;
  return { api: Boolean(r?.api), import: Boolean(r?.imp) };
}

/** Bornes de l'historique disponible en base et liste des mois couverts. */
export async function historyBounds(f: PerfFilter = {}): Promise<HistoryBounds> {
  const res = await db.execute(sql`
    select min(m.date) filter (where not m.is_partial)::text as first_day,
           max(m.date) filter (where not m.is_partial)::text as last_day,
           count(*)::int as rows, count(*) filter (where not m.is_partial)::int as closed_rows,
           array_agg(distinct to_char(m.date, 'YYYY-MM')) as months
    from ad_metrics m
    ${JOINS}
    where ${whereOf({ start: "2000-01-01", end: "2100-01-01" }, { ...f, includePartial: true })}`);
  const r = res.rows[0] as Record<string, unknown>;
  return {
    firstDay: r.first_day ? String(r.first_day) : null, lastDay: r.last_day ? String(r.last_day) : null,
    rows: Number(r.rows ?? 0), closedRows: Number(r.closed_rows ?? 0),
    months: Array.isArray(r.months) ? (r.months as string[]).filter(Boolean).sort() : [],
  };
}

/** Sous-objets d'une entité pour le drawer (ensembles d'une campagne, publicités d'un ensemble…). */
export async function childrenOf(level: EntityLevel, externalId: string, range: Range): Promise<EntityPerf[]> {
  if (level === "campaign") return perfByLevel("adset", range, { externalCampaignId: externalId });
  if (level === "adset") return perfByLevel("ad", range, { externalAdsetId: externalId });
  if (level === "ad") return perfByLevel("creative", range, { externalAdId: externalId });
  if (level === "product") return perfByLevel("ad", range, { productId: externalId });
  if (level === "brand") return perfByLevel("campaign", range, { brandId: externalId });
  return [];
}

export type FreshnessRow = { name: string; status: string; lastSyncAt: string | null; error: string | null; syncing: boolean };

/** Dernière synchronisation réussie (journal), dernière erreur, comptes. */
export async function syncStatus(): Promise<{ lastSuccessfulSync: string | null; lastSyncError: string | null; accounts: FreshnessRow[] }> {
  const [acc, log] = await Promise.all([
    db.execute(sql`
      select a.name, a.sync_status, a.last_error, a.last_sync_at::text as last_sync_at,
             (a.sync_started_at is not null and a.sync_started_at > now() - interval '10 minutes') as syncing
      from ad_accounts a where a.platform = 'META' and a.sync_enabled = true order by a.name`),
    db.execute(sql`
      select max(finished_at) filter (where ok and mode in ('full','intraday'))::text as last_ok,
             (select error from ad_sync_log where not ok order by finished_at desc limit 1) as last_error
      from ad_sync_log`).catch(() => ({ rows: [{ last_ok: null, last_error: null }] })),
  ]);
  const l = log.rows[0] as { last_ok: string | null; last_error: string | null } | undefined;
  return {
    lastSuccessfulSync: l?.last_ok ? String(l.last_ok) : null,
    lastSyncError: l?.last_error ? String(l.last_error) : null,
    accounts: (acc.rows as Record<string, unknown>[]).map((r) => ({
      name: String(r.name), status: String(r.sync_status), lastSyncAt: r.last_sync_at ? String(r.last_sync_at) : null,
      error: r.last_error ? String(r.last_error) : null, syncing: Boolean(r.syncing),
    })),
  };
}
