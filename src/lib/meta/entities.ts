/**
 * Catalogue des objets publicitaires Meta → `ad_entities`.
 *
 * `ad_metrics` ne connaît que des noms ; ici on garde, pour chaque campagne, ensemble,
 * publicité et créative (archivés compris), l'objectif, les dates, le texte et le format.
 * C'est ce qui rend l'historique lisible et permet de rattacher un produit du référentiel
 * et d'étiqueter les créatives (format, angle, accroche, offre).
 *
 * Un rattachement ou une étiquette corrigés à la main (`MANUAL`) ne sont jamais écrasés.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { adEntities, brands, products } from "@/db/schema";
import { matchBrandInText } from "@/lib/import/match";
import { normKey } from "@/lib/import/normalize";
import { listAds, listAdsets, listCampaigns, type MetaCreative } from "./client";
import type { SyncAccount } from "./sync";

const BATCH = 300;

/* ------------------------------------------------------------------ */
/* Rattachement produit                                                */
/* ------------------------------------------------------------------ */

export type ProductRef = { id: string; name: string; brandId: string | null; keys: string[] };

const SIZE = /^\d+(ML|G|MG|L)?$/;
const STOP = new Set(["POUCH", "TUBE", "BOTTLE", "PUMP", "SPRAY", "ROLL", "ON", "FOAMER", "DE", "DU", "LA", "LE", "LES", "ET", "AU", "AUX", "EN", "MV", "P", "SECHE", "SEC", "ANTI", "AGE", "VISAGE", "CORPS", "SOIN", "CREME", "SERUM", "MASQUE", "FLUIDE", "GEL", "LOTION", "HUILE", "LAIT", "EMULSION", "ELIXIR", "GOMMAGE", "NETTOYANT", "MOUSSE", "BRUME", "CONCENTRE", "BAUME", "PREMIUM", "PLUS", "ACTIVE", "RICHE", "LEGER", "LEGERE", "PERFECTION", "CONTOUR", "YEUX", "COU", "DECOLLETE", "BODY", "MILK", "SKIN", "TOUCHER", "APAISANT", "APAISANTE", "REPARATRICE", "REPARATEUR", "HYDRATANT", "HYDRATANTE", "PURIFIANT", "CLARIFIANT", "EQUILIBRANT", "CONFORT", "RECONFORT", "DOUCEUR", "JOUR", "NUIT", "HER", "DAY", "NIGHT", "KIDS", "SPF50"]);

/** Clés distinctives d'un produit : tokens du nom hors marque, hors forme galénique, hors contenance. */
export function productKeys(name: string, brandNames: string[]): string[] {
  let key = normKey(name);
  for (const b of brandNames) key = key.replace(new RegExp(`(^|[^A-Z0-9])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9]|$)`, "g"), " ");
  const toks = key.split(/[^A-Z0-9]+/).filter((t) => t.length >= 4 && !SIZE.test(t) && !STOP.has(t));
  // « PRO COLLAGENIUM » et « PROCOLLAGENIUM » désignent le même produit : on garde aussi la forme soudée.
  const joined = toks.join("");
  return [...new Set([...toks, ...(toks.length > 1 && joined.length >= 8 ? [joined] : [])])];
}

/**
 * Produit cité dans un texte libre (nom de campagne, d'ensemble, de publicité, texte de créative).
 * Un produit est reconnu si sa clé soudée apparaît, ou si tous ses tokens distinctifs (au plus
 * deux) apparaissent. En cas d'égalité, la marque connue départage ; sinon le plus spécifique gagne.
 */
