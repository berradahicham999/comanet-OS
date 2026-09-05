import { sql } from "drizzle-orm";
import { db } from "@/db";
import { iso, addDays, startOfMonth, fmtMAD, fmtNum } from "@/lib/format";
import { animatriceScores } from "@/lib/animations";
import type { Rule, Recommendation } from "./types";

/**
 * Performance animation en temps réel : chaque point du plan d'action animatrice
 * qui mérite une décision remonte dans l'Action Center, avec l'écart chiffré.
 *
 * La fenêtre est le mois en cours à date, comparé au mois précédent à date —
 * c'est la maille de pilotage des objectifs.
 */
export const animationPerformanceRule: Rule = {
  id: "animation-performance",
  label: "Performance des animations",
  description: "Atteinte des objectifs par animatrice et par ville, CA/jour, panier moyen, journées sans vente.",
  async run({ now: today }) {
    const som = startOfMonth(today);
    const range = { start: iso(som), end: iso(addDays(today, 1)) };
    const prevStart = iso(new Date(Date.UTC(som.getUTCFullYear(), som.getUTCMonth() - 1, 1, 12)));
    const prev = { start: prevStart, end: iso(new Date(Date.UTC(som.getUTCFullYear(), som.getUTCMonth() - 1, today.getUTCDate() + 1, 12))) };
    const year = som.getUTCFullYear();

    const scores = await animatriceScores(range, prev, year);
    const out: Recommendation[] = [];

    for (const a of scores) {
      if (a.days === 0) continue;
      const facts = [
        { label: "CA sell-out du mois", value: fmtMAD(a.revenue) },
        { label: "CA / jour", value: fmtMAD(a.revenuePerDay) },
        { label: "Unités", value: `${fmtNum(a.units)} sur ${fmtNum(a.days)} jours` },
        ...(a.objectiveUnits > 0 ? [{ label: "Objectif à date", value: `${fmtNum(a.units)} / ${fmtNum(a.objectiveUnits)} u.` }] : []),
      ];
      // On ne remonte que le point le plus structurant de son plan : l'Action Center reste lisible.
      const top = a.plan.find((p) => p.severity === "critique") ?? a.plan.find((p) => p.severity === "important");
      if (!top) continue;
      out.push({
        key: `animation-perf:${a.id}`,
        rule: "animation-performance",
        category: "TERRAIN",
        priority: top.severity === "critique" ? "HIGH" : "MEDIUM",
        title: `${a.name}${a.city ? ` — ${a.city}` : ""}`,
        subtitle: top.title,
        facts,
        why: top.detail,
        action: top.action,
        impact: a.objectiveUnits > 0 ? `Objectif de ${a.city ?? "sa ville"} tenu à ${Math.round(a.completion ?? 0)} %.` : undefined,
        task: { title: `Point performance animation — ${a.name}`, dueInDays: top.severity === "critique" ? 3 : 7, role: "TRADE", priority: top.severity === "critique" ? "HIGH" : "MEDIUM" },
        entity: { type: "user", id: a.id, href: `/terrain/animatrices?focus=${a.id}` },
      });
    }

    // Villes très en retard sur leur objectif : arbitrage de tournée, pas de coaching individuel.
    const cityRows = await db.execute(sql`
      with real as (
        select a.city, coalesce(sum(l.quantity_sold), 0)::float8 as units, coalesce(sum(l.amount), 0)::float8 as revenue, sum(a.days)::float8 as days
        from animations a left join animation_lines l on l.animation_id = a.id
        where a.status = 'DONE' and a.date >= ${range.start}::date and a.date < ${range.end}::date and a.city is not null
        group by a.city
      ),
      obj as (select city, sum(units)::float8 as yearly from animation_objectives where year = ${year} and month is null group by city)
      select coalesce(real.city, obj.city) as city, coalesce(real.units, 0) as units, coalesce(real.revenue, 0) as revenue,
             coalesce(real.days, 0) as days, coalesce(obj.yearly, 0) as yearly
      from real full outer join obj on obj.city = real.city`);

    const elapsed = Math.max(1, today.getUTCDate());
    const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
    for (const row of cityRows.rows as { city: string; units: number; revenue: number; days: number; yearly: number }[]) {
      const yearly = Number(row.yearly);
      if (!yearly) continue;
      const expected = (yearly / 365) * elapsed;
      const units = Number(row.units);
      const pct = expected > 0 ? (units / expected) * 100 : null;
      if (pct === null || pct >= 60) continue;
      const monthTarget = (yearly / 12);
      out.push({
        key: `animation-city:${row.city}`,
        rule: "animation-performance",
        category: "TERRAIN",
        priority: pct < 30 ? "HIGH" : "MEDIUM",
        title: `${row.city} — objectif animation`,
        subtitle: `${Math.round(pct)} % de l'objectif à date`,
        facts: [
          { label: "Unités du mois", value: fmtNum(units) },
          { label: "Attendu à date", value: fmtNum(expected) },
          { label: "Objectif du mois", value: fmtNum(monthTarget) },
          { label: "Jours d'animation", value: fmtNum(Number(row.days)) },
        ],
        why: Number(row.days) === 0
          ? "Aucune journée d'animation dans cette ville ce mois-ci alors qu'un objectif y est fixé."
          : `Le rythme actuel (${fmtNum(units)} unités en ${fmtNum(Number(row.days))} jours) ne permet pas d'atteindre les ${fmtNum(monthTarget)} unités du mois.`,
        action: Number(row.days) === 0
          ? "Planifier des journées d'animation sur cette ville, ou réviser l'objectif s'il n'est plus d'actualité."
          : `Ajouter des journées ou renforcer les points de vente les plus porteurs : il reste ${daysInMonth - elapsed} jours.`,
        impact: `${fmtNum(Math.max(0, monthTarget - units))} unités à rattraper d'ici la fin du mois.`,
        task: { title: `Plan de rattrapage animation — ${row.city}`, dueInDays: 5, role: "TRADE", priority: pct < 30 ? "HIGH" : "MEDIUM" },
      });
    }

    return out;
  },
};
