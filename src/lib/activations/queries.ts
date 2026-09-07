import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { iso, today } from "@/lib/format";
import type { ActivationSettings } from "@/lib/settings";
import type { ActivationScope } from "./access";
import { scopeSql } from "./access";
import { activationLateness, budgetTotals, type ActivationRefs, type LatenessKind } from "./shared";

export type ActivationFilters = {
  /** Période (fin exclusive) sur les dates de l'activation ; `null` = tout. */
  start?: string | null; end?: string | null;
  brand?: string | null; type?: string | null; status?: string | null; city?: string | null; responsible?: string | null; campaign?: string | null;
  /** Texte libre : nom, lieu, ville. */
  q?: string | null;
  includeClosed?: boolean;
};

export type ActivationCard = {
  id: string; name: string; type: string; status: string; date: string; endDate: string | null; prepDate: string | null;
  city: string | null; place: string | null; brandId: string | null; brand: string | null; color: string | null; brandCount: number;
  objectiveKey: string | null; targetKey: string | null; responsibleId: string | null; responsible: string | null; validatorId: string | null;
  campaignId: string | null; campaign: string | null; clientId: string | null; client: string | null; clientCount: number; productCount: number;
  planned: number; committed: number; spent: number; materials: number;
  checklistTotal: number; checklistDone: number; hasResults: boolean; hasPhoto: boolean;
  participants: number | null; leads: number | null; samples: number | null; pharmaciesReached: number | null; attributedRevenue: number | null;
  updatedAt: string;
  late: LatenessKind[];
  fullCost: number; remaining: number; overrunPct: number;
};

type Raw = Omit<ActivationCard, "late" | "fullCost" | "remaining" | "overrunPct">;

/** Fragment d'agrégats budgétaires par activation (liste et fiche) ; `s` = activation_statuses joint. Même règle que `budgetTotals()` : validée ⇒ prévu engagé. */
export const BUDGET_AGG = sql`
  coalesce((select sum(l.planned) from activation_budget_lines l where l.activation_id = a.id), 0)::float8 as planned,
  coalesce((select sum(case when greatest(l.committed, l.spent) > 0 then greatest(l.committed, l.spent) when s.is_validated and not s.is_cancelled then l.planned else 0 end) from activation_budget_lines l where l.activation_id = a.id), 0)::float8 as committed,
  coalesce((select sum(l.spent) from activation_budget_lines l where l.activation_id = a.id), 0)::float8 as spent,
  coalesce((select sum(m.quantity * m.unit_cost) from activation_materials m where m.activation_id = a.id), 0)::float8 as materials`;

/** Liste filtrée, une requête indexée sur (status, date) et brand_id. */
export async function listActivations(f: ActivationFilters, scope: ActivationScope, refs: ActivationRefs, settings: ActivationSettings, todayIso = iso(today())): Promise<ActivationCard[]> {
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null;
  const r = await db.execute<Raw>(sql`
    select a.id, a.name, a.type, a.status, a.date::text as date, a.end_date::text as "endDate", a.prep_date::text as "prepDate",
      a.city, a.place, a.brand_id as "brandId", b.name as brand, b.color, (select count(*) from activation_brands x where x.activation_id = a.id)::int as "brandCount",
      a.objective_key as "objectiveKey", a.target_key as "targetKey", a.responsible_id as "responsibleId", u.name as responsible, a.validator_id as "validatorId",
      a.campaign_id as "campaignId", k.name as campaign, a.client_id as "clientId", c.name as client,
      (select count(*) from activation_clients x where x.activation_id = a.id)::int as "clientCount",
      (select count(*) from activation_products x where x.activation_id = a.id)::int as "productCount",
      ${BUDGET_AGG},
      (select count(*) from activation_checklist_items x where x.activation_id = a.id)::int as "checklistTotal",
      (select count(*) from activation_checklist_items x where x.activation_id = a.id and x.done)::int as "checklistDone",
      (a.results_at is not null) as "hasResults",
      exists (select 1 from content_assets x where x.activation_id = a.id and x.kind = 'PHOTO') as "hasPhoto",
      a.participants, a.leads, a.samples, a.pharmacies_reached as "pharmaciesReached", a.attributed_revenue::float8 as "attributedRevenue",
      a.updated_at::text as "updatedAt"
    from activations a join activation_statuses s on s.key = a.status
    left join brands b on b.id = a.brand_id left join users u on u.id = a.responsible_id
    left join campaigns k on k.id = a.campaign_id left join clients c on c.id = a.client_id
    where true
      ${f.start ? sql`and coalesce(a.end_date, a.date) >= ${f.start}::date` : sql``}
      ${f.end ? sql`and a.date < ${f.end}::date` : sql``}
      ${f.brand ? sql`and (a.brand_id = ${f.brand}::uuid or exists (select 1 from activation_brands x where x.activation_id = a.id and x.brand_id = ${f.brand}::uuid))` : sql``}
      ${f.type ? sql`and a.type = ${f.type}` : sql``}
      ${f.status ? sql`and a.status = ${f.status}` : sql``}
      ${f.city ? sql`and lower(a.city) = lower(${f.city})` : sql``}
      ${f.responsible ? sql`and (a.responsible_id = ${f.responsible}::uuid or exists (select 1 from activation_contributors x where x.activation_id = a.id and x.user_id = ${f.responsible}::uuid))` : sql``}
      ${f.campaign ? sql`and a.campaign_id = ${f.campaign}::uuid` : sql``}
      ${q ? sql`and (a.name ilike ${q} or a.place ilike ${q} or a.city ilike ${q})` : sql``}
      ${f.includeClosed ? sql`` : sql`and a.status not in (select key from activation_statuses where is_archived or is_cancelled)`}
      ${scopeSql(scope)}
    order by a.date desc, a.name`);
  return r.rows.map((x) => withDerived(x, refs, settings, todayIso));
}

