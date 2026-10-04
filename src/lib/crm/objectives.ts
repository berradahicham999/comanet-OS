import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { audit, type AuditActor } from "@/lib/audit";
import { pgArray } from "@/lib/sql-array";
import type { CrmSettings } from "@/lib/settings";
import {
  monthBounds, monthElapsedPct, monthlyTarget, objectiveProgress,
  type Month, type ObjectiveRow, type ObjectiveLine, type ClientObjectiveStatus,
} from "./portfolio-shared";

export { headlineObjective, type ObjectiveLine, type ClientObjectiveStatus } from "./portfolio-shared";

/**
 * CRM commercial — objectifs par client. Ils vivent dans la table `objectives` (colonne `client_id`,
 * migration 0045) : aucune seconde table d'objectifs. Réalisé = sell-in HT du client (`sales.amount`,
 * toutes sources), la même mesure que le module Ventes. Sans objectif saisi : « aucun objectif défini »,
 * jamais une valeur déduite de l'historique.
 */

export type ClientObjective = { id: string; clientId: string; brandId: string | null; brandName: string | null; year: number; month: number | null; amount: number; units: number | null };

export async function clientObjectives(clientId: string, year?: number): Promise<ClientObjective[]> {
  const r = await db.execute<{ id: string; client_id: string; brand_id: string | null; brand_name: string | null; year: number; month: number | null; amount: number; units: number | null }>(sql`
    select o.id, o.client_id, o.brand_id, b.name as brand_name, o.year, o.month, o.amount::float8 as amount, o.units::float8 as units
    from objectives o left join brands b on b.id = o.brand_id
    where o.client_id = ${clientId}::uuid ${year ? sql`and o.year = ${year}` : sql``}
    order by o.year desc, o.month nulls first, b.name nulls first`);
  return r.rows.map((x) => ({ id: x.id, clientId: x.client_id, brandId: x.brand_id, brandName: x.brand_name, year: x.year, month: x.month, amount: Number(x.amount), units: x.units === null ? null : Number(x.units) }));
}

async function objectiveRows(clientIds: string[] | null, year: number): Promise<(ObjectiveRow & { brandName: string | null })[]> {
  const r = await db.execute<{ client_id: string; brand_id: string | null; brand_name: string | null; year: number; month: number | null; amount: number }>(sql`
    select o.client_id, o.brand_id, b.name as brand_name, o.year, o.month, o.amount::float8 as amount
    from objectives o left join brands b on b.id = o.brand_id
    where o.client_id is not null and o.year = ${year} ${clientIds ? sql`and o.client_id = any(${pgArray(clientIds)})` : sql``}`);
  return r.rows.map((x) => ({ clientId: x.client_id, brandId: x.brand_id, brandName: x.brand_name, year: x.year, month: x.month, amount: Number(x.amount) }));
}

/** Sell-in HT par client (et par marque) sur une période [start, end[. */
export async function realizedByClient(clientIds: string[] | null, start: string, end: string): Promise<Map<string, { total: number; byBrand: Map<string, number> }>> {
  const r = await db.execute<{ client_id: string; brand_id: string | null; amount: number }>(sql`
    select s.client_id, p.brand_id, sum(s.amount)::float8 as amount
    from sales s left join products p on p.id = s.product_id
    where s.date >= ${start}::date and s.date < ${end}::date and s.client_id is not null
      ${clientIds ? sql`and s.client_id = any(${pgArray(clientIds)})` : sql``}
    group by s.client_id, p.brand_id`);
  const out = new Map<string, { total: number; byBrand: Map<string, number> }>();
  for (const x of r.rows) {
    const cur = out.get(x.client_id) ?? { total: 0, byBrand: new Map<string, number>() };
    cur.total += Number(x.amount);
    if (x.brand_id) cur.byBrand.set(x.brand_id, (cur.byBrand.get(x.brand_id) ?? 0) + Number(x.amount));
    out.set(x.client_id, cur);
  }
  return out;
}

