import { fmtNum, fmtPct, daysBetween, startOfMonth, addMonths } from "@/lib/format";
import { listDoctors, buildDoctorRecommendation, computeDoctorSignal } from "@/lib/medical/doctors";
import { groupFollowUpsByDelegate, type FollowUpDoctor } from "@/lib/medical/follow-up-shared";
import { delegatePerformance } from "@/lib/medical/delegates";
import { sampleForecast } from "@/lib/medical/samples";
import type { Rule, Recommendation } from "./types";

/**
 * Médecins jamais visités ou en retard au regard de leur fréquence recommandée : UNE carte par déléguée (et non une par
 * médecin, ~300 cartes qui noyaient l'Action Center). La fiche du médecin garde sa propre recommandation.
 */
export const doctorFollowUpRule: Rule = {
  id: "medical-doctor-follow-up",
  label: "Médecins à relancer",
  description: "Par déléguée : médecins jamais visités, ou en retard par rapport à leur fréquence de visite recommandée.",
  async run({ settings, now }) {
    const doctors = await listDoctors();
    const late: FollowUpDoctor[] = [];
    for (const d of doctors) {
      if (!d.delegateId || !buildDoctorRecommendation(d, settings, now)) continue;
      const signal = computeDoctorSignal(d, settings, now);
      late.push({
        id: d.id, name: `Dr ${d.firstName} ${d.lastName}`, delegateId: d.delegateId, delegateName: d.delegateName,
        highPotential: d.potential === "A" || d.potential === "B", neverVisited: signal.neverVisited, daysSinceLastVisit: signal.daysSinceLastVisit,
      });
    }
    return groupFollowUpsByDelegate(late).map((g): Recommendation => ({
      key: `medical-doctor-follow-up:delegate:${g.delegateId}`,
      rule: "medical-doctor-follow-up",
      category: "MEDICAL",
      priority: g.highPotential > 0 ? "HIGH" : "MEDIUM",
      title: `${g.delegateName} — ${fmtNum(g.total)} médecin${g.total > 1 ? "s" : ""} à relancer`,
      subtitle: g.highPotential > 0 ? `dont ${fmtNum(g.highPotential)} à fort potentiel (A/B)` : "aucun à fort potentiel",
      facts: [
        { label: "À relancer", value: fmtNum(g.total) },
        { label: "Jamais visités", value: fmtNum(g.neverVisited) },
        { label: "Potentiel A/B", value: fmtNum(g.highPotential) },
      ],
      why: `${fmtNum(g.total)} médecin${g.total > 1 ? "s" : ""} de son portefeuille ${g.total > 1 ? "sont" : "est"} en retard de visite ou jamais visité${g.total > 1 ? "s" : ""}. À commencer par : ${g.first.map((d) => `${d.name}${d.daysSinceLastVisit !== null ? ` (${d.daysSinceLastVisit} j)` : ""}`).join(", ")}.`,
      action: "Construire la tournée des deux prochaines semaines en commençant par les médecins à fort potentiel.",
      task: { title: `Tournée de relance — ${g.delegateName} (${fmtNum(g.total)} médecins)`, dueInDays: 7, role: "DELEGUE_MEDICAL", priority: g.highPotential > 0 ? "HIGH" : "MEDIUM" },
      suggestedAssigneeId: g.delegateId,
      entity: { type: "user", id: g.delegateId, href: `/medical/medecins?delegate=${g.delegateId}` },
    }));
  },
};

/** Délégué dont le rythme de visites ne permet pas d'atteindre l'objectif mensuel en fin de mois. */
export const delegateObjectiveBehindRule: Rule = {
  id: "medical-delegate-objective-behind",
  label: "Délégué en retard sur son objectif",
  description: "À moins d'une semaine de la fin du mois, réalisation de visites nettement inférieure à l'objectif mensuel.",
  async run({ now }) {
    const monthEnd = addMonths(startOfMonth(now), 1);
    const daysRemaining = daysBetween(now, monthEnd);
    if (daysRemaining > 7) return [];
    const perf = await delegatePerformance(now);
    const out: Recommendation[] = [];
    for (const d of perf) {
      if (!d.monthlyObjective || d.realisationPct === null || d.realisationPct >= 85) continue;
      out.push({
        key: `medical-delegate-objective-behind:${d.id}`,
        rule: "medical-delegate-objective-behind",
        category: "MEDICAL",
        priority: d.realisationPct < 60 ? "HIGH" : "MEDIUM",
        title: d.name,
        subtitle: `${fmtPct(d.realisationPct)} de l'objectif mensuel à ${daysRemaining} j de la fin du mois`,
        facts: [
          { label: "Objectif du mois", value: `${fmtNum(d.monthlyObjective)} visites` },
          { label: "Réalisées", value: `${fmtNum(d.visitsMonth)} visites` },
          { label: "Médecins actifs", value: fmtNum(d.activeDoctors) },
        ],
        why: "Au rythme actuel, l'objectif de visites du mois ne sera pas atteint.",
        action: "Faire un point avec le délégué, prioriser les médecins à fort potentiel restants et ajuster le planning de fin de mois.",
        task: { title: `Point objectif de visites — ${d.name}`, dueInDays: 1, role: "MANAGER_MEDICAL", priority: d.realisationPct < 60 ? "HIGH" : "MEDIUM" },
        entity: { type: "user", id: d.id, href: `/medical/delegues/${d.id}` },
      });
    }
    return out;
  },
};

/** Stock d'échantillons d'un délégué insuffisant pour couvrir les visites déjà planifiées. */
export const sampleStockShortageRule: Rule = {
  id: "medical-sample-shortage",
  label: "Stock d'échantillons insuffisant",
  description: "Stock d'échantillons d'un délégué inférieur au besoin estimé pour les visites planifiées à venir.",
  async run({ now }) {
    const forecast = await sampleForecast(now);
    return forecast
      .filter((f) => f.deficit > 0)
      .map((f) => ({
        key: `medical-sample-shortage:${f.delegateId}`,
        rule: "medical-sample-shortage",
        category: "MEDICAL" as const,
        priority: f.deficit >= f.estimatedNeed ? ("HIGH" as const) : ("MEDIUM" as const),
        title: f.delegateName,
        subtitle: `Déficit estimé de ${fmtNum(f.deficit)} échantillons`,
        facts: [
          { label: "Visites planifiées", value: fmtNum(f.plannedVisits) },
          { label: "Besoin estimé", value: fmtNum(f.estimatedNeed) },
          { label: "Stock actuel", value: fmtNum(f.currentStock) },
        ],
        why: "Le stock d'échantillons du délégué ne couvre pas les visites déjà planifiées.",
        action: "Réapprovisionner le délégué depuis le stock central avant ses prochaines visites.",
        task: { title: `Réapprovisionner en échantillons — ${f.delegateName}`, dueInDays: 3, role: "MANAGER_MEDICAL" as const },
        entity: { type: "user" as const, id: f.delegateId, href: `/medical/echantillons` },
      }));
  },
};

export const medicalRules: Rule[] = [doctorFollowUpRule, delegateObjectiveBehindRule, sampleStockShortageRule];
