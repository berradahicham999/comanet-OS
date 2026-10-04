import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clientVisits, clients, visitEvents, medicalGpsConsents } from "@/db/schema";
import type { DbLike } from "@/lib/events/emit";
import { audit, type AuditActor } from "@/lib/audit";
import { getSettings, type CrmSettings } from "@/lib/settings";
import { businessDay } from "@/lib/medical/chrono";
import {
  verifyVisit, eventTime, sendDelayMs, haversineM, pointOf, canProposeCabinet, visitDurationMinutes,
  type EventForCheck, type GpsError, type VerificationStatus, type Cabinet, type PreviousStop,
} from "@/lib/medical/gps-shared";
import { crmCheckSettings, type ClientVisitKind } from "./visits-shared";

/**
 * CRM commercial — visites chez les clients. Seul écrivain des heures, du statut et du contrôle de
 * présence de `client_visits`, de ses événements dans `visit_events` (colonne `client_visit_id`) et de
 * la position du point de vente sur `clients`. Même mécanique que le chrono médical (`chrono.ts`) :
 * - la commerciale ne fournit jamais une heure : heure serveur, ou heure du téléphone recalée du décalage
 *   d'horloge pour une action envoyée en différé ;
 * - une action rejouée (file hors connexion) est idempotente par `clientEventId` ;
 * - une erreur se corrige par `correctClientVisit()` (motif, événement CORRECTION, `audit_logs`), jamais
 *   sur une position.
 */

export const CRM_GPS_NOTICE_VERSION = "crm-2026-10-v1";

export type CrmActor = AuditActor & { id: string };

export type CrmActionInput = {
  clientEventId: string;
  type: "START" | "STOP" | "NON_EFFECTUEE";
  /** START / NON_EFFECTUEE sans visite démarrée : client, et visite planifiée à convertir s'il y en a une. */
  clientId?: string | null;
  plannedVisitId?: string | null;
  /** STOP / NON_EFFECTUEE d'une visite démarrée : identifiant d'action du Démarrer (connu hors connexion) ou de la visite. */
  startRef?: string | null;
  visitId?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  gpsError?: GpsError | null;
  deviceTime?: string | null;
  sentAt?: string | null;
  queued?: boolean;
  reason?: string | null;
  userAgent?: string | null;
};

export type CrmActionResult =
  | { ok: true; visitId: string; duplicate?: boolean; message?: string }
  | { ok: false; code: "RUNNING" | "NOT_FOUND" | "FORBIDDEN" | "WAIT_START" | "INVALID"; message: string };

const UUID = /^[0-9a-f-]{36}$/i;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const parseTime = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const validCoord = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * Clients que la personne peut visiter : tous (portée ALL), sinon son portefeuille (commercial attitré)
 * et les clients de sa portée. `scopeClientIds` = `clientFilter()` (null = sans restriction).
 */
export async function clientVisitAllowed(tx: DbLike, clientId: string, actorId: string, scopeClientIds: string[] | null): Promise<boolean> {
  const r = await tx.execute<{ account_manager_id: string | null; active: boolean }>(sql`select account_manager_id, active from clients where id = ${clientId}::uuid`);
  const c = r.rows[0];
  if (!c) return false;
  if (scopeClientIds === null) return true;
  return c.account_manager_id === actorId || scopeClientIds.includes(clientId);
}

