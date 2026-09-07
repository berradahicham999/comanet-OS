/**
 * Sell-out animations : agrégats par jour / ville / animatrice / point de vente / marque / produit,
 * comparaison aux objectifs par ville, et plan d'action par animatrice.
 *
 * Le CA est le **TTC encaissé en rayon** (quantité × prix public), valeur portée par les lignes d'animation.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { cityKey } from "./animations-shared";
import { selloutAmountSql, selloutSumSql } from "./sellout";

export type Range = { start: string; end: string };

/* ------------------------------ Agrégats ---------------------------------- */

export type Totals = { revenue: number; units: number; days: number; animations: number; pos: number; customers: number; cost: number };

export async function animationTotals(range: Range, filter?: { animatriceId?: string; city?: string }): Promise<Totals> {
  const where = buildWhere(range, filter);
  const r = await db.execute(sql`
    with anim as (select a.* from animations a where ${where}),
    lines as (
      select al.*, ${selloutAmountSql("al", "lp")} as sellout
      from animation_lines al join anim on anim.id = al.animation_id left join products lp on lp.id = al.product_id
    )
    select
      coalesce((select sum(sellout) from lines), 0)::float8 as revenue,
      coalesce((select sum(quantity_sold) from lines), 0)::float8 as units,
      coalesce((select sum(days) from anim), 0)::float8 as days,
      (select count(*) from anim)::int as animations,
      (select count(distinct client_id) from anim)::int as pos,
      coalesce((select sum(customers_advised) from anim), 0)::float8 as customers,
      coalesce((select sum(cost) from anim), 0)::float8 as cost`);
  const x = r.rows[0] as Record<string, number>;
  return { revenue: Number(x.revenue), units: Number(x.units), days: Number(x.days), animations: Number(x.animations), pos: Number(x.pos), customers: Number(x.customers), cost: Number(x.cost) };
}

function buildWhere(range: Range, filter?: { animatriceId?: string; city?: string }): SQL {
  const parts: SQL[] = [sql`a.status = 'DONE' and a.date >= ${range.start}::date and a.date < ${range.end}::date`];
  if (filter?.animatriceId) parts.push(sql`a.animatrice_id = ${filter.animatriceId}::uuid`);
  if (filter?.city) parts.push(sql`a.city = ${filter.city}`);
  return sql.join(parts, sql` and `);
}

export type DimRow = {
  id: string; name: string; extra: string | null; color: string | null;
  revenue: number; units: number; days: number; animations: number; prevRevenue: number;
};

/** Agrégat par dimension : animatrice, ville, point de vente, marque ou produit. */
export async function animationsByDim(dim: "animatrice" | "city" | "pos" | "brand" | "product", range: Range, prev: Range, filter?: { animatriceId?: string; city?: string }): Promise<DimRow[]> {
  const where = buildWhere(range, filter);
  const wherePrev = buildWhere(prev, filter);
  const joins =
    dim === "animatrice" ? sql`left join users u on u.id = a.animatrice_id`
      : dim === "pos" ? sql`join clients c on c.id = a.client_id`
        : dim === "brand" || dim === "product" ? sql`join animation_lines l on l.animation_id = a.id join products p on p.id = l.product_id left join brands b on b.id = p.brand_id`
          : sql``;
  const key =
    dim === "animatrice" ? sql`coalesce(u.id::text, 'none')`
      : dim === "city" ? sql`coalesce(a.city, '—')`
        : dim === "pos" ? sql`c.id::text`
          : dim === "brand" ? sql`coalesce(b.id::text, 'none')`
            : sql`p.id::text`;
  // Le libellé est agrégé (max) : il est constant par groupe mais Postgres exige une agrégation.
  const label =
    dim === "animatrice" ? sql`max(coalesce(u.name, 'Non renseignée'))`
      : dim === "city" ? sql`max(coalesce(a.city, '—'))`
        : dim === "pos" ? sql`max(c.name)`
          : dim === "brand" ? sql`max(coalesce(b.name, 'Sans marque'))`
            : sql`max(p.name)`;
  const extra =
    dim === "pos" ? sql`max(c.city)`
      // ville dominante sur la période plutôt que la ville de fiche : elle reflète le terrain réel
      : dim === "animatrice" ? sql`mode() within group (order by a.city)`
        : dim === "product" ? sql`max(coalesce(b.name, ''))`
          : sql`null::text`;
  const color = dim === "brand" || dim === "product" ? sql`max(b.color)` : sql`null::text`;
  // Pour les dimensions portées par les lignes, le CA vient directement de la jointure ;
  // pour les autres, il faut agréger les lignes de chaque animation.
  const revenue = dim === "brand" || dim === "product" ? selloutSumSql("l", "p") : sql`coalesce(sum(la.revenue), 0)::float8`;
  const units = dim === "brand" || dim === "product" ? sql`coalesce(sum(l.quantity_sold), 0)::float8` : sql`coalesce(sum(la.units), 0)::float8`;
  const lineAgg = dim === "brand" || dim === "product" ? sql`` : sql`left join lateral (select ${selloutSumSql("al", "lp")} as revenue, coalesce(sum(al.quantity_sold),0)::float8 as units from animation_lines al left join products lp on lp.id = al.product_id where al.animation_id = a.id) la on true`;

  const r = await db.execute(sql`
    with cur as (
      select ${key} as id, ${label} as name, ${extra} as extra, ${color} as color,
             ${revenue} as revenue, ${units} as units,
             ${dim === "brand" || dim === "product" ? sql`0::float8` : sql`coalesce(sum(a.days), 0)::float8`} as days,
             count(distinct a.id)::int as animations
      from animations a ${joins} ${lineAgg}
      where ${where}
      group by 1
    ),
    prev as (
      select ${key} as id, ${revenue} as revenue
      from animations a ${joins} ${lineAgg}
      where ${wherePrev}
      group by 1
    )
    select cur.*, coalesce(prev.revenue, 0)::float8 as prev_revenue
    from cur left join prev on prev.id = cur.id
    order by cur.revenue desc`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), name: String(x.name), extra: x.extra ? String(x.extra) : null, color: x.color ? String(x.color) : null,
    revenue: Number(x.revenue), units: Number(x.units), days: Number(x.days), animations: Number(x.animations),
    prevRevenue: Number(x.prev_revenue),
  }));
}

