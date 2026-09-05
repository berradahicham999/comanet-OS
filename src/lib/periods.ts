import { periodRange, shiftRange } from "./analytics";
import { addDays, addMonths, iso, startOfMonth, fmtDate, fmtMonth } from "./format";

export type PeriodParam = "month" | "prevMonth" | "quarter" | "ytd" | "year" | "last30" | "last90" | "last12m" | "custom";

export const PERIOD_OPTIONS: { key: PeriodParam; label: string }[] = [
  { key: "month", label: "Mois en cours" },
  { key: "prevMonth", label: "Mois précédent" },
  { key: "quarter", label: "Trimestre en cours" },
  { key: "ytd", label: "Année en cours" },
  { key: "last30", label: "30 derniers jours" },
  { key: "last90", label: "90 derniers jours" },
  { key: "last12m", label: "12 derniers mois" },
  { key: "custom", label: "Personnalisé" },
];

export type ResolvedPeriod = { key: PeriodParam; start: string; end: string; label: string; prev: { start: string; end: string; label: string }; n1: { start: string; end: string }; days: number };

/** Résout une période en plage [start, end) avec la période de comparaison (précédente) et N-1. */
export function resolvePeriod(key: PeriodParam | undefined, ref: Date, custom?: { start?: string; end?: string }): ResolvedPeriod {
  const k = key ?? "month";
  let start: string, end: string, label: string;
  const tomorrow = iso(addDays(ref, 1));
  switch (k) {
    case "prevMonth": {
      const som = startOfMonth(ref);
      start = iso(addMonths(som, -1)); end = iso(som); label = fmtMonth(start);
      break;
    }
    case "last30": start = iso(addDays(ref, -29)); end = tomorrow; label = "30 derniers jours"; break;
    case "last90": start = iso(addDays(ref, -89)); end = tomorrow; label = "90 derniers jours"; break;
    case "last12m": start = iso(addMonths(startOfMonth(ref), -11)); end = tomorrow; label = "12 derniers mois"; break;
    case "custom": {
      start = custom?.start && /^\d{4}-\d{2}-\d{2}$/.test(custom.start) ? custom.start : iso(addDays(ref, -29));
      const e = custom?.end && /^\d{4}-\d{2}-\d{2}$/.test(custom.end) ? custom.end : iso(ref);
      end = iso(addDays(new Date(e + "T12:00:00Z"), 1));
      label = `${fmtDate(start)} → ${fmtDate(e)}`;
      break;
    }
    case "quarter": case "ytd": case "year": {
      const r = periodRange(k === "year" ? "ytd" : k, ref); start = r.start; end = r.end; label = r.label; break;
    }
    default: {
      const r = periodRange("month", ref); start = r.start; end = r.end; label = `${fmtMonth(start)} (à date)`;
    }
  }
  const days = Math.round((new Date(end + "T12:00:00Z").getTime() - new Date(start + "T12:00:00Z").getTime()) / 86400000);
  // période précédente : même longueur juste avant (ou mois précédent à date pour "month")
  let prev: { start: string; end: string; label: string };
  if (k === "month" || k === "prevMonth") {
    const s = shiftRange({ start, end }, -1); prev = { ...s, label: "M-1 à date" };
  } else if (k === "quarter") {
    const s = shiftRange({ start, end }, -3); prev = { ...s, label: "T-1 à date" };
  } else if (k === "ytd" || k === "year" || k === "last12m") {
    const s = shiftRange({ start, end }, -12); prev = { ...s, label: "N-1 à date" };
  } else {
    prev = { start: iso(addDays(new Date(start + "T12:00:00Z"), -days)), end: start, label: `${days} jours précédents` };
  }
  const n1 = shiftRange({ start, end }, -12);
  return { key: k, start, end, label, prev, n1, days };
}
