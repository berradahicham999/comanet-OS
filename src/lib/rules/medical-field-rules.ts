import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtNum, fmtDate } from "@/lib/format";
import { businessDay } from "@/lib/medical/chrono";
import type { Rule, Recommendation } from "./types";

/**
 * Médical v2 — alertes de contrôle terrain (GPS, présence). Chaque recommandation porte
 * `fieldDelegateId` : l'Action Center ne la montre qu'à la direction et au manager de la déléguée.
 * Seuils : `settings.medicalField` (rien en dur).
 */

const day = (d: Date, delta: number) => businessDay(new Date(d.getTime() + delta * 86_400_000));
const suivi = (delegateId: string, from: string, to: string) => `/medical/suivi?${new URLSearchParams({ delegate: delegateId, from, to })}`;

/** Visites des 7 derniers jours hors zone, sans position, ou autrement « à vérifier », non encore tranchées. */
export const visitsToCheckRule: Rule = {
  id: "medical-visits-to-check",
  label: "Visites à vérifier (contrôle GPS)",
  description: "Visites chronométrées hors du rayon du cabinet, sans position (GPS refusé) ou avec une autre anomalie, sur les 7 derniers jours.",
  async run({ now }) {
    const from = day(now, -7);
    const r = await db.execute<{ delegate_id: string; name: string; to_check: number; not_verified: number; refused: number; last: string }>(sql`
      select v.delegate_id, u.name,
        count(*) filter (where v.verification_status = 'A_VERIFIER')::int as to_check,
        count(*) filter (where v.verification_status = 'NON_VERIFIEE')::int as not_verified,
        count(*) filter (where exists (select 1 from visit_events e where e.visit_id = v.id and e.gps_error = 'REFUSE'))::int as refused,
        max(v.date)::text as last
      from doctor_visits v join users u on u.id = v.delegate_id
      where v.timing_source = 'CHRONO' and v.date >= ${from}::date
        and v.verification_status in ('A_VERIFIER', 'NON_VERIFIEE')
        and not exists (select 1 from visit_events c where c.visit_id = v.id and c.type = 'CORRECTION')
      group by v.delegate_id, u.name`);
    return r.rows.map((x): Recommendation => ({
      key: `medical-visits-to-check:${x.delegate_id}`,
      rule: "medical-visits-to-check",
      category: "MEDICAL",
      priority: x.refused > 0 || x.to_check + x.not_verified >= 3 ? "HIGH" : "MEDIUM",
      title: x.name,
      subtitle: `${fmtNum(x.to_check + x.not_verified)} visite(s) à vérifier depuis le ${fmtDate(from)}`,
      facts: [
        { label: "À vérifier (hors zone, durée, différé…)", value: fmtNum(x.to_check) },
        { label: "Sans position", value: fmtNum(x.not_verified) },
        { label: "Dont GPS refusé", value: fmtNum(x.refused) },
      ],
      why: x.refused > 0
        ? "La localisation a été refusée sur le téléphone au moment d'au moins une visite : la présence chez le médecin n'est pas prouvée."
        : "Des visites ont été démarrées ou terminées loin du cabinet, ou présentent une durée ou un envoi anormal.",
      action: "Ouvrir le suivi terrain, vérifier chaque motif ; corriger avec un motif si l'écart est expliqué (cabinet secondaire, clinique), sinon en parler à la déléguée.",
      task: { title: `Vérifier les visites de ${x.name}`, dueInDays: 2, role: "MANAGER_MEDICAL", priority: x.refused > 0 ? "HIGH" : "MEDIUM" },
      entity: { type: "user", id: x.delegate_id, href: suivi(x.delegate_id, from, businessDay(now)) },
      fieldDelegateId: x.delegate_id,
    }));
  },
};

/** Visite démarrée et jamais terminée au-delà de la durée maximale, ou compte rendu resté à compléter la veille. */
export const visitsNotClosedRule: Rule = {
  id: "medical-visits-not-closed",
  label: "Visite non clôturée / compte rendu à compléter",
  description: "Visite en cours au-delà de la durée maximale, clôtures automatiques et comptes rendus non validés des jours précédents.",
  async run({ settings, now }) {
    const today = businessDay(now);
    const r = await db.execute<{ delegate_id: string; name: string; running: number; auto: number; reports: number }>(sql`
      select v.delegate_id, u.name,
        count(*) filter (where v.started_at is not null and v.ended_at is null and v.started_at < now() - make_interval(mins => ${settings.medicalField.maxDurationMin}))::int as running,
        count(*) filter (where v.auto_closed and v.date >= ${day(now, -7)}::date)::int as auto,
        count(*) filter (where v.report_status = 'A_COMPLETER' and v.date < ${today}::date)::int as reports
      from doctor_visits v join users u on u.id = v.delegate_id
      where v.timing_source = 'CHRONO'
      group by v.delegate_id, u.name`);
    return r.rows
      .filter((x) => x.running + x.auto + x.reports > 0)
      .map((x): Recommendation => ({
        key: `medical-visits-not-closed:${x.delegate_id}`,
        rule: "medical-visits-not-closed",
        category: "MEDICAL",
        priority: x.running > 0 || x.auto > 0 ? "HIGH" : "MEDIUM",
        title: x.name,
        subtitle: [x.running && `${x.running} visite(s) en cours trop longtemps`, x.auto && `${x.auto} clôture(s) automatique(s)`, x.reports && `${x.reports} compte(s) rendu(s) à compléter`].filter(Boolean).join(" · "),
        facts: [
          { label: "En cours au-delà de " + settings.medicalField.maxDurationMin + " min", value: fmtNum(x.running) },
          { label: "Clôtures automatiques (7 j)", value: fmtNum(x.auto) },
          { label: "Comptes rendus en retard", value: fmtNum(x.reports) },
        ],
        why: "Une visite oubliée n'a pas de durée mesurée, et un compte rendu non rempli prive la fiche médecin de ses objections et prochaines actions.",
        action: "Rappeler à la déléguée de terminer chaque visite en sortant et de valider ses comptes rendus le jour même (Ma journée → Comptes rendus à compléter).",
        task: { title: `Clôtures et comptes rendus — ${x.name}`, dueInDays: 1, role: "MANAGER_MEDICAL" },
        entity: { type: "user", id: x.delegate_id, href: suivi(x.delegate_id, day(now, -7), today) },
        fieldDelegateId: x.delegate_id,
      }));
  },
};

