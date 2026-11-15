/**
 * « Médecins à relancer », regroupés par déléguée pour l'Action Center (logique pure, testée sans base).
 *
 * Une carte par médecin en retard donnait ~300 cartes, alors que la réponse est une seule : construire la tournée de
 * la déléguée. Le détail par médecin reste sur sa fiche (`buildDoctorRecommendation()`), et la liste filtrée par
 * déléguée sur /medical/medecins. Seuls les médecins qu'elle recommande eux-mêmes (`buildDoctorRecommendation()`
 * non nul : actif, avec déléguée, jamais visité ou en retard) entrent dans le compte.
 */
export type FollowUpDoctor = {
  id: string; name: string; delegateId: string; delegateName: string | null;
  highPotential: boolean; neverVisited: boolean; daysSinceLastVisit: number | null;
};

export type DelegateFollowUp = {
  delegateId: string; delegateName: string; total: number; neverVisited: number; highPotential: number;
  /** Médecins à fort potentiel d'abord, puis le plus long retard : ce par quoi commencer. */
  first: FollowUpDoctor[];
};

export function groupFollowUpsByDelegate(doctors: FollowUpDoctor[], firstCount = 3): DelegateFollowUp[] {
  const by = new Map<string, FollowUpDoctor[]>();
  for (const d of doctors) by.set(d.delegateId, [...(by.get(d.delegateId) ?? []), d]);
  return [...by.entries()].map(([delegateId, list]) => {
    const sorted = [...list].sort((a, b) => Number(b.highPotential) - Number(a.highPotential) || (b.daysSinceLastVisit ?? 0) - (a.daysSinceLastVisit ?? 0));
    return {
      delegateId, delegateName: list[0].delegateName ?? "Délégué", total: list.length,
      neverVisited: list.filter((d) => d.neverVisited).length, highPotential: list.filter((d) => d.highPotential).length,
      first: sorted.slice(0, firstCount),
    };
  }).sort((a, b) => b.highPotential - a.highPotential || b.total - a.total);
}