/** Série journalière : CA et unités par jour d'animation. */
export async function animationDaily(range: Range, filter?: { animatriceId?: string; city?: string }) {
  const where = buildWhere(range, filter);
  const r = await db.execute(sql`
    select a.date::text as date,
      coalesce(sum(la.revenue), 0)::float8 as revenue,
      coalesce(sum(la.units), 0)::float8 as units,
      coalesce(sum(a.days), 0)::float8 as days
    from animations a
    left join lateral (select ${selloutSumSql("al", "lp")} as revenue, coalesce(sum(al.quantity_sold),0)::float8 as units from animation_lines al left join products lp on lp.id = al.product_id where al.animation_id = a.id) la on true
    where ${where}
    group by a.date order by a.date`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({ date: String(x.date), revenue: Number(x.revenue), units: Number(x.units), days: Number(x.days) }));
}

/** Série mensuelle sur 13 mois, pour la tendance. */
export async function animationMonthly(endExclusive: string, months = 13, filter?: { animatriceId?: string }) {
  const r = await db.execute(sql`
    select to_char(a.date, 'YYYY-MM') as month,
      coalesce(sum(la.revenue), 0)::float8 as revenue,
      coalesce(sum(la.units), 0)::float8 as units
    from animations a
    left join lateral (select ${selloutSumSql("al", "lp")} as revenue, coalesce(sum(al.quantity_sold),0)::float8 as units from animation_lines al left join products lp on lp.id = al.product_id where al.animation_id = a.id) la on true
    where a.status = 'DONE' and a.date < ${endExclusive}::date
      and a.date >= (date_trunc('month', ${endExclusive}::date) - interval '${sql.raw(String(months - 1))} months')
      ${filter?.animatriceId ? sql`and a.animatrice_id = ${filter.animatriceId}::uuid` : sql``}
    group by 1 order by 1`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({ month: String(x.month), revenue: Number(x.revenue), units: Number(x.units) }));
}

/* ------------------------------ Objectifs --------------------------------- */

export type ObjectiveRow = { city: string; brandId: string; brandName: string; color: string; yearlyUnits: number; monthlyUnits: number };

/** Objectifs animation (unités) par ville × marque pour une année. */
export async function animationObjectives(year: number): Promise<ObjectiveRow[]> {
  const r = await db.execute(sql`
    select o.city, b.id as brand_id, b.name as brand_name, b.color, o.units::float8 as units, o.month
    from animation_objectives o join brands b on b.id = o.brand_id
    where o.year = ${year} and o.month is null
    order by o.city, b.name`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    city: String(x.city), brandId: String(x.brand_id), brandName: String(x.brand_name), color: String(x.color),
    yearlyUnits: Number(x.units), monthlyUnits: Number(x.units) / 12,
  }));
}

