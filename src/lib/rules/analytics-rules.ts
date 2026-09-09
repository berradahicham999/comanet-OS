/**
 * Règles Action Center de l'analytics marketing transverse.
 *
 *  - `analytics-reallocation` : « déplacer X MAD du canal A vers le canal B pour la marque M »
 *    (raisonnement, résultat attendu, confiance) — une tâche en un clic.
 *  - `analytics-budget-drift` : engagé au-delà du plan par catégorie (budget_lines) sur l'année.
 *  - `analytics-cost-degrading` : coût par résultat d'un couple canal × marque en hausse N semaines de suite.
 *  - `analytics-brand-no-spend` : marque sans dépense marketing sur le mois alors que l'objectif de vente décroche.
 *  - `analytics-pushed-no-effect` : produit poussé sans effet sur les ventes après la fenêtre d'attribution.
 *
 * Aucun seuil ici : tout vient de `settings.analytics` (Paramètres → Analytics).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtMAD, fmtPct, iso, addDays } from "@/lib/format";
import { channelVerdicts, reallocationsFrom, weeklyCostPerResult, isDegrading } from "@/lib/analytics-marketing/decision";
import { reallocationSentence } from "@/lib/analytics-marketing/reallocation";
import { aggregateBy, listChannels, listMetricDefinitions } from "@/lib/analytics-marketing/queries";
import { compute } from "@/lib/analytics-marketing/metrics";
import { classifyProduct } from "@/lib/analytics-marketing/analysis";
import type { Rule, Recommendation } from "./types";

type BrandRow = { id: string; name: string };
const brandsActive = async (): Promise<BrandRow[]> => (await db.execute<BrandRow>(sql`select id::text as id, name from brands where active and merged_into_id is null order by name`)).rows;

/** Mois glissant : les 30 derniers jours avant la date de référence des ventes, et les 30 précédents. */
function lastMonth(ref: Date) {
  const end = iso(addDays(ref, 1));
  const start = iso(addDays(ref, -29));
  return { range: { start, end }, prev: { start: iso(addDays(ref, -59)), end: start } };
}

export const reallocationRule: Rule = {
  id: "analytics-reallocation",
  label: "Réallocation budgétaire recommandée",
  description: "Déplacer une part de la dépense d'un canal en échec vers un canal qui performe, pour une marque donnée.",
  async run({ settings, today: ref }) {
    const { range, prev } = lastMonth(ref);
    const [verdicts, brands, channels, defs] = await Promise.all([channelVerdicts({ range, prev, brandIds: null, ref, settings }), brandsActive(), listChannels(), listMetricDefinitions()]);
    const labels = { brand: (id: string) => brands.find((b) => b.id === id)?.name ?? "?", channel: (k: string) => channels.find((c) => c.key === k)?.label ?? k, result: (k: string) => defs.find((d) => d.key === k)?.label ?? k };
    const out: Recommendation[] = [];
    for (const r of reallocationsFrom(verdicts, settings, labels)) {
      const from = verdicts.find((v) => v.brandId === r.brandId && v.channelKey === r.fromChannel)!;
      const to = verdicts.find((v) => v.brandId === r.brandId && v.channelKey === r.toChannel)!;
      out.push({
        key: r.key, rule: "analytics-reallocation", category: "MARKETING",
        priority: r.confidence === "HAUTE" ? "HIGH" : r.confidence === "MOYENNE" ? "MEDIUM" : "LOW",
        title: `${labels.brand(r.brandId).toUpperCase()} — ${labels.channel(r.fromChannel)} → ${labels.channel(r.toChannel)}`,
        subtitle: `Déplacer ${fmtMAD(r.amount, { compact: true })} · confiance ${r.confidence.toLowerCase()}`,
        facts: [
          { label: "Canal source", value: `${labels.channel(r.fromChannel)} · ${from.verdict.headline}` },
          { label: "Canal cible", value: `${labels.channel(r.toChannel)} · ${to.verdict.headline}` },
          { label: "Montant", value: `${fmtMAD(r.amount)} (${r.fromSharePct} % du canal source)` },
          { label: "Résultat attendu", value: r.expected ? `≈ ${r.expected.value.toLocaleString("fr-FR")} ${labels.result(r.expected.key).toLowerCase()} (extrapolation au coût constaté)` : "non chiffrable : résultat cible non mesuré" },
          { label: "Confiance", value: `${r.confidence} — ${r.confidenceWhy}` },
        ],
        why: r.reasoning,
        action: reallocationSentence(r, labels),
        impact: r.expected ? `≈ ${r.expected.value.toLocaleString("fr-FR")} ${labels.result(r.expected.key).toLowerCase()} supplémentaires, si le coût par résultat se maintient.` : undefined,
        task: { title: `Réallouer ${fmtMAD(r.amount, { compact: true })} ${labels.channel(r.fromChannel)} → ${labels.channel(r.toChannel)} (${labels.brand(r.brandId)})`, dueInDays: 7, role: "MARKETING" },
        entity: { type: "brand", id: r.brandId, href: `/marketing/analytics/canaux?period=last30&brand=${r.brandId}` },
        brandId: r.brandId,
        score: r.amount,
      });
    }
    return out;
  },
};

