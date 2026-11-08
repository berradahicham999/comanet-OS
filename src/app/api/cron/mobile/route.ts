/**
 * Relances de l'app mobile (saisie du jour manquante, stock en tension). Appelé chaque heure par Vercel Cron : chaque
 * relance ne s'exécute qu'à son heure, réglée dans Paramètres. Même garde que les autres crons.
 */
import { NextResponse } from "next/server";
import { runMobileCron } from "@/lib/mobile/reminders";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET non configuré : relances désactivées." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Non autorisé." }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await runMobileCron()) });
}
