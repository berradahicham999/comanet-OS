import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { DELEGATE_SQL } from "@/lib/users";
import { iso, startOfMonth, addMonths, addDays, mondayOf } from "@/lib/format";
import { listDoctors } from "./doctors";
import { delegatePerformance, type DelegatePerf } from "./delegates";

export type SectorBreakdown = { sectorId: string | null; sectorName: string; doctors: number; activeDoctors: number; visits: number };
export type CityCorrelation = {
  city: string;
  /** Visites réalisées sur 90 jours dans la ville des prescripteurs. */
  visits90: number;
  /** Ventes sell-in (MAD) aux clients de cette ville sur les mêmes 90 jours, et les 90 jours précédents. */
  sales90: number;
  salesPrev90: number;
  deltaPct: number | null;
};

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
  /** Tendance par ville : visites vs ventes, présentée comme corrélation observée. */
  byCity: CityCorrelation[];
  /** Coefficient de corrélation visites ↔ évolution des ventes entre villes (null si < 4 villes). */
  cityCorrelation: number | null;
};

export async function medicalDashboard(ref: Date): Promise<MedicalDashboard> {
  const monthStart = iso(startOfMonth(ref));
  const monthEnd = iso(addMonths(startOfMonth(ref), 1));
  const weekStart = iso(mondayOf(ref)), weekEnd = iso(addDays(mondayOf(ref), 7));
  const todayIso = iso(ref);

  const d90 = iso(addDays(ref, -90)), d180 = iso(addDays(ref, -180));
  const [doctors, team, countsRes, sectorRes, specialtyRes, cityRes] = await Promise.all([
    listDoctors(),
    delegatePerformance(ref),
    db.execute(sql`
      select
        (select count(*)::int from users u where ${DELEGATE_SQL} and u.active) as active_delegates,
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
    db.execute(sql`
      with vis as (
        select ${sql.raw("upper(trim(d.city))")} as city, count(*)::int as visits90
        from doctor_visits v join doctors d on d.id = v.doctor_id
        where v.status = 'REALISEE' and v.date >= ${d90}::date and v.date <= ${todayIso}::date and d.city is not null
        group by 1
      ),
      sal as (
        select ${sql.raw("upper(trim(c.city))")} as city,
          coalesce(sum(case when s.date >= ${d90}::date then s.amount else 0 end), 0)::float8 as sales90,
          coalesce(sum(case when s.date >= ${d180}::date and s.date < ${d90}::date then s.amount else 0 end), 0)::float8 as sales_prev90
        from sales s join clients c on c.id = s.client_id
        where s.date >= ${d180}::date and s.date <= ${todayIso}::date and c.city is not null
        group by 1
      )
      select vis.city, vis.visits90, coalesce(sal.sales90, 0) as sales90, coalesce(sal.sales_prev90, 0) as sales_prev90
      from vis left join sal on sal.city = vis.city
      order by vis.visits90 desc limit 20`),
  ]);
  const byCity = (cityRes.rows as Record<string, unknown>[]).map((r) => {
    const sales90 = Number(r.sales90), salesPrev90 = Number(r.sales_prev90);
    return { city: String(r.city), visits90: Number(r.visits90), sales90, salesPrev90, deltaPct: salesPrev90 > 0 ? ((sales90 - salesPrev90) / salesPrev90) * 100 : null };
  });
  const pairs = byCity.filter((c) => c.deltaPct !== null);
  const cityCorrelation = pairs.length >= 4 ? pearson(pairs.map((c) => c.visits90), pairs.map((c) => c.deltaPct as number)) : null;
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
    byCity,
    cityCorrelation,
    bySpecialty: (specialtyRes.rows as Record<string, unknown>[]).map((r) => ({
      specialtyId: r.specialty_id as string | null, specialtyName: String(r.specialty_name),
      doctors: Number(r.doctors), visits: Number(r.visits),
      avgFrequencyDays: r.avg_frequency !== null ? Math.round(Number(r.avg_frequency)) : null,
    })),
  };
}

/** Corrélation de Pearson entre deux séries de même longueur ; null si une variance est nulle. */
function pearson(a: number[], b: number[]): number | null {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da === 0 || db === 0 ? null : num / Math.sqrt(da * db);
}
