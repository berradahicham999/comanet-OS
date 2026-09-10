/**
 * Anomaly Engine : journées dont une métrique s'écarte de plus de `anomalyZ` écarts-types de
 * ses 28 journées précédentes. Seules les anomalies récentes (7 jours) et significatives en
 * dépense sont remontées : une journée à 12 MAD n'a pas de « CPM anormal ».
 */
import type { ResultKind } from "@/lib/ads";
import type { AdsIntelSettings } from "@/lib/settings";
import { zScores, type Metric } from "./metrics";
import type { Anomaly, DailyPoint } from "./types";

const LABELS: Record<Metric, string> = { spend: "Dépense", cpm: "CPM", cpc: "CPC", ctr: "CTR", results: "Résultats", costPerResult: "Coût par résultat" };

export function anomaliesOf(points: DailyPoint[], kind: ResultKind, scope: string, s: AdsIntelSettings, opts?: { recentDays?: number; minSpend?: number }): Anomaly[] {
  const closed = points.filter((p) => !(p as { partial?: boolean }).partial);
  const recentDays = opts?.recentDays ?? 7;
  const minSpend = opts?.minSpend ?? 50;
  const cutoff = closed.length ? closed[Math.max(0, closed.length - recentDays)].date : "";
  const out: Anomaly[] = [];
  for (const metric of ["spend", "cpm", "cpc", "ctr", "results", "costPerResult"] as Metric[]) {
    for (const z of zScores(closed, metric, kind)) {
      if (z.date < cutoff || Math.abs(z.z) < s.anomalyZ) continue;
      const day = closed.find((p) => p.date === z.date);
      if (!day || day.spend < minSpend) continue;
      out.push({ date: z.date, metric, label: LABELS[metric], value: z.value, expected: z.expected, z: z.z, severity: Math.abs(z.z) >= s.anomalyZ * 1.6 ? "high" : "medium", scope });
    }
  }
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}