export function matchProductInText(text: string | null, brandId: string | null, refs: ProductRef[]): string | null {
  if (!text) return null;
  const key = normKey(text);
  if (!key) return null;
  const soft = key.replace(/[^A-Z0-9]+/g, "");
  let best: { id: string; score: number } | null = null;
  for (const p of refs) {
    if (brandId && p.brandId && p.brandId !== brandId) continue;
    if (!p.keys.length) continue;
    const words = p.keys.filter((k) => !/^[A-Z0-9]{8,}$/.test(k) || key.includes(k));
    const joined = p.keys.find((k) => k.length >= 8 && soft.includes(k));
    const hits = words.filter((k) => new RegExp(`(^|[^A-Z0-9])${k}([^A-Z0-9]|$)`).test(key));
    const distinct = p.keys.filter((k) => k.length < 8 || !p.keys.includes(k)).length || p.keys.length;
    let score = 0;
    if (joined) score = 2 + joined.length / 100;
    else if (hits.length && (hits.length >= Math.min(2, distinct) || hits.some((h) => h.length >= 6))) score = 1 + hits.reduce((s, h) => s + h.length, 0) / 100;
    if (score > 0 && p.brandId && p.brandId === brandId) score += 0.5;
    if (score > 0 && (!best || score > best.score)) best = { id: p.id, score };
  }
  return best?.id ?? null;
}

async function loadProductRefs(): Promise<{ refs: ProductRef[]; brandList: { id: string; name: string; aliases: string[] }[] }> {
  const [ps, bs] = await Promise.all([
    db.select({ id: products.id, name: products.name, brandId: products.brandId }).from(products).where(sql`${products.active} = true`),
    db.select({ id: brands.id, name: brands.name, aliases: brands.aliases }).from(brands),
  ]);
  const brandList = bs.map((b) => ({ id: b.id, name: b.name, aliases: Array.isArray(b.aliases) ? b.aliases : [] }));
  const brandNames = brandList.flatMap((b) => [b.name, ...b.aliases]).map(normKey).filter(Boolean);
  return { refs: ps.map((p) => ({ id: p.id, name: p.name, brandId: p.brandId, keys: productKeys(p.name, brandNames) })), brandList };
}

/* ------------------------------------------------------------------ */
/* Étiquettes de contenu                                               */
/* ------------------------------------------------------------------ */

export type CreativeTags = { format?: string; angle?: string; hook?: string; offer?: string; contentType?: string };

const ANGLES: [string, RegExp][] = [
  ["Avant / après", /avant\s*\/?\s*apr[eè]s|before\s*\/?\s*after|b\/a\b|résultat(s)? en \d/i],
  ["Témoignage", /t[ée]moignage|testimon|avis client|elle a test|ils ont test|collab(oration)?|influenc|ugc/i],
  ["Problème → solution", /probl[eè]me|marre de|vous souffrez|dites adieu|fini les|stop (aux|les)|solution|contre (les|la|le)|lutte/i],
  ["FAQ / éducatif", /\bfaq\b|pourquoi|comment |savez-vous|le saviez|conseil|astuce|explication|3 erreurs|\d erreurs|guide|éduc/i],
  ["Démonstration", /d[ée]mo|application|texture|routine|étape|step|mode d.emploi|tuto/i],
  ["Promo / offre", /promo|offre|-\s?\d{1,2}\s?%|\d{1,2}\s?% de (remise|réduction)|réduction|remise|soldes|black friday|cadeau|gratuit|2\+1|pack/i],
  ["Événement / point de vente", /rendez-vous|chez [A-Z]|animation|en (para)?pharmacie|point de vente|disponible chez|jeudi au samedi|du \d+ au \d+/i],
  ["Nouveauté / lancement", /nouveau|nouvelle|lancement|new\b|découvrez/i],
];

const FORMATS: [string, RegExp][] = [
  ["Reel / vidéo", /\breel|\bvideo|\bvid[ée]o|\brell\b|thruplay/i],
  ["Carrousel", /carousel|carrousel/i],
  ["Post existant", /^post:|existing (video )?post|instagram post|dark post|\bpost\b/i],
  ["Image / feed", /\bfeed\b|\bimg\b|\bphoto|image|visuel|static/i],
];