function withDerived(x: Raw, refs: ActivationRefs, settings: ActivationSettings, todayIso: string): ActivationCard {
  const totals = budgetTotals([{ planned: x.planned, committed: x.committed, spent: x.spent }], [{ quantity: 1, unitCost: x.materials }]);
  return {
    ...x, fullCost: totals.fullCost, remaining: totals.remaining, overrunPct: totals.overrunPct,
    late: activationLateness({ date: x.date, endDate: x.endDate, status: x.status, hasResults: x.hasResults, checklistTotal: x.checklistTotal, checklistDone: x.checklistDone, totals }, refs.statuses, settings, todayIso),
  };
}

export type ActivationDetail = ActivationCard & {
  description: string | null; objective: string | null; notes: string | null; results: string | null; publishedLink: string | null;
  productId: string | null; product: string | null; templateId: string | null; linkedAnimationId: string | null;
  createdById: string | null; createdBy: string | null; validator: string | null; validatedAt: string | null; measuredAt: string | null; resultsAt: string | null; createdAt: string;
  newClients: number | null; ordersOnSite: number | null; ordersAmount: number | null; pressMentions: number | null;
  brandIds: string[]; productIds: string[]; clientIds: string[]; contributorIds: string[];
};

/** Fiche complète d'une activation, dans la portée donnée (sinon `null`). */
export async function getActivation(id: string, scope: ActivationScope, refs: ActivationRefs, settings: ActivationSettings, todayIso = iso(today())): Promise<ActivationDetail | null> {
  const r = await db.execute<Omit<ActivationDetail, "late" | "fullCost" | "remaining" | "overrunPct">>(sql`
    select a.id, a.name, a.type, a.status, a.date::text as date, a.end_date::text as "endDate", a.prep_date::text as "prepDate",
      a.city, a.place, a.brand_id as "brandId", b.name as brand, b.color, (select count(*) from activation_brands x where x.activation_id = a.id)::int as "brandCount",
      a.objective_key as "objectiveKey", a.target_key as "targetKey", a.responsible_id as "responsibleId", u.name as responsible, a.validator_id as "validatorId", vu.name as validator,
      a.campaign_id as "campaignId", k.name as campaign, a.client_id as "clientId", c.name as client,
      (select count(*) from activation_clients x where x.activation_id = a.id)::int as "clientCount",
      (select count(*) from activation_products x where x.activation_id = a.id)::int as "productCount",
      ${BUDGET_AGG},
      (select count(*) from activation_checklist_items x where x.activation_id = a.id)::int as "checklistTotal",
      (select count(*) from activation_checklist_items x where x.activation_id = a.id and x.done)::int as "checklistDone",
      (a.results_at is not null) as "hasResults",
      exists (select 1 from content_assets x where x.activation_id = a.id and x.kind = 'PHOTO') as "hasPhoto",
      a.participants, a.leads, a.samples, a.pharmacies_reached as "pharmaciesReached", a.attributed_revenue::float8 as "attributedRevenue",
      a.updated_at::text as "updatedAt",
      a.description, a.objective, a.notes, a.results, a.published_link as "publishedLink",
      a.product_id as "productId", p.name as product, a.template_id as "templateId", a.linked_animation_id as "linkedAnimationId",
      a.created_by_id as "createdById", cu.name as "createdBy", a.validated_at::text as "validatedAt", a.measured_at::text as "measuredAt", a.results_at::text as "resultsAt", a.created_at::text as "createdAt",
      a.new_clients as "newClients", a.orders_on_site as "ordersOnSite", a.orders_amount::float8 as "ordersAmount", a.press_mentions as "pressMentions",
      coalesce((select array_agg(x.brand_id) from activation_brands x where x.activation_id = a.id), '{}') as "brandIds",
      coalesce((select array_agg(x.product_id) from activation_products x where x.activation_id = a.id), '{}') as "productIds",
      coalesce((select array_agg(x.client_id) from activation_clients x where x.activation_id = a.id), '{}') as "clientIds",
      coalesce((select array_agg(x.user_id) from activation_contributors x where x.activation_id = a.id), '{}') as "contributorIds"
    from activations a join activation_statuses s on s.key = a.status
    left join brands b on b.id = a.brand_id left join users u on u.id = a.responsible_id left join users vu on vu.id = a.validator_id left join users cu on cu.id = a.created_by_id
    left join campaigns k on k.id = a.campaign_id left join clients c on c.id = a.client_id left join products p on p.id = a.product_id
    where a.id = ${id}::uuid ${scopeSql(scope)}`);
  const x = r.rows[0];
  return x ? { ...x, ...withDerived(x, refs, settings, todayIso) } : null;
}

