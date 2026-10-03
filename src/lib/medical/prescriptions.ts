import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSettings, type MedicalFieldSettings } from "@/lib/settings";
import { cityKey as officialCityKey } from "@/lib/animations-shared";
import { pgArray } from "@/lib/sql-array";
import {
  doctorPotential, recommendProducts, type PrescriberStats, type PrescriberProducts, type PotentialResult, type RecommendationResult, type Potential,
} from "./prescriptions-shared";

/**
 * Médical v2 — lecture des ordonnances pour un médecin (potentiel, produits prescrits, produits à
 * présenter, fiche pré-visite). Les calculs sont dans `prescriptions-shared.ts` ; ce module ne fait
 * que charger les données et écrire le potentiel automatique (jamais par-dessus une valeur saisie).
 */

const cityKey = (c: string | null | undefined) => (c ? officialCityKey(c) || null : null);

async function prescriberStats(s: MedicalFieldSettings): Promise<PrescriberStats[]> {
  const r = await db.execute<{ doctor_id: string; specialty: string | null; lines: number; recent: number; previous: number; brands: number }>(sql`
    select p.doctor_id, d.specialty_id::text as specialty, count(*)::int as lines,
      count(*) filter (where p.date >= (current_date - make_interval(months => ${s.trendMonths})))::int as recent,
      count(*) filter (where p.date >= (current_date - make_interval(months => ${2 * s.trendMonths})) and p.date < (current_date - make_interval(months => ${s.trendMonths})))::int as previous,
      count(distinct pr.brand_id)::int as brands
    from prescriptions p join doctors d on d.id = p.doctor_id join products pr on pr.id = p.product_id
    where p.date >= (current_date - make_interval(months => ${s.potentialMonths}))
    group by p.doctor_id, d.specialty_id`);
  return r.rows.map((x) => ({ doctorId: x.doctor_id, specialty: x.specialty, lines: x.lines, recent: x.recent, previous: x.previous, brands: x.brands }));
}

/**
 * Recalcule le potentiel automatique de tous les médecins observés. Le détail (motifs, observations)
 * est toujours gardé ; `potential` n'est écrit que si aucune valeur n'a été saisie à la main.
 */
export async function refreshDoctorPotentials(): Promise<{ computed: number; written: number }> {
  const s = (await getSettings()).medicalField;
  const stats = await prescriberStats(s);
  const results = stats.map((me) => ({ id: me.doctorId, res: doctorPotential(me, stats, s) }));
  const computedAt = new Date().toISOString();
  let written = 0;
  for (let i = 0; i < results.length; i += 500) {
    const chunk = results.slice(i, i + 500);
    const payload = JSON.stringify(chunk.map((c) => ({ id: c.id, level: c.res.level, detail: { ...c.res, computedAt } })));
    const r = await db.execute(sql`
      update doctors d set
        potential_detail = x.detail,
        potential = case when d.potential_source = 'MANUELLE' then d.potential else x.level::doctor_potential end,
        potential_source = case when d.potential_source = 'MANUELLE' then 'MANUELLE' when x.level is null then null else 'AUTO' end,
        updated_at = now()
      from jsonb_to_recordset(${payload}::jsonb) as x(id uuid, level text, detail jsonb)
      where d.id = x.id`);
    written += r.rowCount ?? 0;
  }
  // Un potentiel automatique dont le médecin n'a plus d'ordonnance sur la fenêtre n'est plus justifié.
  if (results.length) {
    await db.execute(sql`update doctors set potential = null, potential_source = null where potential_source = 'AUTO' and not (id = any(${pgArray(results.map((r) => r.id))}))`);
  } else {
    await db.execute(sql`update doctors set potential = null, potential_source = null where potential_source = 'AUTO'`);
  }
  return { computed: results.length, written };
}

export type PrescribedProduct = { productId: string; name: string; brand: string | null; lines: number; units: number; lastDate: string };

export type DoctorPrescriptionProfile = {
  observations: number;
  firstDate: string | null;
  lastDate: string | null;
  products: PrescribedProduct[];
  potential: { level: Potential | null; source: "MANUELLE" | "AUTO" | null; computed: PotentialResult | null };
  recommendations: Omit<RecommendationResult, "items"> & { items: (RecommendationResult["items"][number] & { name: string; brand: string | null })[] };
};

