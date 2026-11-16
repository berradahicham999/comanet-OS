/**
 * Clôture automatique des visites médicales oubliées (en cours depuis plus du délai paramétré), puis un lot du
 * contrôle Internet des positions (cabinets et points de vente, `src/lib/places/web-check.ts`, sans effet sans
 * `GOOGLE_MAPS_API_KEY`). Déclenché chaque heure par Vercel Cron (voir `vercel.json`) ; les écrans médicaux
 * déclenchent aussi la clôture à la lecture. Même garde que les autres crons : sans `CRON_SECRET` valide, la route refuse.
 */
import { NextResponse } from "next/server";
import { autoCloseStale } from "@/lib/medical/chrono";
import { runWebChecksQuietly } from "@/lib/places/web-check";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET non configuré : clôture automatique désactivée." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Non autorisé." }, { status: 401 });
  const closed = await autoCloseStale();
  const positions = await runWebChecksQuietly();
  return NextResponse.json({ ok: true, closed, positions });
}
