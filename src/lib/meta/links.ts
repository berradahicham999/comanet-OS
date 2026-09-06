/**
 * Rattachement des campagnes de régie aux campagnes COMANET.
 *
 * Les noms de campagne Meta ne suivent aucune convention (« gamarde », « TOF auracos march_26 »,
 * « Post: "…" » pour les publications boostées) et plusieurs marques cohabitent dans un même
 * compte : le rapprochement automatique par nom ne peut pas être fiable. On l'assume — c'est
 * Hicham qui rattache, une fois, et le lien porte sur l'identifiant Meta, stable au renommage.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type LinkedAdCampaign = {
  linkId: string;
  campaignId: string;
  externalCampaignId: string | null;
  name: string;
  platform: string;
  accountName: string | null;
  spend: number;
  purchases: number;
  revenue: number;
  rows: number;
  firstDay: string | null;
  lastDay: string | null;
};

/** Campagnes de régie déjà rattachées à une campagne COMANET, avec ce qu'elles ont coûté. */
export async function linkedAdCampaigns(campaignId: string): Promise<LinkedAdCampaign[]> {
  const res = await db.execute(sql`
    select l.id as link_id, l.campaign_id, l.external_campaign_id, l.external_campaign_name as name,
           l.platform, a.name as account_name,
           coalesce(sum(m.spend), 0)::float8 as spend,
           coalesce(sum(m.purchases), 0)::int as purchases,
           coalesce(sum(m.revenue), 0)::float8 as revenue,
           count(m.id)::int as rows,
           min(m.date)::text as first_day, max(m.date)::text as last_day
    from campaign_ad_links l
    left join ad_accounts a on a.id = l.account_id
    left join ad_metrics m
      on m.platform = l.platform
     and (
       (l.external_campaign_id is not null and m.external_campaign_id = l.external_campaign_id)
       or (l.external_campaign_id is null and upper(btrim(m.campaign_name)) = l.match_key)
     )
    where l.campaign_id = ${campaignId}::uuid
    group by l.id, l.campaign_id, l.external_campaign_id, l.external_campaign_name, l.platform, a.name
    order by spend desc`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    linkId: String(r.link_id), campaignId: String(r.campaign_id),
    externalCampaignId: r.external_campaign_id ? String(r.external_campaign_id) : null,
    name: String(r.name), platform: String(r.platform),
    accountName: r.account_name ? String(r.account_name) : null,
    spend: Number(r.spend), purchases: Number(r.purchases), revenue: Number(r.revenue),
    rows: Number(r.rows),
    firstDay: r.first_day ? String(r.first_day) : null,
    lastDay: r.last_day ? String(r.last_day) : null,
  }));
}

export type LinkCandidate = {
  externalCampaignId: string | null;
  name: string;
  platform: string;
  accountName: string | null;
  accountId: string | null;
  brandName: string | null;
  spend: number;
  rows: number;
  lastDay: string | null;
  /** Vrai si la marque déduite du nom correspond à celle de la campagne COMANET. */
  suggested: boolean;
};

/**
 * Campagnes de régie observées dans `ad_metrics` et non encore rattachées.
 *
 * On lit les données déjà en base plutôt que d'interroger Meta : la liste reste consultable
 * sans jeton, et elle couvre aussi bien les lignes importées par fichier que celles remontées
 * par l'API. Triées par dépense — le premier écran doit montrer ce qui pèse.
 */
export async function linkCandidates(brandId: string, opts?: { search?: string; limit?: number }): Promise<LinkCandidate[]> {
  const search = opts?.search?.trim();
  const limit = opts?.limit ?? 60;
  const res = await db.execute(sql`
    select m.external_campaign_id, max(m.campaign_name) as name, m.platform,
           max(a.name) as account_name, max(m.account_id::text) as account_id,
           max(b.name) as brand_name,
           bool_or(m.brand_id = ${brandId}::uuid) as suggested,
           coalesce(sum(m.spend), 0)::float8 as spend,
           count(*)::int as rows, max(m.date)::text as last_day
    from ad_metrics m
    left join ad_accounts a on a.id = m.account_id
    left join brands b on b.id = m.brand_id
    where m.campaign_id is null
      and not exists (
        select 1 from campaign_ad_links l
        where l.platform = m.platform
          and l.match_key = coalesce(m.external_campaign_id, upper(btrim(m.campaign_name)))
      )
      ${search ? sql`and m.campaign_name ilike ${"%" + search + "%"}` : sql``}
    group by m.external_campaign_id, m.platform, coalesce(m.external_campaign_id, upper(btrim(m.campaign_name)))
    order by suggested desc nulls last, spend desc
    limit ${limit}`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    externalCampaignId: r.external_campaign_id ? String(r.external_campaign_id) : null,
    name: String(r.name), platform: String(r.platform),
    accountName: r.account_name ? String(r.account_name) : null,
    accountId: r.account_id ? String(r.account_id) : null,
    brandName: r.brand_name ? String(r.brand_name) : null,
    spend: Number(r.spend), rows: Number(r.rows),
    lastDay: r.last_day ? String(r.last_day) : null,
    suggested: Boolean(r.suggested),
  }));
}

/**
 * Clé de nom, volontairement simple : elle doit être calculable à l'identique en SQL
 * (`upper(btrim(campaign_name))`). Une normalisation plus riche (accents, séparateurs)
 * divergerait entre TypeScript et Postgres, et le rattachement serait silencieusement perdu.
 */
export function nameKey(name: string): string {
  return name.trim().toUpperCase();
}

/** Clé de rattachement : l'identifiant de régie s'il est connu, la clé de nom sinon. */
export function matchKeyFor(externalCampaignId: string | null, name: string): string {
  return externalCampaignId ?? nameKey(name);
}

/**
 * Applique un rattachement à l'historique déjà en base.
 *
 * Sans ce rappel, seules les lignes synchronisées APRÈS le rattachement porteraient la
 * campagne : Hicham verrait un rattachement sans chiffres.
 */
export async function backfillLink(params: {
  campaignId: string;
  platform: string;
  externalCampaignId: string | null;
  externalCampaignName: string;
}): Promise<number> {
  const { campaignId, platform, externalCampaignId, externalCampaignName } = params;
  const res = await db.execute(sql`
    update ad_metrics m
    set campaign_id = ${campaignId}::uuid,
        brand_id = coalesce(m.brand_id, (select brand_id from campaigns where id = ${campaignId}::uuid))
    where m.platform = ${platform}
      and ${externalCampaignId
        ? sql`m.external_campaign_id = ${externalCampaignId}`
        : sql`upper(btrim(m.campaign_name)) = ${nameKey(externalCampaignName)}`}
    returning m.id`);
  return res.rows.length;
}

/** Retire le rattachement : les lignes redeviennent analysables par nom, sans campagne. */
export async function clearLink(linkId: string): Promise<number> {
  const res = await db.execute(sql`
    with l as (delete from campaign_ad_links where id = ${linkId}::uuid returning *)
    update ad_metrics m
    set campaign_id = null
    from l
    where m.platform = l.platform
      and (
        (l.external_campaign_id is not null and m.external_campaign_id = l.external_campaign_id)
        or (l.external_campaign_id is null and upper(btrim(m.campaign_name)) = l.match_key)
      )
    returning m.id`);
  return res.rows.length;
}
