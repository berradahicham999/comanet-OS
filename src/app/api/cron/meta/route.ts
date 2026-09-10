/**
 * Synchronisation quotidienne des comptes Meta.
 *
 * Déclenchée par Vercel Cron (voir `vercel.json`). Vercel signe ses appels avec
 * `CRON_SECRET` : sans en-tête valide, la route refuse — elle est publique sur Internet.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { syncAll, syncAccount, type SyncMode } from "@/lib/meta/sync";
import { hasMetaToken } from "@/lib/meta/client";
import { backfillAll, catalogAll } from "@/lib/meta/backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function syncOne(id: string, mode: SyncMode) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return [];
  const rows = await db.execute(sql`
    select id, name, external_id, brand_id, currency from ad_accounts
    where id = ${id}::uuid and external_id is not null`);
  const a = rows.rows[0] as { id: string; name: string; external_id: string; brand_id: string | null; currency: string } | undefined;
  if (!a) return [];
  return [await syncAccount({ id: a.id, name: a.name, externalId: a.external_id, brandId: a.brand_id, currency: a.currency }, { mode })];
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET non configuré : synchronisation désactivée." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Non autorisé." }, { status: 401 });
  }
  if (!hasMetaToken()) {
    return NextResponse.json({ ok: false, error: "META_ACCESS_TOKEN manquant." }, { status: 503 });
  }

  const started = Date.now();
  const params = new URL(request.url).searchParams;
  // `?mode=intraday` (passage horaire) ne relit que la veille et le jour même ; `full`
  // (passage de nuit) relit toute la fenêtre d'attribution. Relire 28 jours toutes les
  // heures brûlerait le quota de l'API pour deux journées qui bougent.
  const rawMode = params.get("mode");
  // `?mode=backfill` : rattrapage historique (quelques mois par appel, reprenable) ;
  // `?mode=entities` : catalogue des objets publicitaires seul.
  if (rawMode === "backfill") {
    const results = await backfillAll({ monthsPerRun: Number(params.get("months")) || 6 });
    return NextResponse.json({ ok: results.every((r) => r.ok), mode: "backfill", durationMs: Date.now() - started, accounts: results });
  }
  if (rawMode === "entities") {
    const results = await catalogAll();
    return NextResponse.json({ ok: results.every((r) => r.ok), mode: "entities", durationMs: Date.now() - started, accounts: results });
  }
  const mode: SyncMode = rawMode === "intraday" ? "intraday" : "full";
  // `?account=<uuid>` synchronise un seul compte : de quoi étaler la charge sur plusieurs
  // passages si l'ensemble des comptes dépasse la durée maximale d'une fonction.
  const only = params.get("account");
  const results = only ? await syncOne(only, mode) : await syncAll({ mode });
  return NextResponse.json({
    ok: results.every((r) => r.ok),
    mode,
    durationMs: Date.now() - started,
    accounts: results.map((r) => ({
      compte: r.accountName,
      statut: r.skipped ? "IGNORÉ (déjà en cours)" : r.ok ? "OK" : "ERREUR",
      jours: r.days,
      lignes: r.rows,
      lignesRattachees: r.linkedRows,
      lignesSansMarque: r.unbrandedRows,
      campagnesRelevees: r.campaignStates,
      devise: r.currency,
      taux: r.fxRate,
      erreur: r.error,
    })),
  });
}
