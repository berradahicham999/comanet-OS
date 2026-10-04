/**
 * Données du studio créatif (serveur, lecture seule) — rien n'est recalculé à la main.
 *
 *  - Produit prioritaire, objectif et priorité commerciale : moteur de décision marketing (`buildRecommendations`),
 *    sinon produit prioritaire du plan du mois, sinon premier contributeur sain (même logique que le générateur).
 *  - Budget par levier, saisonnalité, coût par résultat Meta, convictions de la direction : `loadGeneratorData()`.
 *  - Fiche produit : table `products` telle quelle. Performance et stock : `buildProductPerformance`.
 *  - Mémoire créative : créatives Meta étiquetées (`perfByLevel("creative")`, `autoTags`), contenus publiés du planning
 *    (étiquetés par le même `autoTags`, ou par le concept dont ils sont issus), collaborations d'influence.
 *  - Concepts récents : `creative_concepts` (fenêtre de fatigue).
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { addDays, iso } from "@/lib/format";
import { OBJECTIVES, TARGETS } from "@/lib/action-generator/catalog";
import { loadGeneratorData } from "@/lib/action-generator/context";
import { OBJECTIVE_OF } from "@/lib/action-generator/server";
import type { AxisKey, ObjectiveKey } from "@/lib/action-generator/types";
import { perfByLevel } from "@/lib/ads-intel/data";
import { contentRefs } from "@/lib/content/refs";
import { buildProductPerformance, buildRecommendations, type PerformanceResult } from "@/lib/marketing-intel/build";
import type { IntelContext, MarketingAction } from "@/lib/marketing-intel/types";
import { currentPlanFor } from "@/lib/marketing-plan/plan";
import { autoTags } from "@/lib/meta/entities";
import type { ComanetSettings } from "@/lib/settings";
import { matchTensions } from "./consumer";
import { mechanicForAngleTag, territoryUsage } from "./fingerprint";
import { creativeLearning } from "./learning";
import { audienceOf, brandAsProduct, buildProductIntelligence, creativeCategoryOf, type ProductSheetRow } from "./product-intel";
import { funnelOf } from "./scoring";
import { recentConceptsFor } from "./store";
import type { BusinessContext, CreativeData, CreativePerformance, HookType, TerritoryKey } from "./types";

export type BrandRef = { id: string; name: string; color: string };

/** Un contexte de génération : le produit à pousser, l'objectif et la priorité commerciale qui le justifient. */
export type CreativeContextSeed = { productId: string | null; objective: ObjectiveKey; priorityAction: MarketingAction | null; signal: string };

/**
 * Contextes d'une marque (jusqu'à `max`) : les décisions du moteur marketing qui désignent un produit, puis le produit
 * prioritaire du plan, puis le premier contributeur sain. Les produits « à ne pas pousser » (rupture, diagnostic)
 * viennent en dernier, avec leur action : le studio les affiche bloqués plutôt que de les ignorer en silence.
 */
