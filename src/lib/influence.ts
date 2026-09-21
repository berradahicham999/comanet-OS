/**
 * Influence Center — scoring et classement des collaborations influenceurs.
 *
 * Principe de prudence : rien ici ne prétend qu'une collaboration « a généré »
 * du chiffre d'affaires. Le CA n'est affiché comme *attribué* que lorsqu'il a
 * été mesuré (code promo ou lien tracké saisi). Le reste est une corrélation
 * ou une mesure d'exposition (reach, engagement), jamais une causalité.
 */

import { pgArray } from "@/lib/sql-array";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { COLLAB_STATUS } from "@/lib/marketing-shared";

export type Range = { start: string; end: string };

export type CollabRow = {
  id: string;
  date: string;
  influencer_id: string;
  influencer: string;
  followers: number | null;
  engagement_rate: number | null;
  category: string | null;
  city: string | null;
  brand_id: string;
  brand: string;
  brand_color: string | null;
  product: string | null;
  campaign_id: string | null;
  campaign: string | null;
  content_type: string | null;
  stories: number;
  reels: number;
  posts: number;
  fee: number;
  product_value: number;
  status: string;
  reach: number | null;
  impressions: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  link_clicks: number | null;
  promo_code: string | null;
  conversions: number | null;
  attributed_revenue: number | null;
  product_id: string | null;
  notes: string | null;
};

export type CollabKpis = CollabRow & {
  cost: number;
  /** Coût pour mille personnes touchées — null si le reach n'a pas été saisi. */
  cpm: number | null;
  /** Interactions / reach, en %. */
  engagement: number | null;
  /** Coût par interaction. */
  costPerEngagement: number | null;
  /** Coût par clic sortant. */
  costPerClick: number | null;
  /** Vrai seulement si un code promo ou un lien tracké permet une attribution. */
  measured: boolean;
  /** ROAS mesuré (uniquement si `measured`). */
  roas: number | null;
  interactions: number | null;
  /** Score 0-100 de la collaboration, comparable entre influenceurs. */
  score: number | null;
  /** Ce que le score ne dit pas (données manquantes). */
  missing: string[];
};

const n = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v));

export function collabKpis(r: CollabRow): CollabKpis {
  const cost = Number(r.fee ?? 0) + Number(r.product_value ?? 0);
  const reach = n(r.reach);
  const likes = n(r.likes) ?? 0;
  const comments = n(r.comments) ?? 0;
  const shares = n(r.shares) ?? 0;
  const saves = n(r.saves) ?? 0;
  const anyEngagement = r.likes !== null || r.comments !== null || r.shares !== null || r.saves !== null;
  const interactions = anyEngagement ? likes + comments + shares + saves : null;
  const clicks = n(r.link_clicks);
  const measured = Boolean(r.promo_code) && r.attributed_revenue !== null;
  const missing: string[] = [];
  if (reach === null) missing.push("reach");
  if (interactions === null) missing.push("engagement");
  if (!r.promo_code) missing.push("code promo");

  return {
    ...r,
    cost,
    cpm: reach && reach > 0 ? (cost / reach) * 1000 : null,
    engagement: reach && reach > 0 && interactions !== null ? (interactions / reach) * 100 : null,
    costPerEngagement: interactions && interactions > 0 ? cost / interactions : null,
    costPerClick: clicks && clicks > 0 ? cost / clicks : null,
    measured,
    roas: measured && cost > 0 ? Number(r.attributed_revenue) / cost : null,
    interactions,
    score: null,
    missing,
  };
}

/** `range.end` est exclusif ([start, end)), comme partout dans le marketing. */
export async function listCollaborations(range: Range, filter?: { brandId?: string | null; influencerId?: string | null; status?: string | null; brandIds?: string[] | null }): Promise<CollabRow[]> {
  const res = await db.execute(sql`
    select c.id, c.date::text as date, c.influencer_id, i.name as influencer, i.followers, i.engagement_rate::float8 as engagement_rate,
           i.category, i.city, c.brand_id, b.name as brand, b.color as brand_color,
           p.name as product, c.campaign_id, ca.name as campaign, c.content_type,
           c.stories, c.reels, c.posts, c.fee::float8 as fee, c.product_value::float8 as product_value, c.status,
           c.reach, c.impressions, c.views, c.likes, c.comments, c.shares, c.saves, c.link_clicks,
           c.promo_code, c.conversions, c.attributed_revenue::float8 as attributed_revenue, c.product_id, c.notes
    from collaborations c
    join influencers i on i.id = c.influencer_id
    join brands b on b.id = c.brand_id
    left join products p on p.id = c.product_id
    left join campaigns ca on ca.id = c.campaign_id
    where c.date >= ${range.start}::date and c.date < ${range.end}::date
      ${filter?.brandId ? sql`and c.brand_id = ${filter.brandId}::uuid` : sql``}
      ${filter?.brandIds ? sql`and c.brand_id = any(${pgArray(filter.brandIds)})` : sql``}
      ${filter?.influencerId ? sql`and c.influencer_id = ${filter.influencerId}::uuid` : sql``}
      ${filter?.status ? sql`and c.status = ${filter.status}` : sql``}
    order by c.date desc`);
  return res.rows as CollabRow[];
}

