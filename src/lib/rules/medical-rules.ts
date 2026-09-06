import { fmtNum, fmtPct, daysBetween, startOfMonth, addMonths } from "@/lib/format";
import { listDoctors, buildDoctorRecommendation } from "@/lib/medical/doctors";
import { delegatePerformance } from "@/lib/medical/delegates";
import { sampleForecast } from "@/lib/medical/samples";
import type { Rule, Recommendation } from "./types";

/** Médecin jamais visité ou en retard de visite au regard de sa fréquence recommandée. */
export const doctorFollowUpRule: Rule = {
  id: "medical-doctor-follow-up",
  label: "Médecin à relancer",
  description: "Médecin jamais visité, ou en retard par rapport à sa fréquence de visite recommandée.",
  async run({ settings, now }) {
    const doctors = await listDoctors();
    return doctors
      .map((d) => buildDoctorRecommendation(d, settings, now))
      .filter((r): r is Recommendation => r !== null);
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