/** Enregistre Démarrer / Terminer / non effectuée. Idempotent : un `clientEventId` déjà reçu renvoie la visite créée. */
export async function recordClientVisitAction(actor: CrmActor, input: CrmActionInput, opts: { scopeClientIds: string[] | null; settings?: CrmSettings }): Promise<CrmActionResult> {
  if (!input.clientEventId || input.clientEventId.length > 80) return { ok: false, code: "INVALID", message: "Identifiant d'action manquant." };
  const s = opts.settings ?? (await getSettings()).crm;

  const existing = await db.execute<{ client_visit_id: string | null }>(sql`select client_visit_id from visit_events where client_event_id = ${input.clientEventId}`);
  if (existing.rows[0]) {
    const id = existing.rows[0].client_visit_id;
    return id ? { ok: true, visitId: id, duplicate: true } : { ok: false, code: "INVALID", message: "Identifiant d'action déjà utilisé." };
  }

  const serverTime = new Date();
  const hasPos = validCoord(input.lat, input.lng);
  const ev: EventForCheck = {
    type: input.type,
    lat: hasPos ? input.lat! : null,
    lng: hasPos ? input.lng! : null,
    accuracyM: hasPos && input.accuracyM !== null && input.accuracyM !== undefined ? Math.round(input.accuracyM) : null,
    gpsError: hasPos ? null : (input.gpsError ?? "INDISPONIBLE"),
    deviceTime: parseTime(input.deviceTime),
    sentAt: parseTime(input.sentAt),
    serverTime,
  };
  const at = eventTime(ev);
  const late = !!input.queued || sendDelayMs(ev) > 120_000;

  try {
    return await db.transaction(async (tx) => {
      let visitId: string;
      let clientId: string;

      if (input.type === "START" || (input.type === "NON_EFFECTUEE" && !input.startRef && !input.visitId)) {
        clientId = input.clientId ?? "";
        if (!UUID.test(clientId)) return { ok: false, code: "INVALID", message: "Client manquant." };
        if (!(await clientVisitAllowed(tx, clientId, actor.id, opts.scopeClientIds))) return { ok: false, code: "FORBIDDEN", message: "Ce client n'est pas dans votre portefeuille." };

        if (input.type === "START") {
          const running = await tx.execute<{ name: string }>(sql`
            select c.name from client_visits v join clients c on c.id = v.client_id
            where v.user_id = ${actor.id}::uuid and v.started_at is not null and v.ended_at is null limit 1`);
          if (running.rows[0]) return { ok: false, code: "RUNNING", message: `Une visite est déjà en cours chez ${running.rows[0].name} : terminez-la d'abord.` };
        }

        const values = {
          clientId,
          userId: actor.id,
          kind: "VISITE" as const,
          date: businessDay(at),
          timingSource: "CHRONO" as const,
          syncedLate: late,
          updatedAt: serverTime,
          ...(input.type === "START"
            ? { status: "EN_COURS" as const, startedAt: at, endedAt: null, reportStatus: null }
            : { status: "NON_EFFECTUEE" as const, startedAt: null, endedAt: at, notDoneReason: input.reason?.trim() || null, reportStatus: null }),
        };
        let planned: string | null = null;
        if (input.plannedVisitId && UUID.test(input.plannedVisitId)) {
          const p = await tx.execute<{ id: string }>(sql`
            select id from client_visits where id = ${input.plannedVisitId}::uuid and client_id = ${clientId}::uuid
              and status = 'PLANIFIEE' and (user_id = ${actor.id}::uuid or user_id is null) for update`);
          planned = p.rows[0]?.id ?? null;
        }
        if (planned) {
          await tx.update(clientVisits).set(values).where(eq(clientVisits.id, planned));
          visitId = planned;
        } else {
          const [row] = await tx.insert(clientVisits).values({ ...values, createdById: actor.id }).returning({ id: clientVisits.id });
          visitId = row.id;
        }
      } else {
        const ref = await tx.execute<{ id: string; client_id: string; user_id: string | null; started_at: string | null; ended_at: string | null; auto_closed: boolean }>(
          input.startRef
            ? sql`select v.id, v.client_id, v.user_id, v.started_at, v.ended_at, v.auto_closed from visit_events e join client_visits v on v.id = e.client_visit_id where e.client_event_id = ${input.startRef} for update of v`
            : sql`select id, client_id, user_id, started_at, ended_at, auto_closed from client_visits where id = ${UUID.test(input.visitId ?? "") ? input.visitId! : "00000000-0000-0000-0000-000000000000"}::uuid for update`,
        );
        const v = ref.rows[0];
        if (!v) return { ok: false, code: input.startRef ? "WAIT_START" : "NOT_FOUND", message: "Visite introuvable." };
        if (v.user_id !== actor.id) return { ok: false, code: "FORBIDDEN", message: "Cette visite n'est pas la vôtre." };
        visitId = v.id;
        clientId = v.client_id;
        if (v.ended_at && !v.auto_closed) {
          await insertEvent(tx, actor, visitId, input, ev, late, null);
          return { ok: true, visitId, message: "Visite déjà terminée." };
        }
        const startedAt = v.started_at ? new Date(v.started_at) : null;
        if (input.type === "STOP") {
          await tx.update(clientVisits).set({
            status: "EFFECTUEE", endedAt: at, durationMinutes: visitDurationMinutes(startedAt, at), autoClosed: false,
            reportStatus: "A_COMPLETER", updatedAt: serverTime, ...(late ? { syncedLate: true } : {}),
          }).where(eq(clientVisits.id, visitId));
        } else {
          await tx.update(clientVisits).set({
            status: "NON_EFFECTUEE", endedAt: at, durationMinutes: null, autoClosed: false, reportStatus: null,
            notDoneReason: input.reason?.trim() || null, updatedAt: serverTime, ...(late ? { syncedLate: true } : {}),
          }).where(eq(clientVisits.id, visitId));
        }
      }

      const place = await placeOf(tx, clientId);
      const distance = place && ev.lat !== null ? Math.round(haversineM({ lat: ev.lat, lng: ev.lng! }, place)) : null;
      await insertEvent(tx, actor, visitId, input, ev, late, distance);

      // Point de vente sans position : le premier Démarrer précis est proposé, à valider par le manager.
      if (input.type === "START" && !place && canProposeCabinet(ev, s)) {
        await tx.update(clients).set({
          gpsLat: ev.lat!.toFixed(6), gpsLng: ev.lng!.toFixed(6), gpsSource: "PREMIERE_VISITE", gpsStatus: "A_CONFIRMER", updatedAt: new Date(),
        }).where(and(eq(clients.id, clientId), sql`${clients.gpsLat} is null`));
      }

      await refreshClientVisitVerification(tx, visitId, s);
      return { ok: true, visitId };
    });
  } catch (e) {
    if (String((e as { code?: string })?.code ?? "") === "23505") {
      const again = await db.execute<{ client_visit_id: string | null }>(sql`select client_visit_id from visit_events where client_event_id = ${input.clientEventId}`);
      if (again.rows[0]?.client_visit_id) return { ok: true, visitId: again.rows[0].client_visit_id, duplicate: true };
      return { ok: false, code: "RUNNING", message: "Une visite est déjà en cours : terminez-la d'abord." };
    }
    throw e;
  }
}