export const budgetDriftRule: Rule = {
  id: "analytics-budget-drift",
  label: "Dérive budget : engagé au-delà du plan",
  description: "Par marque et catégorie, l'engagé de l'année dépasse la ligne de plan de plus que la tolérance.",
  async run({ settings, now }) {
    const year = now.getUTCFullYear();
    const rows = await db.execute<{ brand_id: string; brand: string; category: string; planned: number; committed: number }>(sql`
      with plan as (select brand_id, category, sum(amount)::float8 as planned from budget_lines where year = ${year} group by 1, 2),
           com as (select brand_id, budget_category as category, sum(committed)::float8 as committed from fact_marketing_spend where is_partial = false and extract(year from day) = ${year} group by 1, 2)
      select b.id::text as brand_id, b.name as brand, p.category::text as category, p.planned, coalesce(c.committed, 0)::float8 as committed
      from plan p join brands b on b.id = p.brand_id
      left join com c on c.brand_id = p.brand_id and c.category = p.category
      where b.active and b.merged_into_id is null`);
    const tol = settings.analytics.alerts.budgetDriftPct;
    const out: Recommendation[] = [];
    for (const r of rows.rows) {
      const planned = Number(r.planned), committed = Number(r.committed);
      if (planned <= 0 || committed <= planned * (1 + tol / 100)) continue;
      const overPct = ((committed - planned) / planned) * 100;
      out.push({
        key: `analytics-budget-drift:${r.brand_id}:${r.category}:${year}`, rule: "analytics-budget-drift", category: "BUDGET",
        priority: overPct > 50 ? "HIGH" : "MEDIUM",
        title: `${r.brand.toUpperCase()} — ${r.category}`,
        subtitle: `Engagé ${fmtPct(overPct, 0, true)} au-dessus du plan`,
        facts: [{ label: "Plan (budget_lines)", value: fmtMAD(planned, { compact: true }) }, { label: "Engagé (année)", value: fmtMAD(committed, { compact: true }) }, { label: "Tolérance", value: `${tol} %` }],
        why: `Les engagements de la catégorie dépassent la ligne de plan de ${fmtMAD(committed - planned, { compact: true })} : le reste de l'année se fera au détriment d'une autre catégorie.`,
        action: "Revoir le plan de la catégorie ou geler les nouveaux engagements jusqu'à arbitrage.",
        task: { title: `Arbitrer ${r.category} ${r.brand} (${year})`, dueInDays: 5, role: "MARKETING" },
        entity: { type: "brand", id: r.brand_id, href: `/marketing/budgets?brand=${r.brand_id}` },
        brandId: r.brand_id, score: committed - planned,
      });
    }
    return out;
  },
};