/**
 * Objectif d'unités attendu sur une période : objectif annuel × (jours de la période / 365),
 * limité aux villes et marques demandées. Prorata linéaire — le même que celui du classeur (annuel ÷ 12).
 */
export function objectiveForRange(objectives: ObjectiveRow[], range: Range, opts?: { cities?: string[]; brandId?: string }) {
  const days = Math.max(1, Math.round((new Date(range.end + "T12:00:00Z").getTime() - new Date(range.start + "T12:00:00Z").getTime()) / 86400000));
  const cities = opts?.cities?.map(cityKey);
  return objectives
    .filter((o) => (!cities || cities.includes(cityKey(o.city))) && (!opts?.brandId || o.brandId === opts.brandId))
    .reduce((sum, o) => sum + (o.yearlyUnits * days) / 365, 0);
}

/* --------------------------- Plan d'action -------------------------------- */

export type ActionPlanItem = {
  severity: "critique" | "important" | "opportunité" | "bravo";
  title: string;
  detail: string;
  action: string;
};

export type AnimatriceScore = {
  id: string; name: string; city: string | null;
  revenue: number; units: number; days: number; animations: number; pos: number;
  revenuePerDay: number; unitsPerDay: number; basket: number;
  prevRevenuePerDay: number; progression: number | null;
  objectiveUnits: number; completion: number | null;
  brandsCovered: number; topBrand: string | null; missingBrands: string[];
  topProduct: string | null; topPos: string | null; blankDays: number;
  score: number; rank: number;
  plan: ActionPlanItem[];
};

/**
 * Scorecard + plan d'action par animatrice sur la période.
 *
 * L'objectif d'une animatrice est l'objectif de sa (ses) ville(s) d'intervention, au prorata
 * de ses jours d'animation dans cette ville : deux animatrices sur la même ville ne portent pas
 * chacune 100 % de l'objectif.
 */
