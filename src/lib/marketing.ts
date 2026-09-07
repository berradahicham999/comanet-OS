/**
 * Marketing Command Center — agrégats transverses.
 *
 * Tout se lit sur les tables existantes : budgets, budget_lines, marketing_expenses,
 * campaigns, ad_metrics, collaborations, activations, content_items, sales, animations, stock.
 *
 * Règle de lecture appliquée partout : une dépense et un chiffre d'affaires observés sur la même
 * période sont présentés comme une CORRÉLATION. Le mot « généré » n'est employé que sur un montant
 * réellement attribué (CA saisi sur une dépense, une collaboration ou une activation).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { addMonths, iso, startOfMonth } from "./format";
import { budgetConsumption, type BudgetConsumption } from "./budget";
import { productStocks } from "./stock";
import type { CoverageLevel } from "./stock-math";
import { getRefDate } from "./ref-date";
import { selloutSumSql } from "./sellout";

export type Range = { start: string; end: string };

const brandFilter = (brandId?: string | null, col = "brand_id") =>
  brandId ? sql`and ${sql.raw(col)} = ${brandId}::uuid` : sql``;

/* ------------------------------- Budget ---------------------------------- */

/**
 * Budget consommé : simple relais vers `src/lib/budget.ts`, seule définition officielle.
 * La répartition par catégorie reste ici, elle n'entre pas dans le calcul du consommé.
 */
export type BudgetSummary = BudgetConsumption & {
  byCategory: { category: string; planned: number; committed: number; spent: number }[];
};

export async function budgetSummary(year: number, brandId?: string | null): Promise<BudgetSummary> {
  const [consumption, cat] = await Promise.all([
    budgetConsumption(year, brandId),
    db.execute(sql`
      select category::text as category,
        coalesce(sum(amount) filter (where status = 'PLANNED'), 0)::float8 as planned,
        coalesce(sum(amount) filter (where status = 'COMMITTED'), 0)::float8 as committed,
        coalesce(sum(amount) filter (where status = 'SPENT'), 0)::float8 as spent
      from marketing_expenses where extract(year from date) = ${year} ${brandFilter(brandId)}
      group by 1 order by 2 + 3 + 4 desc`),
  ]);
  return {
    ...consumption,
    byCategory: (cat.rows as Record<string, unknown>[]).map((r) => ({
      category: String(r.category), planned: Number(r.planned), committed: Number(r.committed), spent: Number(r.spent),
    })),
  };
}

/* ------------------------------ Dépenses ---------------------------------- */

export type SpendBreakdown = { total: number; ads: number; influence: number; content: number; trade: number; events: number; other: number };

const CATEGORY_GROUPS: Record<string, keyof Omit<SpendBreakdown, "total">> = {
  META: "ads", TIKTOK: "ads", GOOGLE: "ads", DIGITAL: "ads",
  INFLUENCE: "influence", UGC: "influence",
  CREATION: "content", SHOOTING: "content", AGENCE: "content",
  TRADE: "trade", PLV: "trade", ANIMATION: "trade", ECHANTILLONS: "trade", GOODIES: "trade",
  EVENEMENT: "events", SPONSORING: "events", CONGRES: "events", PRESCRIPTEURS: "events",
};

/** Dépenses engagées ou payées sur une période, regroupées par famille. */
export async function spendBreakdown(range: Range, brandId?: string | null): Promise<SpendBreakdown> {
  const r = await db.execute(sql`
    select category::text as category, coalesce(sum(amount), 0)::float8 as amount
    from marketing_expenses
    where status <> 'PLANNED' and date >= ${range.start}::date and date < ${range.end}::date ${brandFilter(brandId)}
    group by 1`);
  const out: SpendBreakdown = { total: 0, ads: 0, influence: 0, content: 0, trade: 0, events: 0, other: 0 };
  for (const row of r.rows as { category: string; amount: number }[]) {
    const g = CATEGORY_GROUPS[row.category] ?? "other";
    out[g] += Number(row.amount);
    out.total += Number(row.amount);
  }
  return out;
}

/* --------------------------- Marketing vs ventes -------------------------- */

