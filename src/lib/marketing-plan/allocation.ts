/**
 * Allocation proposée du budget marketing par canal — logique PURE (testée sans base).
 *
 * Point de départ : la répartition RÉELLE de l'année précédente par catégorie budgétaire (dépenses
 * engagées + dépensées, régie quand elle fait foi : la même lecture que `budgetByCategory()` et
 * `budgetConsumption()`), étiquetée CONFIRMED. Chaque part est ensuite ajustée selon le verdict du canal
 * (`channelVerdicts()` de l'analytics marketing : SCALE +x %, OPTIMIZE −y %, STOP −z %, seuils
 * `settings.marketingPlan`), puis l'ensemble est ramené au budget. Une part « tests » est réservée si le
 * réglage le prévoit.
 *
 * Si l'historique est insuffisant (sous `minHistoryMad`) ou le budget absent, la proposition est
 * NON MESURABLE : aucune répartition n'est inventée. La proposition est une aide à la saisie — elle n'est
 * jamais appliquée d'office, la personne enregistre les lignes qu'elle retient.
 */
import type { BudgetCategory } from "@/db/schema";
import type { MarketingPlanSettings } from "@/lib/settings";
import type { AdVerdict } from "@/lib/marketing-shared";
import type { DataTag } from "@/lib/marketing-intel/types";

export type HistoryLine = { category: BudgetCategory; amount: number; source: "DEPENSES" | "REGIE" };
export type CategoryVerdict = { category: BudgetCategory; verdict: AdVerdict; headline: string | null };

export type AllocationLine = {
  category: BudgetCategory;
  amount: number;
  sharePct: number;
  /** Part réelle N-1 (CONFIRMED) dont la ligne découle. */
  historyAmount: number;
  historySharePct: number;
  verdict: AdVerdict | null;
  /** Ajustement appliqué à la part historique, en % (+20, −30, 0). */
  adjustmentPct: number;
  basis: "HISTORIQUE" | "HISTORIQUE_AJUSTE" | "TESTS";
  why: string;
  tag: DataTag;
};

export type AllocationProposal =
  | { measurable: true; budget: number; historyYear: number; historyTotal: number; lines: AllocationLine[]; notes: string[] }
  | { measurable: false; reason: string; historyYear: number; historyTotal: number; notes: string[] };

const round100 = (v: number) => Math.round(v / 100) * 100;
const pct = (v: number) => `${Math.round(v * 10) / 10} %`;

export function proposeAllocation(i: { budget: number | null; history: HistoryLine[]; historyYear: number; verdicts: CategoryVerdict[]; settings: MarketingPlanSettings }): AllocationProposal {
  const t = i.settings;
  const byCat = new Map<BudgetCategory, { amount: number; sources: Set<string> }>();
  for (const h of i.history) {
    if (!(h.amount > 0)) continue;
    const cur = byCat.get(h.category) ?? { amount: 0, sources: new Set<string>() };
    cur.amount += h.amount; cur.sources.add(h.source);
    byCat.set(h.category, cur);
  }
  const historyTotal = [...byCat.values()].reduce((a, c) => a + c.amount, 0);
  const notes: string[] = [];
  if (i.budget === null || !(i.budget > 0)) return { measurable: false, reason: "Aucun budget marketing saisi pour ce plan.", historyYear: i.historyYear, historyTotal, notes };
  if (historyTotal < t.minHistoryMad) {
    return { measurable: false, reason: `Historique ${i.historyYear} insuffisant (${Math.round(historyTotal).toLocaleString("fr-FR")} MAD de dépense réelle, seuil ${t.minHistoryMad.toLocaleString("fr-FR")} MAD) : aucune répartition n'est proposée, elle serait inventée.`, historyYear: i.historyYear, historyTotal, notes };
  }
  const verdictOf = new Map(i.verdicts.map((v) => [v.category, v]));
  const adjust = (v: AdVerdict | null): number => (v === "SCALE" ? t.scaleAdjustPct : v === "OPTIMIZE" ? -t.optimizeAdjustPct : v === "STOP" ? -t.stopAdjustPct : 0);

  const testingShare = Math.min(Math.max(t.testingSharePct, 0), 20) / 100;
  const distributable = i.budget * (1 - testingShare);
  const weighted = [...byCat.entries()].map(([category, c]) => {
    const share = c.amount / historyTotal;
    const v = verdictOf.get(category) ?? null;
    const adj = adjust(v?.verdict ?? null);
    return { category, history: c.amount, share, verdict: v, adj, weight: share * (1 + adj / 100) };
  });
  const weightTotal = weighted.reduce((a, w) => a + w.weight, 0);
  const lines: AllocationLine[] = weighted.map((w) => {
    const amount = round100((distributable * w.weight) / weightTotal);
    const basis = w.adj !== 0 ? "HISTORIQUE_AJUSTE" : "HISTORIQUE";
    const why = w.adj !== 0
      ? `part réelle ${i.historyYear} ${pct(w.share * 100)} (confirmé) ; verdict ${w.verdict?.verdict} du canal → ${w.adj > 0 ? "+" : ""}${w.adj} %${w.verdict?.headline ? ` (${w.verdict.headline})` : ""}`
      : `part réelle ${i.historyYear} ${pct(w.share * 100)} (confirmé)${w.verdict ? ` ; verdict ${w.verdict.verdict} : part maintenue` : " ; aucun verdict de canal : part maintenue"}`;
    return { category: w.category, amount, sharePct: 0, historyAmount: w.history, historySharePct: w.share * 100, verdict: w.verdict?.verdict ?? null, adjustmentPct: w.adj, basis, why, tag: "CALCULATED" as DataTag };
  });
  if (testingShare > 0) lines.push({ category: "AUTRES", amount: round100(i.budget * testingShare), sharePct: 0, historyAmount: 0, historySharePct: 0, verdict: null, adjustmentPct: 0, basis: "TESTS", why: `réserve de tests : ${t.testingSharePct} % du budget (réglage Paramètres), pour essayer un canal ou un format sans historique`, tag: "CALCULATED" });
  // Écart d'arrondi posé sur la plus grosse ligne, pour que la somme soit exactement le budget.
  const diff = i.budget - lines.reduce((a, l) => a + l.amount, 0);
  if (diff !== 0 && lines.length) { const big = lines.reduce((m, l) => (l.amount > m.amount ? l : m), lines[0]); big.amount += diff; }
  for (const l of lines) l.sharePct = (l.amount / i.budget) * 100;
  lines.sort((a, b) => b.amount - a.amount);
  if (i.verdicts.length === 0) notes.push("Aucun verdict de canal disponible (analytics marketing) : la proposition reproduit la répartition de l'année précédente.");
  const regie = [...byCat.values()].some((c) => c.sources.has("REGIE"));
  if (regie) notes.push("La dépense publicitaire vient de la régie (Meta) ; elle est rangée en Meta Ads.");
  return { measurable: true, budget: i.budget, historyYear: i.historyYear, historyTotal, lines, notes };
}
