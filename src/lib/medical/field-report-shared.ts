/**
 * Médical v2 — journée terrain d'une déléguée (pur) : ordre des visites, temps entre visites, temps en
 * visite vs temps de trajet. Seule définition de ces agrégats (page Suivi terrain, export, copilote).
 * Une visite sans heure (saisie avant chrono) n'entre pas dans les temps : elle est listée à part.
 */

export type TimelineVisit = {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number | null;
  autoClosed: boolean;
  status: string;
};

export type TimelineItem<T extends TimelineVisit> = T & {
  /** Rang dans la journée (1, 2, …). */
  seq: number;
  /** Minutes depuis la fin de la visite précédente (null pour la première). */
  gapBeforeMin: number | null;
};

export type DaySummary = {
  firstStart: string | null;
  lastStop: string | null;
  /** Minutes passées en visite (durées mesurées seulement ; clôture automatique exclue). */
  visitMinutes: number;
  /** Minutes entre la fin d'une visite et le début de la suivante (trajet, attente, pause). */
  betweenMinutes: number;
  /** Amplitude : premier démarrage → dernière fin. */
  spanMinutes: number | null;
  measured: number;
};

const anchor = (v: TimelineVisit) => v.startedAt ?? v.endedAt;
const min = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60_000);

export function buildTimeline<T extends TimelineVisit>(visits: T[]): { items: TimelineItem<T>[]; untimed: T[]; summary: DaySummary } {
  const timed = visits.filter((v) => anchor(v)).sort((a, b) => Date.parse(anchor(a)!) - Date.parse(anchor(b)!));
  const untimed = visits.filter((v) => !anchor(v));
  let prevEnd: string | null = null;
  let visitMinutes = 0;
  let betweenMinutes = 0;
  let measured = 0;
  const items = timed.map((v, i) => {
    const start = anchor(v)!;
    const gap = prevEnd ? Math.max(0, min(prevEnd, start)) : null;
    if (gap !== null) betweenMinutes += gap;
    if (v.durationMinutes !== null && !v.autoClosed) {
      visitMinutes += v.durationMinutes;
      measured++;
    }
    prevEnd = v.endedAt ?? start;
    return { ...v, seq: i + 1, gapBeforeMin: gap };
  });
  const firstStart = timed.length ? anchor(timed[0])! : null;
  const lastStop = timed.length ? (timed[timed.length - 1].endedAt ?? anchor(timed[timed.length - 1])!) : null;
  return {
    items,
    untimed,
    summary: { firstStart, lastStop, visitMinutes, betweenMinutes, spanMinutes: firstStart && lastStop ? Math.max(0, min(firstStart, lastStop)) : null, measured },
  };
}

/** Part en % (arrondie), ou null sans dénominateur. */
export function share(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 100) : null;
}