export type TimelinePoint = {
  month: string;
  revenue: number;
  marketing: number;
  ads: number;
  influence: number;
  trade: number;
  events: number;
  adSpend: number;
  animations: number;
  animationRevenue: number;
  contents: number;
  activations: number;
  collaborations: number;
};

/**
 * Timeline mensuelle : CA facturé (sell-in Sage), dépenses marketing par famille,
 * dépense publicitaire réelle (régie), animations, contenus, activations, collaborations.
 */
export async function marketingTimeline(endExclusive: string, months = 13, brandId?: string | null): Promise<TimelinePoint[]> {
  const startMonth = iso(addMonths(startOfMonth(new Date(endExclusive + "T12:00:00Z")), -(months - 1)));
  const bf = (col: string) => (brandId ? sql`and ${sql.raw(col)} = ${brandId}::uuid` : sql``);
  const r = await db.execute(sql`
    with months as (
      select to_char(generate_series(${startMonth}::date, ${endExclusive}::date - interval '1 day', interval '1 month'), 'YYYY-MM') as month
    ),
    sales_m as (
      select to_char(s.date, 'YYYY-MM') as month, coalesce(sum(s.amount), 0)::float8 as revenue
      from sales s join products p on p.id = s.product_id
      where s.date >= ${startMonth}::date and s.date < ${endExclusive}::date ${bf("p.brand_id")}
      group by 1
    ),
    exp_m as (
      select to_char(date, 'YYYY-MM') as month, category::text as category, coalesce(sum(amount), 0)::float8 as amount
      from marketing_expenses
      where status <> 'PLANNED' and date >= ${startMonth}::date and date < ${endExclusive}::date ${bf("brand_id")}
      group by 1, 2
    ),
    ads_m as (
      select to_char(date, 'YYYY-MM') as month, coalesce(sum(spend), 0)::float8 as spend
      from ad_metrics where date >= ${startMonth}::date and date < ${endExclusive}::date ${bf("brand_id")}
      group by 1
    ),
    anim_m as (
      select to_char(a.date, 'YYYY-MM') as month, coalesce(sum(a.days), 0)::float8 as days,
             coalesce(sum(l.sellout), 0)::float8 as revenue
      from animations a
      left join lateral (select ${selloutSumSql("al", "p")} as sellout from animation_lines al
                         join products p on p.id = al.product_id
                         where al.animation_id = a.id ${bf("p.brand_id")}) l on true
      where a.status = 'DONE' and a.date >= ${startMonth}::date and a.date < ${endExclusive}::date
      group by 1
    ),
    content_m as (
      select to_char(date, 'YYYY-MM') as month, count(*)::int as n
      from content_items where status = 'PUBLIE' and date >= ${startMonth}::date and date < ${endExclusive}::date ${bf("brand_id")}
      group by 1
    ),
    act_m as (
      select to_char(date, 'YYYY-MM') as month, count(*)::int as n
      from activations where date >= ${startMonth}::date and date < ${endExclusive}::date ${bf("brand_id")}
      group by 1
    ),
    collab_m as (
      select to_char(date, 'YYYY-MM') as month, count(*)::int as n
      from collaborations where date >= ${startMonth}::date and date < ${endExclusive}::date ${bf("brand_id")}
      group by 1
    )
    select m.month,
      coalesce(s.revenue, 0)::float8 as revenue,
      coalesce((select sum(amount) from exp_m e where e.month = m.month), 0)::float8 as marketing,
      coalesce((select sum(amount) from exp_m e where e.month = m.month and e.category in ('META','TIKTOK','GOOGLE','DIGITAL')), 0)::float8 as ads,
      coalesce((select sum(amount) from exp_m e where e.month = m.month and e.category in ('INFLUENCE','UGC')), 0)::float8 as influence,
      coalesce((select sum(amount) from exp_m e where e.month = m.month and e.category in ('TRADE','PLV','ANIMATION','ECHANTILLONS','GOODIES')), 0)::float8 as trade,
      coalesce((select sum(amount) from exp_m e where e.month = m.month and e.category in ('EVENEMENT','SPONSORING','CONGRES','PRESCRIPTEURS')), 0)::float8 as events,
      coalesce(a.spend, 0)::float8 as ad_spend,
      coalesce(an.days, 0)::float8 as animations,
      coalesce(an.revenue, 0)::float8 as animation_revenue,
      coalesce(c.n, 0)::int as contents,
      coalesce(ac.n, 0)::int as activations,
      coalesce(co.n, 0)::int as collaborations
    from months m
    left join sales_m s on s.month = m.month
    left join ads_m a on a.month = m.month
    left join anim_m an on an.month = m.month
    left join content_m c on c.month = m.month
    left join act_m ac on ac.month = m.month
    left join collab_m co on co.month = m.month
    order by m.month`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    month: String(x.month),
    revenue: Number(x.revenue), marketing: Number(x.marketing), ads: Number(x.ads),
    influence: Number(x.influence), trade: Number(x.trade), events: Number(x.events),
    adSpend: Number(x.ad_spend), animations: Number(x.animations), animationRevenue: Number(x.animation_revenue),
    contents: Number(x.contents), activations: Number(x.activations), collaborations: Number(x.collaborations),
  }));
}

