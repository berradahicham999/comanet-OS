/**
 * Lectures serveur de la couche Marketing Intelligence : l'activité marketing d'une marque telle qu'elle
 * vit dans les modules existants (campagnes, planning éditorial, influence, activations). Lecture seule,
 * statuts lus par leurs drapeaux (`content_statuses`, `activation_statuses`), jamais par leur nom.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { addDays, iso } from "@/lib/format";
import { COLLAB_STATUS } from "@/lib/marketing-shared";
import type { MarketingActivity } from "./types";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function marketingActivity(o: { brandId: string; now: Date; windowDays: number }): Promise<MarketingActivity> {
  const today = iso(o.now), since = iso(addDays(o.now, -o.windowDays)), until = iso(addDays(o.now, o.windowDays));
  const [campaigns, contents, collabs, activations, brand] = await Promise.all([
    db.execute(sql`
      select c.id, c.name, c.type, c.channel::text as channel, c.status::text as status, c.objective, c.offer,
             c.start_date::text as start_date, c.end_date::text as end_date, c.budget::float8 as budget, c.kpi_target, c.kpi_actual,
             coalesce((select array_agg(p.name order by p.name) from campaign_products cp join products p on p.id = cp.product_id where cp.campaign_id = c.id), '{}'::text[]) as products,
             coalesce((select sum(e.amount) from marketing_expenses e where e.campaign_id = c.id and e.status <> 'PLANNED'), 0)::float8 as spent,
             coalesce((select sum(m.spend) from ad_metrics m where m.campaign_id = c.id), 0)::float8 as ad_spend
      from campaigns c
      where c.brand_id = ${o.brandId}::uuid
        and (c.status in ('ACTIVE','PAUSED','PLANNED','DRAFT') or coalesce(c.end_date, c.start_date) >= ${since}::date)
      order by (c.status = 'ACTIVE') desc, c.start_date desc nulls last limit 30`),
    db.execute(sql`
      select ci.id, ci.title, ci.date::text as date, ci.deadline::text as deadline, ci.platform, ci.format, ci.status, cs.label as status_label,
             cs.is_published, cs.awaiting_validation, cs.in_production, p.name as product,
             (not cs.is_published and coalesce(ci.deadline, ci.date) < ${today}::date) as late
      from content_items ci join content_statuses cs on cs.key = ci.status left join products p on p.id = ci.product_id
      where ci.brand_id = ${o.brandId}::uuid and not cs.is_archived and ci.date >= ${since}::date and ci.date < ${until}::date
      order by ci.date limit 40`),
    db.execute(sql`
      select co.id, i.name as influencer, co.date::text as date, co.status, co.content_type, p.name as product, co.fee::float8 as fee,
             co.product_value::float8 as product_value, co.promo_code, co.attributed_revenue::float8 as attributed_revenue, co.reach
      from collaborations co join influencers i on i.id = co.influencer_id left join products p on p.id = co.product_id
      where co.brand_id = ${o.brandId}::uuid and co.date >= ${since}::date and co.date < ${until}::date
      order by co.date desc limit 30`),
    db.execute(sql`
      select a.id, a.name, a.type, a.date::text as date, a.end_date::text as end_date, a.status, st.label as status_label,
             st.is_running, st.is_done, st.is_validated, st.awaiting_validation, a.city, a.budget_planned::float8 as budget_planned,
             a.attributed_revenue::float8 as attributed_revenue, p.name as product
      from activations a join activation_statuses st on st.key = a.status left join products p on p.id = a.product_id
      where (a.brand_id = ${o.brandId}::uuid or exists (select 1 from activation_brands ab where ab.activation_id = a.id and ab.brand_id = ${o.brandId}::uuid))
        and not st.is_archived and not st.is_cancelled
        and coalesce(a.end_date, a.date) >= ${since}::date and a.date < ${until}::date
      order by a.date limit 30`),
    db.execute(sql`select objectives from brands where id = ${o.brandId}::uuid`),
  ]);
  return {
    campaigns: (campaigns.rows as Row[]).map((r) => ({
      id: String(r.id), name: String(r.name), type: String(r.type), channel: String(r.channel), status: String(r.status), objective: s(r.objective), offer: s(r.offer),
      startDate: s(r.start_date), endDate: s(r.end_date), budget: n(r.budget), kpiTarget: s(r.kpi_target), kpiActual: s(r.kpi_actual),
      products: Array.isArray(r.products) ? (r.products as string[]) : [], spent: Number(r.spent), adSpend: Number(r.ad_spend),
    })),
    contents: (contents.rows as Row[]).map((r) => ({
      id: String(r.id), title: String(r.title), date: String(r.date), deadline: s(r.deadline), platform: s(r.platform), format: s(r.format), status: String(r.status), statusLabel: String(r.status_label),
      isPublished: !!r.is_published, awaitingValidation: !!r.awaiting_validation, inProduction: !!r.in_production, product: s(r.product), late: !!r.late,
    })),
    collaborations: (collabs.rows as Row[]).map((r) => ({
      id: String(r.id), influencer: String(r.influencer), date: String(r.date), status: String(r.status), done: COLLAB_STATUS[String(r.status)]?.done ?? false,
      contentType: s(r.content_type), product: s(r.product), fee: Number(r.fee), productValue: Number(r.product_value), promoCode: s(r.promo_code), attributedRevenue: n(r.attributed_revenue), reach: n(r.reach),
    })),
    activations: (activations.rows as Row[]).map((r) => ({
      id: String(r.id), name: String(r.name), type: String(r.type), date: String(r.date), endDate: s(r.end_date), status: String(r.status), statusLabel: String(r.status_label),
      isRunning: !!r.is_running, isDone: !!r.is_done, isValidated: !!r.is_validated, awaitingValidation: !!r.awaiting_validation, city: s(r.city),
      budgetPlanned: Number(r.budget_planned), attributedRevenue: n(r.attributed_revenue), product: s(r.product),
    })),
    brandObjectives: s((brand.rows[0] as Row | undefined)?.objectives),
  };
}
