/**
 * Rafraîchissement quotidien de la couche de faits marketing (toutes sources).
 *
 * Déclenché par Vercel Cron (voir `vercel.json`), après la synchronisation Meta du matin.
 * Même garde que `/api/cron/meta` : sans `CRON_SECRET` valide, la route refuse.
 */
import { NextResponse } from "next/server";
import { refreshMarketingFacts } from "@/lib/analytics-marketing/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET non configuré : rafraîchissement désactivé." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Non autorisé." }, { status: 401 });
  const started = Date.now();
  const results = await refreshMarketingFacts(undefined, "CRON");
  return NextResponse.json({ ok: results.every((r) => r.ok), ms: Date.now() - started, results });
}
