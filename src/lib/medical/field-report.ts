import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSettings } from "@/lib/settings";
import { pgArray } from "@/lib/sql-array";
import { today, iso, mondayOf, startOfMonth } from "@/lib/format";
import { computeDoctorSignal } from "./doctors";
import { eventTime, haversineM, pointOf, type VerificationStatus } from "./gps-shared";
import { toCheckEvent } from "./chrono";
import { share } from "./field-report-shared";
import type { FieldScope } from "./field-access";

/**
 * Médical v2 — données de l'espace de contrôle (direction et managers) : visites avec leurs événements
 * GPS, positions des cabinets, indicateurs. Lecture seule. La portée (`FieldScope`) est appliquée ici,
 * jamais seulement dans la page.
 */

export type FieldEvent = {
  id: string;
  type: "START" | "STOP" | "NON_EFFECTUEE" | "CLOTURE_AUTO" | "CORRECTION";
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  gpsError: string | null;
  at: string;
  serverTime: string;
  deviceTime: string | null;
  syncedLate: boolean;
  distanceM: number | null;
  actorName: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  userAgent: string | null;
};

export type FieldVisit = {
  id: string;
  delegateId: string | null;
  delegateName: string | null;
  doctorId: string;
  doctorName: string;
  doctorCity: string | null;
  date: string;
  status: string;
  timingSource: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number | null;
  autoClosed: boolean;
  syncedLate: boolean;
  verificationStatus: VerificationStatus;
  reasons: string[];
  reportStatus: string | null;
  notDoneReason: string | null;
  cabinet: { lat: number; lng: number; validated: boolean; source: string | null } | null;
  events: FieldEvent[];
};

export type FieldFilters = { delegateId?: string | null; from: string; to: string };

function scopeSql(scope: FieldScope, col: string) {
  if (scope.all) return sql``;
  return scope.delegateIds.length ? sql`and ${sql.raw(col)} = any(${pgArray(scope.delegateIds)})` : sql`and false`;
}

/** Déléguées visibles (pour le filtre). */
export async function fieldDelegates(scope: FieldScope): Promise<{ id: string; name: string; weekly: number; monthly: number; managerId: string | null }[]> {
  const r = await db.execute<{ id: string; name: string; weekly: number; monthly: number; manager_id: string | null }>(sql`
    select u.id, u.name, coalesce(md.weekly_visit_objective, 0) as weekly, coalesce(md.monthly_visit_objective, 0) as monthly, md.manager_id
    from users u left join medical_delegates md on md.user_id = u.id
    where (md.id is not null or exists (select 1 from doctor_visits v where v.delegate_id = u.id and v.timing_source = 'CHRONO'))
      ${scopeSql(scope, "u.id")}
    order by u.name`);
  return r.rows.map((x) => ({ id: x.id, name: x.name, weekly: x.weekly, monthly: x.monthly, managerId: x.manager_id }));
}

