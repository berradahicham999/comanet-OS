/**
 * Données COMANET OS du générateur d'actions (serveur, lecture seule).
 *
 * Tout est lu par les définitions officielles : performance et stock du produit (`buildProductPerformance`), budget
 * engagé (`budgetByCategory`, `budgetConsumption`), allocation (`budget_lines`), verdict de canal (`categoryVerdicts`),
 * coût par résultat Meta (`adsByDim` + `kpis`), saisonnalité (`settings.forecast.events`). Les requêtes propres au
 * générateur ne lisent que de l'historique (actions, activations, campagnes), des clients, des influenceuses et l'équipe.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { BudgetCategory } from "@/db/schema";
import { budgetByCategory, budgetConsumption, engagedSql } from "@/lib/budget";
import { AD_EXPENSE_CATEGORIES } from "@/lib/ad-spend";
import { adsByDim, kpis, RESULT_LABELS, type ResultKind } from "@/lib/ads";
import { buildProductPerformance, type PerformanceResult } from "@/lib/marketing-intel/build";
import type { IntelContext } from "@/lib/marketing-intel/types";
import { categoryVerdicts, currentPlanFor } from "@/lib/marketing-plan/plan";
import { coveredShare, eventApplies } from "@/lib/forecast-shared";
import { listUsers } from "@/lib/users";
import { pgArray } from "@/lib/sql-array";
import { addDays, iso } from "@/lib/format";
import type { AdVerdict } from "@/lib/marketing-shared";
import { AXES, AXIS_KEYS } from "./catalog";
import { axisAvailable } from "./engine";
import type { AxisBudget, AxisKey, GeneratorData, HistoryItem, ProductData, StepRole } from "./types";

const ACTIONABLE: ResultKind[] = ["message", "lead", "landing", "purchase", "click"];

export async function loadGeneratorData(ctx: IntelContext, o: { brandId: string; brandName: string; productId: string | null; month: string; performance?: PerformanceResult | null }): Promise<GeneratorData> {
  const year = Number(o.month.slice(0, 4));
  const today = iso(ctx.now);
  const monthStart = Date.UTC(year, Number(o.month.slice(5, 7)) - 1, 1);
  const monthEnd = Date.UTC(year, Number(o.month.slice(5, 7)), 1);
  const since365 = iso(addDays(ctx.now, -365));

  const [perf, cats, cons, lines, reservedRows, plan, historyRows, verdictRows, adsRows, cityRows, posRows, inflRows, users] = await Promise.all([
    o.performance !== undefined ? Promise.resolve(o.performance) : buildProductPerformance(ctx, { brandId: o.brandId, period: "90d" }).catch(() => null),
    budgetByCategory(year, o.brandId),
    budgetConsumption(year, o.brandId),
    db.execute<{ category: string; amount: number }>(sql`select category::text as category, sum(amount)::float8 as amount from budget_lines where brand_id = ${o.brandId}::uuid and year = ${year} group by 1`),
    // Réservé : budget prévu des actions ouvertes de l'année, pas encore engagé (actions générées comprises).
    db.execute<{ category: string | null; reserved: number }>(sql`
      select a.category::text as category,
        sum(greatest(a.budget_planned - coalesce((select sum(e.amount) from marketing_expenses e where (e.action_id = a.id or (a.activation_id is not null and e.activation_id = a.activation_id and e.action_id is null)) and ${engagedSql("e")}), 0), 0))::float8 as reserved
      from marketing_actions a join tasks t on t.id = a.task_id
      where a.brand_id = ${o.brandId}::uuid and t.status in ('TODO','IN_PROGRESS','BLOCKED') and extract(year from coalesce(a.month, a.event_date, a.created_at::date)) = ${year}
      group by 1`),
    currentPlanFor(o.brandId, year),
    db.execute<{ kind: string; template_key: string | null; activation_type: string | null; product_id: string | null; label: string; date: string; open: boolean }>(sql`
      select 'ACTION' as kind, a.template_key, null as activation_type, a.product_id::text as product_id, a.title as label,
        coalesce(a.event_date, a.month, a.created_at::date)::text as date, (t.status in ('TODO','IN_PROGRESS','BLOCKED')) as open
      from marketing_actions a join tasks t on t.id = a.task_id
      where a.brand_id = ${o.brandId}::uuid and (t.status <> 'CANCELLED') and coalesce(a.event_date, a.created_at::date) >= ${since365}::date
      union all
      select 'ACTIVATION', null, ac.type, ac.product_id::text, ac.name, ac.date::text, false
      from activations ac where ac.brand_id = ${o.brandId}::uuid and ac.date >= ${since365}::date
      union all
      select 'CAMPAIGN', null, null, null, c.name, coalesce(c.start_date, c.created_at::date)::text, c.status in ('ACTIVE','PLANNED','DRAFT')
      from campaigns c where c.brand_id = ${o.brandId}::uuid and coalesce(c.start_date, c.created_at::date) >= ${since365}::date`),
    ctx.gates.marketing ? categoryVerdicts(o.brandId, ctx.refDate).catch(() => []) : Promise.resolve([]),
    ctx.gates.marketing ? adsByDim("campaign", { start: iso(addDays(ctx.now, -90)), end: iso(addDays(ctx.now, 1)) }, { brandId: o.brandId }).catch(() => []) : Promise.resolve([]),
    db.execute<{ city: string }>(sql`
      select initcap(trim(c.city)) as city from sales s join products p on p.id = s.product_id join clients c on c.id = s.client_id
      where p.brand_id = ${o.brandId}::uuid and s.date >= ${since365}::date and c.city is not null and trim(c.city) <> ''
      group by 1 order by sum(s.amount) desc limit 1`),
    db.execute<{ name: string; city: string | null; revenue: number; prev: number }>(sql`
      select c.name, initcap(trim(c.city)) as city,
        coalesce(sum(s.amount) filter (where s.date >= ${iso(addDays(ctx.refDate, -90))}::date), 0)::float8 as revenue,
        coalesce(sum(s.amount) filter (where s.date < ${iso(addDays(ctx.refDate, -90))}::date), 0)::float8 as prev
      from sales s join products p on p.id = s.product_id join clients c on c.id = s.client_id
      where p.brand_id = ${o.brandId}::uuid and s.date >= ${iso(addDays(ctx.refDate, -180))}::date and c.type in ('PHARMACIE','PARAPHARMACIE')
        ${ctx.scopeClientIds ? sql`and c.id = any(${pgArray(ctx.scopeClientIds)})` : sql``}
      group by c.id, c.name, c.city having sum(s.amount) > 0 order by 3 desc limit 12`),
    db.execute<{ name: string; followers: number | null; usual_rate: number | null; collabs: number; last_reach: number | null }>(sql`
      select i.name, i.followers, i.usual_rate::float8 as usual_rate,
        count(co.id) filter (where co.brand_id = ${o.brandId}::uuid)::int as collabs,
        (select co2.reach from collaborations co2 where co2.influencer_id = i.id and co2.reach is not null order by co2.date desc limit 1) as last_reach
      from influencers i left join collaborations co on co.influencer_id = i.id
      where i.active group by i.id order by 4 desc, i.followers desc nulls last limit 8`),
    listUsers(),
  ]);

  /* Produit */
  let product: ProductData | null = null;
  if (o.productId) {
    const row = (await db.execute<{ id: string; name: string; short_name: string | null; category: string | null; price_retail: number | null; actives: string | null; marketing_angle: string | null }>(sql`
      select id, name, short_name, category, price_retail::float8 as price_retail, actives, marketing_angle from products where id = ${o.productId}::uuid and brand_id = ${o.brandId}::uuid`)).rows[0];
    if (row) {
      const p = perf?.rows.find((r) => r.productId === row.id) ?? null;
      product = {
        id: row.id, name: row.name, shortName: row.short_name, category: row.category, priceRetail: row.price_retail, actives: row.actives, marketingAngle: row.marketing_angle,
        profile: p?.profile ?? null, growthPct: p?.growthPct ?? null, revenue90: p ? p.revenue : null, contributionPct: p?.contributionPct ?? null,
        stockRisk: p?.stock?.risk ?? null, daysOfStock: p?.stock?.daysOfStock ?? null,
      };
    }
  }

  /* Budget par levier */
  const regie = cons.adSource === "REGIE";
  const allocBy = new Map(lines.rows.map((r) => [r.category, Number(r.amount)]));
  const commitBy = new Map(cats.map((c) => [c.category, c.committed]));
  const reservedBy = new Map(reservedRows.rows.map((r) => [r.category ?? "AUTRES", Number(r.reserved)]));
  const reservedAll = reservedRows.rows.reduce((s, r) => s + Number(r.reserved), 0);
  const brandAvailable = cons.hasBudget ? cons.annual - cons.consumed - reservedAll : null;
  const budgets = {} as Record<AxisKey, AxisBudget>;
  for (const axis of AXIS_KEYS) {
    const catsOf = AXES[axis].categories;
    const allocated = catsOf.reduce((s, c) => s + (allocBy.get(c) ?? 0), 0);
    // Digital : quand la régie fait foi, l'engagé média EST la dépense Meta (règle de `budget.ts`).
    const committed = axis === "DIGITAL" && regie ? cons.adSpend + catsOf.filter((c) => !(AD_EXPENSE_CATEGORIES as readonly string[]).includes(c)).reduce((s, c) => s + (commitBy.get(c) ?? 0), 0) : catsOf.reduce((s, c) => s + (commitBy.get(c) ?? 0), 0);
    const reserved = catsOf.reduce((s, c) => s + (reservedBy.get(c) ?? 0), 0);
    budgets[axis] = axisAvailable({ axis, allocated, committed, reserved, brandAvailable });
  }

  /* Budget du mois du plan */
  let monthRemaining: number | null = null;
  if (plan) {
    const m = (await db.execute<{ budget: number; used: number }>(sql`
      select m.budget::float8 as budget, coalesce((select sum(a.budget_planned) from marketing_actions a join tasks t on t.id = a.task_id where a.plan_id = m.plan_id and a.month = m.month and t.status <> 'CANCELLED'), 0)::float8 as used
      from marketing_plan_months m where m.plan_id = ${plan.id}::uuid and m.month = ${o.month}::date`)).rows[0];
    if (m && m.budget > 0) monthRemaining = m.budget - m.used;
  }

  /* Coût par résultat Meta : type de résultat dominant (en dépense) parmi les résultats actionnables. */
  let adsCost: GeneratorData["adsCost"] = null;
  const byKind = new Map<ResultKind, { spend: number; results: number }>();
  for (const r of adsRows) { const k = kpis(r); if (!ACTIONABLE.includes(k.resultKind) || k.results <= 0) continue; const cur = byKind.get(k.resultKind) ?? { spend: 0, results: 0 }; cur.spend += k.spend; cur.results += k.results; byKind.set(k.resultKind, cur); }
  const dominant = [...byKind.entries()].sort((a, b) => b[1].spend - a[1].spend)[0];
  if (dominant && dominant[1].results >= 20) adsCost = { value: dominant[1].spend / dominant[1].results, label: RESULT_LABELS[dominant[0]].many };

  /* Saisonnalité de la période (événements couvrant au moins 30 % du mois et concernant le produit). */
  const fp = product ? { name: product.name, category: product.category } : { name: o.brandName, category: null };
  const seasonEvents = ctx.settings.forecast.events.filter((e) => coveredShare(e, monthStart, monthEnd) >= 0.3 && eventApplies(e, fp)).map((e) => ({ key: e.key, label: e.label }));

  /* Équipe : une personne par rôle (proposition, modifiable sur chaque tâche). */
  const pick = (role: string) => users.find((u) => u.role === role) ?? null;
  const team: GeneratorData["team"] = {};
  const map: Record<StepRole, string> = { MARKETING: "MARKETING", TRADE: "TRADE", REGLEMENTAIRE: "REGLEMENTAIRE", ANIMATRICE: "ANIMATRICE", DIRECTION: "ADMIN" };
  for (const [k, role] of Object.entries(map) as [StepRole, string][]) { const u = pick(role); if (u) team[k] = { id: u.id, name: u.name }; }

  const verdicts: Partial<Record<BudgetCategory, AdVerdict>> = {};
  for (const v of verdictRows) verdicts[v.category] = v.verdict;

  return {
    today, brand: { id: o.brandId, name: o.brandName }, product, budgets, brandAvailable, monthRemaining,
    history: historyRows.rows.map((h): HistoryItem => ({ kind: h.kind as HistoryItem["kind"], templateKey: h.template_key, activationType: h.activation_type, productId: h.product_id, label: h.label, date: h.date, open: !!h.open })),
    verdicts, adsCost, seasonEvents,
    topCity: cityRows.rows[0]?.city ?? null,
    topPos: posRows.rows.map((p) => ({ name: p.name, city: p.city, revenue: Number(p.revenue), trendPct: Number(p.prev) > 0 ? ((Number(p.revenue) - Number(p.prev)) / Number(p.prev)) * 100 : null })),
    influencers: inflRows.rows.map((i) => ({ name: i.name, followers: i.followers, usualRate: i.usual_rate, collabs: Number(i.collabs), lastReach: i.last_reach })),
    team,
  };
}