/** Coefficient de corrélation de Pearson entre deux séries — jamais présenté comme une causalité. */
export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 4) return null;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, dbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; dbb += y * y;
  }
  if (da === 0 || dbb === 0) return null;
  return num / Math.sqrt(da * dbb);
}

export function correlationLabel(r: number | null): string {
  if (r === null) return "pas assez de points";
  const a = Math.abs(r);
  const dir = r >= 0 ? "positive" : "négative";
  if (a >= 0.7) return `corrélation ${dir} forte (r = ${r.toFixed(2)})`;
  if (a >= 0.4) return `corrélation ${dir} modérée (r = ${r.toFixed(2)})`;
  if (a >= 0.2) return `corrélation ${dir} faible (r = ${r.toFixed(2)})`;
  return `aucune corrélation nette (r = ${r.toFixed(2)})`;
}

/* ------------------------------- Ventes ----------------------------------- */

export async function salesTotal(range: Range, brandId?: string | null) {
  const r = await db.execute(sql`
    select coalesce(sum(s.amount), 0)::float8 as revenue, coalesce(sum(s.quantity), 0)::float8 as units
    from sales s join products p on p.id = s.product_id
    where s.date >= ${range.start}::date and s.date < ${range.end}::date ${brandFilter(brandId, "p.brand_id")}`);
  const x = r.rows[0] as { revenue: number; units: number };
  return { revenue: Number(x.revenue), units: Number(x.units) };
}

/* ------------------------------ Compteurs --------------------------------- */

export async function marketingCounters(range: Range, brandId?: string | null) {
  const bf = (col: string) => (brandId ? sql`and ${sql.raw(col)} = ${brandId}::uuid` : sql``);
  const r = await db.execute(sql`
    select
      (select count(*) from campaigns c where c.status = 'ACTIVE' ${bf("c.brand_id")})::int as active_campaigns,
      (select count(*) from campaigns c where c.status in ('DRAFT','PLANNED') ${bf("c.brand_id")})::int as planned_campaigns,
      (select count(*) from activations a where a.date >= ${range.start}::date and a.date < ${range.end}::date ${bf("a.brand_id")})::int as activations,
      (select count(*) from collaborations co where co.date >= ${range.start}::date and co.date < ${range.end}::date ${bf("co.brand_id")})::int as collaborations,
      (select count(*) from content_items ci where ci.status = 'PUBLIE' and ci.date >= ${range.start}::date and ci.date < ${range.end}::date ${bf("ci.brand_id")})::int as published,
      (select count(*) from content_items ci where ci.status <> 'PUBLIE' and ci.status <> 'ANALYSE' and ci.date >= ${range.start}::date and ci.date < ${range.end}::date ${bf("ci.brand_id")})::int as pending_content`);
  const x = r.rows[0] as Record<string, number>;
  return {
    activeCampaigns: Number(x.active_campaigns), plannedCampaigns: Number(x.planned_campaigns),
    activations: Number(x.activations), collaborations: Number(x.collaborations),
    published: Number(x.published), pendingContent: Number(x.pending_content),
  };
}

