import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { doctorVisits, doctors, visitEvents, medicalGpsConsents } from "@/db/schema";
import type { DbLike } from "@/lib/events/emit";
import { audit, type AuditActor } from "@/lib/audit";
import { getSettings, type MedicalFieldSettings } from "@/lib/settings";
import { BUSINESS_TZ } from "@/lib/format";
import {
  verifyVisit, eventTime, sendDelayMs, haversineM, pointOf, canProposeCabinet, visitDurationMinutes,
  type EventForCheck, type GpsError, type VerificationStatus, type Cabinet, type PreviousStop,
} from "./gps-shared";

/**
 * Médical v2 — chrono de visite. Seul écrivain de `visit_events` et des champs horaires / GPS de
 * `doctor_visits` (started_at, ended_at, duration_minutes, statut de contrôle) et de la position du
 * cabinet sur `doctors`. Le compte rendu, lui, reste écrit par `saveVisitReport()` (`visits.ts`).
 *
 * La déléguée ne fournit jamais une heure : l'heure retenue est celle du serveur, ou celle du téléphone
 * recalée du décalage d'horloge pour une action envoyée en différé (`eventTime()`). Une correction
 * passe par `correctVisit()` (manager ou direction, motif obligatoire, trace `audit_logs`).
 */

export const GPS_NOTICE_VERSION = "2026-10-v1";

export type ChronoActor = AuditActor & { id: string };

export type ActionInput = {
  clientEventId: string;
  type: "START" | "STOP" | "NON_EFFECTUEE";
  /** START / NON_EFFECTUEE sans visite démarrée : médecin, et visite planifiée à convertir s'il y en a une. */
  doctorId?: string | null;
  plannedVisitId?: string | null;
  /** STOP / NON_EFFECTUEE d'une visite démarrée : identifiant client du START (connu même hors connexion) ou de la visite. */
  startRef?: string | null;
  visitId?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  gpsError?: GpsError | null;
  deviceTime?: string | null;
  sentAt?: string | null;
  /** L'action est passée par la file hors connexion. */
  queued?: boolean;
  reason?: string | null;
  userAgent?: string | null;
};

