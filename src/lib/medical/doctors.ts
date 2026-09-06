import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSettings, type ComanetSettings } from "@/lib/settings";
import { today, daysBetween, toDate, fmtDate } from "@/lib/format";
import type { DoctorPotential, DoctorStatus } from "@/db/schema";
import type { Recommendation } from "@/lib/rules/types";

export type DoctorRow = {
  id: string;
  firstName: string;
  lastName: string;
  city: string | null;
  sectorId: string | null;
  sectorName: string | null;
  specialtyId: string | null;
  specialtyName: string | null;
  delegateId: string | null;
  delegateName: string | null;
  status: DoctorStatus;
  potential: DoctorPotential | null;
  lastVisitAt: string | null;
  visitFrequencyDays: number | null;
  createdAt: string;
  visitCount: number;
  daysSinceLastVisit: number | null;
  overdue: boolean;
  neverVisited: boolean;
};

export type DoctorFilters = {
  sectorId?: string;
  delegateId?: string;
  status?: string;
  potential?: string;
  search?: string;
};

/** Fréquence de visite effective : celle de la fiche médecin, sinon le défaut des réglages. */
export function effectiveFrequencyDays(visitFrequencyDays: number | null, settings: ComanetSettings) {
  return visitFrequencyDays ?? settings.medicalDefaultVisitFrequencyDays;
}

/** Calcule les signaux (retard, jamais visité) communs à la fiche 360°, au dashboard et à l'Action Center. */
export function computeDoctorSignal(
  d: { lastVisitAt: string | null; visitFrequencyDays: number | null; createdAt: string },
  settings: ComanetSettings,
  ref: Date,
) {
  const last = toDate(d.lastVisitAt);
  const created = toDate(d.createdAt);
  const daysSinceLastVisit = last ? daysBetween(last, ref) : created ? daysBetween(created, ref) : null;
  const neverVisited = !last;
  const freq = effectiveFrequencyDays(d.visitFrequencyDays, settings);
  const threshold = neverVisited ? settings.medicalOverdueVisitDays : freq;
  const overdue = daysSinceLastVisit !== null && daysSinceLastVisit > threshold;
  return { daysSinceLastVisit, neverVisited, overdue, effectiveFrequency: freq };
}

/** "Que faire avec ce médecin ?" — recommandation courte réutilisée par la fiche 360° et l'Action Center. */
export function doctorRecommendation(
  row: { firstName: string; lastName: string; potential: DoctorPotential | null; status: DoctorStatus },
  signal: ReturnType<typeof computeDoctorSignal>,
): { why: string; action: string } | null {
  if (signal.neverVisited) {
    return {
      why: `Dr ${row.firstName} ${row.lastName} n'a jamais été visité depuis sa création dans la base.`,
      action: "Planifier une première visite de découverte.",
    };
  }
  if (signal.overdue) {
    return {
      why: `Dernière visite il y a ${signal.daysSinceLastVisit} jours, au-delà de la fréquence recommandée (${signal.effectiveFrequency} j).`,
      action: row.potential === "A" || row.potential === "B" ? "Programmer une visite en priorité (potentiel élevé)." : "Programmer une visite de relance.",
    };
  }
  if (row.status === "A_REACTIVER") {
    return { why: "Ce médecin est marqué à réactiver.", action: "Planifier une visite de réactivation et réévaluer le potentiel." };
  }
  return null;
}

/** Recommandation Action Center complète pour un médecin — utilisée par la règle `medical-doctor-follow-up` et par la fiche 360°. */
export function buildDoctorRecommendation(row: DoctorRow, settings: ComanetSettings, ref: Date): Recommendation | null {
  if (row.status === "INACTIF" || !row.delegateId) return null;
  const signal = computeDoctorSignal(row, settings, ref);
  const reco = doctorRecommendation(row, signal);
  if (!reco || !(signal.overdue || signal.neverVisited)) return null;
  const highPotential = row.potential === "A" || row.potential === "B";
  return {
    key: `medical-doctor-follow-up:${row.id}`,
    rule: "medical-doctor-follow-up",
    category: "MEDICAL",
    priority: highPotential ? "HIGH" : "MEDIUM",
    title: `Dr ${row.firstName} ${row.lastName}`,
    subtitle: `${row.specialtyName ?? "Spécialité non renseignée"}${row.sectorName ? " · " + row.sectorName : ""}`,
    facts: [
      { label: "Dernière visite", value: row.lastVisitAt ? fmtDate(row.lastVisitAt) : "Jamais" },
      { label: "Potentiel", value: row.potential ?? "Non classé" },
      { label: "Délégué", value: row.delegateName ?? "—" },
    ],
    why: reco.why,
    action: reco.action,
    task: {
      title: `Planifier une visite — Dr ${row.firstName} ${row.lastName}`,
      dueInDays: highPotential ? 3 : 7,
      role: "DELEGUE_MEDICAL",
      priority: highPotential ? "HIGH" : "MEDIUM",
    },
    entity: { type: "doctor", id: row.id, href: `/medical/medecins/${row.id}` },
  };
}

