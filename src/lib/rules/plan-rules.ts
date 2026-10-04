/**
 * Règles Action Center du plan marketing (Marketing OS).
 *
 *  - `plan-actions-late`   : actions marketing ouvertes dont l'échéance est passée, par marque (qui, combien, quel budget).
 *  - `plan-unallocated`    : plan ACTIF dont le budget n'est pas alloué par canal (ou alloué au-delà du budget).
 *  - `plan-month-no-action`: mois du plan en cours (ou à venir sous 30 j) avec un budget mais aucune action.
 *
 * Lecture seule ; les seuils viennent de `settings.marketingPlan`. La page Priorités & actions reste l'écran
 * de travail : ces règles ne font que remonter les retards dans l'Action Center et le cockpit.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtMAD, fmtDateShort, fmtMonth, iso, addDays } from "@/lib/format";
import { engagedSql } from "@/lib/budget";
import type { Rule, Recommendation } from "./types";

export const planActionsLateRule: Rule = {
  id: "plan-actions-late",
  label: "Actions marketing en retard",
  description: "Actions du plan marketing (Priorités & actions) dont l'échéance est passée sans être terminées.",
  async run({ now }) {
    const todayIso = iso(now);
    const r = await db.execute<{ brand_id: string; brand: string; n: number; budget: number; oldest: string; titles: string[]; assignees: string[] }>(sql`
      select a.brand_id, b.name as brand, count(*)::int as n, coalesce(sum(a.budget_planned), 0)::float8 as budget, min(t.due_date)::text as oldest,
        (array_agg(a.title order by t.due_date))[1:3] as titles,
        array_remove(array_agg(distinct u.name), null) as assignees
      from marketing_actions a join tasks t on t.id = a.task_id join brands b on b.id = a.brand_id left join users u on u.id = t.assignee_id
      where t.status in ('TODO','IN_PROGRESS','BLOCKED') and t.due_date < ${todayIso}::date
      group by a.brand_id, b.name order by n desc`);
    return r.rows.map((x): Recommendation => ({
      key: `plan-actions-late:${x.brand_id}`, rule: "plan-actions-late", category: "MARKETING",
      priority: x.n >= 3 ? "HIGH" : "MEDIUM",
      title: x.brand.toUpperCase(), subtitle: `${x.n} action(s) marketing en retard`,
      facts: [
        { label: "Actions en retard", value: String(x.n) },
        { label: "Budget prévu concerné", value: fmtMAD(x.budget, { compact: true }) },
        { label: "Plus ancienne échéance", value: fmtDateShort(x.oldest) },
        { label: "Responsables", value: x.assignees.length ? x.assignees.join(", ") : "non assignées" },
        { label: "Exemples", value: x.titles.join(" · ") },
      ],
      why: "Des actions du plan sont passées d'échéance sans être terminées : le budget prévu reste immobilisé et l'objectif du mois n'est pas servi.",
      action: "Ouvrir Priorités & actions : terminer, replanifier ou annuler chaque action en retard ; réassigner celles sans responsable.",
      task: { title: `Replanifier les actions marketing en retard — ${x.brand}`, dueInDays: 2, role: "MARKETING" },
      entity: { type: "brand", id: x.brand_id, href: `/marketing/priorites?brand=${x.brand_id}` },
      brandId: x.brand_id, score: x.budget,
    }));
  },
};

export const planUnallocatedRule: Rule = {
  id: "plan-unallocated",
  label: "Plan marketing sans allocation",
  description: "Plan actif dont le budget n'est pas réparti par canal (ou réparti au-delà du budget).",
  async run() {
    const r = await db.execute<{ id: string; name: string; brand_id: string; brand: string; budget: number | null; allocated: number }>(sql`
      select p.id, p.name, p.brand_id, b.name as brand,
        (select amount::float8 from budgets bu where bu.brand_id = p.brand_id and bu.year = p.year) as budget,
        coalesce((select sum(amount) from budget_lines bl where bl.brand_id = p.brand_id and bl.year = p.year), 0)::float8 as allocated
      from marketing_plans p join brands b on b.id = p.brand_id where p.status = 'ACTIVE'`);
    const out: Recommendation[] = [];
    for (const p of r.rows) {
      if (!p.budget || p.budget <= 0) continue;
      const pct = (p.allocated / p.budget) * 100;
      if (pct >= 80 && pct <= 100) continue;
      out.push({
        key: `plan-unallocated:${p.id}`, rule: "plan-unallocated", category: "BUDGET", priority: pct > 100 ? "HIGH" : "MEDIUM",
        title: p.brand.toUpperCase(), subtitle: pct > 100 ? "Allocation au-delà du budget" : `Budget alloué à ${Math.round(pct)} % seulement`,
        facts: [{ label: "Plan", value: p.name }, { label: "Budget", value: fmtMAD(p.budget, { compact: true }) }, { label: "Alloué par canal", value: `${fmtMAD(p.allocated, { compact: true })} (${Math.round(pct)} %)` }],
        why: pct > 100 ? "La somme des canaux dépasse l'enveloppe : les actions générées engageraient plus que le budget." : "Sans répartition par canal, le plan mensuel ne peut pas générer d'actions budgétées et l'écart plan / réel n'est pas mesurable.",
        action: "Ouvrir le plan → Allocation par canal : « Proposer une allocation » (historique réel ajusté par verdict) puis enregistrer.",
        task: { title: `Allouer le budget du plan ${p.name}`, dueInDays: 5, role: "MARKETING" },
        entity: { type: "brand", id: p.brand_id, href: `/marketing/plan/${p.id}` }, brandId: p.brand_id, score: p.budget,
      });
    }
    return out;
  },
};

export const planMonthNoActionRule: Rule = {
  id: "plan-month-no-action",
  label: "Mois du plan sans action",
  description: "Mois budgété d'un plan actif, en cours ou à venir sous 30 jours, sans aucune action créée.",
  async run({ now }) {
    const start = `${iso(now).slice(0, 7)}-01`, horizon = iso(addDays(now, 30));
    const r = await db.execute<{ plan_id: string; name: string; brand_id: string; brand: string; month: string; budget: number; product: string | null; engaged: number }>(sql`
      select m.plan_id, p.name, p.brand_id, b.name as brand, m.month::text as month, m.budget::float8 as budget, pr.name as product,
        coalesce((select sum(e.amount) from marketing_expenses e where ${engagedSql("e")} and e.brand_id = p.brand_id and e.date >= m.month and e.date < (m.month + interval '1 month')), 0)::float8 as engaged
      from marketing_plan_months m join marketing_plans p on p.id = m.plan_id join brands b on b.id = p.brand_id left join products pr on pr.id = m.focus_product_id
      where p.status = 'ACTIVE' and m.budget > 0 and m.month >= ${start}::date and m.month <= ${horizon}::date
        and not exists (select 1 from marketing_actions a where a.plan_id = m.plan_id and a.month = m.month)`);
    return r.rows.map((x): Recommendation => ({
      key: `plan-month-no-action:${x.plan_id}:${x.month}`, rule: "plan-month-no-action", category: "MARKETING", priority: x.month <= start ? "HIGH" : "MEDIUM",
      title: `${x.brand.toUpperCase()} — ${fmtMonth(x.month)}`, subtitle: "Budget du mois sans action",
      facts: [{ label: "Plan", value: x.name }, { label: "Budget du mois", value: fmtMAD(x.budget, { compact: true }) }, { label: "Produit prioritaire", value: x.product ?? "non défini" }, { label: "Déjà engagé sur le mois", value: fmtMAD(x.engaged, { compact: true }) }],
      why: "Le mois est budgété mais aucune action n'a été créée : personne n'a de tâche, le budget ne sera ni engagé ni mesuré.",
      action: "Ouvrir le plan → Plan mensuel → « Générer les actions » (répartition par canal) ou créer les actions à la main, avec responsable et échéance.",
      task: { title: `Créer les actions de ${fmtMonth(x.month)} — ${x.brand}`, dueInDays: 3, role: "MARKETING" },
      entity: { type: "brand", id: x.brand_id, href: `/marketing/plan/${x.plan_id}?mois=${x.month}` }, brandId: x.brand_id, score: x.budget,
    }));
  },
};

export const planRules: Rule[] = [planActionsLateRule, planUnallocatedRule, planMonthNoActionRule];