export type ActionResult =
  | { ok: true; visitId: string; duplicate?: boolean; message?: string }
  | { ok: false; code: "RUNNING" | "NOT_FOUND" | "FORBIDDEN" | "WAIT_START" | "INVALID"; message: string };

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
/** Jour d'un instant dans le fuseau de l'entreprise (AAAA-MM-JJ). */
export function businessDay(d: Date): string {
  return ymd.format(d);
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const parseTime = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const validCoord = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Médecins que la personne peut visiter : portée OWN = ses médecins ou ceux de ses secteurs. */
export async function doctorAllowed(tx: DbLike, doctorId: string, actorId: string, ownOnly: boolean): Promise<boolean> {
  if (!ownOnly) {
    const r = await tx.execute(sql`select 1 from doctors where id = ${doctorId}::uuid`);
    return r.rows.length > 0;
  }
  const r = await tx.execute(sql`
    select 1 from doctors d
    where d.id = ${doctorId}::uuid and (
      d.delegate_id = ${actorId}::uuid
      or d.sector_id in (select ds.sector_id from medical_delegate_sectors ds join medical_delegates md on md.id = ds.delegate_id where md.user_id = ${actorId}::uuid)
    )`);
  return r.rows.length > 0;
}

/**
 * Enregistre une action de la déléguée (Démarrer, Terminer, non effectuée). Idempotent : un
 * `clientEventId` déjà reçu renvoie la visite déjà créée, sans rien réécrire.
 */
export async function recordAction(actor: ChronoActor, input: ActionInput, opts: { ownOnly: boolean; settings?: MedicalFieldSettings }): Promise<ActionResult> {
  if (!input.clientEventId || input.clientEventId.length > 80) return { ok: false, code: "INVALID", message: "Identifiant d'action manquant." };
  const s = opts.settings ?? (await getSettings()).medicalField;

  const existing = await db.execute<{ visit_id: string }>(sql`select visit_id from visit_events where client_event_id = ${input.clientEventId}`);
  if (existing.rows[0]) return { ok: true, visitId: existing.rows[0].visit_id, duplicate: true };

  const serverTime = new Date();
  const deviceTime = parseTime(input.deviceTime);
  const sentAt = parseTime(input.sentAt);
  const hasPos = validCoord(input.lat, input.lng);
  const ev: EventForCheck = {
    type: input.type,
    lat: hasPos ? input.lat! : null,
    lng: hasPos ? input.lng! : null,
    accuracyM: hasPos && input.accuracyM !== null && input.accuracyM !== undefined ? Math.round(input.accuracyM) : null,
    gpsError: hasPos ? null : (input.gpsError ?? "INDISPONIBLE"),
    deviceTime,
    sentAt,
    serverTime,
  };
  const at = eventTime(ev);
  const late = !!input.queued || sendDelayMs(ev) > 120_000;

  try {
    return await db.transaction(async (tx) => {
      let visitId: string;
      let doctorId: string;

      if (input.type === "START" || (input.type === "NON_EFFECTUEE" && !input.startRef && !input.visitId)) {
        doctorId = input.doctorId ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(doctorId)) return { ok: false, code: "INVALID", message: "Médecin manquant." };
        if (!(await doctorAllowed(tx, doctorId, actor.id, opts.ownOnly))) return { ok: false, code: "FORBIDDEN", message: "Ce médecin n'est pas dans vos secteurs." };

        if (input.type === "START") {
          const running = await tx.execute<{ id: string; name: string }>(sql`
            select v.id, d.first_name || ' ' || d.last_name as name from doctor_visits v join doctors d on d.id = v.doctor_id
            where v.delegate_id = ${actor.id}::uuid and v.started_at is not null and v.ended_at is null limit 1`);
          if (running.rows[0]) return { ok: false, code: "RUNNING", message: `Une visite est déjà en cours chez Dr ${running.rows[0].name} : terminez-la d'abord.` };
        }

        const values = {
          doctorId,
          delegateId: actor.id,
          date: businessDay(at),
          timingSource: "CHRONO" as const,
          syncedLate: late,
          ...(input.type === "START"
            ? { status: "EN_COURS" as const, startedAt: at, endedAt: null, reportStatus: null }
            : { status: "NON_EFFECTUEE" as const, startedAt: null, endedAt: at, notDoneReason: input.reason?.trim() || null, reportStatus: null }),
        };
        let planned: string | null = null;
        if (input.plannedVisitId && /^[0-9a-f-]{36}$/i.test(input.plannedVisitId)) {
          const p = await tx.execute<{ id: string }>(sql`
            select id from doctor_visits where id = ${input.plannedVisitId}::uuid and doctor_id = ${doctorId}::uuid
              and status = 'PLANIFIEE' and (delegate_id = ${actor.id}::uuid or delegate_id is null) for update`);
          planned = p.rows[0]?.id ?? null;
        }
        if (planned) {
          await tx.update(doctorVisits).set(values).where(eq(doctorVisits.id, planned));
          visitId = planned;
        } else {
          const [row] = await tx.insert(doctorVisits).values(values).returning({ id: doctorVisits.id });
          visitId = row.id;
        }
      } else {
        const ref = await tx.execute<{ id: string; doctor_id: string; delegate_id: string | null; started_at: string | null; ended_at: string | null; auto_closed: boolean }>(
          input.startRef
            ? sql`select v.id, v.doctor_id, v.delegate_id, v.started_at, v.ended_at, v.auto_closed from visit_events e join doctor_visits v on v.id = e.visit_id where e.client_event_id = ${input.startRef} for update of v`
            : sql`select id, doctor_id, delegate_id, started_at, ended_at, auto_closed from doctor_visits where id = ${input.visitId ?? ""}::uuid for update`,
        );
        const v = ref.rows[0];
        // Le Démarrer de cette visite n'est pas encore arrivé (file hors connexion) : la file réessaiera.
        if (!v) return { ok: false, code: input.startRef ? "WAIT_START" : "NOT_FOUND", message: "Visite introuvable." };
        if (v.delegate_id !== actor.id) return { ok: false, code: "FORBIDDEN", message: "Cette visite n'est pas la vôtre." };
        visitId = v.id;
        doctorId = v.doctor_id;
        if (v.ended_at && !v.auto_closed) {
          // Déjà terminée : l'action est gardée au journal, la visite n'est pas modifiée.
          await insertEvent(tx, actor, visitId, input, ev, late, null);
          return { ok: true, visitId, message: "Visite déjà terminée." };
        }
        const startedAt = v.started_at ? new Date(v.started_at) : null;
        if (input.type === "STOP") {
          await tx.update(doctorVisits).set({
            status: "REALISEE",
            endedAt: at,
            durationMinutes: visitDurationMinutes(startedAt, at),
            autoClosed: false,
            reportStatus: "A_COMPLETER",
            ...(late ? { syncedLate: true } : {}),
          }).where(eq(doctorVisits.id, visitId));
        } else {
          await tx.update(doctorVisits).set({
            status: "NON_EFFECTUEE",
            endedAt: at,
            durationMinutes: null,
            autoClosed: false,
            reportStatus: null,
            notDoneReason: input.reason?.trim() || null,
            ...(late ? { syncedLate: true } : {}),
          }).where(eq(doctorVisits.id, visitId));
        }
      }

      const cab = await cabinetOf(tx, doctorId);
      const distance = cab && ev.lat !== null ? Math.round(haversineM({ lat: ev.lat, lng: ev.lng! }, cab)) : null;
      await insertEvent(tx, actor, visitId, input, ev, late, distance);

      // Médecin sans position : le premier Démarrer précis est proposé comme position du cabinet, à valider.
      if (input.type === "START" && !cab && canProposeCabinet(ev, s)) {
        await tx.update(doctors).set({
          gpsLat: ev.lat!.toFixed(6), gpsLng: ev.lng!.toFixed(6), gpsSource: "PREMIERE_VISITE", gpsStatus: "A_CONFIRMER", updatedAt: new Date(),
        }).where(and(eq(doctors.id, doctorId), sql`${doctors.gpsLat} is null`));
      }

      await refreshVerification(tx, visitId, s);
      await refreshDoctorVisitStats(tx, doctorId);
      return { ok: true, visitId };
    });
  } catch (e) {
    // Deux Démarrer simultanés (deux onglets) : l'index unique tranche.
    if (String((e as { code?: string })?.code ?? "") === "23505") {
      const again = await db.execute<{ visit_id: string }>(sql`select visit_id from visit_events where client_event_id = ${input.clientEventId}`);
      if (again.rows[0]) return { ok: true, visitId: again.rows[0].visit_id, duplicate: true };
      return { ok: false, code: "RUNNING", message: "Une visite est déjà en cours : terminez-la d'abord." };
    }
    throw e;
  }
}