export const costDegradingRule: Rule = {
  id: "analytics-cost-degrading",
  label: "Coût par résultat en dégradation",
  description: "Le coût par résultat d'un couple canal × marque monte plusieurs semaines de suite.",
  async run({ settings, now }) {
    const n = settings.analytics.channelDiagnosis.degradingWeeks;
    const [points, brands, channels] = await Promise.all([weeklyCostPerResult(n + 1, now, null), brandsActive(), listChannels()]);
    const groups = new Map<string, typeof points>();
    for (const p of points) groups.set(`${p.brandId}|${p.channelKey}`, [...(groups.get(`${p.brandId}|${p.channelKey}`) ?? []), p]);
    const out: Recommendation[] = [];
    for (const [k, pts] of groups) {
      if (!isDegrading(pts, n)) continue;
      const [brandId, channelKey] = k.split("|");
      const sorted = [...pts].sort((a, b) => a.week.localeCompare(b.week));
      const first = sorted[sorted.length - 1 - n].costPerResult as number, last = sorted[sorted.length - 1].costPerResult as number;
      const brand = brands.find((b) => b.id === brandId)?.name ?? "?", channel = channels.find((c) => c.key === channelKey)?.label ?? channelKey;
      out.push({
        key: `analytics-cost-degrading:${brandId}:${channelKey}:${sorted[sorted.length - 1].week}`, rule: "analytics-cost-degrading", category: "MARKETING",
        priority: last > first * 1.5 ? "HIGH" : "MEDIUM",
        title: `${brand.toUpperCase()} — ${channel}`,
        subtitle: `Coût par résultat en hausse ${n} semaines de suite`,
        facts: sorted.slice(-(n + 1)).map((p) => ({ label: p.week, value: p.costPerResult === null ? "—" : `${fmtMAD(p.costPerResult)} (${fmtMAD(p.spent, { compact: true })})` })),
        why: `De ${fmtMAD(first)} à ${fmtMAD(last)} par résultat en ${n} semaines : la dépense achète de moins en moins.`,
        action: "Identifier ce qui a changé (créative, cible, point de vente, prestataire) et réduire la dépense tant que le coût ne redescend pas.",
        task: { title: `Analyser la dérive ${channel} · ${brand}`, dueInDays: 3, role: "MARKETING" },
        entity: { type: "brand", id: brandId, href: `/marketing/analytics/canaux?period=last30&brand=${brandId}&channel=${channelKey}` },
        brandId, score: last - first,
      });
    }
    return out;
  },
};

export const brandNoSpendRule: Rule = {
  id: "analytics-brand-no-spend",
  label: "Marque sans marketing alors que l'objectif décroche",
  description: "Aucune dépense marketing sur le mois glissant et atteinte de l'objectif de vente sous le seuil.",
  async run({ settings, today: ref }) {
    const { range, prev } = lastMonth(ref);
    const [rows, brands] = await Promise.all([aggregateBy("brand", { range, prev, n1: null }), brandsActive()]);
    const drop = settings.analytics.alerts.brandNoSpendObjectiveDropPct;
    const out: Recommendation[] = [];
    for (const b of brands) {
      const a = rows.find((r) => r.key === b.id)?.aggregate;
      if (!a || a.spend.rows > 0) continue;
      const obj = compute("OBJECTIVE_ATTAINMENT", a, { settings: settings.analytics });
      if (!obj.ok || obj.value >= 100 - drop) continue;
      out.push({
        key: `analytics-brand-no-spend:${b.id}:${range.start}`, rule: "analytics-brand-no-spend", category: "MARKETING",
        priority: obj.value < 100 - drop * 2 ? "HIGH" : "MEDIUM",
        title: b.name.toUpperCase(), subtitle: `Objectif à ${Math.round(obj.value)} %, aucune dépense marketing sur 30 jours`,
        facts: [{ label: "Sell-in 30 j", value: fmtMAD(a.sales.sellIn, { compact: true }) }, { label: "Objectif proratisé", value: fmtMAD(a.objective ?? 0, { compact: true }) }, { label: "Dépense marketing", value: "aucune" }],
        why: "La marque décroche de son objectif sans aucune action marketing enregistrée : rien ne soutient les ventes.",
        action: "Planifier une action (animation, contenu, activation) ou vérifier que les dépenses réelles sont bien saisies.",
        task: { title: `Plan d'action marketing ${b.name}`, dueInDays: 7, role: "MARKETING" },
        entity: { type: "brand", id: b.id, href: `/marketing/analytics/marques?period=last30&brand=${b.id}` },
        brandId: b.id, score: (a.objective ?? 0) - a.sales.sellIn,
      });
    }
    return out;
  },
};

