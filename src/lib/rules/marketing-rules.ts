import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtMAD, fmtNum, fmtPct, iso, addDays } from "@/lib/format";
import type { Rule, Recommendation } from "./types";

/** Budget engagé vs budget annuel. */
export const budgetRule: Rule = {
  id: "budget-overrun",
  label: "Budget marketing sous tension",
  description: "Budget engagé (engagé + dépensé) au-delà du seuil d'alerte, ou consommation en avance sur l'année.",
  async run({ settings, now: today }) {
    const year = today.getUTCFullYear();
    const r = await db.execute(sql`
      select b.id, b.name, bu.amount::float8 as budget,
        coalesce(sum(case when e.status in ('COMMITTED','SPENT') then e.amount end),0)::float8 as engaged,
        coalesce(sum(case when e.status = 'SPENT' then e.amount end),0)::float8 as spent,
        coalesce(sum(e.amount),0)::float8 as planned
      from brands b join budgets bu on bu.brand_id = b.id and bu.year = ${year}
      left join marketing_expenses e on e.brand_id = b.id and extract(year from e.date) = ${year}
      group by b.id, b.name, bu.amount`);
    const out: Recommendation[] = [];
    const yearProgress = (today.getUTCMonth() + today.getUTCDate() / 30) / 12;
    for (const row of r.rows as { id: string; name: string; budget: number; engaged: number; spent: number; planned: number }[]) {
      if (!row.budget) continue;
      const pct = (row.engaged / row.budget) * 100;
      const plannedPct = (row.planned / row.budget) * 100;
      const ahead = pct / 100 > yearProgress + 0.15 && pct >= 50;
      if (pct < settings.budgetAlertPct && plannedPct <= 100 && !ahead) continue;
      const over = pct >= 100 || plannedPct > 100;
      out.push({
        key: `budget-overrun:${row.id}:${year}`,
        rule: "budget-overrun",
        category: "BUDGET",
        priority: pct >= 100 ? "CRITICAL" : over || pct >= settings.budgetAlertPct ? "HIGH" : "MEDIUM",
        title: row.name.toUpperCase(),
        subtitle: pct >= 100 ? "Budget annuel dépassé" : plannedPct > 100 ? "Le prévu dépasse le budget annuel" : ahead ? "Consommation en avance sur l'année" : `Budget engagé à ${Math.round(pct)} %`,
        facts: [
          { label: "Budget annuel", value: fmtMAD(row.budget, { compact: true }) },
          { label: "Engagé", value: `${fmtMAD(row.engaged, { compact: true })} (${Math.round(pct)} %)` },
          { label: "Dépensé", value: fmtMAD(row.spent, { compact: true }) },
          { label: "Prévu total", value: `${fmtMAD(row.planned, { compact: true })} (${Math.round(plannedPct)} %)` },
          { label: "Avancement année", value: fmtPct(yearProgress * 100) },
        ],
        why: over ? "Les engagements dépassent l'enveloppe validée : chaque nouvelle action nécessite un arbitrage." : "Au rythme actuel, l'enveloppe sera consommée avant la fin de l'année.",
        action: over ? "Arbitrer : réduire les actions prévues à faible ROI ou revoir le budget de la marque." : "Prioriser les actions restantes par ROI attendu et geler celles sans résultat mesurable.",
        task: { title: `Arbitrage budget ${row.name} ${year}`, dueInDays: 5, role: "MARKETING" },
        entity: { type: "brand", id: row.id, href: `/marketing?brand=${row.id}` },
        brandId: row.id,
      });
    }
    return out;
  },
};

