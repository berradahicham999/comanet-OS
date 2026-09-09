/** `get_marketing_budget` — enveloppe, prévu / engagé / dépensé / restant (définition : `budget.ts`). */
import { z } from "zod";
import { BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import type { BudgetCategory } from "@/db/schema";
import type { AiTool, ToolResult } from "./types";
import { resolveBrand, round, scopeLabel, unavailable } from "./shared";

const schema = z.object({
  brand: z.string().optional().describe("Marque ; absente = toutes marques du périmètre."),
  year: z.number().int().min(2020).max(2100).optional().describe("Année budgétaire (défaut : année de la date du jour)."),
});

export const getMarketingBudget: AiTool<typeof schema> = {
  name: "get_marketing_budget",
  description:
    "Budget marketing annuel : enveloppe, dépenses planifiées, engagées (devis / factures + dépense de régie), dépensées, restant et taux de consommation, puis répartition par catégorie (enveloppe vs engagé vs dépensé). La dépense de régie remplace le média saisi à la main quand la régie fait foi.",
  module: "budgets",
  action: "view",
  schema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access, settings } = ctx;
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    const year = input.year ?? ctx.now.getUTCFullYear();
    const [c, byCat] = await Promise.all([deps.budgetConsumption(year, brand?.id ?? null), deps.budgetByCategory(year, brand?.id ?? null, access.brandIds)]);
    if (!c.hasBudget && c.consumed === 0 && c.planned === 0) {
      return unavailable(`Aucune enveloppe ni dépense marketing enregistrée pour ${year}${brand ? ` sur ${brand.name}` : ""}.`, "Importer les budgets (Imports → Budgets) ou saisir une enveloppe dans Marketing → Budgets.", "Marketing Command Center");
    }
    const label = (k: string) => BUDGET_CATEGORY_LABELS[k as BudgetCategory] ?? k;
    return {
      available: true,
      source: "Marketing Command Center — enveloppes et dépenses (MAD), régie Meta en MAD converti",
      period: { start: `${year}-01-01`, end: `${year + 1}-01-01`, label: `Année ${year}` },
      scope: scopeLabel(access, [brand ? `marque ${brand.name}` : "toutes marques"]),
      data: {
        has_budget: c.hasBudget,
        annual_budget_mad: round(c.annual),
        planned_mad: round(c.planned),
        committed_mad: round(c.committed),
        spent_mad: round(c.spent),
        ad_spend_mad: round(c.adSpend),
        ad_spend_source: c.adSource,
        manual_ad_ignored_mad: round(c.manualAdIgnored),
        medical_samples_value_mad: round(c.samplesValue),
        consumed_mad: round(c.consumed),
        remaining_mad: round(c.remaining),
        consumed_pct: round(c.consumedPct, 1),
        alert_threshold_pct: settings.budgetAlertPct,
        over_alert_threshold: c.consumedPct !== null && c.consumedPct >= settings.budgetAlertPct,
        by_category: byCat.map((r) => ({ category: label(r.category), planned_mad: round(r.planned), committed_mad: round(r.committed), spent_mad: round(r.spent), remaining_mad: round(r.planned - r.committed) })),
      },
      rowCount: 1 + byCat.length,
      links: [{ label: "Ouvrir Budgets", href: `/marketing/budgets?year=${year}${brand ? `&brand=${brand.id}` : ""}` }],
      notes: c.hasBudget ? [] : ["Aucune enveloppe annuelle saisie : le restant et le taux ne sont pas mesurables."],
    };
  },
};
