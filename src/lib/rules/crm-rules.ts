import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtMAD, fmtNum, fmtPct, iso, fmtDate } from "@/lib/format";
import { pgArray } from "@/lib/sql-array";
import { visitProgress, paceVerdict, monthOf, monthElapsedPct, monthBounds, monthLabel, expectedVisits } from "@/lib/crm/portfolio-shared";
import { clientObjectiveProgress } from "@/lib/crm/objectives";
import type { Rule, Recommendation } from "./types";

/**
 * CRM commercial — alertes de suivi des visites et des objectifs client. Seuils : `settings.crm`
 * (Paramètres → CRM commercial). Les alertes de contrôle de présence portent `crmUserId` : l'Action Center
 * ne les montre qu'à la direction et au manager de la commerciale (`canSeePositions()`).
 */

type Row = { id: string; name: string; city: string | null; f: number | null; manager_id: string; manager: string; boss_id: string | null; counted: number; revenue12: number };

async function portfolioRows(month: string, countedKinds: string[]): Promise<Row[]> {
  const b = monthBounds(month);
  const r = await db.execute<Row>(sql`
    select c.id, c.name, c.city, c.visit_frequency_monthly as f, c.account_manager_id as manager_id, u.name as manager, u.manager_id as boss_id,
      (select count(*) from client_visits cv where cv.client_id = c.id and cv.status = 'EFFECTUEE' and cv.kind = any(${pgArray(countedKinds, "text")})
         and cv.date >= ${b.start}::date and cv.date < ${b.end}::date)::int as counted,
      coalesce((select sum(s.amount) from sales s where s.client_id = c.id and s.date >= ${b.start}::date - 365), 0)::float8 as revenue12
    from clients c join users u on u.id = c.account_manager_id and u.active
    where c.active and c.account_manager_id is not null`);
  return r.rows;
}

/** Clients prévus ce mois et jamais visités, après le jour d'alerte : une recommandation par commerciale. */
export const crmNotVisitedRule: Rule = {
  id: "crm-client-non-visite",
  label: "Clients prévus non visités",
  description: "À partir du jour d'alerte du mois, les clients d'un portefeuille avec une fréquence de visite qui n'ont reçu aucune visite ce mois.",
  async run({ settings, now }) {
    const s = settings.crm;
    const today = iso(now);
    if (Number(today.slice(8, 10)) < s.lateVisitDayOfMonth) return [];
    const month = monthOf(today);
    const rows = (await portfolioRows(month, s.countedKinds)).filter((c) => expectedVisits(c.f) > 0 && c.counted === 0);
    const byUser = new Map<string, Row[]>();
    for (const c of rows) byUser.set(c.manager_id, [...(byUser.get(c.manager_id) ?? []), c]);
    return [...byUser].map(([userId, cs]): Recommendation => {
      const top = [...cs].sort((a, b) => b.revenue12 - a.revenue12);
      return {
        key: `crm-client-non-visite:${userId}:${month}`,
        rule: "crm-client-non-visite",
        category: "COMMERCIAL",
        priority: cs.length >= 5 || Number(today.slice(8, 10)) >= 25 ? "HIGH" : "MEDIUM",
        title: cs[0].manager,
        subtitle: `${fmtNum(cs.length)} client(s) prévu(s) sans visite en ${monthLabel(month)}`,
        facts: [
          { label: "Clients sans visite", value: fmtNum(cs.length) },
          ...top.slice(0, 4).map((c) => ({ label: `${c.name}${c.city ? ` (${c.city})` : ""}`, value: `CA 12 mois ${fmtMAD(c.revenue12, { compact: true })}` })),
        ],
        why: `Ces clients ont une fréquence de visite définie et n'ont reçu aucune visite depuis le début du mois ; il reste ${monthBounds(month).days - Number(today.slice(8, 10))} jour(s).`,
        action: "Planifier ces clients dans les tournées de la fin du mois, en commençant par les plus gros CA (Ma tournée les remonte en tête).",
        task: { title: `Visiter ${cs.length} client(s) avant la fin du mois — ${cs[0].manager}`, dueInDays: 3, role: "TRADE" },
        suggestedAssigneeId: userId,
        entity: { type: "user", id: userId, href: `/clients/visites?user=${userId}&month=${month}` },
        score: top.reduce((a, c) => a + c.revenue12, 0),
      };
    });
  },
};