/** Villes connues (activations + clients), pour les filtres et l'autocomplétion. */
export async function knownCities(): Promise<string[]> {
  const r = await db.execute<{ city: string }>(sql`
    select city from (select distinct city from activations where city is not null union select distinct city from clients where city is not null and active) x order by city`);
  return r.rows.map((c) => c.city);
}

/** Options des sélecteurs de la fiche (chargées une fois, filtrées côté client). */
export async function pickerOptions() {
  const [clients, products, campaigns, animations] = await Promise.all([
    db.execute<{ id: string; name: string; city: string | null; type: string }>(sql`select id, name, city, type::text as type from clients where active order by name`),
    db.execute<{ id: string; name: string; brandId: string | null }>(sql`select id, name, brand_id as "brandId" from products where active order by name`),
    db.execute<{ id: string; name: string; brandId: string }>(sql`select id, name, brand_id as "brandId" from campaigns where status not in ('DONE','ANALYZED') order by start_date desc nulls last, name`),
    db.execute<{ id: string; label: string }>(sql`select a.id, (a.date::text || ' · ' || coalesce(a.city, '') || ' · ' || coalesce(c.name, '')) as label from animations a left join clients c on c.id = a.client_id where a.date >= current_date - 180 order by a.date desc limit 300`),
  ]);
  return { clients: clients.rows, products: products.rows, campaigns: campaigns.rows, animations: animations.rows };
}

export function periodSql(start: string, end: string): SQL {
  return sql`coalesce(a.end_date, a.date) >= ${start}::date and a.date < ${end}::date`;
}

export type ValidationQueueRow = {
  id: string; name: string; type: string; date: string; endDate: string | null; city: string | null; place: string | null;
  brandId: string | null; brand: string | null; color: string | null; description: string | null; objectiveKey: string | null; targetKey: string | null;
  responsible: string | null; createdBy: string | null; since: string;
  planned: number; checklistTotal: number; checklistDone: number; clientCount: number; productCount: number;
  lines: { label: string; costItem: string; planned: number }[];
  assetId: string | null; assetMime: string | null; assetName: string | null;
};

/** Activations en attente de validation (file du DG), dans la portée donnée, la plus ancienne d'abord. */
export async function activationValidationQueue(scope: ActivationScope): Promise<ValidationQueueRow[]> {
  const r = await db.execute<ValidationQueueRow>(sql`
    select a.id, a.name, a.type, a.date::text as date, a.end_date::text as "endDate", a.city, a.place,
      a.brand_id as "brandId", b.name as brand, b.color, a.description, a.objective_key as "objectiveKey", a.target_key as "targetKey",
      u.name as responsible, cu.name as "createdBy",
      coalesce((select max(h.created_at) from activation_status_history h where h.activation_id = a.id and h.to_status = a.status), a.updated_at)::text as since,
      coalesce((select sum(l.planned) from activation_budget_lines l where l.activation_id = a.id), 0)::float8 as planned,
      (select count(*) from activation_checklist_items x where x.activation_id = a.id)::int as "checklistTotal",
      (select count(*) from activation_checklist_items x where x.activation_id = a.id and x.done)::int as "checklistDone",
      (select count(*) from activation_clients x where x.activation_id = a.id)::int as "clientCount",
      (select count(*) from activation_products x where x.activation_id = a.id)::int as "productCount",
      coalesce((select json_agg(json_build_object('label', l.label, 'costItem', ci.label, 'planned', l.planned::float8) order by l.sort)
        from activation_budget_lines l join activation_cost_items ci on ci.key = l.cost_item_key where l.activation_id = a.id), '[]'::json) as lines,
      f.id as "assetId", f.mime as "assetMime", f.name as "assetName"
    from activations a join activation_statuses s on s.key = a.status
    left join brands b on b.id = a.brand_id left join users u on u.id = a.responsible_id left join users cu on cu.id = a.created_by_id
    left join lateral (select id, mime, name from content_assets x where x.activation_id = a.id and x.kind in ('PHOTO', 'VISUEL', 'DEVIS', 'REFERENCE')
      order by (x.kind = 'VISUEL') desc, (x.kind = 'PHOTO') desc, x.version desc, x.created_at desc limit 1) f on true
    where s.awaiting_validation ${scopeSql(scope)}
    order by since asc`);
  return r.rows;
}
