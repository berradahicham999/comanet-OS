/**
 * Médical v2 — contrôle de présence d'une visite (pur, sans base, importable côté client).
 *
 * Seule définition de : distance entre deux points (`haversineM`), heure retenue d'un événement
 * (`eventTime`), durée d'une visite (`visitDurationMinutes`), vitesse implicite entre deux visites
 * (`impliedSpeedKmh`) et statut de contrôle (`verifyVisit`). Les seuils viennent de
 * `settings.medicalField`, jamais du code. Une position manquante n'est jamais estimée : la visite
 * passe en NON_VERIFIEE avec le motif.
 */
import type { MedicalFieldSettings } from "@/lib/settings";

export type VerificationStatus = "VERIFIEE" | "A_VERIFIER" | "NON_VERIFIEE" | "HORS_CONTROLE";
export type VisitEventType = "START" | "STOP" | "NON_EFFECTUEE" | "CLOTURE_AUTO" | "CORRECTION";
export type GpsError = "REFUSE" | "INDISPONIBLE" | "DELAI" | "NON_SUPPORTE";

export type Point = { lat: number; lng: number };

export type EventForCheck = {
  type: VisitEventType;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  gpsError: GpsError | null;
  /** Heure de l'action sur le téléphone. */
  deviceTime: Date | null;
  /** Heure du téléphone au moment de l'envoi (sert à mesurer le décalage d'horloge et le retard d'envoi). */
  sentAt: Date | null;
  serverTime: Date;
  /** Correction : statut de contrôle imposé par le manager ou la direction, avec son motif. */
  forcedStatus?: VerificationStatus | null;
  reason?: string | null;
  actorName?: string | null;
};

export type Cabinet = Point & { validated: boolean };

export type PreviousStop = { at: Date; position: Point } | null;

export type VerificationResult = { status: VerificationStatus; reasons: string[] };

export const GPS_ERROR_LABELS: Record<GpsError, string> = {
  REFUSE: "localisation refusée sur le téléphone",
  INDISPONIBLE: "position indisponible",
  DELAI: "position non obtenue dans le délai",
  NON_SUPPORTE: "navigateur sans géolocalisation",
};

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  VERIFIEE: "Vérifiée",
  A_VERIFIER: "À vérifier",
  NON_VERIFIEE: "Non vérifiée",
  HORS_CONTROLE: "Saisie avant chrono",
};

/** « au démarrage », « à la fin »… et le nom seul, pour des motifs grammaticalement justes. */
const EVENT_AT: Record<VisitEventType, string> = {
  START: "au démarrage",
  STOP: "à la fin",
  NON_EFFECTUEE: "au constat d'absence",
  CLOTURE_AUTO: "à la clôture automatique",
  CORRECTION: "à la correction",
};
const EVENT_NOUN: Record<VisitEventType, string> = {
  START: "Démarrage",
  STOP: "Fin",
  NON_EFFECTUEE: "Constat d'absence",
  CLOTURE_AUTO: "Clôture automatique",
  CORRECTION: "Correction",
};

const R_EARTH_M = 6_371_000;