/** Portefeuille en retard sur le rythme du mois (progression nettement sous l'avancement du mois). */
export const crmPaceRule: Rule = {
  id: "crm-portefeuille-en-retard",
  label: "Portefeuille de visites en retard",
  description: "Progression des visites d'une commerciale inférieure de plus de N points à la part du mois écoulée (à partir du 8 du mois).",
  async run({ settings, now }) {
    const s = settings.crm;
    const today = iso(now);
    if (Number(today.slice(8, 10)) < 8) return [];
    const month = monthOf(today);
    const elapsed = monthElapsedPct(month, today);
    const rows = await portfolioRows(month, s.countedKinds);
    const byUser = new Map<string, Row[]>();
    for (const c of rows) byUser.set(c.manager_id, [...(byUser.get(c.manager_id) ?? []), c]);
    const out: Recommendation[] = [];
    for (const [userId, cs] of byUser) {
      const p = visitProgress(cs.map((c) => ({ frequency: c.f, done: c.counted })));
      const pace = paceVerdict(p, elapsed, s.paceGapPts);
      if (pace.kind !== "EN_RETARD") continue;
      out.push({
        key: `crm-portefeuille-en-retard:${userId}:${month}`,
        rule: "crm-portefeuille-en-retard",
        category: "COMMERCIAL",
        priority: (p.pct ?? 0) < elapsed / 2 ? "HIGH" : "MEDIUM",
        title: cs[0].manager,
        subtitle: `${fmtNum(p.counted)} visite(s) sur ${fmtNum(p.expected)} attendues · ${fmtPct(elapsed)} du mois écoulé`,
        facts: [
          { label: "Progression du mois", value: fmtPct(p.pct ?? 0) },
          { label: "Mois écoulé", value: fmtPct(elapsed) },
          { label: "Retard", value: `${fmtNum(pace.behind)} visite(s)` },
          { label: "Clients jamais visités ce mois", value: fmtNum(p.notVisited) },
        ],
        why: `La progression (${fmtPct(p.pct ?? 0)}) est inférieure de plus de ${s.paceGapPts} points à l'avancement du mois (${fmtPct(elapsed)}). Visites plafonnées à la fréquence de chaque client.`,
        action: "Faire le point avec la commerciale : tournées prévues, clients injoignables, fréquences à revoir si elles sont irréalistes.",
        task: { title: `Point visites du mois avec ${cs[0].manager}`, dueInDays: 2, role: "ADMIN" },
        suggestedAssigneeId: cs[0].boss_id,
        entity: { type: "user", id: userId, href: `/clients/visites?user=${userId}&month=${month}` },
        score: pace.behind * 1000,
      });
    }
    return out;
  },
};

