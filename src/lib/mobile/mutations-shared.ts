/**
 * Lecture d'une saisie venue du téléphone — pure, testée dans `tests/mobile-outbox.test.ts`.
 * Tout ce qui arrive du téléphone est une donnée non fiable : rien n'est écrit sans passer ici.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Une file peut rester plusieurs jours sans réseau, pas davantage : au-delà, la date est sans doute une erreur. */
export const MAX_BACKDATE_DAYS = 31;

/** Le jour d'une saisie : ni dans le futur (un jour de tolérance pour le fuseau), ni trop ancien. */
export function dateInWindow(date: unknown, today: string): date is string {
  if (typeof date !== "string" || !ISO_DATE.test(date)) return false;
  const d = Date.parse(`${date}T12:00:00Z`);
  const t = Date.parse(`${today}T12:00:00Z`);
  if (Number.isNaN(d) || Number.isNaN(t)) return false;
  const delta = (t - d) / 86400000;
  return delta >= -1 && delta <= MAX_BACKDATE_DAYS;
}

/**
 * Heure du téléphone, recalée du décalage mesuré à l'envoi (`sentAt` est l'heure du téléphone au moment où le serveur
 * reçoit). Même principe que les visites : une horloge fausse ne fausse pas l'horodatage.
 */
export function alignedDeviceTime(deviceTime: unknown, sentAt: unknown, serverNow: Date): Date | null {
  const d = typeof deviceTime === "string" ? new Date(deviceTime) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const s = typeof sentAt === "string" ? new Date(sentAt) : null;
  if (!s || Number.isNaN(s.getTime())) return d;
  return new Date(d.getTime() + (serverNow.getTime() - s.getTime()));
}

export type GpsColumns = { gpsLat: string | null; gpsLng: string | null; gpsAccuracyM: number | null; gpsError: string | null };

const GPS_ERRORS = ["REFUSE", "INDISPONIBLE", "DELAI", "NON_SUPPORTE", "SANS_POSITION"];

/** Position reçue, ou la raison de son absence. Une saisie sans position reste acceptée, marquée comme telle. */
export function gpsColumns(gps: unknown): GpsColumns {
  const g = (gps ?? {}) as { lat?: unknown; lng?: unknown; accuracyM?: unknown; error?: unknown };
  const lat = typeof g.lat === "number" && Math.abs(g.lat) <= 90 ? g.lat : null;
  const lng = typeof g.lng === "number" && Math.abs(g.lng) <= 180 ? g.lng : null;
  if (lat === null || lng === null) {
    return { gpsLat: null, gpsLng: null, gpsAccuracyM: null, gpsError: GPS_ERRORS.includes(String(g.error)) ? String(g.error) : "SANS_POSITION" };
  }
  const acc = typeof g.accuracyM === "number" && g.accuracyM >= 0 ? Math.round(g.accuracyM) : null;
  return { gpsLat: lat.toFixed(6), gpsLng: lng.toFixed(6), gpsAccuracyM: acc, gpsError: null };
}

/** Lignes d'une saisie, ramenées à des chaînes : c'est `parseAnimationInput()` qui décide de leur validité. */
export function rawLines(lines: unknown): { productId: string; qty: string; stock: string }[] {
  if (!Array.isArray(lines)) return [];
  return lines.slice(0, 60).map((l) => {
    const x = (l ?? {}) as { productId?: unknown; qty?: unknown; stock?: unknown };
    return { productId: String(x.productId ?? "").trim(), qty: String(x.qty ?? ""), stock: String(x.stock ?? "") };
  }).filter((l) => isUuid(l.productId));
}
