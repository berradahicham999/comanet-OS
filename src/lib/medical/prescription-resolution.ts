import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { doctors, doctorAliases, productAliases, clientAliases, prescriptionIgnoredLabels } from "@/db/schema";
import { audit, type AuditActor } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { normKey } from "@/lib/import/normalize";
import { normalizeCity } from "@/lib/animations-shared";
import { pgArray } from "@/lib/sql-array";
import { doctorCandidate, doctorNameTokens, matchDoctor } from "./matching";
import { refreshDoctorPotentials } from "./prescriptions";

/**
 * Médical v2 — file de résolution des ordonnances : libellés de médecin, de produit et de pharmacie
 * non rapprochés, à associer, créer ou écarter. Chaque décision écrit un alias (le prochain import la
 * réutilise), rattache toutes les lignes du même libellé et laisse une trace `audit_logs`.
 */

export type DoctorQueueItem = {
  key: string;
  rawName: string;
  city: string | null;
  specialty: string | null;
  lines: number;
  lastDate: string;
  suggestions: { doctorId: string; label: string; score: number }[];
};

export type LabelQueueItem = { key: string; raw: string; lines: number; lastDate: string };

export type AutoMatch = { alias: string; doctorId: string; doctorLabel: string; rawName: string; lines: number; score: number | null };

export type PrescriptionOverview = {
  total: number;
  doctorMatched: number;
  productMatched: number;
  pharmacyMatched: number;
  withPharmacy: number;
  firstDate: string | null;
  lastDate: string | null;
  lastImport: { id: string; fileName: string; createdAt: string; warnings: string[]; errorRows: number; errors: { row: number; message: string }[] } | null;
};

export async function prescriptionOverview(): Promise<PrescriptionOverview> {
  const [t, imp] = await Promise.all([
    db.execute<{ total: number; dm: number; pm: number; cm: number; wp: number; first: string | null; last: string | null }>(sql`
      select count(*)::int as total,
        count(*) filter (where doctor_id is not null)::int as dm,
        count(*) filter (where product_id is not null)::int as pm,
        count(*) filter (where client_id is not null)::int as cm,
        count(*) filter (where pharmacy_raw is not null)::int as wp,
        min(date)::text as first, max(date)::text as last
      from prescriptions`),
    db.execute<{ id: string; file_name: string; created_at: string; warnings: string[]; error_rows: number; errors: { row: number; message: string }[] }>(sql`
      select id, file_name, created_at::text as created_at, warnings, error_rows, errors from imports where type = 'PRESCRIPTIONS' order by created_at desc limit 1`),
  ]);
  const x = t.rows[0];
  const i = imp.rows[0];
  return {
    total: x?.total ?? 0, doctorMatched: x?.dm ?? 0, productMatched: x?.pm ?? 0, pharmacyMatched: x?.cm ?? 0, withPharmacy: x?.wp ?? 0,
    firstDate: x?.first ?? null, lastDate: x?.last ?? null,
    lastImport: i ? { id: i.id, fileName: i.file_name, createdAt: i.created_at, warnings: i.warnings ?? [], errorRows: i.error_rows, errors: i.errors ?? [] } : null,
  };
}

/** Libellés médecin non rapprochés, du plus fréquent au moins fréquent, avec les meilleures suggestions. */
export async function doctorQueue(limit = 100): Promise<{ items: DoctorQueueItem[]; total: number }> {
  const s = (await getSettings()).medicalField;
  const [groups, count, docs] = await Promise.all([
    db.execute<{ key: string; raw_name: string; city: string | null; specialty: string | null; lines: number; last_date: string }>(sql`
      select doctor_raw_key as key, mode() within group (order by doctor_raw_name) as raw_name, max(city) as city,
        max(specialty_raw) as specialty, count(*)::int as lines, max(date)::text as last_date
      from prescriptions where doctor_id is null and doctor_match = 'NON_RAPPROCHE'
      group by doctor_raw_key order by count(*) desc limit ${limit}`),
    db.execute<{ n: number }>(sql`select count(distinct doctor_raw_key)::int as n from prescriptions where doctor_id is null and doctor_match = 'NON_RAPPROCHE'`),
    db.select({ id: doctors.id, firstName: doctors.firstName, lastName: doctors.lastName, city: doctors.city }).from(doctors),
  ]);
  const candidates = docs.map(doctorCandidate);
  // Suggestions larges (le seuil de suggestion abaissé) : c'est un humain qui tranche.
  const items = groups.rows.map((g) => {
    const m = matchDoctor(g.raw_name, g.city, candidates, new Map(), { autoScore: 2, suggestScore: Math.min(s.matchSuggestScore, 0.7), maxSuggestions: 4 });
    return { key: g.key, rawName: g.raw_name, city: g.city, specialty: g.specialty, lines: g.lines, lastDate: g.last_date, suggestions: m.kind === "NONE" ? m.suggestions : [] };
  });
  return { items, total: count.rows[0]?.n ?? 0 };
}