/** Objectif client du mois en retard (réalisé sell-in sous le rythme attendu), à partir du jour de contrôle. */
export const crmObjectiveLateRule: Rule = {
  id: "crm-objectif-client-en-retard",
  label: "Objectif client en retard",
  description: "Clients dont le sell-in HT du mois est sous l'objectif saisi × avancement du mois × ratio de tolérance.",
  async run({ settings, now }) {
    const s = settings.crm;
    const today = iso(now);
    const month = monthOf(today);
    const progress = await clientObjectiveProgress(null, month, today, s);
    const late = [...progress].flatMap(([clientId, st]) => {
      const line = st.global ?? null;
      const lines = line ? [line] : st.brands;
      return lines.filter((l) => l.verdict === "EN_RETARD").map((l) => ({ clientId, line: l }));
    });
    if (!late.length) return [];
    const ids = [...new Set(late.map((x) => x.clientId))];
    const info = await db.execute<{ id: string; name: string; city: string | null; manager_id: string | null; manager: string | null }>(sql`
      select c.id, c.name, c.city, c.account_manager_id as manager_id, u.name as manager from clients c left join users u on u.id = c.account_manager_id
      where c.id = any(${pgArray(ids)}) and c.active`);
    const byId = new Map(info.rows.map((r) => [r.id, r]));
    const elapsed = monthElapsedPct(month, today);
    return late
      .filter((x) => byId.has(x.clientId))
      .map(({ clientId, line }): Recommendation => {
        const c = byId.get(clientId)!;
        const gap = line.target * (elapsed / 100) - line.realized;
        return {
          key: `crm-objectif-client-en-retard:${clientId}:${line.brandId ?? "global"}:${month}`,
          rule: "crm-objectif-client-en-retard",
          category: "COMMERCIAL",
          priority: (line.pct ?? 0) < elapsed / 3 ? "HIGH" : "MEDIUM",
          title: c.name,
          subtitle: `${line.brandName ? `${line.brandName} : ` : ""}${fmtMAD(line.realized, { compact: true })} sur ${fmtMAD(line.target, { compact: true })} (${fmtPct(line.pct ?? 0)}) · ${fmtPct(elapsed)} du mois écoulé`,
          facts: [
            { label: "Objectif du mois (HT)", value: `${fmtMAD(line.target)}${line.source === "ANNUEL" ? " (annuel ÷ 12)" : ""}` },
            { label: "Réalisé (sell-in HT)", value: fmtMAD(line.realized) },
            { label: "Commercial attitré", value: c.manager ?? "—" },
            ...(c.city ? [{ label: "Ville", value: c.city }] : []),
          ],
          why: `Le sell-in du mois est sous le rythme nécessaire pour tenir l'objectif saisi. Les ventes sont celles connues à ce jour (imports et pièces COMANET OS).`,
          action: "Visiter ou appeler le client avec une proposition de réassort sur ses produits habituels et l'assortiment manquant (fiche client → Suivi commercial).",
          task: { title: `Relancer ${c.name} : ${fmtMAD(line.realized, { compact: true })} / ${fmtMAD(line.target, { compact: true })}`, dueInDays: 3, role: "TRADE" },
          suggestedAssigneeId: c.manager_id,
          entity: { type: "client", id: clientId, href: `/clients/${clientId}?tab=crm` },
          score: Math.max(0, gap),
        };
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 12);
  },
};

/* ------------------------------------------------------------------ */
/* Contrôle de présence (direction et manager seulement)               */
/* ------------------------------------------------------------------ */

/** Visites des 7 derniers jours à vérifier ou sans position, non encore tranchées par une correction. */
export const crmVisitsToCheckRule: Rule = {
  id: "crm-visites-a-verifier",
  label: "Visites commerciales à vérifier",
  description: "Visites chronométrées hors du rayon du point de vente, sans position ou avec une autre anomalie, sur 7 jours.",
  async run({ now }) {
    const from = iso(new Date(now.getTime() - 7 * 86_400_000));
    const r = await db.execute<{ user_id: string; name: string; to_check: number; not_verified: number; refused: number }>(sql`
      select cv.user_id, u.name,
        count(*) filter (where cv.verification_status = 'A_VERIFIER')::int as to_check,
        count(*) filter (where cv.verification_status = 'NON_VERIFIEE')::int as not_verified,
        count(*) filter (where exists (select 1 from visit_events e where e.client_visit_id = cv.id and e.gps_error = 'REFUSE'))::int as refused
      from client_visits cv join users u on u.id = cv.user_id
      where cv.timing_source = 'CHRONO' and cv.date >= ${from}::date and cv.verification_status in ('A_VERIFIER', 'NON_VERIFIEE')
        and not exists (select 1 from visit_events c where c.client_visit_id = cv.id and c.type = 'CORRECTION')
      group by cv.user_id, u.name`);
    return r.rows.map((x): Recommendation => ({
      key: `crm-visites-a-verifier:${x.user_id}`,
      rule: "crm-visites-a-verifier",
      category: "COMMERCIAL",
      priority: x.refused > 0 || x.to_check + x.not_verified >= 3 ? "HIGH" : "MEDIUM",
      title: x.name,
      subtitle: `${fmtNum(x.to_check + x.not_verified)} visite(s) commerciale(s) à vérifier depuis le ${fmtDate(from)}`,
      facts: [
        { label: "À vérifier (hors zone, durée, différé…)", value: fmtNum(x.to_check) },
        { label: "Sans position", value: fmtNum(x.not_verified) },
        { label: "Dont GPS refusé", value: fmtNum(x.refused) },
      ],
      why: x.refused > 0 ? "La localisation a été refusée au moment d'au moins une visite : la présence au point de vente n'est pas prouvée." : "Des visites ont été démarrées ou terminées loin du point de vente, ou présentent une durée ou un envoi anormal.",
      action: "Ouvrir le suivi des visites, vérifier chaque motif ; corriger avec un motif si l'écart est expliqué (dépôt, deuxième adresse), sinon en parler à la commerciale.",
      task: { title: `Vérifier les visites de ${x.name}`, dueInDays: 2, role: "ADMIN", priority: x.refused > 0 ? "HIGH" : "MEDIUM" },
      entity: { type: "user", id: x.user_id, href: `/clients/visites?user=${x.user_id}&controle=1` },
      crmUserId: x.user_id,
    }));
  },
};

/** Positions de point de vente proposées au premier démarrage et pas encore validées. */
export const crmPositionsToValidateRule: Rule = {
  id: "crm-points-de-vente-a-valider",
  label: "Positions de point de vente à valider",
  description: "Positions proposées au premier démarrage d'une visite : tant qu'elles ne sont pas validées, les visites restent « à vérifier ».",
  async run() {
    const r = await db.execute<{ user_id: string; name: string; n: number }>(sql`
      select first.user_id, u.name, count(*)::int as n from clients c
      join lateral (select cv.user_id from client_visits cv where cv.client_id = c.id and cv.timing_source = 'CHRONO' and cv.user_id is not null order by cv.started_at nulls last limit 1) first on true
      join users u on u.id = first.user_id
      where c.gps_status = 'A_CONFIRMER' group by first.user_id, u.name`);
    return r.rows.map((x): Recommendation => ({
      key: `crm-points-de-vente-a-valider:${x.user_id}`,
      rule: "crm-points-de-vente-a-valider",
      category: "COMMERCIAL",
      priority: x.n >= 5 ? "HIGH" : "LOW",
      title: x.name,
      subtitle: `${fmtNum(x.n)} position(s) de point de vente à valider`,
      facts: [{ label: "Points de vente à valider", value: fmtNum(x.n) }],
      why: "Ces positions viennent du premier « Démarrer » chez chaque client. Tant qu'elles ne sont pas validées, la présence n'est pas comparable.",
      action: "Ouvrir la carte du suivi des visites, déplacer le carré orange si le point de vente est ailleurs, puis valider.",
      task: { title: `Valider les points de vente visités par ${x.name}`, dueInDays: 3, role: "ADMIN", priority: "LOW" },
      entity: { type: "user", id: x.user_id, href: `/clients/visites?user=${x.user_id}&controle=1` },
      crmUserId: x.user_id,
    }));
  },
};

/** Visites oubliées (clôture automatique) et comptes rendus non remplis des jours précédents. */
export const crmVisitsNotClosedRule: Rule = {
  id: "crm-visites-non-cloturees",
  label: "Visites commerciales non clôturées",
  description: "Clôtures automatiques des 7 derniers jours et comptes rendus de visite restés à compléter.",
  async run({ now }) {
    const today = iso(now);
    const from = iso(new Date(now.getTime() - 7 * 86_400_000));
    const r = await db.execute<{ user_id: string; name: string; auto: number; reports: number }>(sql`
      select cv.user_id, u.name,
        count(*) filter (where cv.auto_closed and cv.date >= ${from}::date)::int as auto,
        count(*) filter (where cv.report_status = 'A_COMPLETER' and cv.date < ${today}::date)::int as reports
      from client_visits cv join users u on u.id = cv.user_id where cv.timing_source = 'CHRONO' group by cv.user_id, u.name`);
    return r.rows.filter((x) => x.auto + x.reports > 0).map((x): Recommendation => ({
      key: `crm-visites-non-cloturees:${x.user_id}`,
      rule: "crm-visites-non-cloturees",
      category: "COMMERCIAL",
      priority: x.auto > 0 ? "HIGH" : "MEDIUM",
      title: x.name,
      subtitle: [x.auto && `${x.auto} clôture(s) automatique(s)`, x.reports && `${x.reports} compte(s) rendu(s) à compléter`].filter(Boolean).join(" · "),
      facts: [{ label: "Clôtures automatiques (7 j)", value: fmtNum(x.auto) }, { label: "Comptes rendus en retard", value: fmtNum(x.reports) }],
      why: "Une visite oubliée n'a pas de durée mesurée, et un compte rendu vide prive la fiche client du résultat et de la prochaine action.",
      action: "Rappeler de terminer chaque visite en sortant et de remplir le compte rendu le jour même (Ma tournée → Comptes rendus à compléter).",
      task: { title: `Clôtures et comptes rendus — ${x.name}`, dueInDays: 1, role: "ADMIN" },
      entity: { type: "user", id: x.user_id, href: `/clients/visites?user=${x.user_id}&controle=1` },
      crmUserId: x.user_id,
    }));
  },
};

export const crmRules: Rule[] = [crmNotVisitedRule, crmPaceRule, crmObjectiveLateRule, crmVisitsToCheckRule, crmPositionsToValidateRule, crmVisitsNotClosedRule];