/* --------------------------- Attribution mesurée --------------------------- */

export type Attribution = { adRevenue: number; adSpend: number; influenceRevenue: number; influenceCost: number; activationRevenue: number; activationCost: number; expenseRevenue: number };

/** CA réellement attribué (saisi ou remonté par la régie), à distinguer du CA total. */
export async function attribution(range: Range, brandId?: string | null): Promise<Attribution> {
  const bf = (col: string) => (brandId ? sql`and ${sql.raw(col)} = ${brandId}::uuid` : sql``);
  const r = await db.execute(sql`
    select
      (select coalesce(sum(revenue), 0)::float8 from ad_metrics m where m.date >= ${range.start}::date and m.date < ${range.end}::date ${bf("m.brand_id")}) as ad_revenue,
      (select coalesce(sum(spend), 0)::float8 from ad_metrics m where m.date >= ${range.start}::date and m.date < ${range.end}::date ${bf("m.brand_id")}) as ad_spend,
      (select coalesce(sum(attributed_revenue), 0)::float8 from collaborations c where c.date >= ${range.start}::date and c.date < ${range.end}::date ${bf("c.brand_id")}) as influence_revenue,
      (select coalesce(sum(fee + product_value), 0)::float8 from collaborations c where c.date >= ${range.start}::date and c.date < ${range.end}::date ${bf("c.brand_id")}) as influence_cost,
      (select coalesce(sum(attributed_revenue), 0)::float8 from activations a where a.date >= ${range.start}::date and a.date < ${range.end}::date ${bf("a.brand_id")}) as activation_revenue,
      (select coalesce(sum(budget_planned), 0)::float8 from activations a where a.date >= ${range.start}::date and a.date < ${range.end}::date ${bf("a.brand_id")}) as activation_cost,
      (select coalesce(sum(attributed_revenue), 0)::float8 from marketing_expenses e where e.date >= ${range.start}::date and e.date < ${range.end}::date ${bf("e.brand_id")}) as expense_revenue`);
  const x = r.rows[0] as Record<string, number>;
  return {
    adRevenue: Number(x.ad_revenue), adSpend: Number(x.ad_spend),
    influenceRevenue: Number(x.influence_revenue), influenceCost: Number(x.influence_cost),
    activationRevenue: Number(x.activation_revenue), activationCost: Number(x.activation_cost),
    expenseRevenue: Number(x.expense_revenue),
  };
}

/* ------------------------- Campagne : vue 360 ------------------------------ */

export type CampaignPeriodSales = {
  before: number; during: number; after: number;
  beforeDays: number; duringDays: number; afterDays: number;
  /** Jours réellement écoulés dans la fenêtre « après » (0 tant que la campagne n'est pas finie). */
  afterElapsed: number;
  /** Jours réellement écoulés dans la fenêtre « pendant ». */
  duringElapsed: number;
};

/**
 * Ventes facturées avant / pendant / après la campagne, sur les produits qu'elle pousse
 * (à défaut, sur toute la marque). Les trois fenêtres ont la même longueur que la campagne.
 */