export async function listDoctors(filters: DoctorFilters = {}): Promise<DoctorRow[]> {
  const settings = await getSettings();
  const ref = today();
  const r = await db.execute(sql`
    select d.id, d.first_name, d.last_name, d.city,
      d.sector_id, ms.name as sector_name,
      d.specialty_id, sp.name as specialty_name,
      d.delegate_id, u.name as delegate_name,
      d.status, d.potential, d.last_visit_at::text as last_visit_at, d.visit_frequency_days,
      d.created_at::text as created_at,
      coalesce((select count(*) from doctor_visits v where v.doctor_id = d.id and v.status = 'REALISEE'),0)::int as visit_count
    from doctors d
    left join medical_sectors ms on ms.id = d.sector_id
    left join medical_specialties sp on sp.id = d.specialty_id
    left join users u on u.id = d.delegate_id
    where 1=1
      ${filters.sectorId ? sql`and d.sector_id = ${filters.sectorId}::uuid` : sql``}
      ${filters.delegateId ? sql`and d.delegate_id = ${filters.delegateId}::uuid` : sql``}
      ${filters.status ? sql`and d.status = ${filters.status}` : sql``}
      ${filters.potential ? sql`and d.potential = ${filters.potential}` : sql``}
      ${filters.search ? sql`and (d.first_name || ' ' || d.last_name) ilike ${"%" + filters.search + "%"}` : sql``}
    order by d.last_name, d.first_name`);
  return (r.rows as Record<string, unknown>[]).map((x) => {
    const base = {
      id: String(x.id), firstName: String(x.first_name), lastName: String(x.last_name),
      city: x.city as string | null, sectorId: x.sector_id as string | null, sectorName: x.sector_name as string | null,
      specialtyId: x.specialty_id as string | null, specialtyName: x.specialty_name as string | null,
      delegateId: x.delegate_id as string | null, delegateName: x.delegate_name as string | null,
      status: x.status as DoctorStatus, potential: x.potential as DoctorPotential | null,
      lastVisitAt: x.last_visit_at as string | null, visitFrequencyDays: x.visit_frequency_days as number | null,
      createdAt: String(x.created_at), visitCount: Number(x.visit_count),
    };
    const signal = computeDoctorSignal(base, settings, ref);
    return { ...base, daysSinceLastVisit: signal.daysSinceLastVisit, overdue: signal.overdue, neverVisited: signal.neverVisited };
  });
}

export type DoctorProfile = DoctorRow & {
  phone: string | null;
  email: string | null;
  subSpecialty: string | null;
  addressLine: string | null;
  comments: string | null;
  notes: string | null;
};

export async function getDoctor(id: string): Promise<DoctorProfile | null> {
  const rows = await listDoctors();
  const base = rows.find((r) => r.id === id);
  if (!base) return null;
  const r = await db.execute(sql`select phone, email, sub_specialty, address_line, comments, notes from doctors where id = ${id}::uuid`);
  const extra = r.rows[0] as Record<string, unknown> | undefined;
  return {
    ...base,
    phone: (extra?.phone as string | null) ?? null,
    email: (extra?.email as string | null) ?? null,
    subSpecialty: (extra?.sub_specialty as string | null) ?? null,
    addressLine: (extra?.address_line as string | null) ?? null,
    comments: (extra?.comments as string | null) ?? null,
    notes: (extra?.notes as string | null) ?? null,
  };
}

export type DoctorVisitHistoryRow = {
  id: string; date: string; delegateName: string | null; status: string; result: string | null;
  doctorInterest: string | null; comment: string | null; nextAction: string | null; nextVisitDate: string | null;
  products: string[]; samples: { product: string; quantity: number }[];
};

export async function doctorVisitHistory(doctorId: string): Promise<DoctorVisitHistoryRow[]> {
  const r = await db.execute(sql`
    select v.id, v.date::text as date, u.name as delegate_name, v.status, v.result, v.doctor_interest, v.comment, v.next_action, v.next_visit_date::text as next_visit_date,
      coalesce((select array_agg(p.name order by p.name) from visit_products vp join products p on p.id = vp.product_id where vp.visit_id = v.id), '{}') as products,
      coalesce((select json_agg(json_build_object('product', p.name, 'quantity', vs.quantity)) from visit_samples vs join products p on p.id = vs.product_id where vs.visit_id = v.id), '[]') as samples
    from doctor_visits v
    left join users u on u.id = v.delegate_id
    where v.doctor_id = ${doctorId}::uuid
    order by v.date desc, v.created_at desc`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), date: String(x.date), delegateName: x.delegate_name as string | null, status: String(x.status),
    result: x.result as string | null, doctorInterest: x.doctor_interest as string | null, comment: x.comment as string | null,
    nextAction: x.next_action as string | null, nextVisitDate: x.next_visit_date as string | null,
    products: (x.products as string[]) ?? [], samples: (x.samples as { product: string; quantity: number }[]) ?? [],
  }));
}
