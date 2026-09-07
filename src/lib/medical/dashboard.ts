import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { iso, startOfMonth, addMonths, addDays, mondayOf } from "@/lib/format";
import { listDoctors } from "./doctors";
import { delegatePerformance, type DelegatePerf } from "./delegates";

export type SectorBreakdown = { sectorId: string | null; sectorName: string; doctors: number; activeDoctors: number; visits: number };
export type SpecialtyBreakdown = { specialtyId: string | null; specialtyName: string; doctors: number; visits: number; avgFrequencyDays: number | null };

export type MedicalDashboard = {
  activeDelegates: number;
  totalDoctors: number;
  visitedToday: number;
  visitsWeek: number;
  visitsMonth: number;
  monthlyObjective: number;
  realisationPct: number | null;
  avgVisitsPerDelegate: number;
  avgVisitsPerDoctor: number;
  neverVisited: number;
  overdue: number;
  team: DelegatePerf[];
  bySector: SectorBreakdown[];
  bySpecialty: SpecialtyBreakdown[];
};

export async function medicalDashboard(ref: Date): Promise<MedicalDashboard> {
  const monthStart = iso(startOfMonth(ref));
  const monthEnd = iso(addMonths(startOfMonth(ref), 1));
  const weekStart = iso(mondayOf(ref)), weekEnd = iso(addDays(mondayOf(ref), 7));
  const todayIso = iso(ref);

  const [doctors, team, countsRes, sectorRes, specialtyRes] = await Promise.all([
    listDoctors(),
    delegatePerformance(ref),
    db.execute(sql`
      select
        (select count(*)::int from users where role = 'DELEGUE_MEDICAL' and active) as active_delegates,
        (select count(distinct doctor_id)::int from doctor_visits where status = 'REALISEE' and date = ${todayIso}::date) as visited_today,
        (select count(*)::int from doctor_visits where status = 'REALISEE' and date >= ${weekStart}::date and date < ${weekEnd}::date) as visits_week,
        (select count(*)::int from doctor_visits where status = 'REALISEE' and date >= ${monthStart}::date and date < ${monthEnd}::date) as visits_month,
        (select coalesce(sum(monthly_visit_objective),0)::int from medical_delegates) as monthly_objective`),
    db.execute(sql`
      select d.sector_id, coalesce(ms.name, 'Sans secteur') as sector_name,
        count(distinct d.id)::int as doctors,
        count(distinct case when v.status = 'REALISEE' and v.date >= ${monthStart}::date then d.id end)::int as active_doctors,
        count(case when v.status = 'REALISEE' and v.date >= ${monthStart}::date and v.date < ${monthEnd}::date then 1 end)::int as visits
      from doctors d
      left join medical_sectors ms on ms.id = d.sector_id
      left join doctor_visits v on v.doctor_id = d.id
      group by d.sector_id, ms.name
      order by doctors desc`),
    db.execute(sql`
      select d.specialty_id, coalesce(sp.name, 'Non renseignée') as specialty_name,
        count(distinct d.id)::int as doctors,
        count(case when v.status = 'REALISEE' and v.date >= ${monthStart}::date and v.date < ${monthEnd}::date then 1 end)::int as visits,
        avg(d.visit_frequency_days)::float8 as avg_frequency
      from doctors d
      left join medical_specialties sp on sp.id = d.specialty_id
      left join doctor_visits v on v.doctor_id = d.id
      group by d.specialty_id, sp.name
      order by doctors desc`),
  ]);
  const counts = countsRes.rows[0] as Record<string, number>;
  const totalDoctors = doctors.length;
  const visitsMonth = Number(counts.visits_month);
  const activeDelegates = Number(counts.active_delegates);
  const monthlyObjective = Number(counts.monthly_objective);

  return {
    activeDelegates,
    totalDoctors,
    visitedToday: Number(counts.visited_today),
    visitsWeek: Number(counts.visits_week),
    visitsMonth,
    monthlyObjective,
    realisationPct: monthlyObjective ? (visitsMonth / monthlyObjective) * 100 : null,
    avgVisitsPerDelegate: activeDelegates ? visitsMonth / activeDelegates : 0,
    avgVisitsPerDoctor: totalDoctors ? visitsMonth / totalDoctors : 0,
    neverVisited: doctors.filter((d) => d.neverVisited).length,
    overdue: doctors.filter((d) => d.overdue).length,
    team,
    bySector: (sectorRes.rows as Record<string, unknown>[]).map((r) => ({
      sectorId: r.sector_id as string | null, sectorName: String(r.sector_name),
      doctors: Number(r.doctors), activeDoctors: Number(r.active_doctors), visits: Number(r.visits),
    })),
    bySpecialty: (specialtyRes.rows as Record<string, unknown>[]).map((r) => ({
      specialtyId: r.specialty_id as string | null, specialtyName: String(r.specialty_name),
      doctors: Number(r.doctors), visits: Number(r.visits),
      avgFrequencyDays: r.avg_frequency !== null ? Math.round(Number(r.avg_frequency)) : null,
    })),
  };
}
