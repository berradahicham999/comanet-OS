import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSettings } from "@/lib/settings";
import { today, iso } from "@/lib/format";
import { cityKey } from "@/lib/animations-shared";
import { computeDoctorSignal } from "./doctors";
import {
  doctorSegment, recommendProducts, tourPriority, visitImpact, SEGMENT_LABELS,
  type PrescriberProducts, type Segment, type Potential,
} from "./prescriptions-shared";

/**
 * Médical v2 — analyses P1 (segments, impact des visites, tournée suggérée). Ce module charge les
 * données ; les définitions vivent dans `prescriptions-shared.ts`. Tout est explicable : chaque ligne
 * porte ses observations et ses facteurs.
 */

type DoctorBase = {
  id: string; name: string; city: string | null; specialty_id: string | null; specialty: string | null; potential: Potential | null;
  last_visit_at: string | null; visit_frequency_days: number | null; created_at: string; delegate_id: string | null;
};

/** Médecins d'une déléguée (ses secteurs ou assignés), ou tous. */
async function doctorsOf(delegateUserId: string | null): Promise<DoctorBase[]> {
  const r = await db.execute<DoctorBase>(sql`
    select d.id, d.first_name || ' ' || d.last_name as name, d.city, d.specialty_id, sp.name as specialty, d.potential,
      d.last_visit_at::text as last_visit_at, d.visit_frequency_days, d.created_at::text as created_at, d.delegate_id
    from doctors d left join medical_specialties sp on sp.id = d.specialty_id
    where d.status <> 'INACTIF'
      ${delegateUserId ? sql`and (d.delegate_id = ${delegateUserId}::uuid or d.sector_id in (
        select ds.sector_id from medical_delegate_sectors ds join medical_delegates md on md.id = ds.delegate_id where md.user_id = ${delegateUserId}::uuid))` : sql``}`);
  return r.rows;
}

async function allPrescriberProducts(): Promise<PrescriberProducts[]> {
  const r = await db.execute<{ doctor_id: string; specialty_id: string | null; city: string | null; products: string[] }>(sql`
    select p.doctor_id, d.specialty_id, d.city, array_agg(distinct p.product_id::text) as products
    from prescriptions p join doctors d on d.id = p.doctor_id where p.product_id is not null group by p.doctor_id, d.specialty_id, d.city`);
  return r.rows.map((x) => ({ doctorId: x.doctor_id, specialty: x.specialty_id, city: x.city ? cityKey(x.city) : null, products: new Set(x.products) }));
}

export type TourRow = { doctorId: string; name: string; city: string | null; specialty: string | null; potential: Potential | null; score: number; reasons: string[]; lastVisitAt: string | null };

/** Tournée suggérée de la semaine : médecins de la déléguée classés par priorité. */
export async function suggestedTour(delegateUserId: string): Promise<TourRow[]> {
  const settings = await getSettings();
  const s = settings.medicalField;
  const ref = today();
  const [docs, presc] = await Promise.all([doctorsOf(delegateUserId), allPrescriberProducts()]);
  const byDoctor = new Map(presc.map((p) => [p.doctorId, p]));
  const rows = docs.map((d) => {
    const sig = computeDoctorSignal({ lastVisitAt: d.last_visit_at, visitFrequencyDays: d.visit_frequency_days, createdAt: d.created_at }, settings, ref);
    const reco = recommendProducts(
      { doctorId: d.id, specialty: d.specialty_id, city: d.city ? cityKey(d.city) : null, products: byDoctor.get(d.id)?.products ?? new Set() },
      presc, new Map(), { specialty: d.specialty ?? "Médecin", city: d.city }, s,
    );
    const p = tourPriority({ potential: d.potential, daysSince: sig.daysSinceLastVisit, frequencyDays: sig.effectiveFrequency, neverVisited: sig.neverVisited, recommended: reco.items.length }, s);
    return { doctorId: d.id, name: d.name, city: d.city, specialty: d.specialty, potential: d.potential, score: p.score, reasons: p.reasons, lastVisitAt: d.last_visit_at };
  });
  return rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, s.tourSize);
}

export type SegmentReport = { segment: Segment; label: string; count: number; doctors: { id: string; name: string; city: string | null; lines: number; recent: number; previous: number; visits: number }[] }[];