/** Visites (chrono et saisies) d'une période, avec leurs événements et la position du cabinet. */
export async function fieldVisits(scope: FieldScope, f: FieldFilters): Promise<FieldVisit[]> {
  const r = await db.execute(sql`
    select v.id, v.delegate_id, u.name as delegate_name, v.doctor_id, d.first_name || ' ' || d.last_name as doctor_name, d.city as doctor_city,
      v.date::text as date, v.status, v.timing_source, v.started_at, v.ended_at, v.duration_minutes, v.auto_closed, v.synced_late,
      v.verification_status, v.verification_reasons, v.report_status, v.not_done_reason,
      d.gps_lat, d.gps_lng, d.gps_status, d.gps_source
    from doctor_visits v join doctors d on d.id = v.doctor_id left join users u on u.id = v.delegate_id
    where v.date between ${f.from}::date and ${f.to}::date
      and v.status in ('EN_COURS', 'REALISEE', 'NON_EFFECTUEE')
      ${f.delegateId ? sql`and v.delegate_id = ${f.delegateId}::uuid` : sql``}
      ${scopeSql(scope, "v.delegate_id")}
    order by v.date, coalesce(v.started_at, v.ended_at, v.created_at)
    limit 3000`);
  const rows = r.rows as Record<string, unknown>[];
  if (!rows.length) return [];
  const ev = await db.execute(sql`
    select id, visit_id, type, lat, lng, accuracy_m, gps_error, device_time, server_time, synced_late, actor_name, reason, payload, user_agent
    from visit_events where visit_id = any(${pgArray(rows.map((x) => String(x.id)))}) order by server_time, id`);
  const byVisit = new Map<string, Record<string, unknown>[]>();
  for (const e of ev.rows as Record<string, unknown>[]) {
    const k = String(e.visit_id);
    byVisit.set(k, [...(byVisit.get(k) ?? []), e]);
  }
  const iso8 = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return rows.map((x) => {
    const cabinet = x.gps_lat !== null && x.gps_lng !== null
      ? { lat: Number(x.gps_lat), lng: Number(x.gps_lng), validated: x.gps_status === "VALIDEE", source: (x.gps_source as string | null) ?? null }
      : null;
    const events = (byVisit.get(String(x.id)) ?? []).map((e) => {
      const ce = toCheckEvent(e as never);
      const p = pointOf(ce);
      return {
        id: String(e.id),
        type: e.type as FieldEvent["type"],
        lat: ce.lat, lng: ce.lng, accuracyM: ce.accuracyM, gpsError: (e.gps_error as string | null) ?? null,
        at: eventTime(ce).toISOString(),
        serverTime: ce.serverTime.toISOString(),
        deviceTime: ce.deviceTime?.toISOString() ?? null,
        syncedLate: Boolean(e.synced_late),
        distanceM: p && cabinet ? Math.round(haversineM(p, cabinet)) : null,
        actorName: (e.actor_name as string | null) ?? null,
        reason: (e.reason as string | null) ?? null,
        payload: (e.payload as Record<string, unknown> | null) ?? null,
        userAgent: (e.user_agent as string | null) ?? null,
      };
    });
    return {
      id: String(x.id),
      delegateId: (x.delegate_id as string | null) ?? null,
      delegateName: (x.delegate_name as string | null) ?? null,
      doctorId: String(x.doctor_id),
      doctorName: String(x.doctor_name),
      doctorCity: (x.doctor_city as string | null) ?? null,
      date: String(x.date),
      status: String(x.status),
      timingSource: String(x.timing_source),
      startedAt: iso8(x.started_at),
      endedAt: iso8(x.ended_at),
      durationMinutes: (x.duration_minutes as number | null) ?? null,
      autoClosed: Boolean(x.auto_closed),
      syncedLate: Boolean(x.synced_late),
      verificationStatus: x.verification_status as VerificationStatus,
      reasons: (x.verification_reasons as string[]) ?? [],
      reportStatus: (x.report_status as string | null) ?? null,
      notDoneReason: (x.not_done_reason as string | null) ?? null,
      cabinet,
      events,
    };
  });
}

export type FieldKpis = {
  realized: number;
  notDone: number;
  days: number;
  perDay: number | null;
  week: { done: number; objective: number };
  month: { done: number; objective: number };
  avgDuration: number | null;
  verifiedPct: number | null;
  controlled: number;
  coverage: { visited: number; total: number; pct: number | null };
  frequency: { onTime: number; total: number; pct: number | null };
};

/**
 * Indicateurs d'une déléguée (ou de toutes celles visibles) sur la période, plus la semaine et le mois
 * en cours face aux objectifs de sa fiche. Couverture et fréquence portent sur les médecins de ses secteurs.
 */