async function insertEvent(tx: DbLike, actor: CrmActor, clientVisitId: string, input: CrmActionInput, ev: EventForCheck, late: boolean, distance: number | null) {
  await tx.insert(visitEvents).values({
    clientVisitId,
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

/** Position du point de vente (référence du contrôle de présence). */
async function placeOf(tx: DbLike, clientId: string): Promise<Cabinet | null> {
  const r = await tx.execute<{ gps_lat: string | null; gps_lng: string | null; gps_status: string | null }>(sql`select gps_lat, gps_lng, gps_status from clients where id = ${clientId}::uuid`);
  const c = r.rows[0];
  if (!c || c.gps_lat === null || c.gps_lng === null) return null;
  return { lat: Number(c.gps_lat), lng: Number(c.gps_lng), validated: c.gps_status === "VALIDEE" };
}

type EventRow = {
  type: EventForCheck["type"]; lat: string | null; lng: string | null; accuracy_m: number | null; gps_error: GpsError | null;
  device_time: string | null; server_time: string; payload: { sentAt?: string; forcedStatus?: VerificationStatus } | null;
  reason: string | null; actor_name: string | null;
};

function toCheck(r: EventRow): EventForCheck {
  return {
    type: r.type, lat: num(r.lat), lng: num(r.lng), accuracyM: r.accuracy_m, gpsError: r.gps_error,
    deviceTime: r.device_time ? new Date(r.device_time) : null,
    sentAt: r.payload?.sentAt ? new Date(r.payload.sentAt) : null,
    serverTime: new Date(r.server_time),
    forcedStatus: r.payload?.forcedStatus ?? null, reason: r.reason, actorName: r.actor_name,
  };
}

/** Recalcule le contrôle de présence d'une visite chronométrée depuis son journal. */
export async function refreshClientVisitVerification(tx: DbLike, visitId: string, s: CrmSettings): Promise<void> {
  const v = (await tx.execute<{ client_id: string; user_id: string | null; auto_closed: boolean; timing_source: string }>(
    sql`select client_id, user_id, auto_closed, timing_source from client_visits where id = ${visitId}::uuid`,
  )).rows[0];
  if (!v || v.timing_source !== "CHRONO") return;
  const events = (await tx.execute<EventRow>(sql`
    select type, lat, lng, accuracy_m, gps_error, device_time, server_time, payload, reason, actor_name
    from visit_events where client_visit_id = ${visitId}::uuid order by server_time, id`)).rows.map(toCheck);
  const first = events.find((e) => e.type === "START" || e.type === "STOP" || e.type === "NON_EFFECTUEE");
  let previousStop: PreviousStop = null;
  if (first && v.user_id) {
    const firstAt = eventTime(first);
    const others = (await tx.execute<EventRow>(sql`
      select e.type, e.lat, e.lng, e.accuracy_m, e.gps_error, e.device_time, e.server_time, e.payload, e.reason, e.actor_name
      from visit_events e join client_visits cv on cv.id = e.client_visit_id
      where e.delegate_id = ${v.user_id}::uuid and e.client_visit_id <> ${visitId}::uuid and cv.date = ${businessDay(firstAt)}::date
        and e.type in ('START', 'STOP', 'NON_EFFECTUEE') and e.lat is not null`)).rows.map(toCheck);
    for (const o of others) {
      const t = eventTime(o);
      const p = pointOf(o);
      if (p && t < firstAt && (!previousStop || t > previousStop.at)) previousStop = { at: t, position: p };
    }
  }
  const res = verifyVisit({ events, cabinet: await placeOf(tx, v.client_id), previousStop, autoClosed: v.auto_closed, settings: crmCheckSettings(s), placeNoun: "point de vente" });
  await tx.update(clientVisits).set({ verificationStatus: res.status, verificationReasons: res.reasons, verifiedAt: new Date() }).where(eq(clientVisits.id, visitId));
}

/** Clôture automatique des visites oubliées (en cours depuis plus de `autoCloseHours`) : durée non mesurée, à vérifier. */
export async function autoCloseStaleClientVisits(now = new Date()): Promise<number> {
  const s = (await getSettings()).crm;
  const limit = new Date(now.getTime() - s.autoCloseHours * 3_600_000).toISOString();
  const stale = await db.execute<{ id: string; user_id: string | null; started_at: string }>(sql`
    select id, user_id, started_at from client_visits
    where started_at is not null and ended_at is null and started_at < ${limit}::timestamptz limit 200`);
  for (const v of stale.rows) {
    await db.transaction(async (tx) => {
      const ended = new Date(new Date(v.started_at).getTime() + s.autoCloseHours * 3_600_000);
      const upd = await tx.execute(sql`
        update client_visits set ended_at = ${ended.toISOString()}::timestamptz, auto_closed = true, status = 'EFFECTUEE',
          duration_minutes = null, report_status = 'A_COMPLETER', updated_at = now()
        where id = ${v.id}::uuid and ended_at is null`);
      if (!upd.rowCount) return;
      await tx.insert(visitEvents).values({
        clientVisitId: v.id, delegateId: v.user_id, type: "CLOTURE_AUTO", serverTime: now, clientEventId: `auto-crm:${v.id}`,
        actorName: "Clôture automatique", reason: `Visite non terminée après ${s.autoCloseHours} h.`,
      }).onConflictDoNothing();
      await refreshClientVisitVerification(tx, v.id, s);
    });
  }
  return stale.rows.length;
}

/** Variante silencieuse pour les pages : ne casse jamais un affichage. */
export async function autoCloseStaleClientVisitsQuietly() {
  await autoCloseStaleClientVisits().catch((e) => console.error("[crm] clôture automatique", e));
}

/* ------------------------------------------------------------------ */
/* Planification, contacts, compte rendu                               */
/* ------------------------------------------------------------------ */

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Planifie une visite (sans heure : la date seule). Une visite déjà planifiée le même jour chez le même client est réutilisée. */
export async function planClientVisit(actor: CrmActor, input: { clientId: string; userId: string; date: string; objective?: string | null }, ex: DbLike = db): Promise<string> {
  if (!UUID.test(input.clientId) || !UUID.test(input.userId) || !isDay(input.date)) throw new Error("Client, commerciale et date sont obligatoires.");
  const same = await ex.execute<{ id: string }>(sql`
    select id from client_visits where client_id = ${input.clientId}::uuid and user_id = ${input.userId}::uuid and date = ${input.date}::date and status = 'PLANIFIEE' limit 1`);
  if (same.rows[0]) return same.rows[0].id;
  const [row] = await ex.insert(clientVisits).values({
    clientId: input.clientId, userId: input.userId, date: input.date, status: "PLANIFIEE", kind: "VISITE",
    objective: input.objective?.trim() || null, createdById: actor.id,
  }).returning({ id: clientVisits.id });
  return row.id;
}

/** Annule une visite planifiée (jamais une visite démarrée). */
export async function cancelPlannedVisit(actor: CrmActor, visitId: string, opts: { manage: boolean }): Promise<void> {
  const r = await db.execute<{ user_id: string | null; status: string }>(sql`select user_id, status from client_visits where id = ${visitId}::uuid`);
  const v = r.rows[0];
  if (!v) throw new Error("Visite introuvable.");
  if (v.status !== "PLANIFIEE") throw new Error("Seule une visite planifiée s'annule.");
  if (v.user_id !== actor.id && !opts.manage) throw new Error("Cette visite n'est pas la vôtre.");
  await db.update(clientVisits).set({ status: "ANNULEE", updatedAt: new Date() }).where(eq(clientVisits.id, visitId));
}

export type ContactInput = {
  clientId: string;
  /** Commerciale concernée (ressaisie par un manager) ; défaut : la personne connectée. */
  userId?: string | null;
  kind: ClientVisitKind;
  date: string;
  result?: string | null;
  comment?: string | null;
  nextAction?: string | null;
  nextVisitDate?: string | null;
};

/**
 * Contact saisi après coup : appel, message, ou visite ressaisie par un manager (visite faite sans le chrono).
 * Une visite physique se chronomètre ; seule une personne avec « Valider » sur Clients en ressaisit une,
 * avec trace d'audit. Ces saisies sont « hors contrôle » de présence.
 */
export async function logClientContact(actor: CrmActor, input: ContactInput, opts: { manage: boolean }): Promise<string> {
  if (!UUID.test(input.clientId) || !isDay(input.date)) throw new Error("Client et date sont obligatoires.");
  if (!["VISITE", "APPEL", "MESSAGE"].includes(input.kind)) throw new Error("Type de contact inconnu.");
  const userId = input.userId && UUID.test(input.userId) ? input.userId : actor.id;
  if (userId !== actor.id && !opts.manage) throw new Error("Seul un manager saisit un contact pour une autre personne.");
  if (input.kind === "VISITE" && !opts.manage) throw new Error("Une visite se démarre et se termine depuis Ma tournée (heure et position enregistrées). Un appel ou un message se saisit ici.");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(clientVisits).values({
      clientId: input.clientId, userId, date: input.date, status: "EFFECTUEE", kind: input.kind, timingSource: "SAISIE_MANUELLE",
      result: input.result?.trim() || null, comment: input.comment?.trim() || null, nextAction: input.nextAction?.trim() || null,
      nextVisitDate: isDay(input.nextVisitDate) ? input.nextVisitDate : null, reportStatus: "VALIDE", createdById: actor.id, updatedAt: new Date(),
    }).returning({ id: clientVisits.id });
    if (input.kind === "VISITE") {
      await audit({ actor, action: "CREATE", module: "clients", entity: "client_visit", entityId: row.id, label: "Visite ressaisie sans chrono", after: { clientId: input.clientId, userId, date: input.date } }, tx);
    }
    if (isDay(input.nextVisitDate) && input.nextVisitDate > input.date) await planClientVisit(actor, { clientId: input.clientId, userId, date: input.nextVisitDate }, tx);
    return row.id;
  });
}

export type ReportInput = { objective?: string | null; result?: string | null; comment?: string | null; nextAction?: string | null; nextVisitDate?: string | null };

/** Compte rendu d'une visite terminée. La prochaine visite datée est planifiée dans la foulée. */
export async function saveClientVisitReport(actor: CrmActor, visitId: string, input: ReportInput, opts: { manage: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    const v = (await tx.execute<{ user_id: string | null; client_id: string; status: string; date: string }>(
      sql`select user_id, client_id, status, date::text as date from client_visits where id = ${visitId}::uuid for update`,
    )).rows[0];
    if (!v) throw new Error("Visite introuvable.");
    if (v.user_id !== actor.id && !opts.manage) throw new Error("Cette visite n'est pas la vôtre.");
    if (v.status !== "EFFECTUEE") throw new Error("Le compte rendu se remplit sur une visite effectuée.");
    const next = isDay(input.nextVisitDate) ? input.nextVisitDate : null;
    await tx.update(clientVisits).set({
      objective: input.objective?.trim() || null, result: input.result?.trim() || null, comment: input.comment?.trim() || null,
      nextAction: input.nextAction?.trim() || null, nextVisitDate: next, reportStatus: "VALIDE", updatedAt: new Date(),
    }).where(eq(clientVisits.id, visitId));
    if (next && next > v.date && v.user_id) await planClientVisit(actor, { clientId: v.client_id, userId: v.user_id, date: next }, tx);
  });
}