/** Distance orthodromique entre deux points, en mètres (formule de haversine). */
export function haversineM(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pointOf(e: { lat: number | null; lng: number | null }): Point | null {
  return e.lat === null || e.lng === null || !Number.isFinite(e.lat) || !Number.isFinite(e.lng) ? null : { lat: e.lat, lng: e.lng };
}

/**
 * Heure retenue d'une action. Envoyée en direct, c'est l'heure du serveur. Envoyée en différé (hors
 * connexion), c'est l'heure du téléphone recalée du décalage d'horloge mesuré à l'envoi :
 * heure appareil + (heure serveur − heure appareil à l'envoi).
 */
export function eventTime(e: Pick<EventForCheck, "deviceTime" | "sentAt" | "serverTime">): Date {
  if (!e.deviceTime || !e.sentAt) return e.serverTime;
  const skew = e.serverTime.getTime() - e.sentAt.getTime();
  const t = e.deviceTime.getTime() + skew;
  // L'action ne peut pas être postérieure à sa réception.
  return new Date(Math.min(t, e.serverTime.getTime()));
}

/** Retard d'envoi (ms) : délai entre l'action et son envoi, mesuré sur l'horloge du téléphone. */
export function sendDelayMs(e: Pick<EventForCheck, "deviceTime" | "sentAt">): number {
  if (!e.deviceTime || !e.sentAt) return 0;
  return Math.max(0, e.sentAt.getTime() - e.deviceTime.getTime());
}

/** Décalage d'horloge (ms, valeur absolue) entre le téléphone et le serveur au moment de l'envoi. */
export function clockSkewMs(e: Pick<EventForCheck, "sentAt" | "serverTime">): number {
  if (!e.sentAt) return 0;
  return Math.abs(e.serverTime.getTime() - e.sentAt.getTime());
}

/** Durée d'une visite en minutes entières (arrondi), ou null si une borne manque ou si elle est négative. */
export function visitDurationMinutes(startedAt: Date | null, endedAt: Date | null): number | null {
  if (!startedAt || !endedAt) return null;
  const ms = endedAt.getTime() - startedAt.getTime();
  return ms < 0 ? null : Math.round(ms / 60_000);
}

/** Vitesse implicite (km/h) pour parcourir `distanceM` en `ms`. Infinie si le temps est nul et la distance non nulle. */
export function impliedSpeedKmh(distanceM: number, ms: number): number {
  if (distanceM <= 0) return 0;
  if (ms <= 0) return Number.POSITIVE_INFINITY;
  return distanceM / 1000 / (ms / 3_600_000);
}

const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(m)} m`);
const fmtH = (ms: number) => {
  const min = Math.round(ms / 60_000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${min} min`;
};

type CheckSettings = Pick<
  MedicalFieldSettings,
  "radiusM" | "maxAccuracyM" | "maxStartStopM" | "minDurationMin" | "maxDurationMin" | "lateSyncHours" | "clockSkewMin" | "maxSpeedKmh"
>;

/**
 * Statut de contrôle d'une visite chronométrée, avec des motifs lisibles.
 *
 * - NON_VERIFIEE : une action sans position (GPS refusé, indisponible…). La visite reste valable, elle est signalée.
 * - A_VERIFIER : au moins un motif (hors rayon, précision, Démarrer / Terminer éloignés, durée, envoi différé,
 *   horloge, déplacement impossible, cabinet non validé, clôture automatique).
 * - VERIFIEE : aucune anomalie.
 * Une correction peut imposer un statut ; son motif reste affiché avec les autres.
 */
