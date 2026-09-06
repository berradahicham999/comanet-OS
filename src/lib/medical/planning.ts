import "server-only";
import { listDoctors } from "./doctors";

export type RouteStop = {
  doctorId: string;
  name: string;
  city: string | null;
  sectorName: string | null;
  reason: string;
};

/**
 * Tournée suggérée pour un délégué : priorise les médecins jamais visités puis en retard,
 * triés par potentiel (A > B > C). V1 volontairement simple — pas d'optimisation de distance
 * GPS (les coordonnées sont stockées sur `doctors` pour un futur calcul, non exploité ici).
 */
export async function suggestRoute(delegateId: string): Promise<RouteStop[]> {
  const doctors = await listDoctors({ delegateId });
  const rank = { A: 0, B: 1, C: 2 } as const;
  return doctors
    .filter((d) => d.status !== "INACTIF" && (d.neverVisited || d.overdue))
    .sort((a, b) => {
      if (a.neverVisited !== b.neverVisited) return a.neverVisited ? -1 : 1;
      const ra = a.potential ? rank[a.potential] : 3, rb = b.potential ? rank[b.potential] : 3;
      if (ra !== rb) return ra - rb;
      return (b.daysSinceLastVisit ?? 0) - (a.daysSinceLastVisit ?? 0);
    })
    .map((d) => ({
      doctorId: d.id,
      name: `${d.firstName} ${d.lastName}`,
      city: d.city,
      sectorName: d.sectorName,
      reason: d.neverVisited ? "Jamais visité" : `En retard (${d.daysSinceLastVisit} j)`,
    }));
}