export async function campaignSales(campaignId: string): Promise<CampaignPeriodSales | null> {
  const r = await db.execute(sql`
    with c as (select * from campaigns where id = ${campaignId}::uuid),
    span as (
      select c.id, c.brand_id, c.start_date,
             coalesce(c.end_date, least(current_date, c.start_date + interval '30 days')::date) as end_date
      from c where c.start_date is not null
    ),
    len as (select id, brand_id, start_date, end_date, greatest(1, (end_date - start_date) + 1) as days from span),
    scope as (
      select s.amount, s.date from sales s join products p on p.id = s.product_id, len
      where (
        exists (select 1 from campaign_products cp where cp.campaign_id = len.id and cp.product_id = s.product_id)
        or (not exists (select 1 from campaign_products cp where cp.campaign_id = len.id) and p.brand_id = len.brand_id)
      )
    )
    select
      (select days from len)::int as days,
      coalesce((select sum(amount) from scope, len where scope.date >= len.start_date - len.days and scope.date < len.start_date), 0)::float8 as before,
      coalesce((select sum(amount) from scope, len where scope.date >= len.start_date and scope.date <= len.end_date), 0)::float8 as during,
      coalesce((select sum(amount) from scope, len where scope.date > len.end_date and scope.date <= len.end_date + len.days), 0)::float8 as after,
      (select greatest(0, least(days, (select coalesce(max(date), current_date) from sales) - end_date)) from len)::int as after_elapsed,
      (select greatest(0, least(days, (select coalesce(max(date), current_date) from sales) - start_date + 1)) from len)::int as during_elapsed`);
  const x = r.rows[0] as { days: number; before: number; during: number; after: number; after_elapsed: number; during_elapsed: number } | undefined;
  if (!x || x.days === null) return null;
  const days = Number(x.days);
  return {
    before: Number(x.before), during: Number(x.during), after: Number(x.after),
    beforeDays: days, duringDays: days, afterDays: days,
    afterElapsed: Number(x.after_elapsed), duringElapsed: Number(x.during_elapsed),
  };
}

/** Couverture de stock des produits poussés par une campagne — garde-fou avant de scaler. */
export type CampaignStockRow = {
  id: string; name: string; qty: number; monthly: number;
  coverage: number | null; level: CoverageLevel; stockKnown: boolean;
};

/**
 * Couverture de stock des produits poussés par une campagne — garde-fou avant de scaler.
 *
 * Recalculait autrefois sa propre couverture (3 mois en dur, `current_date`, `on_order` et
 * stock de sécurité ignorés) : une campagne pouvait être « en tension » ici et pas dans
 * l'Action Center. Elle délègue maintenant à `productStocks()`, définition unique.
 *
 * Périmètre : les produits rattachés à la campagne ; à défaut, tous les produits actifs de
 * sa marque. C'est la convention historique, inchangée.
 */
export async function campaignStock(campaignId: string): Promise<CampaignStockRow[]> {
  const r = await db.execute(sql`
    select c.brand_id::text as brand_id,
           coalesce(array_remove(array_agg(cp.product_id::text), null), '{}'::text[]) as product_ids
    from campaigns c
    left join campaign_products cp on cp.campaign_id = c.id
    where c.id = ${campaignId}::uuid
    group by c.brand_id`);
  const row = r.rows[0] as { brand_id: string | null; product_ids: string[] } | undefined;
  if (!row) return [];
  const ids = (row.product_ids ?? []).filter(Boolean);
  const { ref } = await getRefDate();
  const list = ids.length
    ? await productStocks({ productIds: ids }, ref)
    : row.brand_id
      ? await productStocks({ brandId: row.brand_id }, ref)
      : [];
  return list
    .map((p) => ({
      id: p.productId, name: p.name, qty: p.stock, monthly: p.avgMonthly,
      coverage: p.coverageMonths, level: p.level, stockKnown: p.stockKnown,
    }))
    .sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY));
}

/* --------------------------- Scorecard par marque -------------------------- */

export type BrandScore = {
  brandId: string; name: string; color: string;
  commercial: number; digital: number; influence: number; content: number; trade: number; budget: number; global: number;
  revenue: number; spend: number; roas: number | null;
};

/**
 * Score marketing par marque (0-100), moyenne pondérée de six dimensions.
 * Chaque dimension est relative au meilleur de la période : c'est un classement interne,
 * pas une note absolue.
 */
