import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, isOwnOnly } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { fmtTime } from "@/lib/format";
import { autoCloseStaleQuietly, hasAcceptedGpsNotice, businessDay } from "@/lib/medical/chrono";
import { VisitDay, type DayData } from "@/components/medical/visit-day";
import { acceptGpsNoticeAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ma journée" };

/**
 * Écran de la déléguée (mobile) : visites planifiées du jour, recherche d'un médecin, chrono de visite
 * (Démarrer / Terminer / non effectuée) et comptes rendus à compléter.
 */
export default async function JourneePage(props: { searchParams: Promise<{ doctor?: string; done?: string; planned?: string }> }) {
  const user = await requireAccess("medical");
  const sp = await props.searchParams;
  await autoCloseStaleQuietly();
  const own = await isOwnOnly();
  const day = businessDay(new Date());
  const settings = (await getSettings()).medicalField;

  const doctorScope = own
    ? sql`and (d.delegate_id = ${user.id}::uuid or d.sector_id in (
        select ds.sector_id from medical_delegate_sectors ds join medical_delegates md on md.id = ds.delegate_id where md.user_id = ${user.id}::uuid))`
    : sql``;

  const [accepted, runningRes, plannedRes, doneRes, todoRes, doctorsRes] = await Promise.all([
    hasAcceptedGpsNotice(user.id),
    db.execute(sql`
      select v.id, v.doctor_id, d.first_name || ' ' || d.last_name as doctor_name, v.started_at,
        (select e.client_event_id from visit_events e where e.visit_id = v.id and e.type = 'START' order by e.server_time limit 1) as start_ref
      from doctor_visits v join doctors d on d.id = v.doctor_id
      where v.delegate_id = ${user.id}::uuid and v.started_at is not null and v.ended_at is null limit 1`),
    db.execute(sql`
      select v.id, v.doctor_id, d.first_name || ' ' || d.last_name as doctor_name, d.city
      from doctor_visits v join doctors d on d.id = v.doctor_id
      where v.delegate_id = ${user.id}::uuid and v.status = 'PLANIFIEE' and v.date = ${day}::date
      order by d.last_name`),
    db.execute(sql`
      select v.id, d.first_name || ' ' || d.last_name as doctor_name, v.status, v.started_at, v.ended_at, v.duration_minutes,
        v.report_status, v.not_done_reason, v.auto_closed
      from doctor_visits v join doctors d on d.id = v.doctor_id
      where v.delegate_id = ${user.id}::uuid and v.date = ${day}::date and v.status in ('REALISEE', 'NON_EFFECTUEE')
      order by coalesce(v.started_at, v.ended_at, v.created_at)`),
    db.execute(sql`
      select v.id, d.first_name || ' ' || d.last_name as doctor_name, v.date::text as date
      from doctor_visits v join doctors d on d.id = v.doctor_id
      where v.delegate_id = ${user.id}::uuid and v.report_status = 'A_COMPLETER' and v.date < ${day}::date
      order by v.date desc limit 20`),
    db.execute(sql`
      select d.id, d.first_name || ' ' || d.last_name as name, d.city, s.name as sector
      from doctors d left join medical_sectors s on s.id = d.sector_id
      where d.status <> 'INACTIF' ${doctorScope}
      order by d.last_name, d.first_name`),
  ]);

  const r = runningRes.rows[0] as { id: string; doctor_id: string; doctor_name: string; started_at: string; start_ref: string | null } | undefined;
  const data: DayData = {
    day,
    accepted,
    gpsTimeoutS: settings.gpsTimeoutS,
    running: r ? { visitId: r.id, doctorId: r.doctor_id, doctorName: r.doctor_name, startedAt: new Date(r.started_at).toISOString(), startRef: r.start_ref } : null,
    planned: (plannedRes.rows as { id: string; doctor_id: string; doctor_name: string; city: string | null }[]).map((p) => ({ visitId: p.id, doctorId: p.doctor_id, doctorName: p.doctor_name, city: p.city })),
    done: (doneRes.rows as { id: string; doctor_name: string; status: string; started_at: string | null; ended_at: string | null; duration_minutes: number | null; report_status: string | null; not_done_reason: string | null; auto_closed: boolean }[]).map((v) => ({
      visitId: v.id, doctorName: v.doctor_name, status: v.status,
      startedAt: v.started_at ? new Date(v.started_at).toISOString() : null, endedAt: v.ended_at ? new Date(v.ended_at).toISOString() : null,
      startLabel: fmtTime(v.started_at), endLabel: fmtTime(v.ended_at),
      durationMinutes: v.duration_minutes, reportStatus: v.report_status, notDoneReason: v.not_done_reason, autoClosed: v.auto_closed,
    })),
    toComplete: (todoRes.rows as { id: string; doctor_name: string; date: string }[]).map((v) => ({ visitId: v.id, doctorName: v.doctor_name, date: v.date })),
    doctors: (doctorsRes.rows as { id: string; name: string; city: string | null; sector: string | null }[]),
    preselectDoctorId: sp.doctor ?? null,
    flash: sp.done ? "Compte rendu enregistré. Merci !" : sp.planned ? "Visite planifiée." : null,
  };

  return <VisitDay data={data} acceptNotice={acceptGpsNoticeAction} />;
}
