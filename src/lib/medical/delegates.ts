import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { iso, startOfMonth, addMonths, addDays, mondayOf } from "@/lib/format";
import { listDoctors, type DoctorRow } from "./doctors";

export type DelegatePerf = {
  id: string;
  name: string;
  zone: string | null;
  monthlyObjective: number;
  weeklyObjective: number;
  visitsMonth: number;
  visitsWeek: number;
  realisationPct: number | null;
  assignedDoctors: number;
  activeDoctors: number;
};

/** Performance de l'équipe de délégués médicaux sur le mois en cours. */
export async function delegatePerformance(ref: Date): Promise<DelegatePerf[]> {
  const monthStart = iso(startOfMonth(ref));
  const monthEnd = iso(addMonths(startOfMonth(ref), 1));
  const weekStart = iso(mondayOf(ref));
  const weekEnd = iso(addDays(mondayOf(ref), 7));
  const r = await db.execute(sql`
    select u.id, u.name, md.zone, coalesce(md.monthly_visit_objective,0)::int as monthly_objective, coalesce(md.weekly_visit_objective,0)::int as weekly_objective,
      coalesce((select count(*) from doctor_visits v where v.delegate_id = u.id and v.status = 'REALISEE' and v.date >= ${monthStart}::date and v.date < ${monthEnd}::date),0)::int as visits_month,
      coalesce((select count(*) from doctor_visits v where v.delegate_id = u.id and v.status = 'REALISEE' and v.date >= ${weekStart}::date and v.date < ${weekEnd}::date),0)::int as visits_week,
      coalesce((select count(*) from doctors d where d.delegate_id = u.id),0)::int as assigned_doctors,
      coalesce((select count(distinct d.id) from doctors d join doctor_visits v on v.doctor_id = d.id where d.delegate_id = u.id and v.status = 'REALISEE' and v.date >= ${monthStart}::date),0)::int as active_doctors
    from users u
    left join medical_delegates md on md.user_id = u.id
    where u.role = 'DELEGUE_MEDICAL' and u.active
    order by u.name`);
  return (r.rows as Record<string, unknown>[]).map((x) => {
    const monthlyObjective = Number(x.monthly_objective), visitsMonth = Number(x.visits_month);
    return {
      id: String(x.id), name: String(x.name), zone: x.zone as string | null,
      monthlyObjective, weeklyObjective: Number(x.weekly_objective),
      visitsMonth, visitsWeek: Number(x.visits_week),
      realisationPct: monthlyObjective ? (visitsMonth / monthlyObjective) * 100 : null,
      assignedDoctors: Number(x.assigned_doctors), activeDoctors: Number(x.active_doctors),
    };
  });
}

export type DelegateDashboard = {
  perf: DelegatePerf | null;
  priorityDoctors: DoctorRow[];
  weekVisits: { id: string; date: string; doctorName: string; status: string }[];
};

/** Dashboard individuel d'un délégué : objectif du mois, médecins prioritaires, planning de la semaine. */
export async function delegateDashboard(userId: string, ref: Date): Promise<DelegateDashboard> {
  const [team, doctors] = await Promise.all([delegatePerformance(ref), listDoctors({ delegateId: userId })]);
  const perf = team.find((t) => t.id === userId) ?? null;
  const priorityDoctors = doctors
    .filter((d) => d.overdue || d.neverVisited)
    .sort((a, b) => {
      const rank = { A: 0, B: 1, C: 2 } as const;
      const ra = a.potential ? rank[a.potential] : 3, rb = b.potential ? rank[b.potential] : 3;
      if (ra !== rb) return ra - rb;
      return (b.daysSinceLastVisit ?? 0) - (a.daysSinceLastVisit ?? 0);
    })
    .slice(0, 20);
  const weekStart = iso(mondayOf(ref)), weekEnd = iso(addDays(mondayOf(ref), 7));
  const r = await db.execute(sql`
    select v.id, v.date::text as date, (d.first_name || ' ' || d.last_name) as doctor_name, v.status
    from doctor_visits v join doctors d on d.id = v.doctor_id
    where v.delegate_id = ${userId}::uuid and v.date >= ${weekStart}::date and v.date < ${weekEnd}::date
    order by v.date`);
  const weekVisits = (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), date: String(x.date), doctorName: String(x.doctor_name), status: String(x.status),
  }));
  return { perf, priorityDoctors, weekVisits };
}