export async function brandScorecard(range: Range, prev: Range): Promise<BrandScore[]> {
  const r = await db.execute(sql`
    with brands_a as (select id, name, color from brands where active),
    rev as (
      select p.brand_id, coalesce(sum(s.amount), 0)::float8 as revenue
      from sales s join products p on p.id = s.product_id
      where s.date >= ${range.start}::date and s.date < ${range.end}::date group by 1
    ),
    rev_prev as (
      select p.brand_id, coalesce(sum(s.amount), 0)::float8 as revenue
      from sales s join products p on p.id = s.product_id
      where s.date >= ${prev.start}::date and s.date < ${prev.end}::date group by 1
    ),
    spend as (
      select brand_id, coalesce(sum(amount), 0)::float8 as spend
      from marketing_expenses where status <> 'PLANNED' and date >= ${range.start}::date and date < ${range.end}::date group by 1
    ),
    ads as (
      select brand_id, coalesce(sum(spend), 0)::float8 as spend, coalesce(sum(revenue), 0)::float8 as revenue,
             coalesce(sum(purchases), 0)::float8 as purchases
      from ad_metrics where date >= ${range.start}::date and date < ${range.end}::date group by 1
    ),
    infl as (
      select brand_id, count(*)::int as n, coalesce(sum(attributed_revenue), 0)::float8 as revenue,
             coalesce(sum(fee + product_value), 0)::float8 as cost
      from collaborations where date >= ${range.start}::date and date < ${range.end}::date group by 1
    ),
    cont as (
      select brand_id, count(*) filter (where status = 'PUBLIE')::int as published, count(*)::int as total
      from content_items where date >= ${range.start}::date and date < ${range.end}::date group by 1
    ),
    terrain as (
      select p.brand_id, ${selloutSumSql("al", "p")} as revenue
      from animations a join animation_lines al on al.animation_id = a.id join products p on p.id = al.product_id
      where a.status = 'DONE' and a.date >= ${range.start}::date and a.date < ${range.end}::date group by 1
    ),
    bud as (select brand_id, coalesce(sum(amount), 0)::float8 as annual from budgets where year = ${Number(range.start.slice(0, 4))} group by 1)
    select b.id, b.name, b.color,
      coalesce(rev.revenue, 0) as revenue, coalesce(rev_prev.revenue, 0) as revenue_prev,
      coalesce(spend.spend, 0) as spend,
      coalesce(ads.spend, 0) as ad_spend, coalesce(ads.revenue, 0) as ad_revenue,
      coalesce(infl.n, 0) as collabs, coalesce(infl.revenue, 0) as infl_revenue, coalesce(infl.cost, 0) as infl_cost,
      coalesce(cont.published, 0) as published, coalesce(cont.total, 0) as content_total,
      coalesce(terrain.revenue, 0) as terrain_revenue,
      coalesce(bud.annual, 0) as annual_budget
    from brands_a b
    left join rev on rev.brand_id = b.id
    left join rev_prev on rev_prev.brand_id = b.id
    left join spend on spend.brand_id = b.id
    left join ads on ads.brand_id = b.id
    left join infl on infl.brand_id = b.id
    left join cont on cont.brand_id = b.id
    left join terrain on terrain.brand_id = b.id
    left join bud on bud.brand_id = b.id`);

  const rows = (r.rows as Record<string, number | string>[]).map((x) => ({
    brandId: String(x.id), name: String(x.name), color: String(x.color),
    revenue: Number(x.revenue), revenuePrev: Number(x.revenue_prev), spend: Number(x.spend),
    adSpend: Number(x.ad_spend), adRevenue: Number(x.ad_revenue),
    collabs: Number(x.collabs), inflRevenue: Number(x.infl_revenue), inflCost: Number(x.infl_cost),
    published: Number(x.published), contentTotal: Number(x.content_total),
    terrainRevenue: Number(x.terrain_revenue), annualBudget: Number(x.annual_budget),
  }));
  const max = (f: (x: (typeof rows)[number]) => number) => Math.max(1, ...rows.map(f));
  const maxRev = max((x) => x.revenue), maxTerrain = max((x) => x.terrainRevenue), maxPub = max((x) => x.published);
  const maxAdRoas = Math.max(1, ...rows.map((x) => (x.adSpend > 0 ? x.adRevenue / x.adSpend : 0)));
  const maxInflRoas = Math.max(1, ...rows.map((x) => (x.inflCost > 0 ? x.inflRevenue / x.inflCost : 0)));

  return rows.map((x) => {
    const growth = x.revenuePrev > 0 ? (x.revenue - x.revenuePrev) / x.revenuePrev : 0;
    const commercial = Math.round(100 * (0.7 * (x.revenue / maxRev) + 0.3 * Math.max(0, Math.min(1, 0.5 + growth))));
    const adRoas = x.adSpend > 0 ? x.adRevenue / x.adSpend : null;
    const digital = adRoas === null ? 50 : Math.round(100 * Math.min(1, adRoas / maxAdRoas));
    const inflRoas = x.inflCost > 0 ? x.inflRevenue / x.inflCost : null;
    const influence = inflRoas === null ? (x.collabs > 0 ? 50 : 0) : Math.round(100 * Math.min(1, inflRoas / maxInflRoas));
    const content = Math.round(100 * (0.6 * (x.published / maxPub) + 0.4 * (x.contentTotal > 0 ? x.published / x.contentTotal : 0)));
    const trade = Math.round(100 * (x.terrainRevenue / maxTerrain));
    // Budget : idéalement consommé au rythme de l'année, ni sous-utilisé ni dépassé
    const budget = x.annualBudget > 0 ? Math.round(100 * (1 - Math.min(1, Math.abs(x.spend / x.annualBudget - 0.5) * 2))) : 50;
    const global = Math.round(0.3 * commercial + 0.2 * digital + 0.15 * influence + 0.15 * content + 0.1 * trade + 0.1 * budget);
    return {
      brandId: x.brandId, name: x.name, color: x.color,
      commercial, digital, influence, content, trade, budget, global,
      revenue: x.revenue, spend: x.spend, roas: x.spend > 0 ? x.revenue / x.spend : null,
    };
  }).sort((a, b) => b.global - a.global);
}

