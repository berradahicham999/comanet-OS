/**
 * Winner Engine : un winner n'est pas « le meilleur ROAS ». Il faut du volume, des jours, un
 * coût par résultat nettement sous la référence, de la stabilité, pas de fatigue et de la
 * récence. Le score 0–100 sert à classer ; la classe est la lecture.
 */
import type { AdsIntelSettings, AdThresholds } from "@/lib/settings";
import { clamp } from "./metrics";
import type { EntityPerf, Fatigue, Trend, WinnerVerdict } from "./types";

export function classify(e: EntityPerf, refCost: number | null, trend: Trend, fatigue: Fatigue | null, stability: number | null, s: AdsIntelSettings, t: AdThresholds, today: string): WinnerVerdict {
  const reasons: string[] = [];
  if (e.spend < s.winnerMinSpend || e.days < s.winnerMinDays) {
    return { cls: "INSUFFICIENT_DATA", score: 0, reasons: [`${Math.round(e.spend)} MAD sur ${e.days} j : sous le seuil (${s.winnerMinSpend} MAD, ${s.winnerMinDays} j).`] };
  }
  if (e.results === 0 || e.costPerResult === null) {
    return { cls: "UNDERPERFORMING", score: 5, reasons: ["Aucun résultat mesuré malgré une dépense significative."] };
  }
  const ratio = refCost && refCost > 0 ? e.costPerResult / refCost : null;
  let score = 50;
  if (ratio !== null) {
    // 0,5 → +35, 1 → 0, 1,5 → −25, borné.
    const gain = ratio <= 1 ? (1 - ratio) * 70 : -(ratio - 1) * 50;
    score += clamp(gain, -35, 35);
    reasons.push(`Coût par résultat ${ratio <= 1 ? "−" : "+"}${Math.abs(Math.round((ratio - 1) * 100))} % vs référence`);
  } else reasons.push("Aucune référence de coût : score sans comparaison");
  const volume = clamp(e.spend / (s.winnerMinSpend * 4), 0, 1) * 15;
  score += volume;
  reasons.push(`Volume ${Math.round(e.spend).toLocaleString("fr-FR")} MAD, ${e.results.toLocaleString("fr-FR")} résultats`);
  if (stability !== null) { score += (stability - 0.5) * 20; reasons.push(`Stabilité ${Math.round(stability * 100)} %`); }
  if (trend.direction === "down") { score += 5; reasons.push(`Coût en baisse (${Math.round(trend.pct ?? 0)} %)`); }
  if (trend.direction === "up") { score -= 8; reasons.push(`Coût en hausse (+${Math.round(trend.pct ?? 0)} %)`); }
  const daysSince = e.lastDay ? Math.round((new Date(today).getTime() - new Date(e.lastDay).getTime()) / 86400000) : 999;
  if (daysSince <= 3) score += 5; else if (daysSince > 30) { score -= 10; reasons.push(`Dernière diffusion il y a ${daysSince} j`); }
  if (fatigue?.status === "FATIGUING") { score -= 15; reasons.push("Fatigue détectée"); }
  score = Math.round(clamp(score, 0, 100));

  let cls: WinnerVerdict["cls"];
  if (fatigue?.status === "FATIGUING" && ratio !== null && ratio <= 1.1) cls = "FATIGUING";
  else if (ratio !== null && ratio >= s.underperformCostFactor) cls = "UNDERPERFORMING";
  else if (ratio !== null && ratio <= s.winnerCostFactor && e.spend >= s.winnerMinSpend * 2 && e.days >= Math.max(s.winnerMinDays, t.minDays)) cls = "WINNER";
  else if (ratio !== null && ratio <= s.winnerCostFactor) cls = "PROMISING";
  else if (ratio !== null && ratio < 1 && trend.direction === "down") cls = "PROMISING";
  else cls = "STABLE";
  return { cls, score, reasons };
}
