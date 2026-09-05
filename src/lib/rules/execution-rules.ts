import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtDate, fmtNum, fmtPct, iso, addDays } from "@/lib/format";
import type { Rule, Recommendation } from "./types";

/** Terrain : baisse du sell-out constaté sur un point de vente ; animations du jour sans saisie. */
export const terrainRules: Rule = {
  id: "terrain-sellout",
  label: "Sell-out terrain en baisse",
  description: "Dernière animation d'un point de vente avec un sell-out inférieur de X % à la moyenne de ses animations précédentes.",
  async run({ settings, now: today }) {
    const r = await db.execute(sql`
      with per_anim as (
        select a.id, a.client_id, a.date, sum(al.quantity_sold)::float8 as sold
        from animations a join animation_lines al on al.animation_id = a.id
        where a.status = 'DONE' group by a.id, a.client_id, a.date
      ),
      ranked as (
        select *, row_number() over (partition by client_id order by date desc) as rn,
               avg(sold) over (partition by client_id) as avg_all, count(*) over (partition by client_id) as n
        from per_anim
      )
      select r.client_id, c.name, c.city, r.date::text as date, r.sold, r.avg_all, r.n
      from ranked r join clients c on c.id = r.client_id
      where r.rn = 1 and r.n >= 3 and r.avg_all > 0 and r.date >= ${iso(addDays(today, -60))}::date`);
    const out: Recommendation[] = [];
    for (const row of r.rows as { client_id: string; name: string; city: string | null; date: string; sold: number; avg_all: number; n: number }[]) {
      // moyenne des animations précédentes (hors la dernière)
      const prevAvg = (row.avg_all * row.n - row.sold) / (row.n - 1);
      if (prevAvg <= 0) continue;
      const drop = ((row.sold - prevAvg) / prevAvg) * 100;
      if (drop > -settings.sellOutDropPct) continue;
      out.push({
        key: `terrain-sellout:${row.client_id}`,
        rule: "terrain-sellout",
        category: "TERRAIN",
        priority: drop < -40 ? "HIGH" : "MEDIUM",
        title: row.name,
        subtitle: `Baisse du sell-out de ${fmtPct(Math.abs(drop))}${row.city ? " · " + row.city : ""}`,
        facts: [
          { label: "Dernière animation", value: fmtDate(row.date) },
          { label: "Ventes dernière animation", value: `${fmtNum(row.sold)} u.` },
          { label: "Moyenne animations précédentes", value: `${fmtNum(prevAvg)} u.` },
        ],
        why: "Le sell-out en animation chute alors que le point de vente était performant : stock rayon insuffisant, PLV manquante ou trafic en baisse.",
        action: "Programmer une nouvelle animation, vérifier le stock rayon et la visibilité, et analyser les produits concernés.",
        task: { title: `Analyser la baisse du sell-out — ${row.name}`, dueInDays: 7, role: "TRADE" },
        entity: { type: "client", id: row.client_id, href: `/clients/${row.client_id}` },
      });
    }
    return out;
  },
};

/** Tâches en retard par responsable. */
export const overdueTasksRule: Rule = {
  id: "tasks-overdue",
  label: "Tâches en retard",
  description: "Tâches ouvertes dont l'échéance est dépassée, regroupées par responsable.",
  async run({ now: today }) {
    const r = await db.execute(sql`
      select coalesce(u.id::text, '') as user_id, coalesce(u.name, 'Non assigné') as name, count(*)::int as n, min(t.due_date)::text as oldest,
             string_agg(t.title, ' · ' order by t.due_date) as titles
      from tasks t left join users u on u.id = t.assignee_id
      where t.status in ('TODO','IN_PROGRESS') and t.due_date < ${iso(today)}::date
      group by u.id, u.name order by n desc`);
    return (r.rows as { user_id: string; name: string; n: number; oldest: string; titles: string }[]).map((row) => ({
      key: `tasks-overdue:${row.user_id || "none"}`,
      rule: "tasks-overdue",
      category: "EXECUTION" as const,
      priority: row.n >= 3 ? ("HIGH" as const) : ("MEDIUM" as const),
      title: row.name,
      subtitle: `${row.n} tâche${row.n > 1 ? "s" : ""} en retard`,
      facts: [{ label: "Plus ancienne échéance", value: fmtDate(row.oldest) }, { label: "Tâches", value: row.titles.length > 120 ? row.titles.slice(0, 120) + "…" : row.titles }],
      why: "Les actions décidées ne sont pas exécutées dans les délais : l'impact attendu est repoussé.",
      action: "Faire un point avec le responsable, replanifier ou réassigner.",
      task: { title: `Point tâches en retard — ${row.name}`, dueInDays: 1, role: "ADMIN" as const },
      entity: { type: "user" as const, id: row.user_id, href: `/taches?assignee=${row.user_id}&overdue=1` },
    }));
  },
};