export function verifyVisit(input: {
  events: EventForCheck[];
  cabinet: Cabinet | null;
  previousStop: PreviousStop;
  autoClosed: boolean;
  settings: CheckSettings;
}): VerificationResult {
  const { events, cabinet, previousStop, settings: s } = input;
  const reasons: string[] = [];
  let gpsMissing = false;

  const actions = events.filter((e) => e.type === "START" || e.type === "STOP" || e.type === "NON_EFFECTUEE");
  if (!actions.length) return { status: "HORS_CONTROLE", reasons: [] };

  const start = actions.find((e) => e.type === "START") ?? null;
  const stop = [...actions].reverse().find((e) => e.type === "STOP") ?? null;
  const notDone = actions.find((e) => e.type === "NON_EFFECTUEE") ?? null;

  for (const e of actions) {
    const at = EVENT_AT[e.type];
    const noun = EVENT_NOUN[e.type];
    const p = pointOf(e);
    if (!p) {
      gpsMissing = true;
      reasons.push(`Aucune position ${at} : ${GPS_ERROR_LABELS[e.gpsError ?? "INDISPONIBLE"]}.`);
      continue;
    }
    if (e.accuracyM !== null && e.accuracyM > s.maxAccuracyM) {
      reasons.push(`Précision GPS insuffisante ${at} : ± ${fmtM(e.accuracyM)} (seuil ${fmtM(s.maxAccuracyM)}).`);
    }
    if (cabinet) {
      const d = haversineM(p, cabinet);
      if (d > s.radiusM) reasons.push(`${noun} à ${fmtM(d)} du cabinet (rayon ${fmtM(s.radiusM)}).`);
    }
    const delay = sendDelayMs(e);
    if (delay > s.lateSyncHours * 3_600_000) reasons.push(`${noun} : envoi ${fmtH(delay)} après l'action (hors connexion).`);
    const skew = clockSkewMs(e);
    if (skew > s.clockSkewMin * 60_000) reasons.push(`Horloge du téléphone décalée de ${fmtH(skew)} ${at}.`);
  }

  if (!cabinet) reasons.push("Position du cabinet inconnue : présence non comparable.");
  else if (!cabinet.validated) reasons.push("Position du cabinet pas encore validée.");

  if (start && stop) {
    const a = pointOf(start);
    const b = pointOf(stop);
    if (a && b) {
      const d = haversineM(a, b);
      if (d > s.maxStartStopM) reasons.push(`Fin à ${fmtM(d)} du démarrage (seuil ${fmtM(s.maxStartStopM)}).`);
    }
  }

  if (input.autoClosed) {
    reasons.push("Clôture automatique : la visite n'a pas été terminée, durée non mesurée.");
  } else if (start && stop) {
    const dur = visitDurationMinutes(eventTime(start), eventTime(stop));
    if (dur !== null && dur < s.minDurationMin) reasons.push(`Durée de ${dur} min, sous le minimum de ${s.minDurationMin} min.`);
    if (dur !== null && dur > s.maxDurationMin) reasons.push(`Durée de ${dur} min, au-delà du maximum de ${s.maxDurationMin} min.`);
  }

  const first = start ?? notDone;
  const firstPoint = first ? pointOf(first) : null;
  if (first && firstPoint && previousStop) {
    const d = haversineM(previousStop.position, firstPoint);
    const ms = eventTime(first).getTime() - previousStop.at.getTime();
    const v = impliedSpeedKmh(d, ms);
    if (d > s.radiusM && v > s.maxSpeedKmh) {
      reasons.push(`Déplacement impossible depuis la visite précédente : ${fmtM(d)} en ${fmtH(Math.max(0, ms))} (${!Number.isFinite(v) ? "temps nul" : v > 1000 ? "plus de 1 000 km/h" : `${Math.round(v)} km/h`}, seuil ${s.maxSpeedKmh} km/h).`);
    }
  }

  let status: VerificationStatus = gpsMissing ? "NON_VERIFIEE" : reasons.length ? "A_VERIFIER" : "VERIFIEE";

  const forced = [...events].reverse().find((e) => e.type === "CORRECTION" && e.forcedStatus);
  if (forced?.forcedStatus) {
    status = forced.forcedStatus;
    reasons.push(`Statut fixé à « ${VERIFICATION_LABELS[forced.forcedStatus]} » par ${forced.actorName ?? "la direction"} : ${forced.reason ?? "sans motif"}.`);
  }
  return { status, reasons };
}

/** Lien Google Maps d'un point (ouvre l'application sur téléphone). */
export function mapsUrl(p: Point): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

/**
 * Une position du premier « Démarrer » peut-elle être proposée comme position du cabinet ?
 * Seulement si elle existe et que sa précision est correcte (sinon la proposition serait fausse).
 */
export function canProposeCabinet(e: { lat: number | null; lng: number | null; accuracyM: number | null }, s: Pick<MedicalFieldSettings, "maxAccuracyM">): boolean {
  return pointOf(e) !== null && (e.accuracyM === null || e.accuracyM <= s.maxAccuracyM);
}

/**
 * Position du cabinet déduite de l'historique des visites (reprise d'un CRM) : le point le plus
 * « entouré » (le plus de visites dans le rayon), puis le centre des visites de ce rayon. Proposée
 * seulement si au moins `minPoints` visites et `minShare` des visites positionnées sont dans le rayon ;
 * sinon rien (pas d'estimation). Elle reste « à valider » comme une position proposée au premier Démarrer.
 */
export function cabinetFromHistory(
  points: Point[],
  s: { radiusM: number; historyMinPoints: number; historyMinShare: number },
): { position: Point; support: number; total: number } | null {
  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0));
  if (pts.length < s.historyMinPoints) return null;
  let best: { idx: number; near: Point[] } | null = null;
  pts.forEach((p, idx) => {
    const near = pts.filter((q) => haversineM(p, q) <= s.radiusM);
    if (!best || near.length > best.near.length) best = { idx, near };
  });
  const b = best as { idx: number; near: Point[] } | null;
  if (!b || b.near.length < s.historyMinPoints || b.near.length / pts.length < s.historyMinShare) return null;
  const lat = b.near.reduce((a, q) => a + q.lat, 0) / b.near.length;
  const lng = b.near.reduce((a, q) => a + q.lng, 0) / b.near.length;
  return { position: { lat, lng }, support: b.near.length, total: pts.length };
}
