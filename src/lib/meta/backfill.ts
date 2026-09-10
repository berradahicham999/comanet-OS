/**
 * Rattrapage historique Meta (2023 →) — le Historical Data Engine.
 *
 * Même chaîne que la synchronisation glissante (client → `upsertInsights` → `ad_metrics`),
 * appliquée mois par mois depuis `settings.metaHistoryStart` jusqu'au début de la fenêtre
 * glissante. Le passage est **reprenable** : `ad_accounts.backfill_cursor` mémorise le prochain
 * mois à lire, et chaque appel n'en traite que quelques-uns pour tenir dans la durée d'une
 * fonction serveur (300 s). Un mois refusé par Meta (rétention de 37 mois, permission) est
 * consigné dans `backfill_gaps` et affiché « Historique indisponible pour cette période » —
 * jamais inventé, jamais bloquant pour les mois suivants.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSettings } from "@/lib/settings";
import { fetchInsights, getAccount, MetaError } from "./client";
import { syncEntities } from "./entities";
import { fxRateOf, logSync, syncableAccounts, todayInTimezone, upsertInsights, type SyncAccount } from "./sync";
import { refreshMarketingFacts } from "@/lib/analytics-marketing/refresh";

export type BackfillResult = {
  accountId: string;
  accountName: string;
  ok: boolean;
  status: "RUNNING" | "DONE" | "ERROR" | "SKIPPED";
  monthsRead: number;
  rows: number;
  /** Prochain mois à lire (null quand terminé). */
  cursor: string | null;
  gaps: { month: string; reason: string }[];
  entities: { campaigns: number; adsets: number; ads: number; creatives: number; withProduct: number } | null;
  error: string | null;
};

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
function nextMonth(iso: string): string {
  const d = new Date(`${monthStart(iso)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}
function monthEnd(iso: string): string {
  const d = new Date(`${nextMonth(iso)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Meta refuse les insights au-delà de 37 mois : cette erreur est une lacune, pas une panne. */
function isRetentionRefusal(e: unknown): boolean {
  if (!(e instanceof MetaError)) return false;
  const m = e.message.toLowerCase();
  return e.code === 100 && (m.includes("37") || m.includes("older") || m.includes("time range") || m.includes("date"));
}

/**
 * Lit jusqu'à `monthsPerRun` mois pour un compte, à partir du curseur, puis avance le curseur.
 * Le catalogue des objets (campagnes, ensembles, publicités, créatives) est relu au premier
 * passage : sans lui, les lignes historiques n'auraient ni objectif ni créative ni produit.
 */
export async function backfillAccount(account: SyncAccount, opts?: { monthsPerRun?: number; restart?: boolean }): Promise<BackfillResult> {
  const settings = await getSettings();
  const monthsPerRun = Math.max(1, opts?.monthsPerRun ?? 6);
  const base: BackfillResult = { accountId: account.id, accountName: account.name, ok: false, status: "ERROR", monthsRead: 0, rows: 0, cursor: null, gaps: [], entities: null, error: null };
  const startedAt = new Date();

  const state = (await db.execute(sql`
    select backfill_cursor::text as cursor, backfill_status as status, backfill_gaps as gaps
    from ad_accounts where id = ${account.id}::uuid`)).rows[0] as { cursor: string | null; status: string; gaps: { month: string; reason: string }[] } | undefined;
  if (!state) return { ...base, error: "Compte introuvable." };
  if (state.status === "DONE" && !opts?.restart) return { ...base, ok: true, status: "SKIPPED", cursor: null, gaps: state.gaps ?? [] };

  const fail = async (message: string) => {
    await db.execute(sql`update ad_accounts set backfill_status = 'ERROR', backfill_error = ${message}, backfill_updated_at = now() where id = ${account.id}::uuid`);
    await logSync({ accountId: account.id, mode: "backfill", since: null, until: null, rows: 0, ok: false, error: message, startedAt });
    return { ...base, error: message };
  };

  try {
    const remote = await getAccount(account.externalId);
    const currency = remote.currency || account.currency;
    const fxRate = fxRateOf(currency, settings.fxRates);
    if (fxRate === null) return await fail(`Devise ${currency} : aucun taux de conversion vers le MAD n'est renseigné (Paramètres → Taux de change).`);

    const today = todayInTimezone(remote.timezone);
    // Borne haute : le début de la fenêtre glissante, déjà couverte par la synchro quotidienne.
    const windowStart = new Date(`${today}T00:00:00Z`); windowStart.setUTCDate(windowStart.getUTCDate() - (settings.metaSyncWindowDays - 1));
    const stop = windowStart.toISOString().slice(0, 10);
    const gaps: { month: string; reason: string }[] = opts?.restart ? [] : [...(state.gaps ?? [])];
    let cursor = opts?.restart || !state.cursor ? monthStart(settings.metaHistoryStart) : state.cursor;

    let entities: BackfillResult["entities"] = null;
    if (!state.cursor || opts?.restart) {
      entities = await syncEntities(account);
    }
    await db.execute(sql`update ad_accounts set backfill_status = 'RUNNING', backfill_error = null, backfill_cursor = ${cursor}::date, backfill_updated_at = now() where id = ${account.id}::uuid`);

    let monthsRead = 0;
    let rows = 0;
    while (monthsRead < monthsPerRun && cursor < stop) {
      const since = cursor;
      const until = monthEnd(cursor) < stop ? monthEnd(cursor) : stop;
      try {
        const insights = await fetchInsights(account.externalId, since, until, settings.metaAttributionWindow, "ad");
        if (insights.length) {
          const up = await upsertInsights(insights, { account, currency, fxRate, attribution: settings.metaAttributionWindow, today, syncedAt: new Date() });
          rows += up.seen.size;
        }
        await logSync({ accountId: account.id, mode: "backfill", since, until, rows: insights.length, ok: true, error: null, startedAt });
      } catch (e) {
        if (isRetentionRefusal(e) || (e instanceof MetaError && e.isAuth)) {
          const reason = e instanceof MetaError ? e.message : String(e);
          if (!gaps.some((g) => g.month === since.slice(0, 7))) gaps.push({ month: since.slice(0, 7), reason });
          await logSync({ accountId: account.id, mode: "backfill", since, until, rows: 0, ok: false, error: reason, startedAt });
        } else {
          throw e;
        }
      }
      cursor = nextMonth(cursor);
      monthsRead++;
      await db.execute(sql`update ad_accounts set backfill_cursor = ${cursor}::date, backfill_gaps = ${JSON.stringify(gaps)}::jsonb, backfill_updated_at = now() where id = ${account.id}::uuid`);
    }

    const done = cursor >= stop;
    await db.execute(sql`
      update ad_accounts set backfill_status = ${done ? "DONE" : "RUNNING"}, backfill_updated_at = now(),
        imported_rows = (select count(*) from ad_metrics where account_id = ${account.id}::uuid)
      where id = ${account.id}::uuid`);
    if (rows > 0) await refreshMarketingFacts(["AD_METRIC"], "SYNC");
    return { ...base, ok: true, status: done ? "DONE" : "RUNNING", monthsRead, rows, cursor: done ? null : cursor, gaps, entities };
  } catch (err) {
    const message = err instanceof MetaError
      ? (err.isAuth ? `Jeton refusé par Meta (${err.message}).` : `Meta : ${err.message}`)
      : err instanceof Error ? err.message : String(err);
    return await fail(message);
  }
}

/** Un passage sur tous les comptes activés. */
export async function backfillAll(opts?: { monthsPerRun?: number }): Promise<BackfillResult[]> {
  const out: BackfillResult[] = [];
  for (const a of await syncableAccounts()) out.push(await backfillAccount(a, opts));
  return out;
}

/** Catalogue seul (objets publicitaires), sans relire les insights. */
export async function catalogAll(): Promise<{ account: string; ok: boolean; error: string | null; result: Awaited<ReturnType<typeof syncEntities>> | null }[]> {
  const out = [];
  for (const a of await syncableAccounts()) {
    const startedAt = new Date();
    try {
      const r = await syncEntities(a);
      await logSync({ accountId: a.id, mode: "entities", since: null, until: null, rows: r.ads, ok: true, error: null, startedAt });
      out.push({ account: a.name, ok: true, error: null, result: r });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logSync({ accountId: a.id, mode: "entities", since: null, until: null, rows: 0, ok: false, error: msg, startedAt });
      out.push({ account: a.name, ok: false, error: msg, result: null });
    }
  }
  return out;
}

export type BackfillState = { accountId: string; name: string; status: string; cursor: string | null; error: string | null; updatedAt: string | null; gaps: { month: string; reason: string }[]; firstDay: string | null; lastDay: string | null; rows: number };

/** État du rattrapage par compte, pour l'écran des comptes et le bloc « Données » du cockpit. */
export async function backfillStates(): Promise<BackfillState[]> {
  const res = await db.execute(sql`
    select a.id, a.name, a.backfill_status, a.backfill_cursor::text as cursor, a.backfill_error, a.backfill_updated_at::text as updated_at, a.backfill_gaps,
           (select min(date)::text from ad_metrics m where m.account_id = a.id) as first_day,
           (select max(date)::text from ad_metrics m where m.account_id = a.id) as last_day,
           (select count(*)::int from ad_metrics m where m.account_id = a.id) as rows
    from ad_accounts a where a.platform = 'META' and a.sync_enabled = true order by a.name`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    accountId: String(r.id), name: String(r.name), status: String(r.backfill_status ?? "IDLE"), cursor: r.cursor ? String(r.cursor) : null,
    error: r.backfill_error ? String(r.backfill_error) : null, updatedAt: r.updated_at ? String(r.updated_at) : null,
    gaps: Array.isArray(r.backfill_gaps) ? (r.backfill_gaps as { month: string; reason: string }[]) : [],
    firstDay: r.first_day ? String(r.first_day) : null, lastDay: r.last_day ? String(r.last_day) : null, rows: Number(r.rows ?? 0),
  }));
}