/* ------------------------------ Calendrier -------------------------------- */

export type CalendarEvent = { id: string; date: string; endDate: string | null; kind: string; title: string; brand: string | null; color: string | null; href: string; status: string | null };

/** Calendrier 360 : contenus, campagnes, collaborations, activations, animations. */
export async function marketingCalendar(range: Range, brandId?: string | null): Promise<CalendarEvent[]> {
  const bf = (col: string) => (brandId ? sql`and ${sql.raw(col)} = ${brandId}::uuid` : sql``);
  const r = await db.execute(sql`
    select ci.id::text, ci.date::text as date, null::text as end_date, 'CONTENU' as kind,
           ci.title, b.name as brand, b.color, ci.status::text as status
    from content_items ci left join brands b on b.id = ci.brand_id
    where ci.date >= ${range.start}::date and ci.date < ${range.end}::date ${bf("ci.brand_id")}
    union all
    select c.id::text, c.start_date::text, c.end_date::text, 'CAMPAGNE', c.name, b.name, b.color, c.status::text
    from campaigns c join brands b on b.id = c.brand_id
    where c.start_date is not null and c.start_date < ${range.end}::date and coalesce(c.end_date, c.start_date) >= ${range.start}::date ${bf("c.brand_id")}
    union all
    select co.id::text, co.date::text, null, 'INFLUENCE', i.name, b.name, b.color, co.status
    from collaborations co join influencers i on i.id = co.influencer_id join brands b on b.id = co.brand_id
    where co.date >= ${range.start}::date and co.date < ${range.end}::date ${bf("co.brand_id")}
    union all
    select a.id::text, a.date::text, a.end_date::text, 'ACTIVATION', a.name, b.name, b.color, a.status
    from activations a left join brands b on b.id = a.brand_id
    where a.date >= ${range.start}::date and a.date < ${range.end}::date ${bf("a.brand_id")}
    order by 2`);
  return (r.rows as Record<string, unknown>[]).map((x) => {
    const kind = String(x.kind);
    const id = String(x.id);
    const href = kind === "CAMPAGNE" ? `/marketing/campagnes/${id}` : kind === "INFLUENCE" ? `/marketing/influence` : kind === "ACTIVATION" ? `/marketing/activations` : `/marketing/planning`;
    return {
      id, date: String(x.date), endDate: x.end_date ? String(x.end_date) : null, kind,
      title: String(x.title), brand: x.brand ? String(x.brand) : null, color: x.color ? String(x.color) : null,
      href, status: x.status ? String(x.status) : null,
    };
  });
}
