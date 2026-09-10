/**
 * Fatigue Engine : une créative fatigue quand la fréquence monte et que l'accroche cesse de
 * porter (CTR ↓, CPC ↑, CPM ↑, coût par résultat ↑). Sept derniers jours contre les sept
 * précédents ; en dessous de dix journées, on ne conclut pas.
 */
import type { ResultKind } from "@/lib/ads";
import type { AdsIntelSettings } from "@/lib/settings";
import { metricOf, pct } from "./metrics";
import type { DailyPoint, Fatigue } from "./types";

export function fatigueOf(points: DailyPoint[], kind: ResultKind, s: AdsIntelSettings): Fatigue {
  const closed = points.filter((p) => !(p as { partial?: boolean }).partial && p.spend > 0);
  if (closed.length < 10) return { status: "INSUFFICIENT", frequency: null, ctrDeltaPct: null, cpcDeltaPct: null, cpmDeltaPct: null, costDeltaPct: null, reasons: [`${closed.length} journée(s) avec dépense : il en faut 10 pour mesurer la fatigue.`] };
  const recent = closed.slice(-7);
  const before = closed.slice(-14, -7);
  const reach = recent.reduce((a, p) => a + p.reach, 0);
  const imp = recent.reduce((a, p) => a + p.impressions, 0);
  const frequency = reach > 0 ? imp / reach : null;
  const ctrDeltaPct = pct(metricOf(recent, "ctr", kind), metricOf(before, "ctr", kind));
  const cpcDeltaPct = pct(metricOf(recent, "cpc", kind), metricOf(before, "cpc", kind));
  const cpmDeltaPct = pct(metricOf(recent, "cpm", kind), metricOf(before, "cpm", kind));
  const costDeltaPct = pct(metricOf(recent, "costPerResult", kind), metricOf(before, "costPerResult", kind));
  const reasons: string[] = [];
  const highFreq = frequency !== null && frequency >= s.fatigueFrequency;
  const ctrDrop = ctrDeltaPct !== null && ctrDeltaPct <= -s.fatigueCtrDropPct;
  const costRise = costDeltaPct !== null && costDeltaPct >= s.fatigueCostRisePct;
  const cpcRise = cpcDeltaPct !== null && cpcDeltaPct >= s.fatigueCostRisePct;
  if (highFreq) reasons.push(`Fréquence ${frequency!.toFixed(1)} (seuil ${s.fatigueFrequency})`);
  if (ctrDrop) reasons.push(`CTR ${Math.round(ctrDeltaPct!)} % sur 7 j`);
  if (cpcRise) reasons.push(`CPC +${Math.round(cpcDeltaPct!)} %`);
  if (cpmDeltaPct !== null && cpmDeltaPct >= s.fatigueCostRisePct) reasons.push(`CPM +${Math.round(cpmDeltaPct)} %`);
  if (costRise) reasons.push(`Coût par résultat +${Math.round(costDeltaPct!)} %`);
  const signals = [ctrDrop, costRise, cpcRise].filter(Boolean).length;
  const status: Fatigue["status"] = highFreq && signals >= 1 ? "FATIGUING" : signals >= 2 || highFreq ? "WATCH" : "OK";
  if (status === "OK") reasons.push("Fréquence et accroche stables sur 7 jours.");
  return { status, frequency, ctrDeltaPct, cpcDeltaPct, cpmDeltaPct, costDeltaPct, reasons };
}
