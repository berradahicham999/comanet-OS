/**
 * Flux de ventes automatique (Pharmafirst → Auracos) : relecture horaire du fichier partagé du prestataire.
 *
 * Déclenché par Vercel Cron (voir `vercel.json`), à la demie : le prestataire réécrit son fichier vers h20.
 * Même garde que `/api/cron/meta` : sans `CRON_SECRET` valide, la route refuse.
 */
import { NextResponse } from "next/server";
import { syncSalesFeed } from "@/lib/import/sales-feed";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET non configuré : flux désactivé." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Non autorisé." }, { status: 401 });
  const started = Date.now();
  const r = await syncSalesFeed({ trigger: "CRON" });
  return NextResponse.json({ ...r, ms: Date.now() - started });
}