async function insertEvent(tx: DbLike, actor: ChronoActor, visitId: string, input: ActionInput, ev: EventForCheck, late: boolean, distance: number | null) {
  await tx.insert(visitEvents).values({
    visitId,
    delegateId: actor.id,
    type: input.type,
    lat: ev.lat !== null ? ev.lat.toFixed(6) : null,
    lng: ev.lng !== null ? ev.lng.toFixed(6) : null,
    accuracyM: ev.accuracyM,
    gpsError: ev.gpsError,
    deviceTime: ev.deviceTime,
    serverTime: ev.serverTime,
    distanceCabinetM: distance,
    syncedLate: late,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
    clientEventId: input.clientEventId,
    actorId: actor.id,
    actorName: actor.name,
    reason: input.type === "NON_EFFECTUEE" ? input.reason?.trim() || null : null,
    payload: ev.sentAt ? { sentAt: ev.sentAt.toISOString() } : null,
  });
}

async function cabinetOf(tx: DbLike, doctorId: string): Promise<Cabinet | null> {
  const r = await tx.execute<{ gps_lat: string | null; gps_lng: string | null; gps_status: string | null }>(
    sql`select gps_lat, gps_lng, gps_status from doctors where id = ${doctorId}::uuid`,
  );
  const d = r.rows[0];
  if (!d || d.gps_lat === null || d.gps_lng === null) return null;
  return { lat: Number(d.gps_lat), lng: Number(d.gps_lng), validated: d.gps_status === "VALIDEE" };
}

type EventRow = {
  type: EventForCheck["type"]; lat: string | null; lng: string | null; accuracy_m: number | null; gps_error: GpsError | null;
  device_time: string | null; server_time: string; payload: { sentAt?: string; forcedStatus?: VerificationStatus } | null;
  reason: string | null; actor_name: string | null;
};

export function toCheckEvent(r: EventRow): EventForCheck {
  return {
    type: r.type,
    lat: num(r.lat),
    lng: num(r.lng),
    accuracyM: r.accuracy_m,
    gpsError: r.gps_error,
    deviceTime: r.device_time ? new Date(r.device_time) : null,
    sentAt: r.payload?.sentAt ? new Date(r.payload.sentAt) : null,
    serverTime: new Date(r.server_time),
    forcedStatus: r.payload?.forcedStatus ?? null,
    reason: r.reason,
    actorName: r.actor_name,
  };
}