/**
 * Score 0-100 : trois axes également pondérés quand ils sont mesurables —
 * efficience du coût (CPM), qualité de l'audience (engagement), résultat
 * commercial mesuré (ROAS). Un axe non mesuré est simplement retiré du calcul,
 * il n'est jamais remplacé par une valeur inventée. Définition unique, utilisée
 * pour les collaborations comme pour les influenceuses.
 */
export function relativeScore<T extends { cpm: number | null; engagement: number | null; roas: number | null }>(rows: T[]): (T & { score: number | null })[] {
  const cpms = rows.map((r) => r.cpm).filter((v): v is number => v !== null && v > 0);
  const engs = rows.map((r) => r.engagement).filter((v): v is number => v !== null);
  const roass = rows.map((r) => r.roas).filter((v): v is number => v !== null);
  const bestCpm = cpms.length ? Math.min(...cpms) : null;
  const maxEng = engs.length ? Math.max(...engs) : null;
  const maxRoas = roass.length ? Math.max(...roass) : null;
  return rows.map((r) => {
    const parts: number[] = [];
    if (bestCpm !== null && r.cpm !== null && r.cpm > 0) parts.push(Math.min(100, (bestCpm / r.cpm) * 100));
    if (maxEng !== null && maxEng > 0 && r.engagement !== null) parts.push(Math.min(100, (r.engagement / maxEng) * 100));
    if (maxRoas !== null && maxRoas > 0 && r.roas !== null) parts.push(Math.min(100, (r.roas / maxRoas) * 100));
    return { ...r, score: parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null };
  });
}

export function scoreCollaborations(rows: CollabKpis[]): CollabKpis[] {
  return relativeScore(rows);
}

/**
 * Agrégats d'exposition sur un lot de collaborations. Le CPM ne divise que le coût des
 * collaborations dont le reach est connu ; l'engagement ne rapporte que les interactions
 * des collaborations dont le reach ET les interactions sont connus. Mélanger les deux
 * gonflait artificiellement les deux indicateurs.
 */
export function exposureAggregates(rows: CollabKpis[]) {
  const withReach = rows.filter((r) => r.reach !== null);
  const reach = withReach.length ? withReach.reduce((a, r) => a + (r.reach ?? 0), 0) : null;
  const reachCost = withReach.reduce((a, r) => a + r.cost, 0);
  const withInter = rows.filter((r) => r.interactions !== null);
  const interactions = withInter.length ? withInter.reduce((a, r) => a + (r.interactions ?? 0), 0) : null;
  const both = withReach.filter((r) => r.interactions !== null);
  const bothReach = both.reduce((a, r) => a + (r.reach ?? 0), 0);
  const bothInter = both.reduce((a, r) => a + (r.interactions ?? 0), 0);
  return {
    reach,
    interactions,
    cpm: reach && reach > 0 ? (reachCost / reach) * 1000 : null,
    engagement: both.length && bothReach > 0 ? (bothInter / bothReach) * 100 : null,
  };
}

export type InfluencerScore = {
  id: string;
  name: string;
  instagram: string | null;
  tiktok: string | null;
  followers: number | null;
  category: string | null;
  city: string | null;
  active: boolean;
  usualRate: number | null;
  collabs: number;
  cost: number;
  reach: number | null;
  interactions: number | null;
  engagement: number | null;
  cpm: number | null;
  measuredRevenue: number;
  measuredCost: number;
  roas: number | null;
  score: number | null;
  lastDate: string | null;
  brands: string[];
};

/** Agrégation par influenceur sur la période, puis classement. */
export function rankInfluencers(rows: CollabKpis[], meta: Map<string, { instagram: string | null; tiktok: string | null; active: boolean; usualRate: number | null }>): InfluencerScore[] {
  const groups = new Map<string, CollabKpis[]>();
  for (const r of rows) groups.set(r.influencer_id, [...(groups.get(r.influencer_id) ?? []), r]);
  const list: Omit<InfluencerScore, "score">[] = [...groups.entries()].map(([id, list]) => {
    const first = list[0]; const m = meta.get(id);
    const measured = list.filter((r) => r.measured);
    const measuredCost = measured.reduce((a, r) => a + r.cost, 0);
    const measuredRevenue = measured.reduce((a, r) => a + (r.attributed_revenue ?? 0), 0);
    return {
      id, name: first.influencer, instagram: m?.instagram ?? null, tiktok: m?.tiktok ?? null,
      followers: first.followers, category: first.category, city: first.city, active: m?.active ?? true, usualRate: m?.usualRate ?? null,
      collabs: list.length, cost: list.reduce((a, r) => a + r.cost, 0),
      ...exposureAggregates(list),
      measuredRevenue, measuredCost, roas: measuredCost > 0 ? measuredRevenue / measuredCost : null,
      lastDate: list.reduce<string | null>((a, r) => (!a || r.date > a ? r.date : a), null),
      brands: [...new Set(list.map((r) => r.brand))],
    };
  });
  return relativeScore(list).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.reach ?? -1) - (a.reach ?? -1));
}