/* ------------------------------------------------------------------ */
/* Corrections et position du point de vente (manager, direction)      */
/* ------------------------------------------------------------------ */

export type ClientVisitCorrection = { visitId: string; reason: string; startedAt?: Date | null; endedAt?: Date | null; forcedStatus?: VerificationStatus | null };

export async function correctClientVisit(actor: CrmActor, input: ClientVisitCorrection): Promise<{ ok: boolean; message?: string }> {
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, message: "Le motif de la correction est obligatoire." };
  const s = (await getSettings()).crm;
  return db.transaction(async (tx) => {
    const cur = (await tx.execute<{ id: string; user_id: string | null; started_at: string | null; ended_at: string | null; timing_source: string; verification_status: string }>(
      sql`select id, user_id, started_at, ended_at, timing_source, verification_status from client_visits where id = ${input.visitId}::uuid for update`,
    )).rows[0];
    if (!cur) return { ok: false, message: "Visite introuvable." };
    if (cur.timing_source !== "CHRONO") return { ok: false, message: "Visite saisie sans chrono : rien à corriger ici." };
    const isoOf = (v: string | null) => (v ? new Date(v).toISOString() : null);
    const before = { startedAt: isoOf(cur.started_at), endedAt: isoOf(cur.ended_at), verificationStatus: cur.verification_status };
    const startedAt = input.startedAt !== undefined ? input.startedAt : cur.started_at ? new Date(cur.started_at) : null;
    const endedAt = input.endedAt !== undefined ? input.endedAt : cur.ended_at ? new Date(cur.ended_at) : null;
    if (startedAt && endedAt && endedAt < startedAt) return { ok: false, message: "La fin ne peut pas précéder le démarrage." };
    const after = { startedAt: startedAt?.toISOString() ?? null, endedAt: endedAt?.toISOString() ?? null, verificationStatus: input.forcedStatus ?? null };
    if (input.startedAt !== undefined || input.endedAt !== undefined) {
      await tx.update(clientVisits).set({
        startedAt, endedAt, durationMinutes: visitDurationMinutes(startedAt, endedAt), updatedAt: new Date(),
        ...(startedAt ? { date: businessDay(startedAt) } : {}),
      }).where(eq(clientVisits.id, cur.id));
    }
    await tx.insert(visitEvents).values({
      clientVisitId: cur.id, delegateId: cur.user_id, type: "CORRECTION", clientEventId: `corr-crm:${randomUUID()}`,
      actorId: actor.id, actorName: actor.name, reason,
      payload: { before, after, ...(input.forcedStatus ? { forcedStatus: input.forcedStatus } : {}) },
    });
    await audit({ actor, action: "UPDATE", module: "clients", entity: "client_visit", entityId: cur.id, label: `Correction de visite : ${reason}`, before, after }, tx);
    await refreshClientVisitVerification(tx, cur.id, s);
    return { ok: true };
  });
}