export async function brandContextSeeds(ctx: IntelContext, brand: BrandRef, month: string, max: number): Promise<{ seeds: CreativeContextSeed[]; performance: PerformanceResult | null }> {
  const reco = await buildRecommendations(ctx, { brandId: brand.id, brandName: brand.name, period: "90d" }).catch(() => null);
  const seeds: CreativeContextSeed[] = [];
  const seen = new Set<string>();
  for (const d of reco?.set.decisions ?? []) {
    if (!d.productId || seen.has(d.productId)) continue;
    const objective = OBJECTIVE_OF[d.action];
    if (!objective) continue;
    seen.add(d.productId);
    seeds.push({ productId: d.productId, objective, priorityAction: d.action, signal: d.why[0] ?? d.title });
    if (seeds.length >= max) break;
  }
  if (seeds.length < max) {
    const plan = await currentPlanFor(brand.id, Number(month.slice(0, 4)));
    if (plan) {
      const m = (await db.execute<{ focus_product_id: string | null }>(sql`select focus_product_id from marketing_plan_months where plan_id = ${plan.id}::uuid and month = ${month}::date`)).rows[0];
      if (m?.focus_product_id && !seen.has(m.focus_product_id)) { seen.add(m.focus_product_id); seeds.push({ productId: m.focus_product_id, objective: "SELL_OUT", priorityAction: null, signal: "produit prioritaire du plan pour ce mois" }); }
    }
  }
  const perf = reco?.performance ?? (await buildProductPerformance(ctx, { brandId: brand.id, period: "90d" }).catch(() => null));
  if (seeds.length < max && perf) {
    for (const r of [...perf.rows].filter((x) => x.stock?.risk !== "RUPTURE_RISQUE" && !seen.has(x.productId)).sort((a, b) => b.revenue - a.revenue).slice(0, max - seeds.length)) {
      seen.add(r.productId);
      seeds.push({ productId: r.productId, objective: "SELL_OUT", priorityAction: null, signal: `premier contributeur de la marque (${Math.round(r.contributionPct ?? 0)} % du CA sur 90 jours)` });
    }
  }
  for (const d of (reco?.set.doNotPush ?? []).slice(0, 1)) {
    if (d.productId && !seen.has(d.productId)) { seen.add(d.productId); seeds.push({ productId: d.productId, objective: "SELL_OUT", priorityAction: d.action, signal: d.why[0] ?? d.title }); }
  }
  if (!seeds.length) seeds.push({ productId: null, objective: "NOTORIETE", priorityAction: null, signal: "aucune vente lue sur 90 jours : contenu de marque" });
  return { seeds, performance: perf };
}

const STUDIO_AXES: AxisKey[] = ["CONTENU", "DIGITAL", "INFLUENCE"];
const LEARNING_MONTHS = 24;