/** Pipeline : combien de collaborations à chaque étape, et le budget engagé. */
export function collabPipeline(rows: CollabKpis[]) {
  const order = Object.keys(COLLAB_STATUS);
  return order.map((k) => {
    const list = rows.filter((r) => r.status === k);
    return { status: k, label: COLLAB_STATUS[k].label, tone: COLLAB_STATUS[k].tone, count: list.length, cost: list.reduce((a, r) => a + r.cost, 0) };
  });
}

export type InfluenceTotals = {
  collabs: number;
  influencers: number;
  cost: number;
  reach: number | null;
  interactions: number | null;
  engagement: number | null;
  cpm: number | null;
  measuredRevenue: number;
  measuredCost: number;
  measuredCollabs: number;
  roas: number | null;
  /** Part des collaborations pour lesquelles une attribution existe. */
  measuredShare: number;
};

export function influenceTotals(rows: CollabKpis[]): InfluenceTotals {
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  const measured = rows.filter((r) => r.measured);
  const measuredCost = measured.reduce((a, r) => a + r.cost, 0);
  const measuredRevenue = measured.reduce((a, r) => a + (r.attributed_revenue ?? 0), 0);
  return {
    collabs: rows.length,
    influencers: new Set(rows.map((r) => r.influencer_id)).size,
    cost,
    ...exposureAggregates(rows),
    measuredRevenue,
    measuredCost,
    measuredCollabs: measured.length,
    roas: measuredCost > 0 ? measuredRevenue / measuredCost : null,
    measuredShare: rows.length ? (measured.length / rows.length) * 100 : 0,
  };
}

/** Recommandations concrètes, formulées sans causalité abusive. */
/** `today` : date métier (ISO) — jamais l'horloge UTC du serveur. */
export function influenceAdvice(rows: CollabKpis[], ranked: InfluencerScore[], today: string): { tone: "green" | "orange" | "red" | "blue"; title: string; detail: string }[] {
  const out: { tone: "green" | "orange" | "red" | "blue"; title: string; detail: string }[] = [];
  const t = influenceTotals(rows);
  if (t.collabs === 0) return out;

  if (t.measuredShare < 50) {
    out.push({
      tone: "orange",
      title: `${Math.round(100 - t.measuredShare)} % des collaborations ne sont pas mesurables`,
      detail: "Attribuez un code promo (ou un lien tracké) unique à chaque influenceuse : sans cela, seul le reach est comparable et le ROI reste une hypothèse.",
    });
  }
  const noReach = rows.filter((r) => r.reach === null && ["PUBLIE", "ANALYSE", "TERMINE"].includes(r.status));
  if (noReach.length) {
    out.push({
      tone: "blue",
      title: `${noReach.length} publication(s) sans statistiques`,
      detail: "Récupérez les captures d'insights (reach, likes, commentaires, clics) 48 h après publication, sinon la collaboration ne pourra pas être notée.",
    });
  }
  const top = ranked.filter((r) => r.score !== null).slice(0, 2);
  if (top.length) {
    out.push({
      tone: "green",
      title: `À reconduire : ${top.map((r) => r.name).join(", ")}`,
      detail: top.map((r) => `${r.name} — score ${r.score}/100${r.cpm !== null ? `, CPM ${Math.round(r.cpm)} MAD` : ""}${r.engagement !== null ? `, engagement ${r.engagement.toFixed(1)} %` : ""}`).join(" · "),
    });
  }
  const weak = ranked.filter((r) => r.score !== null && r.score < 30 && r.collabs >= 2);
  if (weak.length) {
    out.push({
      tone: "red",
      title: `${weak.length} profil(s) sous-performant(s) sur la période`,
      detail: `${weak.slice(0, 3).map((r) => r.name).join(", ")} : score nettement inférieur aux autres profils sur les axes mesurés (CPM, engagement, ROAS). Renégocier le tarif ou remplacer avant le prochain cycle.`,
    });
  }
  const late = rows.filter((r) => ["CONFIRMEE", "CONTENU_RECU"].includes(r.status) && r.date < today);
  if (late.length) {
    out.push({ tone: "orange", title: `${late.length} collaboration(s) confirmée(s) non publiée(s)`, detail: "Date passée mais statut toujours en amont de « Publié » — relancer l'influenceuse ou corriger le statut." });
  }
  return out;
}
