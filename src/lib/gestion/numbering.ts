import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { DbLike } from "@/lib/events/emit";
import { audit, type AuditActor } from "@/lib/audit";
import { formatNumber, nextNumberError, patternError, previewNext } from "./numbering-shared";

/**
 * Numérotation des pièces — seul module qui écrit `document_sequences`.
 *
 * Le numéro est pris par `allocateNumber()` DANS la transaction qui valide la pièce : l'upsert
 * verrouille la ligne du compteur (les validations simultanées attendent leur tour) et, si la
 * validation échoue, l'incrément est annulé avec elle. Il n'y a donc ni doublon ni trou.
 * Fonctionne avec le pooler transactionnel de Supabase (aucun verrou de session).
 */

export type SeriesRow = { key: string; label: string; pattern: string; sort: number; active: boolean; lastValue: number; issuedMax: number; next: string | null };

/** Séries et leur compteur pour une année (compteur absent = 0). */
export async function listSeries(year: number): Promise<SeriesRow[]> {
  const r = await db.execute<{ key: string; label: string; pattern: string; sort: number; active: boolean; last_value: number | null; issued_max: number | null }>(sql`
    select s.key, s.label, s.pattern, s.sort, s.active, q.last_value, q.issued_max
    from document_series s left join document_sequences q on q.series_key = s.key and q.year = ${year}
    order by s.sort, s.key`);
  return r.rows.map((x) => ({
    key: x.key, label: x.label, pattern: x.pattern, sort: x.sort, active: x.active,
    lastValue: x.last_value ?? 0, issuedMax: x.issued_max ?? 0,
    next: previewNext(x.pattern, year, x.last_value ?? 0),
  }));
}

/**
 * Attribue le numéro suivant d'une série pour la date de la pièce. À appeler uniquement dans
 * la transaction de validation (`tx`) : c'est ce qui garantit l'absence de trou.
 */
export async function allocateNumber(tx: DbLike, seriesKey: string, dateIso: string): Promise<{ number: string; seq: number; year: number }> {
  const year = Number(dateIso.slice(0, 4));
  const month = Number(dateIso.slice(5, 7));
  const series = (await tx.execute<{ pattern: string; active: boolean }>(sql`select pattern, active from document_series where key = ${seriesKey}`)).rows[0];
  if (!series) throw new Error(`Série de numérotation inconnue : ${seriesKey}.`);
  if (!series.active) throw new Error(`La série ${seriesKey} est désactivée.`);
  const r = await tx.execute<{ last_value: number }>(sql`
    insert into document_sequences (series_key, year, last_value, issued_max, updated_at) values (${seriesKey}, ${year}, 1, 1, now())
    on conflict (series_key, year) do update set
      last_value = document_sequences.last_value + 1,
      issued_max = document_sequences.last_value + 1,
      updated_at = now()
    returning last_value`);
  const seq = r.rows[0].last_value;
  return { number: formatNumber(series.pattern, { year, month, seq }), seq, year };
}

/**
 * Règle le prochain numéro d'une série pour une année — reprise de la séquence Sage à la bascule.
 * Refusé dès qu'une pièce a été numérotée cette année-là (la série doit rester continue).
 */
export async function setNextNumber(seriesKey: string, year: number, next: number, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const cur = (await tx.execute<{ last_value: number; issued_max: number }>(sql`
      select last_value, issued_max from document_sequences where series_key = ${seriesKey} and year = ${year} for update`)).rows[0];
    const err = nextNumberError(cur?.issued_max ?? 0, next);
    if (err) throw new Error(err);
    await tx.execute(sql`
      insert into document_sequences (series_key, year, last_value, issued_max, updated_at) values (${seriesKey}, ${year}, ${next - 1}, 0, now())
      on conflict (series_key, year) do update set last_value = ${next - 1}, updated_at = now()`);
    await audit({ actor, action: "SET_NEXT_NUMBER", module: "administration", entity: "document_series", label: `${seriesKey} ${year}`, before: { next: (cur?.last_value ?? 0) + 1 }, after: { next } }, tx);
  });
}

/** Modifie le libellé, le format ou l'activation d'une série. Un format invalide est refusé. */
export async function saveSeries(input: { key: string; label: string; pattern: string; active: boolean }, actor: AuditActor): Promise<void> {
  const err = patternError(input.pattern);
  if (err) throw new Error(err);
  await db.transaction(async (tx) => {
    const before = (await tx.execute<{ label: string; pattern: string; active: boolean }>(sql`select label, pattern, active from document_series where key = ${input.key} for update`)).rows[0];
    if (!before) throw new Error("Série introuvable.");
    await tx.execute(sql`update document_series set label = ${input.label}, pattern = ${input.pattern.trim()}, active = ${input.active} where key = ${input.key}`);
    await audit({ actor, action: "UPDATE", module: "administration", entity: "document_series", label: input.key, before, after: { label: input.label, pattern: input.pattern.trim(), active: input.active } }, tx);
  });
}