function hookTypeOfText(hook: string | null | undefined): HookType | null {
  if (!hook) return null;
  const h = hook.toLowerCase();
  if (/^(pourquoi|comment|le saviez|savez-vous|ce que|la question)/.test(h) || h.endsWith("?")) return "CURIOSITY";
  if (/\b(j'ai|je |mon |ma |moi)\b/.test(h)) return "PERSONAL";
  if (/\b(faux|mythe|menti|contrairement|stop|arrêtez)\b/.test(h)) return "CONTRARIAN";
  if (/\b(marre|probl[èe]me|souffrez|fini les|tiraille|boutons|fatigue)\b/.test(h)) return "PROBLEM";
  if (/\b(dermatologue|pharmacien|experte?|nutritionniste|conseil)\b/.test(h)) return "EXPERT";
  return null;
}

/** Mémoire créative d'une marque : créatives Meta, contenus publiés, collaborations — métriques présentes seulement. */
export async function creativePerformances(ctx: IntelContext, brandId: string): Promise<CreativePerformance[]> {
  const since = iso(addDays(ctx.now, -LEARNING_MONTHS * 30)), tomorrow = iso(addDays(ctx.now, 1));
  const [ads, contents, collabs] = await Promise.all([
    ctx.gates.marketing ? perfByLevel("creative", { start: since, end: tomorrow }, { brandId }).catch(() => []) : Promise.resolve([]),
    db.execute<{ id: string; title: string; product_id: string | null; format: string | null; platform: string | null; hook: string | null; angle: string | null; key_message: string | null; brief: string | null; reach: number | null; engagement: number | null; published_at: string | null; date: string; concept_id: string | null; c_territory: string | null; c_mechanic: string | null; c_hook: string | null; c_persona: string | null; c_funnel: string | null; c_objective: string | null }>(sql`
      select ci.id, ci.title, ci.product_id::text as product_id, ci.format, ci.platform, ci.hook, ci.angle, ci.key_message, ci.brief, ci.reach, ci.engagement, ci.published_at::text as published_at, ci.date::text as date,
             cc.id::text as concept_id, cc.territory as c_territory, cc.mechanic as c_mechanic, cc.hook_type as c_hook, cc.concept->>'persona' as c_persona, cc.funnel_stage as c_funnel, cc.objective as c_objective
      from content_items ci join content_statuses cs on cs.key = ci.status
      left join creative_concepts cc on cc.content_item_id = ci.id
      where ci.brand_id = ${brandId}::uuid and cs.is_published and ci.date >= ${since}::date
      order by ci.date desc limit 300`),
    db.execute<{ id: string; influencer: string; product_id: string | null; content_type: string | null; date: string; reach: number | null; impressions: number | null; views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; link_clicks: number | null; conversions: number | null; attributed_revenue: number | null }>(sql`
      select co.id, i.name as influencer, co.product_id::text as product_id, co.content_type, co.date::text as date, co.reach, co.impressions, co.views, co.likes, co.comments, co.shares, co.saves, co.link_clicks, co.conversions, co.attributed_revenue::float8 as attributed_revenue
      from collaborations co join influencers i on i.id = co.influencer_id
      where co.brand_id = ${brandId}::uuid and co.date >= ${since}::date and co.status in ('PUBLIE','ANALYSE','TERMINE')
      order by co.date desc limit 200`),
  ]);
  const out: CreativePerformance[] = [];
  for (const r of ads) {
    const m = mechanicForAngleTag(r.tags?.angle);
    out.push({
      source: "ADS", id: r.key, label: `${r.productName ?? r.campaignName} — ${r.title ?? r.campaignName}`, brandId: r.brandId, productId: r.productId, conceptId: null,
      territory: m?.territory ?? null, mechanic: m?.mechanic || null, hookType: hookTypeOfText(r.tags?.hook), format: r.tags?.format ?? null, persona: null, objective: r.objective ?? null, funnelStage: null,
      publishedAt: r.lastDay ?? r.firstDay ?? null,
      metrics: { spend: r.spend, results: r.results, resultKind: r.resultKind, costPerResult: r.costPerResult, reach: r.reach || null, impressions: r.impressions || null, engagement: r.postEngagement || null, views: r.videoViews || null, ctr: r.ctr, conversions: r.purchases || null, revenue: r.revenue || null },
    });
  }
  for (const r of contents.rows) {
    const tags = autoTags(r.title, { id: "", name: null, title: r.hook ?? r.title, body: [r.angle, r.key_message, r.brief].filter(Boolean).join("\n") || null, thumbnailUrl: null, imageUrl: null, videoId: null, objectType: /reel|video|ugc/i.test(r.format ?? "") ? "VIDEO" : /carrousel|carousel/i.test(r.format ?? "") ? "CAROUSEL" : null, callToAction: null, linkUrl: null });
    const m = r.c_mechanic ? { territory: r.c_territory as TerritoryKey, mechanic: r.c_mechanic } : mechanicForAngleTag(tags.angle);
    out.push({
      source: "CONTENT", id: r.id, label: r.title, brandId, productId: r.product_id, conceptId: r.concept_id,
      territory: m?.territory ?? null, mechanic: m?.mechanic || null, hookType: (r.c_hook as HookType | null) ?? hookTypeOfText(r.hook), format: r.format, persona: (r.c_persona as CreativePerformance["persona"]) ?? null, objective: r.c_objective, funnelStage: (r.c_funnel as CreativePerformance["funnelStage"]) ?? null,
      publishedAt: r.published_at?.slice(0, 10) ?? r.date,
      metrics: { spend: null, results: null, resultKind: null, costPerResult: null, reach: r.reach, impressions: null, engagement: r.engagement, views: null, ctr: null, conversions: null, revenue: null },
    });
  }
  for (const r of collabs.rows) {
    const eng = [r.likes, r.comments, r.shares, r.saves].some((v) => v !== null) ? [r.likes, r.comments, r.shares, r.saves].reduce<number>((s, v) => s + (v ?? 0), 0) : null;
    out.push({
      source: "INFLUENCE", id: r.id, label: `${r.influencer}${r.content_type ? ` — ${r.content_type}` : ""}`, brandId, productId: r.product_id, conceptId: null,
      territory: "UGC", mechanic: null, hookType: null, format: r.content_type, persona: "CREATRICE", objective: null, funnelStage: null, publishedAt: r.date,
      metrics: { spend: null, results: null, resultKind: null, costPerResult: null, reach: r.reach, impressions: r.impressions, engagement: eng, views: r.views, ctr: null, conversions: r.conversions, revenue: r.attributed_revenue },
    });
  }
  return out;
}

export type LoadCreativeOptions = {
  brand: BrandRef;
  seed: CreativeContextSeed;
  month: string;
  settings: ComanetSettings;
  performance?: PerformanceResult | null;
  /** Mémoire créative déjà lue pour la marque (évite de relire par produit). */
  performances?: CreativePerformance[];
};

export async function loadCreativeData(ctx: IntelContext, o: LoadCreativeOptions): Promise<CreativeData> {
  const { brand, seed } = o;
  const today = iso(ctx.now);
  const since = iso(addDays(ctx.now, -o.settings.creative.fatigueWindowDays));
  const [gen, brandRow, productRow, fallbackProduct, performances, recentConcepts, refs] = await Promise.all([
    loadGeneratorData(ctx, { brandId: brand.id, brandName: brand.name, productId: seed.productId, month: o.month, performance: o.performance }),
    db.execute<{ positioning: string | null; target: string | null }>(sql`select positioning, target from brands where id = ${brand.id}::uuid`),
    seed.productId ? db.execute<ProductSheetRow & { price_retail: number | null; short_name: string | null; marketing_angle: string | null }>(sql`select id, name, short_name, category, price_retail::float8 as price_retail, actives, marketing_angle, benefits, claims, target from products where id = ${seed.productId}::uuid`) : Promise.resolve({ rows: [] as (ProductSheetRow & { price_retail: number | null; short_name: string | null; marketing_angle: string | null })[] }),
    db.execute<{ name: string; category: string | null }>(sql`select p.name, p.category from products p left join sales s on s.product_id = p.id and s.date >= ${iso(addDays(ctx.refDate, -365))}::date where p.brand_id = ${brand.id}::uuid and p.active group by p.id, p.name, p.category order by coalesce(sum(s.amount), 0) desc limit 1`),
    o.performances ? Promise.resolve(o.performances) : creativePerformances(ctx, brand.id),
    recentConceptsFor(brand.id, since),
    contentRefs(),
  ]);
  const b = brandRow.rows[0] ?? { positioning: null, target: null };
  const brandInfo = { name: brand.name, positioning: b.positioning, target: b.target };
  const row = productRow.rows[0];
  const perfLite = gen.product ? { profile: gen.product.profile, growthPct: gen.product.growthPct, contributionPct: gen.product.contributionPct, revenue90: gen.product.revenue90, stockRisk: gen.product.stockRisk, daysOfStock: gen.product.daysOfStock } : null;
  const product = row
    ? buildProductIntelligence({ id: String(row.id), name: row.name, shortName: row.short_name, category: row.category, priceRetail: row.price_retail, actives: row.actives, marketingAngle: row.marketing_angle, benefits: row.benefits, claims: row.claims, target: row.target }, brandInfo, perfLite)
    : brandAsProduct(brandInfo, creativeCategoryOf({ name: fallbackProduct.rows[0]?.name ?? brand.name, category: fallbackProduct.rows[0]?.category ?? null }, brandInfo));
  const insights = creativeLearning(performances, { id: brand.id, name: brand.name }, { minCreatives: o.settings.creative.minLearningCreatives, minSpendMad: o.settings.adsIntel.winnerMinSpend });
  const usage = territoryUsage({ performances, recentConcepts, since });
  const budgets: BusinessContext["budgets"] = {};
  for (const a of STUDIO_AXES) budgets[a] = { available: gen.budgets[a].available, source: gen.budgets[a].source };
  const business: BusinessContext = {
    brandId: brand.id, brandName: brand.name, brandColor: brand.color, positioning: b.positioning, brandTarget: b.target,
    objective: seed.objective, objectiveLabel: OBJECTIVES[seed.objective], priorityAction: seed.priorityAction, commercialPriority: seed.signal,
    funnelStage: funnelOf(seed.objective), audience: audienceOf(product, { target: b.target }, TARGETS.FEMMES_25_45), month: o.month,
    season: gen.seasonEvents.length ? gen.seasonEvents.map((e) => e.label).join(", ") : null, budgets, adsCost: gen.adsCost,
  };
  return {
    today, business, product, tensions: matchTensions(product).map((m) => m.tension), usage, recentConcepts, performances, insights,
    playbookNote: gen.playbook?.note ?? null, playbookLevers: gen.playbook?.levers ?? {},
    formats: refs.formats.filter((f) => f.active).map((f) => ({ key: f.key, label: f.label })),
  };
}
