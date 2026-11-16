import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notify } from "@/lib/content/notify";
import { getSettings } from "@/lib/settings";
import { fmtTime } from "@/lib/format";
import { fmtDistance } from "./web-check-shared";

export { isOutOfZone } from "./web-check-shared";

/**
 * Alerte immédiate « visite hors zone » : une visite médicale ou commerciale démarre ou se termine loin de la position
 * VALIDÉE du cabinet ou du point de vente. Destinataires : les administrateurs et le manager de la personne
 * (les seuls qui voient les heures et positions, `field-access.ts` / `canSeePositions()`), jamais la personne elle-même.
 * Une seule alerte par visite. Interrupteur : `settings.webPlaces.notifyOutOfZone`.
 */

export type OutOfZoneInput = {
  kind: "medical" | "crm";
  visitId: string;
  actorId: string;
  actorName: string;
  placeName: string;
  eventType: "START" | "STOP" | "NON_EFFECTUEE";
  distanceM: number;
  radiusM: number;
  accuracyM: number | null;
  at: Date;
};

/** Administrateurs actifs (Administration → Valider) et manager actif de la personne. */
export async function positionWatchers(userId: string | null): Promise<string[]> {
  const r = await db.execute<{ id: string }>(sql`
    select u.id from users u
    where u.active and (
      exists (select 1 from user_permissions p where p.user_id = u.id and p.module = 'administration' and p.can_validate)
      or u.id = (select manager_id from users where id = ${userId}::uuid)
    )`);
  return r.rows.map((x) => String(x.id));
}

const EVENT_LABEL = { START: "Démarrage", STOP: "Fin", NON_EFFECTUEE: "Constat d'absence" } as const;

export async function alertOutOfZone(a: OutOfZoneInput): Promise<boolean> {
  const cfg = (await getSettings()).webPlaces;
  if (!cfg.notifyOutOfZone) return false;
  const entityType = a.kind === "medical" ? "doctor_visit" : "client_visit";
  const already = await db.execute(sql`
    select 1 from notifications where type = 'VISIT_OUT_OF_ZONE' and entity_type = ${entityType} and entity_id = ${a.visitId}::uuid limit 1`);
  if (already.rows.length) return false;
  const where = a.kind === "medical" ? `du cabinet de Dr ${a.placeName}` : `du point de vente ${a.placeName}`;
  await notify(await positionWatchers(a.actorId), {
    type: "VISIT_OUT_OF_ZONE",
    title: `Visite hors zone : ${a.actorName}`,
    body: `${EVENT_LABEL[a.eventType]} à ${fmtDistance(a.distanceM)} ${where} (rayon ${fmtDistance(a.radiusM)}${a.accuracyM !== null ? `, précision ± ${fmtDistance(a.accuracyM)}` : ""}), à ${fmtTime(a.at)}.`,
    href: a.kind === "medical" ? `/medical/visites/${a.visitId}` : `/clients/visites/${a.visitId}`,
    entityType,
    entityId: a.visitId,
  }, { except: a.actorId });
  return true;
}

/** Variante qui ne fait jamais échouer l'action de la déléguée ou de la commerciale. */
export async function alertOutOfZoneQuietly(a: OutOfZoneInput | null): Promise<void> {
  if (!a) return;
  await alertOutOfZone(a).catch((e) => console.error("[positions] alerte hors zone", e));
}
