/**
 * Synchronisation Meta → `ad_metrics`.
 *
 * Mêmes règles que le moteur d'import fichier : idempotent (clé de dédoublonnage stable +
 * `onConflictDoUpdate`), par lots, et jamais d'écrasement par du vide. La différence tient
 * en quatre points propres à l'API :
 *
 *  - **Fenêtre glissante.** Meta révise ses conversions plusieurs jours après coup (fenêtre
 *    d'attribution). Une synchro qui ne relirait que la veille figerait des chiffres faux :
 *    on relit `metaSyncWindowDays` jours à chaque passage complet et l'upsert corrige.
 *  - **Journée en cours.** Le passage `intraday` ne relit que la veille et le jour même, et
 *    marque les lignes du jour `is_partial` : la dépense est déjà là, les conversions arrivent
 *    après. Ces lignes sont exclues des moyennes et des comparaisons, jamais extrapolées.
 *  - **Devise.** Les comptes COMANET facturent en EUR et en USD. `spend`/`revenue` restent
 *    en MAD ; la conversion utilise un taux SAISI dans les paramètres, jamais deviné, et
 *    l'original est conservé pour l'audit. Sans taux, le compte est refusé.
 *  - **Autorité.** Sur une période synchronisée par l'API, les lignes du même compte issues
 *    d'un import fichier sont supprimées : elles décriraient les mêmes journées avec une clé
 *    de dédoublonnage différente (nom vs identifiant), donc en double.
 */
