import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { DbLike } from "@/lib/events/emit";
import { pgArray } from "@/lib/sql-array";
import type { PlaceKind, WebResult, WebStatus } from "./web-check-shared";

/** Lecture des contrôles Internet (`place_web_checks`). Lecture seule : l'écriture vit dans `web-check.ts`. */

type Row = { entity_id: string; status: WebStatus; lat: string | null; lng: string | null; place_name: string | null; place_address: string | null; checked_at: string };

const toResult = (r: Row): WebResult & { checkedAt: string } => ({
  status: r.status, lat: r.lat === null ? null : Number(r.lat), lng: r.lng === null ? null : Number(r.lng),
  name: r.place_name, address: r.place_address, checkedAt: new Date(r.checked_at).toISOString(),
});

/** Dernier résultat Internet d'une fiche (dans la transaction en cours si besoin) ; null = jamais vérifiée. */
export async function webCheckOf(tx: DbLike, kind: PlaceKind, id: string): Promise<WebResult> {
  // Appelée dans la transaction d'une visite : une table absente (migration 0058 non appliquée) ferait échouer
  // toute la transaction, même erreur rattrapée. On vérifie donc d'abord son existence.
  const exists = await tx.execute<{ t: string | null }>(sql`select to_regclass('public.place_web_checks')::text as t`);
  if (!exists.rows[0]?.t) return null;
  const r = await tx.execute<Row>(sql`
    select entity_id, status, lat, lng, place_name, place_address, checked_at from place_web_checks
    where entity_type = ${kind} and entity_id = ${id}::uuid`);
  return r.rows[0] ? toResult(r.rows[0]) : null;
}

/** Résultats Internet de plusieurs fiches, par identifiant. Tolérant : sans la migration 0058, rien. */
export async function webChecksFor(kind: PlaceKind, ids: string[]): Promise<Map<string, WebResult & { checkedAt: string }>> {
  const out = new Map<string, WebResult & { checkedAt: string }>();
  const uniq = [...new Set(ids)];
  if (!uniq.length) return out;
  const r = await db.execute<Row>(sql`
    select entity_id, status, lat, lng, place_name, place_address, checked_at from place_web_checks
    where entity_type = ${kind} and entity_id = any(${pgArray(uniq)})`).catch(() => ({ rows: [] as Row[] }));
  for (const x of r.rows) out.set(String(x.entity_id), toResult(x));
  return out;
}
