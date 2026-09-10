/** `get_ads_performance` — dépense, résultats, coût par résultat et verdict (définition : `ads.ts` → `diagnose()`). */
import { z } from "zod";
import type { AiTool, ToolResult } from "./types";
import { customPeriodFields, fold, inBrandScope, limitOf, periodOf, periodSchema, resolveBrand, round, scopeLabel, unavailable } from "./shared";

const schema = z.object({
  brand: z.string().optional().describe("Marque."),
  campaign: z.string().optional().describe("Nom (ou fragment) de campagne."),
  platform: z.enum(["META", "TIKTOK", "GOOGLE"]).optional().describe("Régie."),
  period: periodSchema,
  ...customPeriodFields,
  limit: z.number().int().min(1).max(50).optional().describe("Nombre de campagnes (défaut 10, triées par dépense)."),
});

export const getAdsPerformance: AiTool<typeof schema> = {
  name: "get_ads_performance",
  description:
    "Digital Ads : par campagne, dépense en MAD (convertie au taux saisi), impressions, clics, conversations, leads, achats, CA mesuré remonté par la régie, coûts par résultat, et verdict SCALE / MAINTAIN / OPTIMIZE / STOP / WATCH avec son diagnostic (comparaison à la période précédente et à la moyenne de la marque). Le CA de la régie est le seul CA attribué ; tout autre lien avec les ventes est une corrélation observée.",
  module: "marketing",
  action: "view",
  schema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access, settings } = ctx;
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    const p = periodOf(input, ctx.now);
    const range = { start: p.start, end: p.end }, prev = { start: p.prev.start, end: p.prev.end };
    const filter = { brandId: brand?.id ?? null, platform: input.platform ?? null };
    const [curRows, prevRows] = await Promise.all([deps.adsByDim("campaign", range, filter), deps.adsByDim("campaign", prev, filter)]);
    let cur = inBrandScope(curRows, access, (r) => r.brandId).map(deps.adKpis);
    const prevMap = new Map(prevRows.map((r) => [r.key, deps.adKpis(r)]));
    if (input.campaign) { const k = fold(input.campaign); cur = cur.filter((r) => fold(r.campaignName).includes(k)); }
    if (!cur.length) return unavailable(`Aucune journée publicitaire close sur ${p.label}${brand ? ` pour ${brand.name}` : ""}${input.campaign ? ` (campagne « ${input.campaign} »)` : ""}.`, "Lancer la synchronisation Meta (Marketing → Digital Ads) ou importer l'export de la régie (Imports → Publicité).", "Régie publicitaire");
    // Moyennes de référence par marque, calculées par la définition officielle (`brandAverages`) sur les campagnes de chaque marque.
    const byBrand = new Map<string, typeof cur>();
    for (const r of cur) { const k = r.brandId ?? ""; byBrand.set(k, [...(byBrand.get(k) ?? []), r]); }
    const avg = new Map([...byBrand].map(([k, rows]) => [k, deps.adBrandAverages(rows)]));
    const rows = [...cur].sort((a, b) => b.spend - a.spend).slice(0, limitOf(input.limit));
    const total = cur.reduce((s, r) => ({ spend: s.spend + r.spend, purchases: s.purchases + r.purchases, leads: s.leads + r.leads, messages: s.messages + r.messagingStarted, revenue: s.revenue + r.revenue, clicks: s.clicks + (r.linkClicks || r.clicks), impressions: s.impressions + r.impressions }), { spend: 0, purchases: 0, leads: 0, messages: 0, revenue: 0, clicks: 0, impressions: 0 });
    const verdicts: Record<string, number> = {};
    const out = rows.map((r) => {
      const d = deps.adDiagnose(r, prevMap.get(r.key) ?? null, avg.get(r.brandId ?? "") ?? null, settings.ads);
      verdicts[d.verdict] = (verdicts[d.verdict] ?? 0) + 1;
      return {
        campaign: r.campaignName, platform: r.platform, brand: r.brandName, objective: r.objective, days: r.days,
        spend_mad: round(r.spend), impressions: r.impressions, clicks: r.linkClicks || r.clicks, ctr_pct: round(r.ctr, 2), cpm_mad: round(r.cpm, 1),
        conversations: r.messagingStarted, cost_per_conversation_mad: round(r.costPerMessage, 1), leads: r.leads, cost_per_lead_mad: round(r.costPerLead, 1),
        purchases: r.purchases, cost_per_purchase_mad: round(r.cpa, 1), measured_revenue_mad: round(r.revenue), roas: round(r.roas, 2),
        verdict: d.verdict, headline: d.headline, diagnostic: d.diagnostic, actions: d.actions.slice(0, 3),
      };
    });
    return {
      available: true,
      source: "Régie publicitaire (Meta et autres) — dépense en MAD convertie au taux saisi, journées closes uniquement",
      period: { start: p.start, end: p.end, label: p.label },
      scope: scopeLabel(access, [brand ? `marque ${brand.name}` : null, input.platform ?? null]),
      data: {
        campaigns: cur.length,
        total_spend_mad: round(total.spend), total_impressions: total.impressions, total_clicks: total.clicks,
        total_conversations: total.messages, total_leads: total.leads, total_purchases: total.purchases,
        measured_revenue_mad: round(total.revenue), roas: total.spend ? round(total.revenue / total.spend, 2) : null,
        verdict_counts: verdicts,
        thresholds: { min_spend_mad: settings.ads.minSpend, min_days: settings.ads.minDays },
        rows: out,
      },
      rowCount: out.length,
      links: [{ label: "Ouvrir Digital Ads", href: `/marketing/ads?period=${p.key}${brand ? `&brand=${brand.id}` : ""}` }],
    };
  },
};