/** Déléguée active sans aucune visite (réalisée ou non effectuée) le dernier jour travaillé. */
export const dayWithoutVisitRule: Rule = {
  id: "medical-day-without-visit",
  label: "Journée sans visite",
  description: "Déléguée active sans aucune visite enregistrée le dernier jour travaillé (jours travaillés dans Paramétrage médical).",
  async run({ settings, now }) {
    const work = settings.medicalField.workDays;
    if (!work.length) return [];
    let target: string | null = null;
    for (let i = 1; i <= 7 && !target; i++) {
      const d = new Date(`${day(now, -i)}T12:00:00Z`);
      const iso = ((d.getUTCDay() + 6) % 7) + 1;
      if (work.includes(iso)) target = day(now, -i);
    }
    if (!target) return [];
    const r = await db.execute<{ user_id: string; name: string }>(sql`
      select md.user_id, u.name from medical_delegates md join users u on u.id = md.user_id
      where md.active and md.created_at::date <= ${target}::date
        and not exists (select 1 from doctor_visits v where v.delegate_id = md.user_id and v.date = ${target}::date and v.status in ('REALISEE', 'NON_EFFECTUEE', 'EN_COURS'))`);
    return r.rows.map((x): Recommendation => ({
      key: `medical-day-without-visit:${x.user_id}:${target}`,
      rule: "medical-day-without-visit",
      category: "MEDICAL",
      priority: "MEDIUM",
      title: x.name,
      subtitle: `Aucune visite enregistrée le ${fmtDate(target!)}`,
      facts: [{ label: "Jour", value: fmtDate(target!) }],
      why: "Aucun démarrage, fin ou visite non effectuée n'a été enregistré ce jour travaillé (congé, formation, réunion ou oubli).",
      action: "Vérifier avec la déléguée : absence prévue, ou visites faites sans le chrono (à ressaisir par le manager).",
      task: { title: `Journée sans visite — ${x.name} (${fmtDate(target!)})`, dueInDays: 1, role: "MANAGER_MEDICAL" },
      entity: { type: "user", id: x.user_id, href: suivi(x.user_id, target!, target!) },
      fieldDelegateId: x.user_id,
    }));
  },
};

/** Positions de cabinet proposées au premier démarrage et pas encore validées. */
export const cabinetsToValidateRule: Rule = {
  id: "medical-cabinets-to-validate",
  label: "Positions de cabinet à valider",
  description: "Positions proposées au premier démarrage d'une visite : tant qu'elles ne sont pas validées, les visites restent « à vérifier ».",
  async run() {
    const r = await db.execute<{ delegate_id: string; name: string; n: number }>(sql`
      select first.delegate_id, u.name, count(*)::int as n
      from doctors d
      join lateral (select v.delegate_id from doctor_visits v where v.doctor_id = d.id and v.timing_source = 'CHRONO' and v.delegate_id is not null order by v.started_at nulls last limit 1) first on true
      join users u on u.id = first.delegate_id
      where d.gps_status = 'A_CONFIRMER'
      group by first.delegate_id, u.name`);
    return r.rows.map((x): Recommendation => ({
      key: `medical-cabinets-to-validate:${x.delegate_id}`,
      rule: "medical-cabinets-to-validate",
      category: "MEDICAL",
      priority: x.n >= 5 ? "HIGH" : "LOW",
      title: x.name,
      subtitle: `${fmtNum(x.n)} position(s) de cabinet à valider`,
      facts: [{ label: "Cabinets à valider", value: fmtNum(x.n) }],
      why: "Ces positions viennent du premier « Démarrer » chez chaque médecin. Tant qu'elles ne sont pas validées, la présence n'est pas comparable.",
      action: "Ouvrir la carte du suivi terrain, déplacer le carré orange si le cabinet est ailleurs, puis valider.",
      task: { title: `Valider les cabinets visités par ${x.name}`, dueInDays: 3, role: "MANAGER_MEDICAL", priority: "LOW" },
      entity: { type: "user", id: x.delegate_id, href: "/medical/suivi" },
      fieldDelegateId: x.delegate_id,
    }));
  },
};

export const medicalFieldRules: Rule[] = [visitsToCheckRule, visitsNotClosedRule, dayWithoutVisitRule, cabinetsToValidateRule];