/** Étiquettes déduites du nom de la publicité et du texte de la créative. Heuristiques lisibles, jamais un modèle opaque. */
export function autoTags(adName: string | null, creative: MetaCreative | null): CreativeTags {
  const text = [adName ?? "", creative?.title ?? "", creative?.body ?? ""].join(" \n ");
  const tags: CreativeTags = {};
  const ot = (creative?.objectType ?? "").toUpperCase();
  if (ot.includes("VIDEO")) tags.format = "Reel / vidéo";
  else if (ot.includes("CAROUSEL")) tags.format = "Carrousel";
  else if (ot === "PHOTO" || ot === "SHARE") tags.format = "Image / feed";
  if (!tags.format) for (const [label, re] of FORMATS) if (re.test(adName ?? "")) { tags.format = label; break; }
  for (const [label, re] of ANGLES) if (re.test(text)) { tags.angle = label; break; }
  if (/promo|offre|-\s?\d{1,2}\s?%|réduction|remise|cadeau|gratuit|pack/i.test(text)) tags.offer = "Offre promotionnelle";
  const body = (creative?.body ?? "").replace(/\s+/g, " ").trim();
  if (body) {
    const first = body.split(/(?<=[.!?])\s|\n/)[0]?.trim() ?? body;
    tags.hook = first.length > 120 ? first.slice(0, 117) + "…" : first;
  }
  if (/conversation|whatsapp|message|discut|écrivez|contactez/i.test(text)) tags.contentType = "Conversation";
  else if (/rendez-vous|chez |pharmacie|point de vente/i.test(text)) tags.contentType = "Point de vente";
  else if (tags.angle === "FAQ / éducatif") tags.contentType = "Éducatif";
  else if (tags.angle === "Témoignage") tags.contentType = "Social proof";
  else if (tags.angle) tags.contentType = "Produit";
  return tags;
}

/* ------------------------------------------------------------------ */
/* Catalogage                                                          */
/* ------------------------------------------------------------------ */

type Row = typeof adEntities.$inferInsert;

async function upsert(rows: Row[]): Promise<number> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(adEntities).values(rows.slice(i, i + BATCH)).onConflictDoUpdate({
      target: [adEntities.platform, adEntities.level, adEntities.externalId],
      set: {
        accountId: sql`excluded.account_id`, parentExternalId: sql`excluded.parent_external_id`,
        externalCampaignId: sql`excluded.external_campaign_id`, externalAdsetId: sql`excluded.external_adset_id`,
        externalCreativeId: sql`coalesce(excluded.external_creative_id, ad_entities.external_creative_id)`,
        name: sql`excluded.name`, status: sql`excluded.status`, effectiveStatus: sql`excluded.effective_status`,
        objective: sql`coalesce(excluded.objective, ad_entities.objective)`,
        createdTime: sql`coalesce(excluded.created_time, ad_entities.created_time)`,
        startTime: sql`coalesce(excluded.start_time, ad_entities.start_time)`, stopTime: sql`coalesce(excluded.stop_time, ad_entities.stop_time)`,
        title: sql`coalesce(excluded.title, ad_entities.title)`, body: sql`coalesce(excluded.body, ad_entities.body)`,
        thumbnailUrl: sql`coalesce(excluded.thumbnail_url, ad_entities.thumbnail_url)`, imageUrl: sql`coalesce(excluded.image_url, ad_entities.image_url)`,
        videoId: sql`coalesce(excluded.video_id, ad_entities.video_id)`, objectType: sql`coalesce(excluded.object_type, ad_entities.object_type)`,
        callToAction: sql`coalesce(excluded.call_to_action, ad_entities.call_to_action)`, linkUrl: sql`coalesce(excluded.link_url, ad_entities.link_url)`,
        // Un rattachement manuel fait foi ; sinon la déduction automatique la plus récente.
        brandId: sql`coalesce(ad_entities.brand_id, excluded.brand_id)`,
        productId: sql`case when ad_entities.product_source = 'MANUAL' then ad_entities.product_id else coalesce(excluded.product_id, ad_entities.product_id) end`,
        productSource: sql`case when ad_entities.product_source = 'MANUAL' then 'MANUAL' else excluded.product_source end`,
        tags: sql`case when ad_entities.tags_source = 'MANUAL' then ad_entities.tags else excluded.tags end`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });
  }
  return rows.length;
}

export type EntitySyncResult = { campaigns: number; adsets: number; ads: number; creatives: number; withProduct: number };

