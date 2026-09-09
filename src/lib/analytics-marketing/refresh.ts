/**
 * Rafraîchissement de la couche de faits marketing (`fact_marketing_spend`, `fact_marketing_result`).
 *
 * Une source à la fois, dans une transaction : on efface les lignes de la source puis on les
 * réécrit depuis le module d'origine. Idempotent, journalisé dans `analytics_refresh_log`.
 * Appelé en fin d'import, de synchronisation Meta, de transition de contenu ou d'activation,
 * après la sauvegarde d'une dépense, d'une collaboration ou d'une animation, par le cron
 * quotidien et par le bouton « Recalculer » de l'écran Qualité.
 *
 * Ce module ne DÉCIDE rien : la répartition et les montants sont dans `refresh-shared.ts`
 * (pure, testée) ; la dépense publicitaire suit `ad-spend.ts` (régie prioritaire) ; les
 * catégories → canaux viennent de `channel_mappings` ; le coût d'animation de `settings.analytics`.
 * Il ne lève jamais vers l'appelant : un import réussi ne doit pas échouer parce que
 * l'analytique n'a pas pu se recalculer — l'erreur est journalisée et visible dans Qualité.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { factMarketingSpend, factMarketingResult, analyticsRefreshLog } from "@/db/schema";
import { getSettings, animationDayCostOf, type AnalyticsSettings } from "@/lib/settings";
import { AD_EXPENSE_CATEGORIES } from "@/lib/ad-spend";
import { iso, today, addDays } from "@/lib/format";
import { SOURCE_KINDS, type SourceKind, type ResultKey } from "./shared";
import { splitShares, expenseAmounts, collaborationAmounts, contentAmounts, animationCost, sampleValue, applyShare, regieOverrides, type Amounts } from "./refresh-shared";

type SpendRow = typeof factMarketingSpend.$inferInsert;
type ResultRow = typeof factMarketingResult.$inferInsert;

const ALL_KINDS = Object.keys(SOURCE_KINDS) as SourceKind[];
const BATCH = 500;
const money = (v: number | null) => (v === null ? null : v.toFixed(2));

export type RefreshTrigger = "IMPORT" | "SYNC" | "WORKFLOW" | "CRON" | "MANUAL";
export type RefreshSummary = { kind: SourceKind; ok: boolean; spendRows: number; resultRows: number; error?: string; ms: number };

/** Contexte commun à toutes les sources, chargé une fois par passage. */
type Ctx = {
  settings: AnalyticsSettings;
  /** source_kind:source_key → channel_key */
  mappings: Map<string, string>;
  /** brand_id → marque cible (fusion) */
  brandTarget: Map<string, string>;
  /** product_id → sell-in HT sur la fenêtre de prorata */
  salesWeight: Map<string, number>;
  /** "brand_id|YYYY-MM" pour lesquels la régie a une journée close */
  regieMonths: Set<string>;
};

async function loadCtx(): Promise<Ctx> {
  const settings = (await getSettings()).analytics;
  const since = iso(addDays(today(), -settings.productSplitLookbackDays));
  const [maps, brands, weights, regie] = await Promise.all([
    db.execute<{ source_kind: string; source_key: string; channel_key: string }>(sql`select source_kind, source_key, channel_key from channel_mappings`),
    db.execute<{ id: string; merged_into_id: string | null }>(sql`select id, merged_into_id from brands`),
    db.execute<{ product_id: string; amount: number }>(sql`select product_id, coalesce(sum(amount), 0)::float8 as amount from sales where date >= ${since}::date group by product_id`),
    db.execute<{ k: string }>(sql`select distinct brand_id::text || '|' || to_char(date, 'YYYY-MM') as k from ad_metrics where brand_id is not null and is_partial = false`),
  ]);
  return {
    settings,
    mappings: new Map(maps.rows.map((r) => [`${r.source_kind}:${r.source_key}`, r.channel_key])),
    brandTarget: new Map(brands.rows.map((b) => [b.id, b.merged_into_id ?? b.id])),
    salesWeight: new Map(weights.rows.map((r) => [r.product_id, Number(r.amount)])),
    regieMonths: new Set(regie.rows.map((r) => r.k)),
  };
}