/** Recalcule le statut de contrôle d'une visite depuis son journal (après chaque événement ou validation du cabinet). */
export async function refreshVerification(tx: DbLike, visitId: string, s: MedicalFieldSettings): Promise<void> {
  const v = (await tx.execute<{ doctor_id: string; delegate_id: string | null; auto_closed: boolean; timing_source: string }>(
    sql`select doctor_id, delegate_id, auto_closed, timing_source from doctor_visits where id = ${visitId}::uuid`,
  )).rows[0];
  if (!v || v.timing_source !== "CHRONO") return;
  const events = (await tx.execute<EventRow>(sql`
    select type, lat, lng, accuracy_m, gps_error, device_time, server_time, payload, reason, actor_name
    from visit_events where visit_id = ${visitId}::uuid order by server_time, id`)).rows.map(toCheckEvent);
  const actions = events.filter((e) => e.type !== "CORRECTION" && e.type !== "CLOTURE_AUTO");
  const first = actions[0];
  let previousStop: PreviousStop = null;
  if (first && v.delegate_id) {
    const firstAt = eventTime(first);
    const day = businessDay(firstAt);
    // Positions de la même déléguée, même jour, sur les autres visites : la dernière avant cette visite.
    const others = (await tx.execute<EventRow>(sql`
      select e.type, e.lat, e.lng, e.accuracy_m, e.gps_error, e.device_time, e.server_time, e.payload, e.reason, e.actor_name
      from visit_events e join doctor_visits dv on dv.id = e.visit_id
      where e.delegate_id = ${v.delegate_id}::uuid and e.visit_id <> ${visitId}::uuid and dv.date = ${day}::date
        and e.type in ('START', 'STOP', 'NON_EFFECTUEE') and e.lat is not null`)).rows.map(toCheckEvent);
    for (const o of others) {
      const t = eventTime(o);
      const p = pointOf(o);
      if (p && t < firstAt && (!previousStop || t > previousStop.at)) previousStop = { at: t, position: p };
    }
  }
  const res = verifyVisit({ events, cabinet: await cabinetOf(tx, v.doctor_id), previousStop, autoClosed: v.auto_closed, settings: s });
  await tx.update(doctorVisits).set({ verificationStatus: res.status, verificationReasons: res.reasons, verifiedAt: new Date() }).where(eq(doctorVisits.id, visitId));
}

/** Même recalcul que `saveVisit()` : date de dernière visite et passage NOUVEAU → ACTIF, depuis l'historique réel. */
export async function refreshDoctorVisitStats(tx: DbLike, doctorId: string) {
  await tx.execute(sql`
    update doctors set
      last_visit_at = (select max(date) from doctor_visits where doctor_id = ${doctorId}::uuid and status = 'REALISEE'),
      status = case when status = 'NOUVEAU' and exists (select 1 from doctor_visits where doctor_id = ${doctorId}::uuid and status = 'REALISEE') then 'ACTIF' else status end,
      updated_at = now()
    where id = ${doctorId}::uuid`);
}

/**
 * Clôture automatique des visites oubliées (en cours depuis plus de `autoCloseHours`). La fin est fixée
 * à démarrage + délai, sans position ; la durée n'est pas mesurée et la visite passe à vérifier.
 * Appelée par le cron horaire et à la lecture des écrans médicaux (une visite n'attend jamais le cron).
 */
export async function autoCloseStale(now = new Date()): Promise<number> {
  const s = (await getSettings()).medicalField;
  const stale = await db.execute<{ id: string; doctor_id: string; delegate_id: string | null; started_at: string }>(sql`
    select id, doctor_id, delegate_id, started_at from doctor_visits
    where started_at is not null and ended_at is null and started_at < ${new Date(now.getTime() - s.autoCloseHours * 3_600_000).toISOString()}::timestamptz
    limit 200`);
  for (const v of stale.rows) {
    await db.transaction(async (tx) => {
      const ended = new Date(new Date(v.started_at).getTime() + s.autoCloseHours * 3_600_000);
      const upd = await tx.execute(sql`
        update doctor_visits set ended_at = ${ended.toISOString()}::timestamptz, auto_closed = true, status = 'REALISEE',
          duration_minutes = null, report_status = 'A_COMPLETER'
        where id = ${v.id}::uuid and ended_at is null`);
      if (!upd.rowCount) return;
      await tx.insert(visitEvents).values({
        visitId: v.id, delegateId: v.delegate_id, type: "CLOTURE_AUTO", serverTime: now, clientEventId: `auto:${v.id}`,
        actorName: "Clôture automatique", reason: `Visite non terminée après ${s.autoCloseHours} h.`,
      }).onConflictDoNothing();
      await refreshVerification(tx, v.id, s);
      await refreshDoctorVisitStats(tx, v.doctor_id);
    });
  }
  return stale.rows.length;
}