export async function productQueue(limit = 100): Promise<{ items: LabelQueueItem[]; total: number }> {
  const [r, c] = await Promise.all([
    db.execute<{ key: string; raw: string; lines: number; last_date: string }>(sql`
      select p.product_raw_key as key, mode() within group (order by p.product_raw) as raw, count(*)::int as lines, max(p.date)::text as last_date
      from prescriptions p
      where p.product_id is null
        and not exists (select 1 from prescription_ignored_labels i where i.kind = 'PRODUCT' and i.alias = p.product_raw_key)
      group by p.product_raw_key order by count(*) desc limit ${limit}`),
    db.execute<{ n: number }>(sql`
      select count(distinct p.product_raw_key)::int as n from prescriptions p where p.product_id is null
        and not exists (select 1 from prescription_ignored_labels i where i.kind = 'PRODUCT' and i.alias = p.product_raw_key)`),
  ]);
  return { items: r.rows.map((x) => ({ key: x.key, raw: x.raw, lines: x.lines, lastDate: x.last_date })), total: c.rows[0]?.n ?? 0 };
}

/** Pharmacies non rapprochées (clé = libellé normalisé, comme `client_aliases`). */
export async function pharmacyQueue(limit = 60): Promise<{ items: LabelQueueItem[]; total: number }> {
  const [r, ignored] = await Promise.all([
    db.execute<{ raw: string; lines: number; last_date: string }>(sql`
      select pharmacy_raw as raw, count(*)::int as lines, max(date)::text as last_date
      from prescriptions where client_id is null and pharmacy_raw is not null group by pharmacy_raw`),
    db.execute<{ alias: string }>(sql`select alias from prescription_ignored_labels where kind = 'PHARMACY'`),
  ]);
  const skip = new Set(ignored.rows.map((x) => x.alias));
  const byKey = new Map<string, LabelQueueItem>();
  for (const x of r.rows) {
    const key = normKey(x.raw);
    if (!key || skip.has(key)) continue;
    const cur = byKey.get(key);
    if (cur) {
      cur.lines += x.lines;
      if (x.last_date > cur.lastDate) cur.lastDate = x.last_date;
    } else byKey.set(key, { key, raw: x.raw, lines: x.lines, lastDate: x.last_date });
  }
  const all = [...byKey.values()].sort((a, b) => b.lines - a.lines);
  return { items: all.slice(0, limit), total: all.length };
}

/** Rapprochements automatiques (score) à vérifier, défaisables. */
export async function autoMatches(limit = 50): Promise<AutoMatch[]> {
  const r = await db.execute<{ alias: string; doctor_id: string; label: string; raw_name: string; lines: number; score: string | null }>(sql`
    select a.alias, a.doctor_id, 'Dr ' || d.first_name || ' ' || d.last_name || coalesce(' — ' || d.city, '') as label,
      mode() within group (order by p.doctor_raw_name) as raw_name, count(p.id)::int as lines, min(p.doctor_match_score)::text as score
    from doctor_aliases a join doctors d on d.id = a.doctor_id
    join prescriptions p on p.doctor_raw_key = a.alias and p.doctor_match = 'AUTO'
    where a.source = 'PRESCRIPTIONS'
    group by a.alias, a.doctor_id, d.first_name, d.last_name, d.city
    order by min(p.doctor_match_score) asc nulls first, count(p.id) desc limit ${limit}`);
  return r.rows.map((x) => ({ alias: x.alias, doctorId: x.doctor_id, doctorLabel: x.label, rawName: x.raw_name, lines: x.lines, score: x.score === null ? null : Number(x.score) }));
}

type Actor = AuditActor & { id: string };

/** Associe un libellé médecin à une fiche : alias + toutes les lignes de ce libellé. */
export async function resolveDoctor(actor: Actor, key: string, doctorId: string): Promise<number> {
  const n = await db.transaction(async (tx) => {
    await tx.insert(doctorAliases).values({ alias: key, doctorId, source: "MANUEL", createdById: actor.id })
      .onConflictDoUpdate({ target: doctorAliases.alias, set: { doctorId, source: "MANUEL", createdById: actor.id, importId: null } });
    await tx.execute(sql`delete from prescription_ignored_labels where kind = 'DOCTOR' and alias = ${key}`);
    const r = await tx.execute(sql`
      update prescriptions set doctor_id = ${doctorId}::uuid, doctor_match = 'MANUEL', doctor_match_score = null
      where doctor_raw_key = ${key}`);
    await audit({ actor, action: "UPDATE", module: "medical", entity: "doctor_alias", entityId: doctorId, label: `Ordonnances : libellé « ${key} » associé au médecin`, after: { alias: key, doctorId, lines: r.rowCount } }, tx);
    return r.rowCount ?? 0;
  });
  await refreshDoctorPotentials().catch(() => {});
  return n;
}