const channelOf = (ctx: Ctx, kind: string, key: string | null, fallback = "OTHER") =>
  ctx.mappings.get(`${kind}:${key ?? ""}`) ?? ctx.mappings.get(`${kind}:*`) ?? fallback;
const brandOf = (ctx: Ctx, id: string) => ctx.brandTarget.get(id) ?? id;
const splitFor = (ctx: Ctx, productIds: (string | null | undefined)[]) =>
  splitShares(productIds.filter((p): p is string => !!p).map((productId) => ({ productId, weight: ctx.salesWeight.get(productId) ?? 0 })), ctx.settings.productSplit);

/** Fabrique les lignes de faits (dépense + résultats) d'une ligne source répartie sur ses produits. */
function emit(
  out: { spend: SpendRow[]; result: ResultRow[] },
  base: Omit<SpendRow, "planned" | "committed" | "spent" | "share" | "shareBasis" | "productId" | "attributedRevenue"> & { attributedRevenue?: number | null },
  amounts: Amounts,
  splits: ReturnType<typeof splitShares>,
  results: { key: ResultKey; value: number; measurement?: "MEASURED" | "DECLARED" }[],
  /** false : la source n'a pas de notion de coût (contenu sans budget) — seuls ses résultats sont écrits. */
  withSpend = true,
) {
  for (const s of splits) {
    const a = applyShare(amounts, s.share);
    if (withSpend) out.spend.push({
      ...base, productId: s.productId, share: String(s.share), shareBasis: s.basis,
      planned: money(a.planned), committed: money(a.committed), spent: money(a.spent),
      attributedRevenue: base.attributedRevenue == null ? null : money(Math.round(base.attributedRevenue * s.share * 100) / 100),
    });
    for (const r of results) {
      if (!(r.value > 0)) continue;
      out.result.push({
        day: base.day, brandId: base.brandId, productId: s.productId, city: base.city ?? null, campaignId: base.campaignId ?? null,
        channelKey: base.channelKey, subChannel: base.subChannel ?? null, sourceKind: base.sourceKind, sourceId: base.sourceId, sourceLabel: base.sourceLabel ?? null,
        resultKey: r.key, value: (Math.round(r.value * s.share * 1e4) / 1e4).toFixed(4), share: String(s.share),
        measurement: r.measurement ?? "MEASURED", isPartial: base.isPartial ?? false,
      });
    }
  }
}

/* ------------------------------------ Sources ------------------------------------ */

type Loader = (ctx: Ctx, out: { spend: SpendRow[]; result: ResultRow[] }) => Promise<void>;