/** Variante silencieuse pour les pages : ne casse jamais un affichage. */
export async function autoCloseStaleQuietly() {
  await autoCloseStale().catch((e) => console.error("[medical] clôture automatique", e));
}

/* ------------------------------------------------------------------ */
/* Corrections (manager ou direction)                                  */
/* ------------------------------------------------------------------ */

export type CorrectionInput = {
  visitId: string;
  reason: string;
  startedAt?: Date | null;
  endedAt?: Date | null;
  forcedStatus?: VerificationStatus | null;
};

/**
 * Corrige les heures d'une visite ou fixe son statut de contrôle. Motif obligatoire ; un événement
 * CORRECTION (avant / après) et une ligne `audit_logs` sont écrits dans la même transaction. Les
 * positions enregistrées ne se corrigent jamais : ce sont des preuves.
 */
export async function correctVisit(actor: ChronoActor, input: CorrectionInput): Promise<{ ok: boolean; message?: string }> {
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, message: "Le motif de la correction est obligatoire." };
  const s = (await getSettings()).medicalField;
  return db.transaction(async (tx) => {
    const cur = (await tx.execute<{ id: string; doctor_id: string; delegate_id: string | null; started_at: string | null; ended_at: string | null; timing_source: string; verification_status: string }>(
      sql`select id, doctor_id, delegate_id, started_at, ended_at, timing_source, verification_status from doctor_visits where id = ${input.visitId}::uuid for update`,
    )).rows[0];
    if (!cur) return { ok: false, message: "Visite introuvable." };
    if (cur.timing_source !== "CHRONO") return { ok: false, message: "Visite saisie sans chrono : rien à corriger ici." };
    const isoOf = (v: string | null) => (v ? new Date(v).toISOString() : null);
    const before = { startedAt: isoOf(cur.started_at), endedAt: isoOf(cur.ended_at), verificationStatus: cur.verification_status };
    const startedAt = input.startedAt !== undefined ? input.startedAt : cur.started_at ? new Date(cur.started_at) : null;
    const endedAt = input.endedAt !== undefined ? input.endedAt : cur.ended_at ? new Date(cur.ended_at) : null;
    if (startedAt && endedAt && endedAt < startedAt) return { ok: false, message: "La fin ne peut pas précéder le démarrage." };
    const after = { startedAt: startedAt?.toISOString() ?? null, endedAt: endedAt?.toISOString() ?? null, verificationStatus: input.forcedStatus ?? null };
    const timesChanged = input.startedAt !== undefined || input.endedAt !== undefined;
    if (timesChanged) {
      await tx.update(doctorVisits).set({
        startedAt, endedAt, durationMinutes: visitDurationMinutes(startedAt, endedAt),
        ...(startedAt ? { date: businessDay(startedAt) } : {}),
      }).where(eq(doctorVisits.id, cur.id));
    }
    await tx.insert(visitEvents).values({
      visitId: cur.id, delegateId: cur.delegate_id, type: "CORRECTION", clientEventId: `corr:${randomUUID()}`,
      actorId: actor.id, actorName: actor.name, reason,
      payload: { before, after, ...(input.forcedStatus ? { forcedStatus: input.forcedStatus } : {}) },
    });
    await audit({ actor, action: "UPDATE", module: "medical", entity: "doctor_visit", entityId: cur.id, label: `Correction de visite : ${reason}`, before, after }, tx);
    await refreshVerification(tx, cur.id, s);
    await refreshDoctorVisitStats(tx, cur.doctor_id);
    return { ok: true };
  });
}

/**
 * Valide (et éventuellement déplace) la position du cabinet d'un médecin, puis recalcule le contrôle
 * de toutes ses visites chronométrées. Plusieurs médecins peuvent partager la même position.
 */