/** Ads intelligence (V1 : basée sur les dépenses digitales saisies avec conversions / CA attribué). */
export const adsRule: Rule = {
  id: "ads-performance",
  label: "Performance Ads",
  description: "SCALE / MAINTAIN / OPTIMIZE / STOP par campagne digitale : CPA et ROAS des 30 derniers jours vs les 90 jours précédents.",
  async run({ now: today, stocks }) {
    const d30 = iso(addDays(today, -30)), d120 = iso(addDays(today, -120));
    const r = await db.execute(sql`
      select c.id, c.name, c.channel::text as channel, b.id as brand_id, b.name as brand_name,
        coalesce(sum(case when e.date >= ${d30}::date then e.amount end),0)::float8 as spend30,
        coalesce(sum(case when e.date >= ${d30}::date then e.conversions end),0)::float8 as conv30,
        coalesce(sum(case when e.date >= ${d30}::date then e.attributed_revenue end),0)::float8 as rev30,
        coalesce(sum(case when e.date >= ${d120}::date and e.date < ${d30}::date then e.amount end),0)::float8 as spend90,
        coalesce(sum(case when e.date >= ${d120}::date and e.date < ${d30}::date then e.conversions end),0)::float8 as conv90,
        coalesce(sum(case when e.date >= ${d120}::date and e.date < ${d30}::date then e.attributed_revenue end),0)::float8 as rev90
      from campaigns c join brands b on b.id = c.brand_id
      left join marketing_expenses e on e.campaign_id = c.id and e.category in ('META','TIKTOK','GOOGLE') and e.date <= ${iso(today)}::date
      where c.status = 'ACTIVE' and c.channel in ('META','TIKTOK','GOOGLE')
      group by c.id, c.name, c.channel, b.id, b.name`);
    const out: Recommendation[] = [];
    for (const row of r.rows as Record<string, number | string>[]) {
      const spend30 = Number(row.spend30), conv30 = Number(row.conv30), rev30 = Number(row.rev30);
      const spend90 = Number(row.spend90), conv90 = Number(row.conv90), rev90 = Number(row.rev90);
      if (spend30 <= 0) continue;
      const cpa = conv30 ? spend30 / conv30 : null, cpaRef = conv90 ? spend90 / conv90 : null;
      const roas = spend30 ? rev30 / spend30 : 0, roasRef = spend90 ? rev90 / spend90 : null;
      const cpaDelta = cpa && cpaRef ? ((cpa - cpaRef) / cpaRef) * 100 : null;
      let verdict: "SCALE" | "MAINTAIN" | "OPTIMIZE" | "STOP";
      if (roas < 1.2) verdict = "STOP";
      else if ((cpaDelta !== null && cpaDelta > 20) || (roasRef !== null && roas < roasRef * 0.75)) verdict = "OPTIMIZE";
      else if (roas >= 3 && (cpaDelta === null || cpaDelta <= 0)) verdict = "SCALE";
      else verdict = "MAINTAIN";
      if (verdict === "MAINTAIN") continue;
      const tight = stocks.filter((p) => p.brandId === row.brand_id && p.coverageMonths !== null && p.coverageMonths < 1.5 && p.avgMonthly > 30);
      const why = verdict === "STOP" ? `ROAS ${roas.toFixed(1)} : chaque dirham investi rapporte moins qu'il ne coûte une fois la marge déduite.`
        : verdict === "OPTIMIZE" ? `CPA ${cpaDelta !== null ? fmtPct(cpaDelta, 0, true) + " vs 90 jours précédents" : "dégradé"}${roasRef !== null ? `, ROAS ${roas.toFixed(1)} vs ${roasRef.toFixed(1)}` : ""}. Diagnostic probable : fatigue créative ou problème post-clic (landing, offre).`
        : `ROAS ${roas.toFixed(1)}${cpaDelta !== null ? `, CPA ${fmtPct(cpaDelta, 0, true)}` : ""} : la campagne est rentable et stable.`;
      const action = verdict === "STOP" ? "Couper la campagne, conserver les audiences, réallouer le budget vers une campagne rentable."
        : verdict === "OPTIMIZE" ? "Analyser la landing page et le tunnel, tester 3 nouvelles variations créatives, resserrer le ciblage."
        : tight.length ? `Augmenter le budget par paliers de 20 % — MAIS d'abord sécuriser le stock de ${tight.map((p) => p.name).join(", ")} (couverture < 1,5 mois).` : "Augmenter le budget par paliers de 20 % en surveillant le CPA à chaque palier.";
      out.push({
        key: `ads-${verdict.toLowerCase()}:${row.id}`,
        rule: "ads-performance",
        category: "MARKETING",
        priority: verdict === "STOP" ? "HIGH" : verdict === "OPTIMIZE" ? "HIGH" : "MEDIUM",
        title: `${String(row.brand_name).toUpperCase()} — ${row.name}`,
        subtitle: `${verdict} · ${row.channel}`,
        facts: [
          { label: "Dépense 30 j", value: fmtMAD(spend30, { compact: true }) },
          { label: "CA attribué 30 j", value: fmtMAD(rev30, { compact: true }) },
          { label: "ROAS", value: roas.toFixed(2) + (roasRef !== null ? ` (réf. ${roasRef.toFixed(2)})` : "") },
          { label: "CPA", value: cpa ? fmtMAD(cpa) + (cpaDelta !== null ? ` (${fmtPct(cpaDelta, 0, true)})` : "") : "n/c" },
          { label: "Conversions", value: fmtNum(conv30) },
        ],
        why, action,
        impact: verdict === "SCALE" ? `+${fmtMAD(rev30 * 0.2, { compact: true })} de CA attribué par palier de +20 %` : verdict === "STOP" ? `${fmtMAD(spend30, { compact: true })}/mois réalloués` : "Retour au CPA de référence",
        task: { title: `${verdict} — ${row.name}`, dueInDays: verdict === "STOP" ? 1 : 3, role: "MARKETING" },
        entity: { type: "campaign", id: String(row.id), href: `/marketing?brand=${row.brand_id}` },
        brandId: String(row.brand_id),
      });
    }
    return out;
  },
};