/** Régie publicitaire : une ligne par jour × publicité. Produit via la créative, sinon les produits de la campagne COMANET. */
const loadAdMetrics: Loader = async (ctx, out) => {
  const rows = await db.execute<{
    id: string; date: string; platform: string; brand_id: string; campaign_id: string | null; campaign_name: string; ad_name: string | null;
    spend: number; revenue: number; impressions: number; reach: number; clicks: number; link_clicks: number; leads: number; purchases: number;
    messaging_started: number; is_partial: boolean; creative_product: string | null; campaign_products: string[] | null;
  }>(sql`
    select m.id, m.date::text, m.platform, m.brand_id, m.campaign_id, m.campaign_name, m.ad_name,
           m.spend::float8, m.revenue::float8, m.impressions, m.reach, m.clicks, m.link_clicks, m.leads, m.purchases, m.messaging_started, m.is_partial,
           cr.product_id as creative_product,
           (select array_agg(cp.product_id::text) from campaign_products cp where cp.campaign_id = m.campaign_id) as campaign_products
    from ad_metrics m
    left join ad_creatives cr on cr.platform = m.platform and cr.ad_name = m.ad_name
    where m.brand_id is not null`);
  for (const r of rows.rows) {
    const splits = splitFor(ctx, r.creative_product ? [r.creative_product] : (r.campaign_products ?? []));
    const revenue = Number(r.revenue) || 0;
    emit(out, {
      day: r.date, brandId: brandOf(ctx, r.brand_id), city: null, campaignId: r.campaign_id,
      channelKey: channelOf(ctx, "AD_PLATFORM", r.platform, "DIGITAL_OTHER"), subChannel: r.campaign_name,
      budgetCategory: (["META", "TIKTOK", "GOOGLE"].includes(r.platform) ? r.platform : "DIGITAL") as SpendRow["budgetCategory"],
      sourceKind: "AD_METRIC", sourceId: r.id, sourceLabel: r.campaign_name, sourceRef: null,
      isPartial: r.is_partial, attributionMode: revenue > 0 ? "MEASURED" : "NONE", attributedRevenue: revenue > 0 ? revenue : null,
    }, { planned: null, committed: null, spent: Number(r.spend) || 0 }, splits, [
      { key: "IMPRESSIONS", value: r.impressions }, { key: "REACH", value: r.reach }, { key: "CLICKS", value: r.clicks },
      { key: "LINK_CLICKS", value: r.link_clicks }, { key: "MESSAGES_STARTED", value: r.messaging_started },
      { key: "LEADS", value: r.leads }, { key: "PURCHASES", value: r.purchases },
    ]);
  }
};

/**
 * Dépenses saisies (Command Center) — y compris le reflet des activations (`activation_id`),
 * seul reflet officiel de leur budget. Régie prioritaire sur les catégories média.
 */
const loadExpenses: Loader = async (ctx, out) => {
  const rows = await db.execute<{
    id: string; date: string; brand_id: string; campaign_id: string | null; activation_id: string | null; collaboration_id: string | null; product_id: string | null;
    category: string; label: string; amount: number; status: string; attributed_revenue: number | null; conversions: number | null;
    activation_name: string | null; activation_city: string | null; activation_products: string[] | null; campaign_products: string[] | null;
  }>(sql`
    select e.id, e.date::text, e.brand_id, e.campaign_id, e.activation_id, e.collaboration_id, e.product_id, e.category::text, e.label,
           e.amount::float8, e.status::text, e.attributed_revenue::float8, e.conversions,
           a.name as activation_name, a.city as activation_city,
           (select array_agg(ap.product_id::text) from activation_products ap where ap.activation_id = e.activation_id) as activation_products,
           (select array_agg(cp.product_id::text) from campaign_products cp where cp.campaign_id = e.campaign_id) as campaign_products
    from marketing_expenses e
    left join activations a on a.id = e.activation_id`);
  for (const r of rows.rows) {
    const brandId = brandOf(ctx, r.brand_id);
    const overridden = regieOverrides(r.category, ctx.regieMonths.has(`${brandId}|${r.date.slice(0, 7)}`), AD_EXPENSE_CATEGORIES);
    const amounts = overridden ? { planned: null, committed: null, spent: null } : expenseAmounts(r.status, Number(r.amount) || 0);
    const splits = splitFor(ctx, r.product_id ? [r.product_id] : r.activation_products?.length ? r.activation_products : (r.campaign_products ?? []));
    const revenue = r.attributed_revenue === null ? null : Number(r.attributed_revenue);
    emit(out, {
      day: r.date, brandId, city: r.activation_city, campaignId: r.campaign_id,
      channelKey: channelOf(ctx, "BUDGET_CATEGORY", r.category), subChannel: r.activation_name,
      budgetCategory: r.category as SpendRow["budgetCategory"],
      sourceKind: "EXPENSE", sourceId: r.id, sourceLabel: r.label,
      sourceRef: overridden ? "REGIE_PRIORITAIRE" : r.activation_id ? `ACTIVATION:${r.activation_id}` : r.collaboration_id ? `COLLABORATION:${r.collaboration_id}` : null,
      isPartial: false, attributionMode: revenue !== null && revenue > 0 ? "MEASURED" : "NONE", attributedRevenue: revenue !== null && revenue > 0 ? revenue : null,
    }, amounts, splits, r.conversions ? [{ key: "PURCHASES", value: r.conversions, measurement: "DECLARED" }] : []);
  }
};