/** Valide (et éventuellement déplace) la position d'un point de vente, puis recalcule le contrôle de ses visites. */
export async function validatePointOfSale(actor: CrmActor, clientId: string, position: { lat: number; lng: number } | null): Promise<{ ok: boolean; message?: string }> {
  const s = (await getSettings()).crm;
  return db.transaction(async (tx) => {
    const c = (await tx.execute<{ gps_lat: string | null; gps_lng: string | null; gps_source: string | null; gps_status: string | null; name: string }>(
      sql`select gps_lat, gps_lng, gps_source, gps_status, name from clients where id = ${clientId}::uuid for update`,
    )).rows[0];
    if (!c) return { ok: false, message: "Client introuvable." };
    if (!position && c.gps_lat === null) return { ok: false, message: "Aucune position à valider : placez le point sur la carte." };
    if (position && !validCoord(position.lat, position.lng)) return { ok: false, message: "Position invalide." };
    const moved = !!position && (c.gps_lat === null || Math.abs(Number(c.gps_lat) - position.lat) > 1e-6 || Math.abs(Number(c.gps_lng) - position.lng) > 1e-6);
    const before = { lat: c.gps_lat, lng: c.gps_lng, source: c.gps_source, status: c.gps_status };
    const next = {
      gpsLat: moved ? position!.lat.toFixed(6) : c.gps_lat,
      gpsLng: moved ? position!.lng.toFixed(6) : c.gps_lng,
      gpsSource: (moved ? "MANUELLE" : (c.gps_source ?? "MANUELLE")) as "MANUELLE" | "PREMIERE_VISITE",
      gpsStatus: "VALIDEE" as const,
      gpsValidatedAt: new Date(),
      gpsValidatedBy: actor.id,
      updatedAt: new Date(),
    };
    await tx.update(clients).set(next).where(eq(clients.id, clientId));
    await audit({
      actor, action: "VALIDATE", module: "clients", entity: "client_position", entityId: clientId,
      label: `Position du point de vente ${c.name} ${moved ? "déplacée et validée" : "validée"}`,
      before, after: { lat: next.gpsLat, lng: next.gpsLng, source: next.gpsSource, status: "VALIDEE" },
    }, tx);
    const visits = await tx.execute<{ id: string }>(sql`select id from client_visits where client_id = ${clientId}::uuid and timing_source = 'CHRONO'`);
    for (const v of visits.rows) await refreshClientVisitVerification(tx, v.id, s);
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Lectures utiles aux écrans                                          */
/* ------------------------------------------------------------------ */

/** Visite en cours d'une personne (bandeau, reprise après rechargement). */
export async function runningClientVisitOf(userId: string): Promise<{ visitId: string; clientId: string; clientName: string; startedAt: string; startRef: string | null } | null> {
  const r = await db.execute<{ id: string; client_id: string; name: string; started_at: string; start_ref: string | null }>(sql`
    select v.id, v.client_id, c.name, v.started_at,
      (select e.client_event_id from visit_events e where e.client_visit_id = v.id and e.type = 'START' order by e.server_time limit 1) as start_ref
    from client_visits v join clients c on c.id = v.client_id
    where v.user_id = ${userId}::uuid and v.started_at is not null and v.ended_at is null limit 1`);
  const x = r.rows[0];
  return x ? { visitId: x.id, clientId: x.client_id, clientName: x.name, startedAt: new Date(x.started_at).toISOString(), startRef: x.start_ref } : null;
}

export async function hasAcceptedCrmGpsNotice(userId: string): Promise<boolean> {
  const r = await db.execute(sql`select 1 from medical_gps_consents where user_id = ${userId}::uuid and notice_version = ${CRM_GPS_NOTICE_VERSION} limit 1`);
  return r.rows.length > 0;
}

/** Prise de connaissance de l'information GPS (horodatée, conservée ; même table que le médical, version propre au CRM). */
export async function acceptCrmGpsNotice(userId: string, userAgent: string | null) {
  if (await hasAcceptedCrmGpsNotice(userId)) return;
  await db.insert(medicalGpsConsents).values({ userId, noticeVersion: CRM_GPS_NOTICE_VERSION, userAgent: userAgent?.slice(0, 300) ?? null });
}

export type VisitOutcome = { orders: { id: string; number: string | null; status: string }[]; readings: number };

/**
 * Ce qui s'est passé pendant une visite, déduit et non saisi : commandes clients enregistrées par la
 * commerciale chez ce client entre 10 min avant le démarrage et `orderWindowMinutes` après la fin (le même
 * jour pour un contact sans heures), et relevés de stock en rayon du même jour par la même personne.
 * C'est le seul lien mesuré entre une visite et une commande.
 */
export async function visitOutcomes(visitIds: string[], s: CrmSettings): Promise<Map<string, VisitOutcome>> {
  const out = new Map<string, VisitOutcome>();
  if (!visitIds.length) return out;
  const ids = sql.join(visitIds.filter((x) => UUID.test(x)).map((x) => sql`${x}::uuid`), sql`, `);
  const [orders, readings] = await Promise.all([
    db.execute<{ visit_id: string; id: string; number: string | null; status: string }>(sql`
      select cv.id as visit_id, d.id, d.number, d.status from client_visits cv
      join sales_documents d on d.client_id = cv.client_id and d.type = 'COMMANDE' and d.status <> 'ANNULE'
        and (d.created_by_id = cv.user_id or d.sales_rep_id = cv.user_id)
        and case when cv.started_at is not null
          then d.created_at between cv.started_at - interval '10 minutes' and coalesce(cv.ended_at, cv.started_at) + make_interval(mins => ${s.orderWindowMinutes})
          else d.created_at::date = cv.date end
      where cv.id in (${ids}) and cv.status = 'EFFECTUEE'`),
    db.execute<{ visit_id: string; n: number }>(sql`
      select cv.id as visit_id, count(*)::int as n from client_visits cv
      join client_stock_readings r on r.client_id = cv.client_id and r.user_id = cv.user_id and r.read_at = cv.date
      where cv.id in (${ids}) and cv.status = 'EFFECTUEE' group by cv.id`),
  ]);
  for (const id of visitIds) out.set(id, { orders: [], readings: 0 });
  for (const o of orders.rows) out.get(o.visit_id)?.orders.push({ id: o.id, number: o.number, status: o.status });
  for (const r of readings.rows) { const x = out.get(r.visit_id); if (x) x.readings = r.n; }
  return out;
}