/**
 * Catalogue complet d'un compte. Le produit est cherché du plus précis au plus large :
 * texte de la créative, nom de la publicité, nom de l'ensemble, nom de la campagne.
 */
export async function syncEntities(account: SyncAccount): Promise<EntitySyncResult> {
  const [{ refs, brandList }, campaigns, adsets, ads] = await Promise.all([
    loadProductRefs(), listCampaigns(account.externalId, true), listAdsets(account.externalId), listAds(account.externalId),
  ]);
  const now = new Date();
  const t = (v: string | null) => (v ? new Date(v) : null);
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const adsetById = new Map(adsets.map((a) => [a.id, a]));
  const brandOf = (texts: (string | null | undefined)[]): string | null => {
    for (const x of texts) { const b = matchBrandInText(x ?? null, brandList); if (b) return b; }
    return account.brandId ?? null;
  };
  const productOf = (brandId: string | null, texts: (string | null | undefined)[]): string | null => {
    for (const x of texts) { const p = matchProductInText(x ?? null, brandId, refs); if (p) return p; }
    return null;
  };

  const rows: Row[] = [];
  for (const c of campaigns) {
    const brandId = brandOf([c.name]);
    const productId = productOf(brandId, [c.name]);
    rows.push({
      platform: "META", level: "CAMPAIGN", externalId: c.id, accountId: account.id, parentExternalId: null,
      externalCampaignId: c.id, externalAdsetId: null, externalCreativeId: null, name: c.name, status: c.status,
      effectiveStatus: c.effectiveStatus, objective: c.objective, createdTime: t(c.createdTime), startTime: t(c.startTime), stopTime: t(c.stopTime),
      brandId, productId, productSource: productId ? "AUTO" : null, tags: {}, tagsSource: "AUTO", fetchedAt: now,
    });
  }
  for (const a of adsets) {
    const c = campaignById.get(a.campaignId);
    const brandId = brandOf([a.name, c?.name]);
    const productId = productOf(brandId, [a.name, c?.name]);
    rows.push({
      platform: "META", level: "ADSET", externalId: a.id, accountId: account.id, parentExternalId: a.campaignId,
      externalCampaignId: a.campaignId, externalAdsetId: a.id, externalCreativeId: null, name: a.name, status: a.status,
      effectiveStatus: a.effectiveStatus, objective: c?.objective ?? null, createdTime: t(a.createdTime), startTime: t(a.startTime), stopTime: t(a.endTime),
      body: a.targeting, brandId, productId, productSource: productId ? "AUTO" : null, tags: a.optimizationGoal ? { optimization: a.optimizationGoal } : {}, tagsSource: "AUTO", fetchedAt: now,
    });
  }
  let withProduct = 0;
  const creativeSeen = new Set<string>();
  let creatives = 0;
  for (const ad of ads) {
    const c = campaignById.get(ad.campaignId); const s = adsetById.get(ad.adsetId);
    const cr = ad.creative;
    const brandId = brandOf([cr?.body, cr?.title, ad.name, s?.name, c?.name]);
    const productId = productOf(brandId, [cr?.body, cr?.title, ad.name, s?.name, c?.name]);
    if (productId) withProduct++;
    const tags = autoTags(ad.name, cr);
    rows.push({
      platform: "META", level: "AD", externalId: ad.id, accountId: account.id, parentExternalId: ad.adsetId,
      externalCampaignId: ad.campaignId, externalAdsetId: ad.adsetId, externalCreativeId: cr?.id ?? null, name: ad.name, status: ad.status,
      effectiveStatus: ad.effectiveStatus, objective: c?.objective ?? null, createdTime: t(ad.createdTime), startTime: null, stopTime: null,
      title: cr?.title ?? null, body: cr?.body ?? null, thumbnailUrl: cr?.thumbnailUrl ?? null, imageUrl: cr?.imageUrl ?? null,
      videoId: cr?.videoId ?? null, objectType: cr?.objectType ?? null, callToAction: cr?.callToAction ?? null, linkUrl: cr?.linkUrl ?? null,
      brandId, productId, productSource: productId ? "AUTO" : null, tags: tags as Record<string, string>, tagsSource: "AUTO", fetchedAt: now,
    });
    if (cr && !creativeSeen.has(cr.id)) {
      creativeSeen.add(cr.id); creatives++;
      rows.push({
        platform: "META", level: "CREATIVE", externalId: cr.id, accountId: account.id, parentExternalId: ad.id,
        externalCampaignId: ad.campaignId, externalAdsetId: ad.adsetId, externalCreativeId: cr.id, name: cr.name ?? cr.title ?? ad.name,
        status: null, effectiveStatus: null, objective: c?.objective ?? null, createdTime: t(ad.createdTime), startTime: null, stopTime: null,
        title: cr.title, body: cr.body, thumbnailUrl: cr.thumbnailUrl, imageUrl: cr.imageUrl, videoId: cr.videoId, objectType: cr.objectType,
        callToAction: cr.callToAction, linkUrl: cr.linkUrl,
        brandId, productId, productSource: productId ? "AUTO" : null, tags: tags as Record<string, string>, tagsSource: "AUTO", fetchedAt: now,
      });
    }
  }
  await upsert(rows);
  // Les lignes de métriques héritent de la créative de leur publicité (les insights ne la donnent pas).
  await db.execute(sql`
    update ad_metrics m set external_creative_id = e.external_creative_id
    from ad_entities e
    where e.platform = 'META' and e.level = 'AD' and e.external_id = m.external_ad_id
      and m.platform = 'META' and e.external_creative_id is not null
      and m.external_creative_id is distinct from e.external_creative_id`);
  // Idem pour la marque : une ligne sans marque prend celle déduite du catalogue (jamais l'inverse).
  await db.execute(sql`
    update ad_metrics m set brand_id = e.brand_id
    from ad_entities e
    where e.platform = 'META' and e.level = 'AD' and e.external_id = m.external_ad_id
      and m.platform = 'META' and m.brand_id is null and e.brand_id is not null`);
  return { campaigns: campaigns.length, adsets: adsets.length, ads: ads.length, creatives, withProduct };
}