/** Collaborations influence : cachet + valeur produit ; résultats déclarés à la main. */
const loadCollaborations: Loader = async (ctx, out) => {
  const rows = await db.execute<{
    id: string; date: string; brand_id: string; product_id: string | null; campaign_id: string | null; status: string; fee: number; product_value: number;
    reach: number | null; impressions: number | null; views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null;
    link_clicks: number | null; promo_code: string | null; conversions: number | null; attributed_revenue: number | null;
    stories: number; reels: number; posts: number; influencer: string; city: string | null;
  }>(sql`
    select c.id, c.date::text, c.brand_id, c.product_id, c.campaign_id, c.status, c.fee::float8, c.product_value::float8,
           c.reach, c.impressions, c.views, c.likes, c.comments, c.shares, c.saves, c.link_clicks, c.promo_code, c.conversions, c.attributed_revenue::float8,
           c.stories, c.reels, c.posts, i.name as influencer, i.city
    from collaborations c join influencers i on i.id = c.influencer_id`);
  for (const r of rows.rows) {
    const done = ["PUBLIE", "ANALYSE", "TERMINE"].includes(r.status);
    const revenue = r.attributed_revenue === null ? null : Number(r.attributed_revenue);
    const engagement = (r.likes ?? 0) + (r.comments ?? 0) + (r.shares ?? 0) + (r.saves ?? 0);
    emit(out, {
      day: r.date, brandId: brandOf(ctx, r.brand_id), city: r.city, campaignId: r.campaign_id,
      channelKey: channelOf(ctx, "COLLABORATION", "*", "INFLUENCE"), subChannel: r.influencer, budgetCategory: "INFLUENCE",
      sourceKind: "COLLABORATION", sourceId: r.id, sourceLabel: r.influencer, sourceRef: null, isPartial: false,
      attributionMode: revenue !== null && revenue > 0 ? "MEASURED" : "NONE", attributedRevenue: revenue !== null && revenue > 0 ? revenue : null,
    }, collaborationAmounts(r.status, Number(r.fee) || 0, Number(r.product_value) || 0), splitFor(ctx, [r.product_id]), done ? [
      { key: "REACH", value: r.reach ?? 0, measurement: "DECLARED" }, { key: "IMPRESSIONS", value: r.impressions ?? 0, measurement: "DECLARED" },
      { key: "VIEWS", value: r.views ?? 0, measurement: "DECLARED" }, { key: "ENGAGEMENT", value: engagement, measurement: "DECLARED" },
      { key: "LINK_CLICKS", value: r.link_clicks ?? 0, measurement: "DECLARED" },
      { key: "PROMO_CONVERSIONS", value: r.promo_code ? (r.conversions ?? 0) : 0 },
      { key: "CONTENTS_PUBLISHED", value: (r.stories ?? 0) + (r.reels ?? 0) + (r.posts ?? 0), measurement: "DECLARED" },
    ] : []);
  }
};

