/**
 * Ce que la régie dit de l'instant présent : fraîcheur de la synchronisation, journée en
 * cours, état de diffusion des campagnes.
 *
 * Séparé de `src/lib/ads.ts`, qui compare des périodes closes. Ici rien n'est comparé à rien :
 * on montre des chiffres bruts, datés, explicitement non définitifs. Aucune projection de fin
 * de journée — une dépense de 11 h n'annonce pas la dépense de minuit.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type AccountFreshness = {
  id: string;
  name: string;
  currency: string;
  timezone: string | null;
  syncStatus: string;
  lastError: string | null;
  /** Fin de la dernière synchronisation, réussie ou non. */
  lastSyncAt: string | null;
  /** Vrai si une synchronisation est en cours en ce moment même. */
  syncing: boolean;
  /** Nombre de lignes de la journée en cours pour ce compte. */
  todayRows: number;
};

/** Comptes activés pour la synchronisation, avec l'état du dernier passage. */
export async function accountsFreshness(): Promise<AccountFreshness[]> {
  const res = await db.execute(sql`
    select a.id, a.name, a.currency, a.timezone, a.sync_status, a.last_error,
           a.last_sync_at::text as last_sync_at,
           (a.sync_started_at is not null and a.sync_started_at > now() - interval '10 minutes') as syncing,
           coalesce((select count(*) from ad_metrics m where m.account_id = a.id and m.is_partial), 0)::int as today_rows
    from ad_accounts a
    where a.platform = 'META' and a.sync_enabled = true
    order by a.name`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), name: String(r.name), currency: String(r.currency),
    timezone: r.timezone ? String(r.timezone) : null,
    syncStatus: String(r.sync_status),
    lastError: r.last_error ? String(r.last_error) : null,
    lastSyncAt: r.last_sync_at ? String(r.last_sync_at) : null,
    syncing: Boolean(r.syncing),
    todayRows: Number(r.today_rows),
  }));
}

export type IntradayTotals = {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  revenue: number;
  /** Heure du dernier relevé — c'est l'heure à laquelle ces chiffres se sont arrêtés. */
  syncedAt: string | null;
  /** Journée(s) concernée(s) : plusieurs si des comptes sont dans des fuseaux différents. */
  dates: string[];
};

type Filter = { brandId?: string | null; platform?: string | null };

/** Cumul de la journée en cours. Non définitif par construction : les conversions arrivent après. */
export async function intradayTotals(filter?: Filter): Promise<IntradayTotals | null> {
  const res = await db.execute(sql`
    select coalesce(sum(m.spend), 0)::float8 as spend,
           coalesce(sum(m.impressions), 0)::float8 as impressions,
           coalesce(sum(case when m.link_clicks > 0 then m.link_clicks else m.clicks end), 0)::float8 as clicks,
           coalesce(sum(m.purchases), 0)::int as purchases,
           coalesce(sum(m.revenue), 0)::float8 as revenue,
           max(m.synced_at)::text as synced_at,
           array_agg(distinct m.date::text) as dates
    from ad_metrics m
    where m.is_partial = true
      ${filter?.brandId ? sql`and m.brand_id = ${filter.brandId}::uuid` : sql``}
      ${filter?.platform ? sql`and m.platform = ${filter.platform}` : sql``}`);
  const r = res.rows[0] as Record<string, unknown> | undefined;
  if (!r || !r.synced_at) return null;
  return {
    spend: Number(r.spend), impressions: Number(r.impressions), clicks: Number(r.clicks),
    purchases: Number(r.purchases), revenue: Number(r.revenue),
    syncedAt: String(r.synced_at),
    dates: Array.isArray(r.dates) ? (r.dates as string[]).filter(Boolean) : [],
  };
}

export type LiveCampaign = {
  externalCampaignId: string;
  name: string;
  accountName: string | null;
  status: string;
  effectiveStatus: string | null;
  /** Budget quotidien en MAD, converti au taux saisi. `null` = budget porté par les ensembles. */
  dailyBudget: number | null;
  budgetRemaining: number | null;
  fetchedAt: string | null;
  spendToday: number;
  purchasesToday: number;
  revenueToday: number;
  impressionsToday: number;
  /** Part du budget quotidien déjà consommée (0–1+). `null` si aucun budget au niveau campagne. */
  budgetPace: number | null;
};

/**
 * État de diffusion des campagnes, croisé avec ce qu'elles ont dépensé aujourd'hui.
 *
 * La liste part des états relevés, pas des dépenses : une campagne active qui n'a rien dépensé
 * depuis ce matin est précisément ce qu'il faut voir. L'inverse (dépenses sans état) n'arrive
 * que pour les comptes alimentés par import fichier, qui n'ont pas d'état courant.
 */
export async function liveCampaigns(filter?: Filter): Promise<LiveCampaign[]> {
  const res = await db.execute(sql`
    select s.external_campaign_id, s.name, s.status, s.effective_status,
           s.daily_budget::float8 as daily_budget, s.budget_remaining::float8 as budget_remaining,
           s.fetched_at::text as fetched_at, a.name as account_name,
           coalesce(t.spend, 0)::float8 as spend_today,
           coalesce(t.purchases, 0)::int as purchases_today,
           coalesce(t.revenue, 0)::float8 as revenue_today,
           coalesce(t.impressions, 0)::float8 as impressions_today
    from ad_campaign_states s
    left join ad_accounts a on a.id = s.account_id
    left join (
      select m.external_campaign_id,
             sum(m.spend)::float8 as spend, sum(m.purchases)::int as purchases,
             sum(m.revenue)::float8 as revenue, sum(m.impressions)::float8 as impressions
      from ad_metrics m
      where m.is_partial = true
        ${filter?.brandId ? sql`and m.brand_id = ${filter.brandId}::uuid` : sql``}
      group by m.external_campaign_id
    ) t on t.external_campaign_id = s.external_campaign_id
    where s.platform = 'META'
      ${filter?.platform && filter.platform !== "META" ? sql`and false` : sql``}
      ${filter?.brandId
        ? sql`and exists (select 1 from ad_metrics m2
              where m2.external_campaign_id = s.external_campaign_id and m2.brand_id = ${filter.brandId}::uuid)`
        : sql``}
    order by spend_today desc, s.name`);
  return (res.rows as Record<string, unknown>[]).map((r) => {
    const dailyBudget = r.daily_budget === null ? null : Number(r.daily_budget);
    const spendToday = Number(r.spend_today);
    return {
      externalCampaignId: String(r.external_campaign_id),
      name: String(r.name),
      accountName: r.account_name ? String(r.account_name) : null,
      status: String(r.status),
      effectiveStatus: r.effective_status ? String(r.effective_status) : null,
      dailyBudget,
      budgetRemaining: r.budget_remaining === null ? null : Number(r.budget_remaining),
      fetchedAt: r.fetched_at ? String(r.fetched_at) : null,
      spendToday,
      purchasesToday: Number(r.purchases_today),
      revenueToday: Number(r.revenue_today),
      impressionsToday: Number(r.impressions_today),
      budgetPace: dailyBudget && dailyBudget > 0 ? spendToday / dailyBudget : null,
    };
  });
}