export async function animatriceScores(range: Range, prev: Range, year: number): Promise<AnimatriceScore[]> {
  const [rows, objectives] = await Promise.all([
    db.execute(sql`
      with anim as (
        select a.*, coalesce(la.revenue, 0) as revenue, coalesce(la.units, 0) as units
        from animations a
        left join lateral (select ${selloutSumSql("al", "lp")} as revenue, coalesce(sum(al.quantity_sold),0)::float8 as units from animation_lines al left join products lp on lp.id = al.product_id where al.animation_id = a.id) la on true
        where a.status = 'DONE' and a.date >= ${range.start}::date and a.date < ${range.end}::date
      ),
      prev as (
        select a.animatrice_id, coalesce(sum(la.revenue), 0)::float8 as revenue, coalesce(sum(a.days), 0)::float8 as days
        from animations a
        left join lateral (select ${selloutSumSql("al", "lp")} as revenue from animation_lines al left join products lp on lp.id = al.product_id where al.animation_id = a.id) la on true
        where a.status = 'DONE' and a.date >= ${prev.start}::date and a.date < ${prev.end}::date
        group by 1
      ),
      brands_cur as (
        select an.animatrice_id, b.id as brand_id, b.name as brand_name, sum(l.quantity_sold)::float8 as units
        from anim an join animation_lines l on l.animation_id = an.id join products p on p.id = l.product_id join brands b on b.id = p.brand_id
        group by 1, 2, 3
      ),
      top_product as (
        select distinct on (an.animatrice_id) an.animatrice_id, p.name, sum(l.quantity_sold) as q
        from anim an join animation_lines l on l.animation_id = an.id join products p on p.id = l.product_id
        group by an.animatrice_id, p.name order by an.animatrice_id, q desc
      ),
      top_pos as (
        select distinct on (an.animatrice_id) an.animatrice_id, c.name, sum(an.revenue) as r
        from anim an join clients c on c.id = an.client_id
        group by an.animatrice_id, c.name order by an.animatrice_id, r desc
      ),
      city_days as (
        select an.animatrice_id, an.city, sum(an.days)::float8 as days from anim an where an.city is not null group by 1, 2
      ),
      city_total as (
        select city, sum(days)::float8 as days from city_days group by 1
      )
      select u.id, u.name, u.city,
        coalesce(sum(an.revenue), 0)::float8 as revenue,
        coalesce(sum(an.units), 0)::float8 as units,
        coalesce(sum(an.days), 0)::float8 as days,
        count(an.id)::int as animations,
        count(distinct an.client_id)::int as pos,
        count(distinct an.id) filter (where an.units = 0)::int as blank_days,
        coalesce(max(pv.revenue), 0)::float8 as prev_revenue,
        coalesce(max(pv.days), 0)::float8 as prev_days,
        (select count(distinct brand_id) from brands_cur bc where bc.animatrice_id = u.id)::int as brands_covered,
        (select brand_name from brands_cur bc where bc.animatrice_id = u.id order by units desc limit 1) as top_brand,
        (select name from top_product tp where tp.animatrice_id = u.id) as top_product,
        (select name from top_pos tp where tp.animatrice_id = u.id) as top_pos,
        (select json_agg(json_build_object('city', cd.city, 'days', cd.days, 'cityDays', ct.days))
           from city_days cd join city_total ct on ct.city = cd.city where cd.animatrice_id = u.id) as cities
      from users u
      left join anim an on an.animatrice_id = u.id
      left join prev pv on pv.animatrice_id = u.id
      where u.role = 'ANIMATRICE' and u.active
      group by u.id, u.name, u.city`),
    animationObjectives(year),
  ]);

  const allBrands = await db.execute(sql`select id, name from brands where active order by name`);
  const brandNames = (allBrands.rows as { id: string; name: string }[]).map((b) => b.name);
  const rangeDays = Math.max(1, Math.round((new Date(range.end + "T12:00:00Z").getTime() - new Date(range.start + "T12:00:00Z").getTime()) / 86400000));

  const list: AnimatriceScore[] = [];
  for (const x of rows.rows as Record<string, unknown>[]) {
    const revenue = Number(x.revenue), units = Number(x.units), days = Number(x.days);
    const prevRevenue = Number(x.prev_revenue), prevDays = Number(x.prev_days);
    const cities = (x.cities as { city: string; days: number; cityDays: number }[] | null) ?? [];
    // Objectif au prorata : part de l'animatrice dans les jours d'animation de chaque ville.
    const objectiveUnits = cities.reduce((sum, c) => {
      const cityObjective = objectives.filter((o) => cityKey(o.city) === cityKey(c.city)).reduce((s2, o) => s2 + (o.yearlyUnits * rangeDays) / 365, 0);
      const share = c.cityDays > 0 ? c.days / c.cityDays : 1;
      return sum + cityObjective * share;
    }, 0);
    const revenuePerDay = days ? revenue / days : 0;
    const prevRevenuePerDay = prevDays ? prevRevenue / prevDays : 0;
    const topBrand = x.top_brand ? String(x.top_brand) : null;
    const coveredBrands = Number(x.brands_covered);
    list.push({
      id: String(x.id), name: String(x.name),
      city: [...cities].sort((c1, c2) => c2.days - c1.days)[0]?.city ?? (x.city ? String(x.city) : null),
      revenue, units, days, animations: Number(x.animations), pos: Number(x.pos),
      revenuePerDay, unitsPerDay: days ? units / days : 0, basket: units ? revenue / units : 0,
      prevRevenuePerDay, progression: prevRevenuePerDay ? ((revenuePerDay - prevRevenuePerDay) / prevRevenuePerDay) * 100 : null,
      objectiveUnits, completion: objectiveUnits > 0 ? (units / objectiveUnits) * 100 : null,
      brandsCovered: coveredBrands, topBrand, missingBrands: [],
      topProduct: x.top_product ? String(x.top_product) : null,
      topPos: x.top_pos ? String(x.top_pos) : null,
      blankDays: Number(x.blank_days),
      score: 0, rank: 0, plan: [],
    });
  }

  // Marques travaillées / oubliées, par animatrice
  const brandRows = await db.execute(sql`
    select an.animatrice_id, b.name, sum(l.quantity_sold)::float8 as units
    from animations an
    join animation_lines l on l.animation_id = an.id
    join products p on p.id = l.product_id join brands b on b.id = p.brand_id
    where an.status = 'DONE' and an.date >= ${range.start}::date and an.date < ${range.end}::date and an.animatrice_id is not null
    group by 1, 2`);
  const worked = new Map<string, Set<string>>();
  for (const b of brandRows.rows as { animatrice_id: string; name: string }[]) {
    if (!worked.has(b.animatrice_id)) worked.set(b.animatrice_id, new Set());
    worked.get(b.animatrice_id)!.add(b.name);
  }

  // Repères d'équipe pour situer chacune
  const active = list.filter((a) => a.days > 0);
  const teamRevPerDay = active.length ? active.reduce((s, a) => s + a.revenuePerDay, 0) / active.length : 0;
  const teamBasket = active.length ? active.reduce((s, a) => s + a.basket, 0) / active.length : 0;
  const bestRevPerDay = Math.max(0, ...active.map((a) => a.revenuePerDay));
  const bestBasket = Math.max(0, ...active.map((a) => a.basket));

  for (const a of list) {
    a.missingBrands = brandNames.filter((b) => !(worked.get(a.id)?.has(b)));
    // Score 0-100 : CA/jour 40 · panier moyen 20 · atteinte objectif 25 · progression 15
    const rev = bestRevPerDay ? a.revenuePerDay / bestRevPerDay : 0;
    const bas = bestBasket ? a.basket / bestBasket : 0;
    const obj = a.completion === null ? 0.5 : Math.max(0, Math.min(1, a.completion / 100));
    const prog = a.progression === null ? 0.5 : Math.max(0, Math.min(1, 0.5 + a.progression / 100));
    a.score = a.days === 0 ? 0 : Math.round(100 * (0.4 * rev + 0.2 * bas + 0.25 * obj + 0.15 * prog));
    a.plan = buildActionPlan(a, { teamRevPerDay, teamBasket, rangeDays });
  }
  list.sort((x, y) => y.score - x.score);
  list.forEach((a, i) => (a.rank = i + 1));
  return list;
}

