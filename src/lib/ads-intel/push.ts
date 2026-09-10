/**
 * « Quoi pousser ? » — par produit : coût par résultat vs la marque, nombre de winners,
 * stabilité historique, investissement, et couverture de stock (définition officielle
 * `isUnderTension()`). Un produit jamais testé n'est pas « à ne pas pousser » : il est inconnu.
 */
import type { ProductStock } from "@/lib/stock";
import { isUnderTension } from "@/lib/stock-math";
import type { AdThresholds, ComanetSettings } from "@/lib/settings";
import { clamp, pct } from "./metrics";
import type { EntityPerf, PushRecommendation, WinnerVerdict } from "./types";

export function pushOf(
  products: EntityPerf[],
  productsHistory: EntityPerf[],
  brandRefs: Map<string, number | null>,
  winnersByProduct: Map<string, WinnerVerdict[]>,
  stocks: ProductStock[],
  settings: ComanetSettings,
): PushRecommendation[] {
  const t: AdThresholds = settings.ads;
  const hist = new Map(productsHistory.map((p) => [p.key, p]));
  const stockOf = new Map(stocks.map((x) => [x.productId, x]));
  const out: PushRecommendation[] = [];
  for (const p of products) {
    if (!p.productId) continue;
    const why: string[] = [];
    const ref = brandRefs.get(`${p.brandId ?? "none"}|${p.resultKind}`) ?? null;
    const vsBrand = pct(p.costPerResult, ref);
    const h = hist.get(p.key);
    const vsHist = h && h.resultKind === p.resultKind ? pct(p.costPerResult, h.costPerResult) : null;
    const winners = (winnersByProduct.get(p.productId) ?? []).filter((w) => w.cls === "WINNER" || w.cls === "PROMISING").length;
    const st = stockOf.get(p.productId);
    const tight = st ? isUnderTension(st, settings) : false;
    const stockNote = st ? (tight ? `stock en tension (${st.coverageMonths?.toFixed(1) ?? "?"} mois)` : st.coverageMonths !== null ? `couverture ${st.coverageMonths.toFixed(1)} mois` : null) : null;

    let score = 50;
    if (p.spend < t.minSpend || p.days < t.minDays) {
      out.push({ productId: p.productId, productName: p.campaignName, brandId: p.brandId, brandName: p.brandName, decision: "INSUFFICIENT", score: 0, why: [`${Math.round(p.spend)} MAD sur ${p.days} j : pas assez de données`], spend: p.spend, results: p.results, resultKind: p.resultKind, costPerResult: p.costPerResult, winners, stockNote });
      continue;
    }
    if (p.results === 0) { score -= 40; why.push("Aucun résultat mesuré"); }
    if (vsBrand !== null) { score += clamp(-vsBrand * 0.8, -30, 30); why.push(`Coût par résultat ${vsBrand > 0 ? "+" : ""}${Math.round(vsBrand)} % vs moyenne ${p.brandName ?? "marque"}`); }
    if (vsHist !== null) { score += clamp(-vsHist * 0.4, -10, 10); why.push(`${vsHist <= 0 ? "Mieux" : "Moins bien"} que son propre historique (${vsHist > 0 ? "+" : ""}${Math.round(vsHist)} %)`); }
    if (winners > 0) { score += Math.min(15, winners * 7); why.push(`${winners} créative(s) performante(s) identifiée(s)`); }
    if (p.adCount >= 3 && p.results > 0 && vsBrand !== null && vsBrand > 25) { score -= 10; why.push(`${p.adCount} publicités déjà testées sous la moyenne`); }
    if (tight) { score -= 25; why.push(`Stock en tension : pousser accélérerait la rupture`); }
    score = Math.round(clamp(score, 0, 100));
    const decision: PushRecommendation["decision"] = tight ? "HOLD" : score >= 75 ? "PUSH_MORE" : score >= 58 ? "PUSH" : score >= 40 ? "HOLD" : "DONT_PUSH";
    out.push({ productId: p.productId, productName: p.campaignName, brandId: p.brandId, brandName: p.brandName, decision, score, why: why.slice(0, 4), spend: p.spend, results: p.results, resultKind: p.resultKind, costPerResult: p.costPerResult, winners, stockNote });
  }
  return out.sort((a, b) => b.score - a.score);
}