export const pushedNoEffectRule: Rule = {
  id: "analytics-pushed-no-effect",
  label: "Produit poussé sans effet sur les ventes",
  description: "Après la fenêtre d'attribution, un produit poussé n'a pas progressé en sell-in.",
  async run({ settings, today: ref }) {
    const w = settings.analytics.windowAfterDays;
    // Fenêtre d'exposition : [ref − 2w, ref − w[ ; ventes comparées : après = [ref − w, ref], avant = [ref − 2w, ref − w[.
    const after = { start: iso(addDays(ref, -w + 1)), end: iso(addDays(ref, 1)) };
    const before = { start: iso(addDays(ref, -2 * w + 1)), end: after.start };
    const [exposure, sales, products] = await Promise.all([
      aggregateBy("product", { range: before, brandIds: null }),
      aggregateBy("product", { range: after, prev: before, brandIds: null }),
      db.execute<{ id: string; name: string; brand_id: string; brand: string }>(sql`select p.id::text as id, p.name, b.id::text as brand_id, b.name as brand from products p join brands b on b.id = p.brand_id where p.active and b.active`),
    ]);
    const out: Recommendation[] = [];
    for (const p of products.rows) {
      const e = exposure.find((r) => r.key === p.id)?.aggregate;
      const s = sales.find((r) => r.key === p.id)?.aggregate;
      if (!e || !s) continue;
      const c = classifyProduct({ spent: e.spend.spent, exposures: e.spend.rows, sellIn: s.sales.sellIn, sellInPrev: s.compare.sellInPrev, brandMedianSellIn: null }, settings.analytics.productCases);
      if (!c.pushed || c.growthPct === null || c.growthPct >= 0) continue;
      out.push({
        key: `analytics-pushed-no-effect:${p.id}:${after.start}`, rule: "analytics-pushed-no-effect", category: "MARKETING",
        priority: e.spend.spent > settings.analytics.productCases.pushedMinSpend * 4 ? "HIGH" : "MEDIUM",
        title: `${p.brand.toUpperCase()} — ${p.name}`, subtitle: `Poussé (${fmtMAD(e.spend.spent, { compact: true })}), sell-in ${fmtPct(c.growthPct, 0, true)} après ${w} jours`,
        facts: [{ label: "Dépense allouée (exposition)", value: fmtMAD(e.spend.spent, { compact: true }) }, { label: "Sell-in pendant l'exposition", value: fmtMAD(s.compare.sellInPrev ?? 0, { compact: true }) }, { label: `Sell-in ${w} jours après`, value: fmtMAD(s.sales.sellIn, { compact: true }) }],
        why: "Corrélation observée : la dépense n'a pas été suivie d'une hausse du sell-in dans la fenêtre d'attribution. Ce n'est pas une preuve de causalité, mais un signal à traiter.",
        action: "Arrêter ou changer d'angle (message, canal, cible) ; vérifier la disponibilité en pharmacie avant de conclure.",
        task: { title: `Revoir la mise en avant de ${p.name}`, dueInDays: 7, role: "MARKETING" },
        entity: { type: "product", id: p.id, href: `/marketing/analytics/produits?period=last30&brand=${p.brand_id}` },
        brandId: p.brand_id, score: e.spend.spent,
      });
    }
    return out;
  },
};

export const analyticsRules: Rule[] = [reallocationRule, budgetDriftRule, costDegradingRule, brandNoSpendRule, pushedNoEffectRule];