/** Plan d'action : ce que cette animatrice doit changer cette semaine, avec le pourquoi chiffré. */
function buildActionPlan(a: AnimatriceScore, ctx: { teamRevPerDay: number; teamBasket: number; rangeDays: number }): ActionPlanItem[] {
  const plan: ActionPlanItem[] = [];
  const mad = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} MAD`;

  if (a.days === 0) {
    plan.push({
      severity: "critique", title: "Aucun jour d'animation sur la période",
      detail: "Aucune journée saisie : soit elle n'a pas travaillé, soit le fichier quotidien n'a pas été chargé.",
      action: "Vérifier son planning et l'import du fichier du jour.",
    });
    return plan;
  }

  if (a.completion !== null && a.completion < 70) {
    const gap = Math.max(0, a.objectiveUnits - a.units);
    plan.push({
      severity: a.completion < 40 ? "critique" : "important",
      title: `Objectif atteint à ${Math.round(a.completion)} %`,
      detail: `${Math.round(a.units)} unités vendues pour un objectif de ${Math.round(a.objectiveUnits)} sur la période (part de l'objectif de ${a.city ?? "sa ville"} au prorata de ses jours).`,
      action: `Combler ${Math.round(gap)} unités : +${Math.ceil(gap / Math.max(1, a.days))} unités par jour d'animation${gap / Math.max(1, a.unitsPerDay || 1) <= 45 ? `, soit ${Math.ceil(gap / Math.max(1, a.unitsPerDay || 1))} journée(s) supplémentaires au rythme actuel` : " — l'écart est trop large pour être rattrapé au rythme actuel : arbitrer entre renfort de journées et révision de l'objectif"}.`,
    });
  } else if (a.completion !== null && a.completion >= 100) {
    plan.push({
      severity: "bravo", title: `Objectif dépassé (${Math.round(a.completion)} %)`,
      detail: `${Math.round(a.units)} unités contre ${Math.round(a.objectiveUnits)} attendues.`,
      action: "Documenter ce qui marche (argumentaire, produits mis en avant) et le transmettre à l'équipe.",
    });
  }

  if (ctx.teamRevPerDay > 0 && a.revenuePerDay < ctx.teamRevPerDay * 0.75) {
    plan.push({
      severity: "important", title: "CA par jour sous la moyenne de l'équipe",
      detail: `${mad(a.revenuePerDay)}/jour contre ${mad(ctx.teamRevPerDay)} en moyenne (${Math.round((1 - a.revenuePerDay / ctx.teamRevPerDay) * 100)} % d'écart).`,
      action: "Accompagner une journée sur le terrain pour observer l'accroche client et le closing.",
    });
  }

  if (ctx.teamBasket > 0 && a.basket < ctx.teamBasket * 0.85 && a.units > 0) {
    plan.push({
      severity: "opportunité", title: "Panier moyen à faire monter",
      detail: `${mad(a.basket)} par unité contre ${mad(ctx.teamBasket)} pour l'équipe : elle vend surtout des références d'entrée de gamme.`,
      action: "Travailler la montée en gamme et la vente croisée (sérum + crème) sur ses prochaines animations.",
    });
  }

  if (a.blankDays > 0) {
    plan.push({
      severity: a.blankDays >= 3 ? "important" : "opportunité",
      title: `${a.blankDays} journée(s) sans aucune vente`,
      detail: "Des journées d'animation saisies sans une seule unité vendue.",
      action: "Vérifier la disponibilité du stock en rayon et l'emplacement du stand ces jours-là.",
    });
  }

  if (a.missingBrands.length > 0 && a.units > 0) {
    plan.push({
      severity: "opportunité",
      title: `${a.missingBrands.length} marque(s) jamais vendues sur la période`,
      detail: `Aucune vente sur : ${a.missingBrands.slice(0, 4).join(", ")}${a.missingBrands.length > 4 ? "…" : ""}.`,
      action: "Lui fixer un objectif d'une vente par animation sur la marque la plus rentable de la liste.",
    });
  }

  if (a.progression !== null && a.progression < -15) {
    plan.push({
      severity: "important", title: `Recul de ${Math.abs(Math.round(a.progression))} % du CA par jour`,
      detail: `${mad(a.revenuePerDay)}/jour contre ${mad(a.prevRevenuePerDay)} sur la période précédente.`,
      action: "Point individuel : identifier ce qui a changé (points de vente, stock, motivation).",
    });
  } else if (a.progression !== null && a.progression > 20) {
    plan.push({
      severity: "bravo", title: `Progression de ${Math.round(a.progression)} % du CA par jour`,
      detail: `${mad(a.revenuePerDay)}/jour contre ${mad(a.prevRevenuePerDay)} précédemment.`,
      action: "Reconnaître la progression et sécuriser le rythme sur le mois suivant.",
    });
  }

  if (a.pos === 1 && a.days >= 5) {
    plan.push({
      severity: "opportunité", title: "Un seul point de vente animé",
      detail: `${a.days} jours concentrés sur ${a.topPos ?? "un seul point de vente"}.`,
      action: "Élargir la tournée : un POS saturé rapporte moins qu'une rotation sur 2 ou 3 points de vente.",
    });
  }

  return plan;
}