/** Contenus éditoriaux : budget facultatif ; un contenu publié compte 1 ; portée / engagement déclarés. */
const loadContents: Loader = async (ctx, out) => {
  const rows = await db.execute<{
    id: string; date: string; published_day: string | null; brand_id: string; product_id: string | null; campaign_id: string | null; platform: string | null;
    title: string; budget: number | null; reach: number | null; engagement: number | null; products: string[] | null; archived: boolean;
  }>(sql`
    select c.id, c.date::text, (c.published_at at time zone 'Africa/Casablanca')::date::text as published_day, c.brand_id, c.product_id, c.campaign_id, c.platform,
           c.title, c.budget::float8, c.reach, c.engagement, (c.archived_at is not null) as archived,
           (select array_agg(cp.product_id::text) from content_products cp where cp.content_id = c.id) as products
    from content_items c`);
  for (const r of rows.rows) {
    const published = !!r.published_day;
    const budget = r.budget === null ? null : Number(r.budget);
    const amounts = contentAmounts(budget, published);
    const products = [...new Set([r.product_id, ...(r.products ?? [])].filter(Boolean))] as string[];
    if (amounts.planned === null && !published) continue; // ni budget ni publication : rien à mesurer
    // Sans budget, un contenu n'est pas une dépense (même non mesurée) : ses résultats seuls sont écrits.
    emit(out, {
      day: r.published_day ?? r.date, brandId: brandOf(ctx, r.brand_id), city: null, campaignId: r.campaign_id,
      channelKey: channelOf(ctx, "CONTENT_PLATFORM", r.platform, "OTHER"), subChannel: r.platform, budgetCategory: "CREATION",
      sourceKind: "CONTENT", sourceId: r.id, sourceLabel: r.title, sourceRef: null, isPartial: false, attributionMode: "NONE", attributedRevenue: null,
    }, amounts, splitFor(ctx, products), published ? [
      { key: "CONTENTS_PUBLISHED", value: 1 },
      { key: "REACH", value: r.reach ?? 0, measurement: "DECLARED" }, { key: "ENGAGEMENT", value: r.engagement ?? 0, measurement: "DECLARED" },
    ] : [], amounts.planned !== null);
  }
};

/**
 * Animations terrain : la marque et les produits viennent des lignes (une animation n'a pas de
 * marque en base). Le coût est réparti au prorata du sell-out de chaque ligne ; sans coût saisi ni
 * tarif journalier, la dépense est NON MESURABLE (NULL) et les résultats restent comptés.
 */