/** Ordonnances d'un médecin : produits prescrits, potentiel (saisi ou calculé), 3 produits à présenter. */
export async function doctorPrescriptionProfile(doctorId: string): Promise<DoctorPrescriptionProfile | null> {
  const s = (await getSettings()).medicalField;
  const d = (await db.execute<{ id: string; specialty_id: string | null; specialty: string | null; city: string | null; potential: Potential | null; potential_source: "MANUELLE" | "AUTO" | null; potential_detail: PotentialResult | null }>(sql`
    select d.id, d.specialty_id, sp.name as specialty, d.city, d.potential, d.potential_source, d.potential_detail
    from doctors d left join medical_specialties sp on sp.id = d.specialty_id where d.id = ${doctorId}::uuid`)).rows[0];
  if (!d) return null;

  const [mine, totals, peersRes] = await Promise.all([
    db.execute<{ product_id: string; name: string; brand: string | null; lines: number; units: number; last_date: string }>(sql`
      select p.product_id, pr.name, b.name as brand, count(*)::int as lines, sum(p.quantity)::int as units, max(p.date)::text as last_date
      from prescriptions p join products pr on pr.id = p.product_id left join brands b on b.id = pr.brand_id
      where p.doctor_id = ${doctorId}::uuid group by p.product_id, pr.name, b.name order by lines desc`),
    db.execute<{ n: number; first: string | null; last: string | null }>(sql`
      select count(*)::int as n, min(date)::text as first, max(date)::text as last from prescriptions where doctor_id = ${doctorId}::uuid`),
    d.specialty_id
      ? db.execute<{ doctor_id: string; city: string | null; products: string[] }>(sql`
          select p.doctor_id, dd.city, array_agg(distinct p.product_id::text) as products
          from prescriptions p join doctors dd on dd.id = p.doctor_id
          where p.product_id is not null and dd.specialty_id = ${d.specialty_id}::uuid
          group by p.doctor_id, dd.city`)
      : Promise.resolve({ rows: [] as { doctor_id: string; city: string | null; products: string[] }[] }),
  ]);

  const products = mine.rows.map((x) => ({ productId: x.product_id, name: x.name, brand: x.brand, lines: x.lines, units: x.units, lastDate: x.last_date }));
  const all: PrescriberProducts[] = peersRes.rows.map((x) => ({ doctorId: x.doctor_id, specialty: d.specialty_id, city: cityKey(x.city), products: new Set(x.products) }));
  const ids = new Set<string>(all.flatMap((p) => [...p.products]));
  const nameRows = ids.size
    ? (await db.execute<{ id: string; name: string; brand: string | null }>(sql`
        select pr.id, pr.name, b.name as brand from products pr left join brands b on b.id = pr.brand_id
        where pr.id = any(${pgArray([...ids])})`)).rows
    : [];
  const names = new Map(nameRows.map((x) => [x.id, x.name]));
  const brands = new Map(nameRows.map((x) => [x.id, x.brand]));
  const reco = recommendProducts(
    { doctorId, specialty: d.specialty_id, city: cityKey(d.city), products: new Set(products.map((p) => p.productId)) },
    all,
    names,
    { specialty: d.specialty ?? "Médecin", city: d.city },
    s,
  );
  const t = totals.rows[0];
  return {
    observations: t?.n ?? 0,
    firstDate: t?.first ?? null,
    lastDate: t?.last ?? null,
    products,
    potential: { level: d.potential, source: d.potential_source, computed: d.potential_detail },
    recommendations: { ...reco, items: reco.items.map((i) => ({ ...i, name: names.get(i.productId) ?? "—", brand: brands.get(i.productId) ?? null })) },
  };
}

export type DoctorBrief = {
  doctor: { id: string; name: string; specialty: string | null; city: string | null; potential: Potential | null; potentialSource: string | null };
  lastReport: {
    date: string; result: string | null; comment: string | null; objections: string | null; nextAction: string | null;
    interest: string | null; products: string[];
  } | null;
  objections: { date: string; text: string }[];
  samples: { name: string; quantity: number; lastDate: string }[];
  prescriptions: DoctorPrescriptionProfile | null;
};

/** Fiche pré-visite (mobile) : dernier compte rendu, objections, échantillons déjà remis, ordonnances, 3 produits à présenter. */
export async function doctorBrief(doctorId: string): Promise<DoctorBrief | null> {
  const doc = (await db.execute<{ id: string; name: string; specialty: string | null; city: string | null; potential: Potential | null; potential_source: string | null }>(sql`
    select d.id, d.first_name || ' ' || d.last_name as name, sp.name as specialty, d.city, d.potential, d.potential_source
    from doctors d left join medical_specialties sp on sp.id = d.specialty_id where d.id = ${doctorId}::uuid`)).rows[0];
  if (!doc) return null;
  const [last, objections, samples, profile] = await Promise.all([
    db.execute<{ date: string; result: string | null; comment: string | null; objections: string | null; next_action: string | null; doctor_interest: string | null; products: string[] | null }>(sql`
      select v.date::text as date, v.result, v.comment, v.objections, v.next_action, v.doctor_interest,
        (select array_agg(pr.name order by pr.name) from visit_products vp join products pr on pr.id = vp.product_id where vp.visit_id = v.id) as products
      from doctor_visits v where v.doctor_id = ${doctorId}::uuid and v.status = 'REALISEE'
      order by v.date desc, coalesce(v.ended_at, v.created_at) desc limit 1`),
    db.execute<{ date: string; objections: string }>(sql`
      select date::text as date, objections from doctor_visits
      where doctor_id = ${doctorId}::uuid and objections is not null and objections <> '' order by date desc limit 5`),
    db.execute<{ name: string; quantity: number; last_date: string }>(sql`
      select pr.name, sum(vs.quantity)::int as quantity, max(v.date)::text as last_date
      from visit_samples vs join doctor_visits v on v.id = vs.visit_id join products pr on pr.id = vs.product_id
      where v.doctor_id = ${doctorId}::uuid and v.status = 'REALISEE' group by pr.name order by max(v.date) desc limit 10`),
    doctorPrescriptionProfile(doctorId),
  ]);
  const l = last.rows[0];
  return {
    doctor: { id: doc.id, name: doc.name, specialty: doc.specialty, city: doc.city, potential: doc.potential, potentialSource: doc.potential_source },
    lastReport: l ? { date: l.date, result: l.result, comment: l.comment, objections: l.objections, nextAction: l.next_action, interest: l.doctor_interest, products: l.products ?? [] } : null,
    objections: objections.rows.map((o) => ({ date: o.date, text: o.objections })),
    samples: samples.rows.map((x) => ({ name: x.name, quantity: x.quantity, lastDate: x.last_date })),
    prescriptions: profile,
  };
}