/** Segments médecins (prescripteur fidèle, en croissance, en baisse, jamais visité…), sur la portée donnée. */
export async function doctorSegments(delegateUserId: string | null): Promise<SegmentReport> {
  const settings = await getSettings();
  const s = settings.medicalField;
  const ref = today();
  const [docs, stats, visits] = await Promise.all([
    doctorsOf(delegateUserId),
    db.execute<{ doctor_id: string; lines: number; recent: number; previous: number }>(sql`
      select doctor_id, count(*)::int as lines,
        count(*) filter (where date >= current_date - make_interval(months => ${s.trendMonths}))::int as recent,
        count(*) filter (where date >= current_date - make_interval(months => ${2 * s.trendMonths}) and date < current_date - make_interval(months => ${s.trendMonths}))::int as previous
      from prescriptions where doctor_id is not null and product_id is not null and date >= current_date - make_interval(months => ${s.potentialMonths})
      group by doctor_id`),
    db.execute<{ doctor_id: string; visits: number; recent: number }>(sql`
      select doctor_id, count(*)::int as visits, count(*) filter (where date >= current_date - make_interval(months => ${s.trendMonths}))::int as recent
      from doctor_visits where status = 'REALISEE' group by doctor_id`),
  ]);
  const st = new Map(stats.rows.map((x) => [x.doctor_id, x]));
  const vi = new Map(visits.rows.map((x) => [x.doctor_id, x]));
  const groups = new Map<Segment, SegmentReport[number]["doctors"]>();
  for (const d of docs) {
    const x = st.get(d.id);
    const v = vi.get(d.id);
    const overdue = computeDoctorSignal({ lastVisitAt: d.last_visit_at, visitFrequencyDays: d.visit_frequency_days, createdAt: d.created_at }, settings, ref).overdue;
    const seg = doctorSegment({ lines: x?.lines ?? 0, recent: x?.recent ?? 0, previous: x?.previous ?? 0, visits: v?.visits ?? 0, visitsRecent: v?.recent ?? 0, potential: d.potential, overdue }, s);
    if (seg === "AUTRE") continue;
    groups.set(seg, [...(groups.get(seg) ?? []), { id: d.id, name: d.name, city: d.city, lines: x?.lines ?? 0, recent: x?.recent ?? 0, previous: x?.previous ?? 0, visits: v?.visits ?? 0 }]);
  }
  const order: Segment[] = ["POTENTIEL_NON_COUVERT", "JAMAIS_VISITE", "BAISSE", "CROISSANCE", "FIDELE", "VISITE_SANS_PRESCRIPTION"];
  return order.filter((k) => groups.has(k)).map((k) => ({
    segment: k, label: SEGMENT_LABELS[k], count: groups.get(k)!.length,
    doctors: groups.get(k)!.sort((a, b) => b.lines - a.lines).slice(0, 25),
  }));
}

export type ImpactAgg = { key: string; label: string; measured: number; pending: number; before: number; after: number };

/**
 * Impact des visites (corrélation observée) : pour chaque produit présenté lors d'une visite réalisée,
 * ordonnances du médecin pour ce produit N jours avant vs N jours après. Une fenêtre « après » non
 * écoulée est comptée à part (« pas encore comparable »), jamais dans le total.
 */
export async function visitImpactReport(delegateUserId: string | null): Promise<{ byProduct: ImpactAgg[]; byBrand: ImpactAgg[]; byDelegate: ImpactAgg[]; windowDays: number; pairs: number }> {
  const s = (await getSettings()).medicalField;
  const ref = iso(today());
  const r = await db.execute<{ visit_date: string; product: string; product_id: string; brand: string | null; delegate: string | null; dates: string[] | null }>(sql`
    select v.date::text as visit_date, pr.name as product, pr.id as product_id, b.name as brand, u.name as delegate,
      (select array_agg(p.date::text) from prescriptions p where p.doctor_id = v.doctor_id and p.product_id = vp.product_id
         and p.date between v.date - ${s.impactWindowDays}::int and v.date + ${s.impactWindowDays}::int) as dates
    from doctor_visits v join visit_products vp on vp.visit_id = v.id join products pr on pr.id = vp.product_id
    left join brands b on b.id = pr.brand_id left join users u on u.id = v.delegate_id
    where v.status = 'REALISEE' and v.date >= current_date - 365
      ${delegateUserId ? sql`and v.delegate_id = ${delegateUserId}::uuid` : sql``}`);
  const agg = (pick: (x: (typeof r.rows)[number]) => [string, string]) => {
    const m = new Map<string, ImpactAgg>();
    for (const x of r.rows) {
      const [key, label] = pick(x);
      const cur = m.get(key) ?? { key, label, measured: 0, pending: 0, before: 0, after: 0 };
      const imp = visitImpact(x.visit_date, x.dates ?? [], s.impactWindowDays, ref);
      if (imp.complete) {
        cur.measured++;
        cur.before += imp.before;
        cur.after += imp.after;
      } else cur.pending++;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.measured - a.measured || b.pending - a.pending);
  };
  return {
    byProduct: agg((x) => [x.product_id, x.product]),
    byBrand: agg((x) => [x.brand ?? "—", x.brand ?? "Sans marque"]),
    byDelegate: agg((x) => [x.delegate ?? "—", x.delegate ?? "—"]),
    windowDays: s.impactWindowDays,
    pairs: r.rows.length,
  };
}
