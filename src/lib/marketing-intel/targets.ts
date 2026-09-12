/**
 * Objectifs de vente et écart — logique PURE.
 *
 * L'objectif du mois est celui de `objectiveFor()` (ligne mensuelle, sinon annuel ÷ 12), l'annuel celui de
 * `annualObjective()`. La projection fin de mois est le run-rate officiel `monthProjection()` : CA à date ÷
 * jours écoulés × jours du mois — une extrapolation linéaire, présentée comme CALCULATED, jamais comme une
 * prévision. Aucun seuil de « retard » n'est décidé ici : l'agent lit l'écart et le rythme.
 */
import { monthProjection } from "@/lib/analytics";
import type { SalesTargets } from "./types";

export type TargetInputs = {
  ref: Date;
  monthlyObjective: number | null;
  annualObjective: number | null;
  /** CA sell-in du mois à date et de l'année à date (HT, MAD). */
  mtd: number;
  ytd: number;
};

const ratioPct = (num: number, den: number | null) => (den && den > 0 ? (num / den) * 100 : null);

export function computeTargets(i: TargetInputs): SalesTargets {
  const y = i.ref.getUTCFullYear(), m = i.ref.getUTCMonth() + 1;
  const proj = monthProjection(i.mtd, i.ref);
  const forecast = proj.day > 0 ? proj.runRate : null;
  const startOfYear = Date.UTC(y, 0, 1), endOfYear = Date.UTC(y + 1, 0, 1);
  const elapsed = (Date.UTC(y, i.ref.getUTCMonth(), i.ref.getUTCDate()) - startOfYear + 86_400_000) / (endOfYear - startOfYear);
  const expectedAtPace = i.annualObjective !== null ? i.annualObjective * elapsed : null;
  return {
    year: y, month: m, asOf: i.ref.toISOString().slice(0, 10),
    monthly: {
      objective: i.monthlyObjective, realized: i.mtd, pct: ratioPct(i.mtd, i.monthlyObjective),
      gap: i.monthlyObjective === null ? null : i.monthlyObjective - i.mtd,
      dayOfMonth: proj.day, daysInMonth: proj.daysInMonth, progressPct: proj.progress * 100,
      forecastRunRate: forecast, forecastPct: forecast === null ? null : ratioPct(forecast, i.monthlyObjective),
      forecastGap: forecast === null || i.monthlyObjective === null ? null : i.monthlyObjective - forecast,
    },
    annual: {
      objective: i.annualObjective, realized: i.ytd, pct: ratioPct(i.ytd, i.annualObjective),
      gap: i.annualObjective === null ? null : i.annualObjective - i.ytd,
      elapsedPct: elapsed * 100, expectedAtPace, paceGap: expectedAtPace === null ? null : expectedAtPace - i.ytd,
    },
  };
}