/** Recalcule les rattachements automatiques et les étiquettes à partir du catalogue déjà en base (sans appel Meta). */
export async function rematchEntities(): Promise<number> {
  const { refs, brandList } = await loadProductRefs();
  const rows = await db.execute(sql`
    select id, level, name, title, body, brand_id, product_source, tags_source, object_type, external_campaign_id, external_adset_id
    from ad_entities where platform = 'META'`);
  const list = rows.rows as { id: string; level: string; name: string; title: string | null; body: string | null; brand_id: string | null; product_source: string | null; tags_source: string; object_type: string | null; external_campaign_id: string | null; external_adset_id: string | null }[];
  const nameOf = new Map<string, string>();
  for (const r of list) if (r.level === "CAMPAIGN" || r.level === "ADSET") nameOf.set(r.id, r.name);
  let n = 0;
  for (const r of list) {
    if (r.product_source === "MANUAL" && r.tags_source === "MANUAL") continue;
    const brandId = r.brand_id ?? matchBrandInText(`${r.body ?? ""} ${r.name}`, brandList);
    const productId = r.product_source === "MANUAL" ? undefined : matchProductInText([r.body, r.title, r.name].filter(Boolean).join(" · "), brandId, refs);
    const tags = r.tags_source === "MANUAL" ? undefined : autoTags(r.name, { id: "", name: null, title: r.title, body: r.body, thumbnailUrl: null, imageUrl: null, videoId: null, objectType: r.object_type, callToAction: null, linkUrl: null });
    await db.execute(sql`
      update ad_entities set
        brand_id = coalesce(brand_id, ${brandId}::uuid),
        product_id = ${productId === undefined ? sql`product_id` : sql`${productId}::uuid`},
        product_source = ${productId === undefined ? sql`product_source` : sql`${productId ? "AUTO" : null}`},
        tags = ${tags === undefined ? sql`tags` : sql`${JSON.stringify(tags)}::jsonb`}
      where id = ${r.id}::uuid`);
    n++;
  }
  return n;
}