const loadAnimations: Loader = async (ctx, out) => {
  const rows = await db.execute<{
    id: string; date: string; city: string | null; cost: number; days: number; customers: number; samples: number; status: string; animatrice: string | null;
    lines: { product_id: string; brand_id: string | null; qty: number; amount: number | null }[] | null; head_brand: string | null;
  }>(sql`
    select a.id, a.date::text, a.city, a.cost::float8, a.days, a.customers_advised as customers, a.samples, a.status::text, u.name as animatrice, a.brand_id as head_brand,
           (select json_agg(json_build_object('product_id', al.product_id, 'brand_id', p.brand_id, 'qty', al.quantity_sold,
                    'amount', coalesce(al.amount, al.quantity_sold * al.unit_price, al.quantity_sold * p.price_retail)::float8))
            from animation_lines al join products p on p.id = al.product_id where al.animation_id = a.id) as lines
    from animations a left join users u on u.id = a.animatrice_id
    where a.status <> 'CANCELLED'`);
  const dayCost = animationDayCostOf(ctx.settings);
  for (const r of rows.rows) {
    const cost = animationCost(Number(r.cost) || 0, r.days, dayCost);
    const lines = (r.lines ?? []).filter((l) => l.brand_id || r.head_brand);
    if (!lines.length) {
      if (!r.head_brand) continue; // ni ligne produit ni marque : rien à rattacher (signalé dans Qualité)
      emit(out, {
        day: r.date, brandId: brandOf(ctx, r.head_brand), city: r.city, campaignId: null, channelKey: channelOf(ctx, "ANIMATION", "*", "ANIMATION_POS"),
        subChannel: r.animatrice, budgetCategory: "ANIMATION", sourceKind: "ANIMATION", sourceId: r.id, sourceLabel: r.animatrice, sourceRef: cost.reason,
        isPartial: false, attributionMode: "NONE", attributedRevenue: null,
      }, { planned: null, committed: null, spent: cost.spent }, [{ productId: null, share: 1, basis: "NONE" }], [
        { key: "ANIMATION_DAYS", value: r.days }, { key: "CUSTOMERS_ADVISED", value: r.customers }, { key: "SAMPLES", value: r.samples },
      ]);
      continue;
    }
    // Poids de répartition : sell-out de la ligne, sinon unités, sinon parts égales.
    const totalAmount = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
    const totalQty = lines.reduce((s, l) => s + (l.qty ?? 0), 0);
    const weights = lines.map((l) => (totalAmount > 0 ? l.amount ?? 0 : totalQty > 0 ? l.qty : 1));
    const wTotal = weights.reduce((s, w) => s + w, 0) || lines.length;
    lines.forEach((l, i) => {
      const share = Math.round(((weights[i] || 0) / wTotal) * 1e6) / 1e6;
      const brandId = brandOf(ctx, (l.brand_id ?? r.head_brand)!);
      emit(out, {
        day: r.date, brandId, city: r.city, campaignId: null, channelKey: channelOf(ctx, "ANIMATION", "*", "ANIMATION_POS"),
        subChannel: r.animatrice, budgetCategory: "ANIMATION", sourceKind: "ANIMATION", sourceId: r.id, sourceLabel: r.animatrice, sourceRef: cost.reason,
        isPartial: false, attributionMode: "NONE", attributedRevenue: null,
      }, { planned: null, committed: null, spent: cost.spent }, [{ productId: l.product_id, share, basis: totalAmount > 0 ? "PRORATA_SALES" : "EQUAL" }], [
        { key: "ANIMATION_DAYS", value: r.days }, { key: "CUSTOMERS_ADVISED", value: r.customers }, { key: "SAMPLES", value: r.samples },
      ]);
      // Le sell-out de la ligne est un résultat MESURÉ propre au produit : il n'est pas réparti.
      if ((l.qty ?? 0) > 0) {
        const base = { day: r.date, brandId, productId: l.product_id, city: r.city, campaignId: null, channelKey: channelOf(ctx, "ANIMATION", "*", "ANIMATION_POS"), subChannel: r.animatrice, sourceKind: "ANIMATION", sourceId: r.id, sourceLabel: r.animatrice, share: "1", measurement: "MEASURED", isPartial: false } as const;
        out.result.push({ ...base, resultKey: "SELLOUT_UNITS", value: String(l.qty) });
        if (l.amount !== null && l.amount > 0) out.result.push({ ...base, resultKey: "SELLOUT_AMOUNT", value: (Math.round(l.amount * 100) / 100).toFixed(2) });
      }
    });
  }
};

/** Échantillons médicaux remis en visite, valorisés au prix d'achat sinon au prix COMANET. */
const loadSamples: Loader = async (ctx, out) => {
  const rows = await db.execute<{ id: string; date: string; product_id: string; brand_id: string | null; units: number; cost_price: number | null; wholesale: number | null; delegate: string | null; city: string | null }>(sql`
    select sm.id, sm.date::text, sm.product_id, p.brand_id, -sm.quantity as units, p.cost_price::float8, p.price_wholesale::float8, u.name as delegate,
           (select d.city from doctors d join doctor_visits v on v.doctor_id = d.id where v.id = sm.visit_id) as city
    from sample_movements sm join products p on p.id = sm.product_id left join users u on u.id = sm.delegate_id
    where sm.type = 'SORTIE_VISITE' and sm.quantity < 0`);
  for (const r of rows.rows) {
    if (!r.brand_id) continue;
    const v = sampleValue(r.units, r.cost_price === null ? null : Number(r.cost_price), r.wholesale === null ? null : Number(r.wholesale));
    emit(out, {
      day: r.date, brandId: brandOf(ctx, r.brand_id), city: r.city, campaignId: null, channelKey: channelOf(ctx, "SAMPLE", "*", "PRESCRIPTION"),
      subChannel: r.delegate, budgetCategory: "PRESCRIPTEURS", sourceKind: "SAMPLE", sourceId: r.id, sourceLabel: r.delegate, sourceRef: v.reason,
      isPartial: false, attributionMode: "NONE", attributedRevenue: null,
    }, { planned: null, committed: null, spent: v.spent }, [{ productId: r.product_id, share: 1, basis: "DECLARED" }], [{ key: "SAMPLES", value: r.units }]);
  }
};