export async function fieldKpis(scope: FieldScope, visits: FieldVisit[], f: FieldFilters): Promise<FieldKpis> {
  const settings = await getSettings();
  const ref = today();
  const realized = visits.filter((v) => v.status === "REALISEE");
  const days = new Set(visits.map((v) => v.date)).size;
  const timed = realized.filter((v) => v.durationMinutes !== null && !v.autoClosed);
  const controlled = visits.filter((v) => v.timingSource === "CHRONO" && v.status !== "EN_COURS");
  const delegateIds = f.delegateId ? [f.delegateId] : scope.all ? null : scope.delegateIds;
  const dFilter = delegateIds === null ? sql`` : delegateIds.length ? sql`and v.delegate_id = any(${pgArray(delegateIds)})` : sql`and false`;
  const mFilter = delegateIds === null ? sql`` : delegateIds.length ? sql`and md.user_id = any(${pgArray(delegateIds)})` : sql`and false`;

  const [counts, objectives, docs] = await Promise.all([
    db.execute<{ week: number; month: number }>(sql`
      select count(*) filter (where v.date >= ${iso(mondayOf(ref))}::date)::int as week,
             count(*) filter (where v.date >= ${iso(startOfMonth(ref))}::date)::int as month
      from doctor_visits v where v.status = 'REALISEE' and v.date <= ${iso(ref)}::date ${dFilter}`),
    db.execute<{ weekly: number; monthly: number }>(sql`
      select coalesce(sum(md.weekly_visit_objective), 0)::int as weekly, coalesce(sum(md.monthly_visit_objective), 0)::int as monthly
      from medical_delegates md where md.active ${mFilter}`),
    db.execute<{ id: string; last_visit_at: string | null; visit_frequency_days: number | null; created_at: string; visited: boolean }>(sql`
      select distinct d.id, d.last_visit_at::text as last_visit_at, d.visit_frequency_days, d.created_at::text as created_at,
        exists (select 1 from doctor_visits v where v.doctor_id = d.id and v.status = 'REALISEE' and v.date between ${f.from}::date and ${f.to}::date ${dFilter}) as visited
      from doctors d
      join medical_delegate_sectors ds on ds.sector_id = d.sector_id
      join medical_delegates md on md.id = ds.delegate_id
      where d.status <> 'INACTIF' ${mFilter}`),
  ]);
  const docRows = docs.rows;
  const onTime = docRows.filter((d) => !computeDoctorSignal({ lastVisitAt: d.last_visit_at, visitFrequencyDays: d.visit_frequency_days, createdAt: d.created_at }, settings, ref).overdue).length;
  const visited = docRows.filter((d) => d.visited).length;
  return {
    realized: realized.length,
    notDone: visits.filter((v) => v.status === "NON_EFFECTUEE").length,
    days,
    perDay: days ? Math.round((realized.length / days) * 10) / 10 : null,
    week: { done: counts.rows[0]?.week ?? 0, objective: objectives.rows[0]?.weekly ?? 0 },
    month: { done: counts.rows[0]?.month ?? 0, objective: objectives.rows[0]?.monthly ?? 0 },
    avgDuration: timed.length ? Math.round(timed.reduce((a, v) => a + (v.durationMinutes ?? 0), 0) / timed.length) : null,
    verifiedPct: share(controlled.filter((v) => v.verificationStatus === "VERIFIEE").length, controlled.length),
    controlled: controlled.length,
    coverage: { visited, total: docRows.length, pct: share(visited, docRows.length) },
    frequency: { onTime, total: docRows.length, pct: share(onTime, docRows.length) },
  };
}

/** Cabinets dont la position attend une validation (proposée au premier Démarrer), dans la portée. */
export async function cabinetsToValidate(scope: FieldScope): Promise<{ doctorId: string; name: string; city: string | null; lat: number; lng: number; source: string | null; delegateName: string | null }[]> {
  const r = await db.execute(sql`
    select distinct on (d.id) d.id, d.first_name || ' ' || d.last_name as name, d.city, d.gps_lat, d.gps_lng, d.gps_source, u.name as delegate_name
    from doctors d
    left join doctor_visits v on v.doctor_id = d.id and v.timing_source = 'CHRONO'
    left join users u on u.id = v.delegate_id
    where d.gps_status = 'A_CONFIRMER' and d.gps_lat is not null
      ${scope.all ? sql`` : scope.delegateIds.length ? sql`and v.delegate_id = any(${pgArray(scope.delegateIds)})` : sql`and false`}
    order by d.id, v.started_at desc nulls last
    limit 200`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    doctorId: String(x.id), name: String(x.name), city: (x.city as string | null) ?? null,
    lat: Number(x.gps_lat), lng: Number(x.gps_lng), source: (x.gps_source as string | null) ?? null, delegateName: (x.delegate_name as string | null) ?? null,
  }));
}