/** Avancement des objectifs du mois pour des clients (null = tous les clients qui ont un objectif). */
export async function clientObjectiveProgress(clientIds: string[] | null, month: Month, today: string, s: CrmSettings): Promise<Map<string, ClientObjectiveStatus>> {
  const b = monthBounds(month);
  const rows = await objectiveRows(clientIds, b.year);
  const out = new Map<string, ClientObjectiveStatus>();
  if (!rows.length) return out;
  const withObjective = [...new Set(rows.map((r) => r.clientId))];
  const realized = await realizedByClient(withObjective, b.start, b.end);
  const elapsedPct = monthElapsedPct(month, today);
  const opts = { elapsedPct, dayOfMonth: today.slice(0, 7) === month ? Number(today.slice(8, 10)) : today < b.start ? 0 : b.days, lateRatio: s.objectiveLateRatio, checkFromDay: s.objectiveCheckFromDay, monthOver: today >= b.end };
  for (const clientId of withObjective) {
    const mine = rows.filter((r) => r.clientId === clientId);
    const real = realized.get(clientId) ?? { total: 0, byBrand: new Map<string, number>() };
    const line = (brandId: string | null): ObjectiveLine | null => {
      const t = monthlyTarget(mine.filter((r) => r.brandId === brandId), b.year, b.month);
      if (!t) return null;
      const rv = brandId ? real.byBrand.get(brandId) ?? 0 : real.total;
      const p = objectiveProgress(t.amount, rv, opts);
      return { brandId, brandName: mine.find((r) => r.brandId === brandId)?.brandName ?? null, target: t.amount, source: t.source, realized: rv, pct: p.pct, verdict: p.verdict };
    };
    const brandIds = [...new Set(mine.map((r) => r.brandId).filter((x): x is string => !!x))];
    const status: ClientObjectiveStatus = {
      global: line(null),
      brands: brandIds.map((id) => line(id)).filter((x): x is ObjectiveLine => !!x).sort((a, c) => (a.brandName ?? "").localeCompare(c.brandName ?? "")),
      realized: real.total,
    };
    if (status.global || status.brands.length) out.set(clientId, status);
  }
  return out;
}

export type ObjectiveInput = { clientId: string; brandId: string | null; year: number; month: number | null; amount: number; units: number | null };

/** Saisie ou mise à jour d'un objectif client (une ligne par client × marque × année × mois), tracée. */
export async function saveClientObjective(actor: AuditActor, input: ObjectiveInput): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(input.clientId)) throw new Error("Client manquant.");
  if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) throw new Error("Année invalide.");
  if (input.month !== null && (!Number.isInteger(input.month) || input.month < 1 || input.month > 12)) throw new Error("Mois invalide.");
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 999_999_999) throw new Error("Montant de l'objectif invalide (CA HT en MAD, supérieur à zéro).");
  const zero = "00000000-0000-0000-0000-000000000000";
  await db.transaction(async (tx) => {
    const before = (await tx.execute<{ amount: number; units: number | null }>(sql`
      select amount::float8 as amount, units::float8 as units from objectives
      where client_id = ${input.clientId}::uuid and coalesce(brand_id, ${zero}::uuid) = coalesce(${input.brandId}::uuid, ${zero}::uuid)
        and product_id is null and year = ${input.year} and coalesce(month, 0) = ${input.month ?? 0}`)).rows[0] ?? null;
    const r = await tx.execute<{ id: string }>(sql`
      insert into objectives (brand_id, product_id, client_id, year, month, amount, units)
      values (${input.brandId}::uuid, null, ${input.clientId}::uuid, ${input.year}, ${input.month}, ${input.amount.toFixed(2)}::numeric, ${input.units === null ? null : input.units.toFixed(2)}::numeric)
      on conflict (coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid), year, coalesce(month, 0))
      do update set amount = excluded.amount, units = excluded.units
      returning id`);
    await audit({
      actor, action: before ? "UPDATE" : "CREATE", module: "clients", entity: "client_objective", entityId: input.clientId,
      label: `Objectif ${input.month ? `${String(input.month).padStart(2, "0")}/${input.year}` : input.year}`,
      before, after: { id: r.rows[0]?.id, brandId: input.brandId, year: input.year, month: input.month, amount: input.amount, units: input.units },
    }, tx);
  });
}

export async function deleteClientObjective(actor: AuditActor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const cur = (await tx.execute<{ client_id: string | null; brand_id: string | null; year: number; month: number | null; amount: number }>(
      sql`select client_id, brand_id, year, month, amount::float8 as amount from objectives where id = ${id}::uuid`,
    )).rows[0];
    if (!cur || !cur.client_id) throw new Error("Objectif client introuvable.");
    await tx.execute(sql`delete from objectives where id = ${id}::uuid and client_id is not null`);
    await audit({ actor, action: "DELETE", module: "clients", entity: "client_objective", entityId: cur.client_id, label: "Objectif supprimé", before: cur }, tx);
  });
}

/** Clients ayant au moins un objectif sur l'année (pour les compteurs). */
export async function clientsWithObjective(year: number): Promise<Set<string>> {
  const r = await db.execute<{ client_id: string }>(sql`select distinct client_id from objectives where client_id is not null and year = ${year}`);
  return new Set(r.rows.map((x) => x.client_id));
}