export async function validateCabinet(actor: ChronoActor, doctorId: string, position: { lat: number; lng: number } | null): Promise<{ ok: boolean; message?: string }> {
  const s = (await getSettings()).medicalField;
  return db.transaction(async (tx) => {
    const d = (await tx.execute<{ gps_lat: string | null; gps_lng: string | null; gps_source: string | null; gps_status: string | null; name: string }>(
      sql`select gps_lat, gps_lng, gps_source, gps_status, first_name || ' ' || last_name as name from doctors where id = ${doctorId}::uuid for update`,
    )).rows[0];
    if (!d) return { ok: false, message: "Médecin introuvable." };
    if (!position && d.gps_lat === null) return { ok: false, message: "Aucune position à valider : placez le point sur la carte." };
    if (position && !validCoord(position.lat, position.lng)) return { ok: false, message: "Position invalide." };
    const moved = !!position && (d.gps_lat === null || Math.abs(Number(d.gps_lat) - position.lat) > 1e-6 || Math.abs(Number(d.gps_lng) - position.lng) > 1e-6);
    const before = { lat: d.gps_lat, lng: d.gps_lng, source: d.gps_source, status: d.gps_status };
    const next = {
      gpsLat: moved ? position!.lat.toFixed(6) : d.gps_lat,
      gpsLng: moved ? position!.lng.toFixed(6) : d.gps_lng,
      gpsSource: (moved ? "MANUELLE" : (d.gps_source ?? "MANUELLE")) as "MANUELLE" | "PREMIERE_VISITE" | "ADRESSE",
      gpsStatus: "VALIDEE" as const,
      gpsValidatedAt: new Date(),
      gpsValidatedBy: actor.id,
      updatedAt: new Date(),
    };
    await tx.update(doctors).set(next).where(eq(doctors.id, doctorId));
    await audit({
      actor, action: "VALIDATE", module: "medical", entity: "doctor_cabinet", entityId: doctorId,
      label: `Position du cabinet de Dr ${d.name} ${moved ? "déplacée et validée" : "validée"}`,
      before, after: { lat: next.gpsLat, lng: next.gpsLng, source: next.gpsSource, status: "VALIDEE" },
    }, tx);
    const visits = await tx.execute<{ id: string }>(sql`select id from doctor_visits where doctor_id = ${doctorId}::uuid and timing_source = 'CHRONO'`);
    for (const v of visits.rows) await refreshVerification(tx, v.id, s);
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Information GPS                                                     */
/* ------------------------------------------------------------------ */

export async function hasAcceptedGpsNotice(userId: string): Promise<boolean> {
  const r = await db.execute(sql`select 1 from medical_gps_consents where user_id = ${userId}::uuid and notice_version = ${GPS_NOTICE_VERSION} limit 1`);
  return r.rows.length > 0;
}

export async function acceptGpsNotice(userId: string, userAgent: string | null) {
  if (await hasAcceptedGpsNotice(userId)) return;
  await db.insert(medicalGpsConsents).values({ userId, noticeVersion: GPS_NOTICE_VERSION, userAgent: userAgent?.slice(0, 300) ?? null });
}

/** « AAAA-MM-JJTHH:MM » saisi dans le fuseau de l'entreprise → instant. */
export function parseBusinessLocal(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess))
    .reduce<Record<string, string>>((a, p) => ({ ...a, [p.type]: p.value }), {});
  const asTz = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asTz - guess));
}

/** Instant → « AAAA-MM-JJTHH:MM » dans le fuseau de l'entreprise (valeur d'un champ datetime-local). */
export function toBusinessLocal(d: Date | string | null): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(d))
    .reduce<Record<string, string>>((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Visite en cours d'une personne (bandeau persistant). */
export async function runningVisitOf(userId: string): Promise<{ doctorName: string; startedAt: string } | null> {
  const r = await db.execute<{ doctor_name: string; started_at: string }>(sql`
    select d.first_name || ' ' || d.last_name as doctor_name, v.started_at from doctor_visits v join doctors d on d.id = v.doctor_id
    where v.delegate_id = ${userId}::uuid and v.started_at is not null and v.ended_at is null limit 1`);
  const x = r.rows[0];
  return x ? { doctorName: x.doctor_name, startedAt: new Date(x.started_at).toISOString() } : null;
}