const LOADERS: Record<SourceKind, Loader> = {
  AD_METRIC: loadAdMetrics,
  EXPENSE: loadExpenses,
  ACTIVATION_LINE: async () => {}, // les lignes d'activation sont lues via leur reflet dans marketing_expenses (EXPENSE)
  COLLABORATION: loadCollaborations,
  CONTENT: loadContents,
  ANIMATION: loadAnimations,
  SAMPLE: loadSamples,
};

/* ------------------------------------ Orchestration ------------------------------------ */

async function refreshOne(kind: SourceKind, ctx: Ctx, triggeredBy: RefreshTrigger): Promise<RefreshSummary> {
  const started = Date.now();
  const [log] = await db.insert(analyticsRefreshLog).values({ sourceKind: kind, triggeredBy }).returning({ id: analyticsRefreshLog.id });
  try {
    const out = { spend: [] as SpendRow[], result: [] as ResultRow[] };
    await LOADERS[kind](ctx, out);
    await db.transaction(async (tx) => {
      await tx.execute(sql`delete from fact_marketing_spend where source_kind = ${kind}`);
      await tx.execute(sql`delete from fact_marketing_result where source_kind = ${kind}`);
      for (let i = 0; i < out.spend.length; i += BATCH) await tx.insert(factMarketingSpend).values(out.spend.slice(i, i + BATCH));
      for (let i = 0; i < out.result.length; i += BATCH) await tx.insert(factMarketingResult).values(out.result.slice(i, i + BATCH));
    });
    await db.update(analyticsRefreshLog).set({ finishedAt: new Date(), ok: true, spendRows: out.spend.length, resultRows: out.result.length }).where(sql`id = ${log.id}::uuid`);
    return { kind, ok: true, spendRows: out.spend.length, resultRows: out.result.length, ms: Date.now() - started };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.update(analyticsRefreshLog).set({ finishedAt: new Date(), ok: false, error }).where(sql`id = ${log.id}::uuid`).catch(() => {});
    console.error(`Analytics marketing : rafraîchissement ${kind} en erreur`, e);
    return { kind, ok: false, spendRows: 0, resultRows: 0, error, ms: Date.now() - started };
  }
}

/**
 * Rafraîchit une ou plusieurs sources (toutes par défaut). Ne lève jamais : un échec est
 * journalisé et renvoyé dans le résumé.
 */
export async function refreshMarketingFacts(kinds: SourceKind[] = ALL_KINDS, triggeredBy: RefreshTrigger = "MANUAL"): Promise<RefreshSummary[]> {
  try {
    const ctx = await loadCtx();
    const results: RefreshSummary[] = [];
    for (const kind of kinds.filter((k) => k !== "ACTIVATION_LINE")) results.push(await refreshOne(kind, ctx, triggeredBy));
    return results;
  } catch (e) {
    console.error("Analytics marketing : contexte de rafraîchissement indisponible", e);
    return kinds.map((kind) => ({ kind, ok: false, spendRows: 0, resultRows: 0, error: e instanceof Error ? e.message : String(e), ms: 0 }));
  }
}

/** Variante « après écriture » : relance en arrière-plan logique (attendue, mais jamais bloquante pour l'appelant). */
export async function refreshAfterWrite(kinds: SourceKind[], triggeredBy: RefreshTrigger = "WORKFLOW"): Promise<void> {
  await refreshMarketingFacts(kinds, triggeredBy);
}