/** Crée la fiche médecin depuis un libellé d'ordonnance, puis l'associe. */
export async function createDoctorFromLabel(actor: Actor, key: string, input: { firstName: string; lastName: string; city: string | null; specialtyId: string | null }): Promise<string> {
  const [row] = await db.insert(doctors).values({
    firstName: input.firstName.trim(), lastName: input.lastName.trim(), city: normalizeCity(input.city) ?? input.city, specialtyId: input.specialtyId, status: "NOUVEAU",
    comments: "Créé depuis les ordonnances (Médical → Ordonnances).",
  }).returning({ id: doctors.id });
  await audit({ actor, action: "CREATE", module: "medical", entity: "doctor", entityId: row.id, label: `Dr ${input.firstName} ${input.lastName} (créé depuis les ordonnances)` });
  await resolveDoctor(actor, key, row.id);
  return row.id;
}

/** Écarte un libellé (médecin hors fichier, produit concurrent, pharmacie inconnue) de la file. */
export async function ignoreLabel(actor: Actor, kind: "DOCTOR" | "PRODUCT" | "PHARMACY", key: string, label: string) {
  await db.transaction(async (tx) => {
    await tx.insert(prescriptionIgnoredLabels).values({ kind, alias: key, label: label.slice(0, 200), createdById: actor.id }).onConflictDoNothing();
    if (kind === "DOCTOR") await tx.execute(sql`update prescriptions set doctor_match = 'IGNORE' where doctor_raw_key = ${key} and doctor_id is null`);
    await audit({ actor, action: "ARCHIVE", module: "medical", entity: "prescription_label", label: `Ordonnances : libellé ${kind === "DOCTOR" ? "médecin" : kind === "PRODUCT" ? "produit" : "pharmacie"} « ${label} » écarté` }, tx);
  });
}

/** Associe un libellé produit à un produit du catalogue (alias réutilisé par tous les imports). */
export async function resolveProduct(actor: Actor, key: string, productId: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.insert(productAliases).values({ alias: key, productId, source: "PRESCRIPTIONS" }).onConflictDoUpdate({ target: productAliases.alias, set: { productId } });
    await tx.execute(sql`delete from prescription_ignored_labels where kind = 'PRODUCT' and alias = ${key}`);
    const r = await tx.execute(sql`update prescriptions set product_id = ${productId}::uuid where product_raw_key = ${key}`);
    await audit({ actor, action: "UPDATE", module: "medical", entity: "product_alias", entityId: productId, label: `Ordonnances : libellé produit « ${key} » associé`, after: { alias: key, productId, lines: r.rowCount } }, tx);
    return r.rowCount ?? 0;
  }).then(async (n) => { await refreshDoctorPotentials().catch(() => {}); return n; });
}

/** Associe une pharmacie à un client (alias `client_aliases`, réutilisé par les imports de ventes). */
export async function resolvePharmacy(actor: Actor, key: string, clientId: string): Promise<number> {
  const raws = (await db.execute<{ raw: string }>(sql`select distinct pharmacy_raw as raw from prescriptions where client_id is null and pharmacy_raw is not null`)).rows
    .map((x) => x.raw).filter((raw) => normKey(raw) === key);
  if (!raws.length) return 0;
  return db.transaction(async (tx) => {
    await tx.insert(clientAliases).values({ alias: key, clientId, source: "PRESCRIPTIONS" }).onConflictDoNothing();
    const r = await tx.execute(sql`update prescriptions set client_id = ${clientId}::uuid where client_id is null and pharmacy_raw = any(${pgArray(raws, "text")})`);
    await audit({ actor, action: "UPDATE", module: "medical", entity: "client_alias", entityId: clientId, label: `Ordonnances : pharmacie « ${raws[0]} » associée`, after: { alias: key, clientId, lines: r.rowCount } }, tx);
    return r.rowCount ?? 0;
  });
}

/** Défait un rapprochement automatique : l'alias appris disparaît, les lignes repartent en file. */
export async function undoAutoMatch(actor: Actor, alias: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from doctor_aliases where alias = ${alias} and source = 'PRESCRIPTIONS'`);
    const r = await tx.execute(sql`update prescriptions set doctor_id = null, doctor_match = 'NON_RAPPROCHE', doctor_match_score = null where doctor_raw_key = ${alias} and doctor_match = 'AUTO'`);
    await audit({ actor, action: "UPDATE", module: "medical", entity: "doctor_alias", label: `Ordonnances : rapprochement automatique « ${alias} » défait`, after: { lines: r.rowCount } }, tx);
  });
  await refreshDoctorPotentials().catch(() => {});
}

/** Prénom / nom proposés depuis un libellé brut (le dernier mot comme nom, le reste comme prénom). */
export function splitDoctorName(raw: string): { firstName: string; lastName: string } {
  const toks = raw.replace(/\b(dr|dre|docteur|pr|prof|professeur)\.?\s+/gi, "").trim().split(/\s+/).filter(Boolean);
  if (toks.length <= 1) return { firstName: "", lastName: toks[0] ?? "" };
  // Libellés « NOM Prénom » (majuscules d'abord) : le nom est le mot en capitales.
  const upper = toks.findIndex((t) => t.length > 1 && t === t.toUpperCase());
  if (upper >= 0) {
    const last = toks[upper];
    return { firstName: toks.filter((_, i) => i !== upper).join(" "), lastName: last };
  }
  return { firstName: toks.slice(0, -1).join(" "), lastName: toks[toks.length - 1] };
}

export { doctorNameTokens };