/* ------------------------------ Palmarès ---------------------------------- */

export type Best = { label: string; value: string; sub: string } | null;

export async function bestOf(range: Range) {
  const r = await db.execute(sql`
    with anim as (
      select a.*, coalesce(la.revenue, 0) as revenue, coalesce(la.units, 0) as units
      from animations a
      left join lateral (select ${selloutSumSql("al", "lp")} as revenue, coalesce(sum(al.quantity_sold),0)::float8 as units from animation_lines al left join products lp on lp.id = al.product_id where al.animation_id = a.id) la on true
      where a.status = 'DONE' and a.date >= ${range.start}::date and a.date < ${range.end}::date
    )
    select
      (select json_build_object('name', p.name, 'units', sum(l.quantity_sold), 'revenue', ${selloutSumSql("l", "p")})
       from anim a join animation_lines l on l.animation_id = a.id join products p on p.id = l.product_id
       group by p.name order by sum(l.quantity_sold) desc limit 1) as product,
      (select json_build_object('name', u.name, 'revenue', sum(a.revenue), 'days', sum(a.days))
       from anim a join users u on u.id = a.animatrice_id group by u.name order by sum(a.revenue) desc limit 1) as animatrice,
      (select json_build_object('name', c.name, 'city', max(c.city), 'revenue', sum(a.revenue), 'days', sum(a.days))
       from anim a join clients c on c.id = a.client_id group by c.name order by sum(a.revenue) desc limit 1) as pos,
      (select json_build_object('name', a.city, 'revenue', sum(a.revenue))
       from anim a where a.city is not null group by a.city order by sum(a.revenue) desc limit 1) as city,
      (select json_build_object('name', b.name, 'units', sum(l.quantity_sold), 'revenue', ${selloutSumSql("l", "p")})
       from anim a join animation_lines l on l.animation_id = a.id join products p on p.id = l.product_id join brands b on b.id = p.brand_id
       group by b.name order by ${selloutSumSql("l", "p")} desc limit 1) as brand,
      (select json_build_object('date', a.date::text, 'revenue', sum(a.revenue))
       from anim a group by a.date order by sum(a.revenue) desc limit 1) as day`);
  return r.rows[0] as Record<string, { name?: string; date?: string; units?: number; revenue?: number; days?: number; city?: string } | null>;
}