import { sql, and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { adMetrics, adCampaignStates, brands } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { matchBrandInText } from "@/lib/import/match";
import { nameKey } from "./links";
import { fetchInsights, getAccount, listCampaigns, minorToMajor, MetaError } from "./client";

export type SyncAccount = {
  id: string;
  name: string;
  externalId: string;
  brandId: string | null;
  currency: string;
};

/**
 * `full` relit toute la fenêtre d'attribution (passage de nuit) ; `intraday` ne relit que la
 * veille et le jour même (passage horaire). Séparer les deux évite de consommer le quota de
 * l'API à relire 28 jours toutes les heures pour deux journées qui bougent.
 */
export type SyncMode = "full" | "intraday";

export type SyncResult = {
  accountId: string;
  accountName: string;
  ok: boolean;
  /** Vrai si une synchronisation était déjà en cours sur ce compte : rien n'a été fait. */
  skipped: boolean;
  mode: SyncMode;
  days: number;
  rows: number;
  linkedRows: number;
  unbrandedRows: number;
  replacedImportRows: number;
  campaignStates: number;
  currency: string;
  fxRate: number | null;
  error: string | null;
};

const BATCH = 500;

/** Au-delà, un verrou est considéré comme abandonné (fonction interrompue, déploiement). */
const LOCK_TIMEOUT = "10 minutes";

/** Décale une date ISO de `days` jours (négatif pour reculer). */
function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Date du jour dans le fuseau du compte publicitaire.
 *
 * Meta découpe ses journées dans le fuseau du COMPTE, pas dans celui du serveur ni dans
 * `Africa/Casablanca`. Un compte à Los Angeles est encore la veille quand il est 2 h à
 * Casablanca : marquer la mauvaise journée « en cours » figerait une journée incomplète.
 */
export function todayInTimezone(tz: string | null | undefined, now = new Date()): string {
  if (!tz) return now.toISOString().slice(0, 10);
  try {
    // `en-CA` produit exactement AAAA-MM-JJ, le format des colonnes `date`.
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    // Fuseau inconnu de l'environnement : on retombe sur UTC plutôt que d'échouer.
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Fenêtre à resynchroniser, bornes incluses. `today` est la date du jour dans le fuseau du
 * compte. La journée en cours est incluse dans les deux modes : elle est marquée partielle,
 * ce qui la rend affichable sans polluer les moyennes.
 */
export function syncWindow(windowDays: number, mode: SyncMode, today: string): { since: string; until: string } {
  if (mode === "intraday") return { since: shift(today, -1), until: today };
  return { since: shift(today, -(windowDays - 1)), until: today };
}

/**
 * Taux vers le MAD pour une devise. `null` = non configuré : l'appelant doit refuser plutôt
 * que d'inventer un montant.
 */
function fxRateFor(currency: string, rates: Record<string, number>): number | null {
  const cur = currency.toUpperCase();
  if (cur === "MAD") return 1;
  const r = rates[cur];
  return typeof r === "number" && r > 0 ? r : null;
}

/**
 * Pose le verrou de façon atomique : c'est le `update … returning` lui-même qui arbitre entre
 * deux appels simultanés. Un test suivi d'une écriture laisserait passer les deux.
 */
async function claimLock(accountId: string): Promise<boolean> {
  const res = await db.execute(sql`
    update ad_accounts set sync_started_at = now()
    where id = ${accountId}::uuid
      and (sync_started_at is null or sync_started_at < now() - interval '${sql.raw(LOCK_TIMEOUT)}')
    returning id`);
  return res.rows.length > 0;
}

async function releaseLock(accountId: string): Promise<void> {
  await db.execute(sql`update ad_accounts set sync_started_at = null where id = ${accountId}::uuid`);
}

type LinkRow = { campaign_id: string; external_campaign_id: string | null; match_key: string; brand_id: string };

/** Rattachements déclarés pour Meta : par identifiant externe d'abord, par nom normalisé sinon. */
async function loadLinks(): Promise<{ byExternalId: Map<string, LinkRow>; byName: Map<string, LinkRow> }> {
  const res = await db.execute(sql`
    select l.campaign_id, l.external_campaign_id, l.match_key, c.brand_id
    from campaign_ad_links l join campaigns c on c.id = l.campaign_id
    where l.platform = 'META'`);
  const byExternalId = new Map<string, LinkRow>();
  const byName = new Map<string, LinkRow>();
  for (const row of res.rows as LinkRow[]) {
    if (row.external_campaign_id) byExternalId.set(row.external_campaign_id, row);
    else byName.set(row.match_key, row);
  }
  return { byExternalId, byName };
}

async function loadBrands() {
  const rows = await db.select({ id: brands.id, name: brands.name, aliases: brands.aliases }).from(brands);
  return rows.map((b) => ({ id: b.id, name: b.name, aliases: Array.isArray(b.aliases) ? b.aliases : [] }));
}

/** Date Meta (ISO) → `Date`, ou `null` si absente ou illisible. Une date fausse serait pire que rien. */
function parseTime(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Relève l'état de diffusion et les budgets des campagnes du compte.
 *
 * C'est ce que les insights ne disent pas : une campagne en pause ou à budget épuisé ne
 * remonte aucune ligne, elle disparaît simplement des chiffres. Les budgets sont convertis
 * en MAD avec le même taux saisi que les dépenses, et le montant d'origine est conservé.
 */
async function syncCampaignStates(account: SyncAccount, currency: string, fxRate: number): Promise<number> {
  const remote = await listCampaigns(account.externalId);
  if (remote.length === 0) {
    // Plus aucune campagne active : les états gardés en base ne décrivent plus rien.
    await db.delete(adCampaignStates).where(and(eq(adCampaignStates.platform, "META"), eq(adCampaignStates.accountId, account.id)));
    return 0;
  }

  const toMad = (minor: number | null): string | null =>
    minor === null ? null : (minorToMajor(minor, currency) * fxRate).toFixed(2);

  const values = remote.map((c) => ({
    platform: "META",
    externalCampaignId: c.id,
    accountId: account.id,
    name: c.name,
    status: c.status,
    effectiveStatus: c.effectiveStatus,
    objective: c.objective,
    dailyBudget: toMad(c.dailyBudgetMinor),
    lifetimeBudget: toMad(c.lifetimeBudgetMinor),
    budgetRemaining: toMad(c.budgetRemainingMinor),
    dailyBudgetOriginal: c.dailyBudgetMinor === null ? null : minorToMajor(c.dailyBudgetMinor, currency).toFixed(2),
    currency,
    fxRate: fxRate.toFixed(6),
    startTime: parseTime(c.startTime),
    stopTime: parseTime(c.stopTime),
    fetchedAt: new Date(),
  }));

  for (let i = 0; i < values.length; i += BATCH) {
    await db.insert(adCampaignStates).values(values.slice(i, i + BATCH)).onConflictDoUpdate({
      target: [adCampaignStates.platform, adCampaignStates.externalCampaignId],
      set: {
        accountId: sql`excluded.account_id`, name: sql`excluded.name`,
        status: sql`excluded.status`, effectiveStatus: sql`excluded.effective_status`,
        objective: sql`excluded.objective`,
        dailyBudget: sql`excluded.daily_budget`, lifetimeBudget: sql`excluded.lifetime_budget`,
        budgetRemaining: sql`excluded.budget_remaining`,
        dailyBudgetOriginal: sql`excluded.daily_budget_original`,
        currency: sql`excluded.currency`, fxRate: sql`excluded.fx_rate`,
        startTime: sql`excluded.start_time`, stopTime: sql`excluded.stop_time`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });
  }

  // Une campagne archivée depuis le dernier passage n'a plus d'état courant à afficher.
  await db.delete(adCampaignStates).where(and(
    eq(adCampaignStates.platform, "META"),
    eq(adCampaignStates.accountId, account.id),
    notInArray(adCampaignStates.externalCampaignId, remote.map((c) => c.id)),
  ));

  return remote.length;
}

/**
 * Synchronise un compte publicitaire sur une fenêtre. Ne lève pas : l'erreur est retournée
 * dans le résultat et écrite sur le compte, pour qu'un compte en panne n'arrête pas les autres.
 */
export async function syncAccount(
  account: SyncAccount,
  opts?: { since?: string; until?: string; mode?: SyncMode },
): Promise<SyncResult> {
  const mode: SyncMode = opts?.mode ?? "full";
  const settings = await getSettings();
  const base: SyncResult = {
    accountId: account.id, accountName: account.name, ok: false, skipped: false, mode,
    days: 0, rows: 0, linkedRows: 0, unbrandedRows: 0, replacedImportRows: 0, campaignStates: 0,
    currency: account.currency, fxRate: null, error: null,
  };

  const fail = async (message: string): Promise<SyncResult> => {
    await db.execute(sql`
      update ad_accounts set sync_status = 'ERROR', last_error = ${message}, last_sync_at = now()
      where id = ${account.id}::uuid`);
    return { ...base, error: message };
  };

  // Le cron horaire et le bouton « Actualiser » peuvent tomber sur le même compte au même
  // moment : le second repart sans rien faire plutôt que de payer une seconde fois le quota.
  if (!(await claimLock(account.id))) {
    return { ...base, ok: true, skipped: true };
  }

  try {
    // Le compte peut avoir changé de devise ou de fuseau côté Meta : on relit avant de convertir.
    const remote = await getAccount(account.externalId);
    const currency = remote.currency || account.currency;
    const fxRate = fxRateFor(currency, settings.fxRates);
    if (fxRate === null) {
      return await fail(
        `Devise ${currency} : aucun taux de conversion vers le MAD n'est renseigné. ` +
        `Ajoutez-le dans Paramètres → Taux de change, sinon les dépenses seraient inventées.`,
      );
    }

    await db.execute(sql`
      update ad_accounts
      set currency = ${currency}, timezone = ${remote.timezone}, business_id = ${remote.businessId},
          business_name = ${remote.businessName}, name = ${remote.name}
      where id = ${account.id}::uuid`);

    // La journée « en cours » est celle du compte publicitaire, pas celle du serveur.
    const today = todayInTimezone(remote.timezone);
    const window = syncWindow(settings.metaSyncWindowDays, mode, today);
    const since = opts?.since ?? window.since;
    const until = opts?.until ?? window.until;
    const attribution = settings.metaAttributionWindow;

    const campaignStates = await syncCampaignStates(account, currency, fxRate);
    const insights = await fetchInsights(account.externalId, since, until, attribution, "ad");
    if (insights.length === 0) {
      await db.execute(sql`
        update ad_accounts set sync_status = 'OK', last_error = null, last_sync_at = now(),
          currency = ${currency}
        where id = ${account.id}::uuid`);
      return { ...base, ok: true, currency, fxRate, campaignStates };
    }

    const [{ byExternalId, byName }, brandList] = await Promise.all([loadLinks(), loadBrands()]);

    type Row = typeof adMetrics.$inferInsert;
    const batch: Row[] = [];
    const seen = new Set<string>();
    const days = new Set<string>();
    const syncedAt = new Date();
    let linkedRows = 0;
    let unbrandedRows = 0;

    const flush = async () => {
      if (!batch.length) return;
      await db.insert(adMetrics).values(batch).onConflictDoUpdate({
        target: adMetrics.dedupeKey,
        set: {
          spend: sql`excluded.spend`, impressions: sql`excluded.impressions`, reach: sql`excluded.reach`,
          clicks: sql`excluded.clicks`, linkClicks: sql`excluded.link_clicks`,
          landingPageViews: sql`excluded.landing_page_views`, leads: sql`excluded.leads`,
          purchases: sql`excluded.purchases`, revenue: sql`excluded.revenue`,
          spendOriginal: sql`excluded.spend_original`, revenueOriginal: sql`excluded.revenue_original`,
          currency: sql`excluded.currency`, fxRate: sql`excluded.fx_rate`,
          attributionWindow: sql`excluded.attribution_window`,
          // La veille relue le lendemain est une journée close : le drapeau doit retomber.
          isPartial: sql`excluded.is_partial`,
          syncedAt: sql`excluded.synced_at`,
          // Le rattachement peut avoir été fait à la main : ne jamais l'effacer avec du vide.
          campaignId: sql`coalesce(excluded.campaign_id, ad_metrics.campaign_id)`,
          brandId: sql`coalesce(excluded.brand_id, ad_metrics.brand_id)`,
          campaignName: sql`excluded.campaign_name`,
          adsetName: sql`coalesce(excluded.adset_name, ad_metrics.adset_name)`,
          adName: sql`coalesce(excluded.ad_name, ad_metrics.ad_name)`,
          externalCampaignId: sql`excluded.external_campaign_id`,
          externalAdsetId: sql`coalesce(excluded.external_adset_id, ad_metrics.external_adset_id)`,
          externalAdId: sql`coalesce(excluded.external_ad_id, ad_metrics.external_ad_id)`,
          source: sql`excluded.source`,
        },
      });
      batch.length = 0;
    };

    for (const r of insights) {
      // Une même publicité ne peut apparaître qu'une fois par jour ; l'API peut répéter une
      // ligne entre deux pages si un objet bouge pendant la pagination.
      const dedupeKey = ["META", r.date, r.campaignId, r.adsetId ?? "", r.adId ?? ""].join("|");
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      days.add(r.date);

      const link = byExternalId.get(r.campaignId) ?? byName.get(nameKey(r.campaignName)) ?? null;
      // Marque : le rattachement fait foi, sinon la marque citée dans le nom de campagne,
      // sinon celle du compte. Les posts boostés (« Post: "…" ») restent souvent sans marque.
      const brandId = link?.brand_id ?? matchBrandInText(r.campaignName, brandList) ?? account.brandId ?? null;
      if (link) linkedRows++;
      if (!brandId) unbrandedRows++;

      batch.push({
        date: r.date, platform: "META", accountId: account.id, brandId,
        campaignId: link?.campaign_id ?? null,
        campaignName: r.campaignName, adsetName: r.adsetName, adName: r.adName,
        externalCampaignId: r.campaignId, externalAdsetId: r.adsetId, externalAdId: r.adId,
        spend: (r.spend * fxRate).toFixed(2),
        impressions: r.impressions, reach: r.reach, clicks: r.clicks, linkClicks: r.linkClicks,
        landingPageViews: r.landingPageViews, leads: r.leads, purchases: r.purchases,
        revenue: (r.revenue * fxRate).toFixed(2),
        spendOriginal: r.spend.toFixed(2), revenueOriginal: r.revenue.toFixed(2),
        currency, fxRate: fxRate.toFixed(6),
        attributionWindow: attribution, source: "API",
        isPartial: r.date === today,
        syncedAt,
        dedupeKey,
      });
      if (batch.length >= BATCH) await flush();
    }
    await flush();

    // Filet : une journée marquée partielle mais jamais relue (serveur arrêté, fenêtre
    // déplacée) resterait exclue des analyses. Elle est close par le calendrier du compte.
    await db.execute(sql`
      update ad_metrics set is_partial = false
      where account_id = ${account.id}::uuid and is_partial = true and date < ${today}::date`);

    // L'API fait foi sur les journées qu'elle vient de couvrir : on retire les lignes du même
    // compte issues d'un import fichier, qui feraient doublon sous une autre clé.
    const replaced = await db.execute(sql`
      delete from ad_metrics
      where account_id = ${account.id}::uuid and source = 'IMPORT'
        and date >= ${since}::date and date <= ${until}::date
      returning id`);

    await db.execute(sql`
      update ad_accounts
      set sync_status = 'OK', last_error = null, last_sync_at = now(), sync_enabled = true,
          imported_rows = (select count(*) from ad_metrics where account_id = ${account.id}::uuid)
      where id = ${account.id}::uuid`);

    return {
      ...base, ok: true, currency, fxRate, campaignStates,
      days: days.size, rows: seen.size, linkedRows, unbrandedRows,
      replacedImportRows: replaced.rows.length,
    };
  } catch (err) {
    const message =
      err instanceof MetaError
        ? err.isAuth
          ? `Jeton refusé par Meta (${err.message}). Vérifiez qu'il couvre le business propriétaire de ce compte.`
          : `Meta : ${err.message}`
        : err instanceof Error ? err.message : String(err);
    return await fail(message);
  } finally {
    // Le verrou tombe même en cas d'erreur : sinon le compte resterait bloqué 10 minutes.
    await releaseLock(account.id);
  }
}

/** Comptes déclarés pour la synchronisation automatique. */
export async function syncableAccounts(): Promise<SyncAccount[]> {
  const res = await db.execute(sql`
    select id, name, external_id, brand_id, currency
    from ad_accounts
    where platform = 'META' and sync_enabled = true and external_id is not null
    order by name`);
  return (res.rows as { id: string; name: string; external_id: string; brand_id: string | null; currency: string }[])
    .map((r) => ({ id: r.id, name: r.name, externalId: r.external_id, brandId: r.brand_id, currency: r.currency }));
}

/** Passage complet : tous les comptes activés, l'un après l'autre. */
export async function syncAll(opts?: { since?: string; until?: string; mode?: SyncMode }): Promise<SyncResult[]> {
  const accounts = await syncableAccounts();
  const out: SyncResult[] = [];
  for (const a of accounts) out.push(await syncAccount(a, opts));
  return out;
}
