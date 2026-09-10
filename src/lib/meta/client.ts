/**
 * Client Graph API Meta — lecture seule.
 *
 * Aucune écriture n'est possible depuis COMANET OS : le jeton attendu ne porte que la
 * permission `ads_read`. Mettre en pause ou rebudgéter une campagne reste un geste manuel
 * dans Ads Manager.
 *
 * La version de l'API est épinglée : Meta déprécie les versions au bout de ~2 ans et change
 * la forme des réponses entre versions. On la change explicitement, jamais par surprise.
 *
 * Plusieurs jetons : les comptes COMANET sont répartis sur cinq Business Managers, et un
 * jeton d'utilisateur système ne voit que les comptes de son business. `META_ACCESS_TOKEN`
 * accepte donc plusieurs jetons séparés par des virgules ; chaque compte est lu avec le
 * premier jeton qui y a accès (mémorisé le temps de l'exécution).
 */

export const META_API_VERSION = process.env.META_API_VERSION || "v23.0";
const GRAPH = "https://graph.facebook.com";

export class MetaError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly isRateLimit: boolean,
    readonly isAuth: boolean,
    /** Statut HTTP et type d'erreur Meta, pour le diagnostic. */
    readonly httpStatus: number | null = null,
    readonly type: string | null = null,
    readonly fbtraceId: string | null = null,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

/** Jetons configurés, dans l'ordre. Jamais stockés en base : variables d'environnement uniquement. */
export function metaTokens(): string[] {
  return (process.env.META_ACCESS_TOKEN ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}

/** Premier jeton (compatibilité). Lève une erreur d'authentification s'il n'y en a aucun. */
export function metaToken(): string {
  const t = metaTokens()[0];
  if (!t) throw new MetaError("META_ACCESS_TOKEN manquant : ajoutez le jeton dans les variables d'environnement.", null, null, false, true);
  return t;
}

export function hasMetaToken(): boolean {
  return metaTokens().length > 0;
}

/** Jeton retenu par compte publicitaire (le premier qui a répondu), le temps du processus. */
const tokenByAccount = new Map<string, string>();

type GraphResponse<T> = { data?: T[]; paging?: { next?: string; cursors?: { after?: string } }; error?: MetaApiError };
/** Une lecture d'objet unique renvoie l'objet lui-même, pas une enveloppe `{ data: [...] }`. */
type GraphObject<T> = T & { error?: MetaApiError };
type MetaApiError = { message: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string; error_user_msg?: string };

const AUTH_CODES = new Set([10, 102, 190, 200, 2635]);
const RATE_CODES = new Set([4, 17, 32, 613, 80000, 80004]);

function toError(e: MetaApiError, httpStatus: number | null): MetaError {
  const code = e.code ?? null;
  const subcode = e.error_subcode ?? null;
  const msg = e.error_user_msg ? `${e.message} — ${e.error_user_msg}` : e.message;
  return new MetaError(msg, code, subcode, code !== null && RATE_CODES.has(code), code !== null && AUTH_CODES.has(code), httpStatus, e.type ?? null, e.fbtrace_id ?? null);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Un appel Graph, avec reprise sur limite de débit.
 *
 * Meta répond 400 (pas 429) sur dépassement de quota, avec un code applicatif : c'est le
 * corps de la réponse qui fait foi, pas le statut HTTP.
 */
async function call<T>(url: string, attempt = 0, opts?: { noRetry?: boolean }): Promise<GraphResponse<T>> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch (err) {
    if (attempt < 3 && !opts?.noRetry) { await sleep(2000 * 2 ** attempt); return call<T>(url, attempt + 1, opts); }
    throw new MetaError(`Réseau injoignable : ${err instanceof Error ? err.message : String(err)}`, null, null, false, false);
  }
  const body = (await res.json().catch(() => ({}))) as GraphResponse<T>;
  if (body.error) {
    const err = toError(body.error, res.status);
    if (err.isRateLimit && attempt < 4 && !opts?.noRetry) { await sleep(30_000 * (attempt + 1)); return call<T>(url, attempt + 1, opts); }
    throw err;
  }
  if (!res.ok) throw new MetaError(`HTTP ${res.status} sur l'API Meta`, null, null, res.status === 429, res.status === 401, res.status);
  return body;
}

/** Lecture d'un objet unique (un compte, une campagne) plutôt que d'une collection. */
async function callObject<T>(url: string): Promise<T> {
  return (await call<never>(url)) as unknown as GraphObject<T>;
}

function buildUrl(path: string, params: Record<string, string | undefined>, token: string): string {
  const u = new URL(`${GRAPH}/${META_API_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  return u.toString();
}

/**
 * Exécute `fn` avec le jeton du compte ; si aucun n'est encore connu, essaie chaque jeton
 * configuré et retient le premier qui n'est pas refusé pour cause d'autorisation.
 */
async function withToken<T>(externalId: string | null, fn: (token: string) => Promise<T>): Promise<T> {
  const tokens = metaTokens();
  if (!tokens.length) metaToken(); // lève l'erreur « manquant »
  const key = externalId ? externalId.replace(/^act_/, "") : "*";
  const known = tokenByAccount.get(key);
  if (known) return fn(known);
  let last: unknown = null;
  for (const t of tokens) {
    try {
      const out = await fn(t);
      tokenByAccount.set(key, t);
      return out;
    } catch (e) {
      last = e;
      if (!(e instanceof MetaError && e.isAuth)) throw e;
    }
  }
  throw last instanceof Error ? last : new MetaError("Aucun jeton n'a accès à ce compte.", null, null, false, true);
}

/** Suit la pagination jusqu'au bout. `limit` de page volontairement haut : moins d'allers-retours. */
async function paginate<T>(path: string, params: Record<string, string | undefined>, token: string, maxPages = 60): Promise<T[]> {
  let url = buildUrl(path, { ...params, limit: params.limit ?? "500" }, token);
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const body = await call<T>(url);
    if (body.data?.length) out.push(...body.data);
    if (!body.paging?.next) break;
    url = body.paging.next;
  }
  return out;
}

const act = (externalId: string) => (externalId.startsWith("act_") ? externalId : `act_${externalId}`);

/* ------------------------------------------------------------------ */
/* Diagnostic : appels bruts, sans reprise, avec le détail de l'erreur */
/* ------------------------------------------------------------------ */

export type ProbeResult = {
  ok: boolean;
  httpStatus: number | null;
  code: number | null;
  subcode: number | null;
  type: string | null;
  message: string | null;
  fbtraceId: string | null;
  /** Réponse (tronquée) en cas de succès, pour montrer ce qui a été lu. */
  sample: unknown;
  ms: number;
};

/** Un appel GET Graph brut, pour le diagnostic : jamais d'exception, toujours un compte-rendu. */
export async function probe(path: string, params: Record<string, string | undefined>, token: string): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const body = await call<unknown>(buildUrl(path, params, token), 0, { noRetry: true });
    const sample = Array.isArray(body.data) ? body.data.slice(0, 3) : body;
    return { ok: true, httpStatus: 200, code: null, subcode: null, type: null, message: null, fbtraceId: null, sample, ms: Date.now() - started };
  } catch (e) {
    if (e instanceof MetaError) return { ok: false, httpStatus: e.httpStatus, code: e.code, subcode: e.subcode, type: e.type, message: e.message, fbtraceId: e.fbtraceId, sample: null, ms: Date.now() - started };
    return { ok: false, httpStatus: null, code: null, subcode: null, type: null, message: e instanceof Error ? e.message : String(e), fbtraceId: null, sample: null, ms: Date.now() - started };
  }
}

export type TokenDebug = {
  appId: string | null;
  appName: string | null;
  type: string | null;
  isValid: boolean;
  expiresAt: string | null; // null = n'expire pas
  dataAccessExpiresAt: string | null;
  scopes: string[];
  userId: string | null;
  error: string | null;
};

/**
 * `debug_token` : validité, application émettrice, expiration, permissions. Un jeton
 * d'utilisateur système peut s'inspecter lui-même ; sinon Meta répond avec une erreur qui est
 * elle-même une information (jeton invalide, application désactivée).
 */
export async function debugToken(token: string): Promise<TokenDebug> {
  type Raw = { data?: { app_id?: string; application?: string; type?: string; is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; user_id?: string; error?: { message: string } } };
  const r = await probe("debug_token", { input_token: token }, token);
  const d = (r.sample as Raw | null)?.data;
  const toIso = (n: number | undefined) => (n && n > 0 ? new Date(n * 1000).toISOString() : null);
  return {
    appId: d?.app_id ?? null, appName: d?.application ?? null, type: d?.type ?? null,
    isValid: Boolean(d?.is_valid), expiresAt: toIso(d?.expires_at), dataAccessExpiresAt: toIso(d?.data_access_expires_at),
    scopes: d?.scopes ?? [], userId: d?.user_id ?? null,
    error: r.ok ? (d?.error?.message ?? null) : r.message,
  };
}

/* ------------------------------------------------------------------ */
/* Compte publicitaire                                                 */
/* ------------------------------------------------------------------ */

export type MetaAccount = {
  id: string;            // act_123…
  accountId: string;     // 123…
  name: string;
  currency: string;
  timezone: string;
  businessId: string | null;
  businessName: string | null;
  status: number;
};

/**
 * Champs lisibles avec la seule permission `ads_read`.
 *
 * `business{id,name}` en est volontairement absent : Meta exige `business_management` pour ce
 * champ, une permission qui ouvre l'administration du Business Manager — hors de proportion
 * pour afficher un nom. Le business reste donc inconnu de l'application, ce qui ne coûte
 * qu'un repère d'affichage.
 */
const ACCOUNT_FIELDS = "id,account_id,name,currency,timezone_name,account_status";
type RawAccount = { id: string; account_id: string; name: string; currency: string; timezone_name: string; account_status: number };
const toAccount = (r: RawAccount): MetaAccount => ({
  id: r.id, accountId: r.account_id, name: r.name, currency: r.currency,
  timezone: r.timezone_name, status: r.account_status, businessId: null, businessName: null,
});

/** Comptes auxquels les jetons donnent accès (union, dédoublonnée). Sert à l'écran de configuration. */
export async function listAccounts(): Promise<MetaAccount[]> {
  const tokens = metaTokens();
  if (!tokens.length) metaToken();
  const seen = new Map<string, MetaAccount>();
  let lastErr: unknown = null;
  for (const t of tokens) {
    try {
      const rows = await paginate<RawAccount>("me/adaccounts", { fields: ACCOUNT_FIELDS }, t);
      for (const r of rows) {
        if (!seen.has(r.account_id)) { seen.set(r.account_id, toAccount(r)); tokenByAccount.set(r.account_id, t); }
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (!seen.size && lastErr) throw lastErr;
  return [...seen.values()];
}

export async function getAccount(externalId: string): Promise<MetaAccount> {
  return withToken(externalId, async (t) => toAccount(await callObject<RawAccount>(buildUrl(act(externalId), { fields: ACCOUNT_FIELDS }, t))));
}

/* ------------------------------------------------------------------ */
/* Campagnes, ensembles, publicités, créatives                         */
/* ------------------------------------------------------------------ */

export type MetaCampaign = {
  id: string;
  name: string;
  /** Ce que l'annonceur a demandé. */
  status: string;
  /** Ce que Meta applique réellement : un compte impayé passe en pause sans toucher `status`. */
  effectiveStatus: string | null;
  objective: string | null;
  /** Budgets dans l'unité mineure de la devise du compte (centimes pour EUR/USD). */
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  budgetRemainingMinor: number | null;
  startTime: string | null;
  stopTime: string | null;
  createdTime: string | null;
};

/**
 * Devises sans sous-unité : un « centime » n'y existe pas, le montant est déjà entier.
 * Diviser par 100 y ferait un budget cent fois trop petit.
 */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD", "COP", "PYG", "UGX", "RWF", "XAF", "XOF", "KMF", "DJF", "GNF", "VUV"]);

/** Convertit un montant Meta (unité mineure) vers l'unité principale de la devise. */
export function minorToMajor(minor: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? minor : minor / 100;
}

const CAMPAIGN_FIELDS = [
  "id", "name", "status", "effective_status", "objective",
  "daily_budget", "lifetime_budget", "budget_remaining", "start_time", "stop_time", "created_time",
].join(",");
type RawCampaign = {
  id: string; name: string; status: string; effective_status?: string; objective?: string;
  daily_budget?: string; lifetime_budget?: string; budget_remaining?: string;
  start_time?: string; stop_time?: string; created_time?: string;
};
const opt = (v: string | undefined) => (v === undefined || v === "" ? null : Number(v) || 0);
const toCampaign = (r: RawCampaign): MetaCampaign => ({
  id: r.id, name: r.name, status: r.status,
  effectiveStatus: r.effective_status ?? null,
  objective: r.objective ?? null,
  dailyBudgetMinor: opt(r.daily_budget),
  lifetimeBudgetMinor: opt(r.lifetime_budget),
  budgetRemainingMinor: opt(r.budget_remaining),
  startTime: r.start_time ?? null,
  stopTime: r.stop_time ?? null,
  createdTime: r.created_time ?? null,
});

/** Tous les états, archivés compris : c'est la liste qu'il faut pour cataloguer l'historique. */
const ALL_EFFECTIVE = ["ACTIVE", "PAUSED", "IN_PROCESS", "WITH_ISSUES", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "ARCHIVED", "DELETED", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO"];

/**
 * Campagnes d'un compte avec leur état de diffusion et leurs budgets.
 *
 * C'est ce que les insights ne disent pas : une campagne mise en pause ou à budget épuisé
 * n'apparaît pas dans les chiffres du jour, elle y manque. `effective_status` est demandé en
 * plus de `status` parce que c'est lui qui décrit ce qui se passe vraiment.
 * `all` inclut les campagnes archivées et supprimées (catalogue historique).
 */
export async function listCampaigns(externalId: string, all = false): Promise<MetaCampaign[]> {
  return withToken(externalId, async (t) => {
    const rows = await paginate<RawCampaign>(`${act(externalId)}/campaigns`, {
      fields: CAMPAIGN_FIELDS,
      effective_status: JSON.stringify(all ? ALL_EFFECTIVE : ["ACTIVE", "PAUSED", "IN_PROCESS", "WITH_ISSUES", "CAMPAIGN_PAUSED"]),
    }, t);
    return rows.map(toCampaign);
  });
}

export type MetaAdset = {
  id: string; name: string; campaignId: string; status: string; effectiveStatus: string | null;
  optimizationGoal: string | null; dailyBudgetMinor: number | null; lifetimeBudgetMinor: number | null;
  startTime: string | null; endTime: string | null; createdTime: string | null;
  /** Ciblage résumé (pays, âges, intérêts) : lisible, jamais réécrit. */
  targeting: string | null;
};

/** Ensembles de publicités d'un compte (tous états). */
export async function listAdsets(externalId: string): Promise<MetaAdset[]> {
  type Raw = {
    id: string; name: string; campaign_id: string; status: string; effective_status?: string; optimization_goal?: string;
    daily_budget?: string; lifetime_budget?: string; start_time?: string; end_time?: string; created_time?: string;
    targeting?: { geo_locations?: { countries?: string[]; cities?: { name: string }[] }; age_min?: number; age_max?: number; genders?: number[]; flexible_spec?: { interests?: { name: string }[] }[]; custom_audiences?: { name: string }[] };
  };
  const summarize = (tg: Raw["targeting"]): string | null => {
    if (!tg) return null;
    const parts: string[] = [];
    const cities = tg.geo_locations?.cities?.map((c) => c.name).filter(Boolean) ?? [];
    if (cities.length) parts.push(cities.slice(0, 4).join(", ") + (cities.length > 4 ? "…" : ""));
    else if (tg.geo_locations?.countries?.length) parts.push(tg.geo_locations.countries.join(", "));
    if (tg.age_min || tg.age_max) parts.push(`${tg.age_min ?? "?"}–${tg.age_max ?? "?"} ans`);
    if (tg.genders?.length === 1) parts.push(tg.genders[0] === 1 ? "hommes" : "femmes");
    const interests = tg.flexible_spec?.flatMap((f) => f.interests?.map((i) => i.name) ?? []) ?? [];
    if (interests.length) parts.push(`intérêts : ${interests.slice(0, 4).join(", ")}`);
    if (tg.custom_audiences?.length) parts.push(`audiences : ${tg.custom_audiences.map((a) => a.name).slice(0, 3).join(", ")}`);
    return parts.length ? parts.join(" · ") : null;
  };
  return withToken(externalId, async (t) => {
    const rows = await paginate<Raw>(`${act(externalId)}/adsets`, {
      fields: "id,name,campaign_id,status,effective_status,optimization_goal,daily_budget,lifetime_budget,start_time,end_time,created_time,targeting",
      effective_status: JSON.stringify(ALL_EFFECTIVE),
    }, t);
    return rows.map((r) => ({
      id: r.id, name: r.name, campaignId: r.campaign_id, status: r.status, effectiveStatus: r.effective_status ?? null,
      optimizationGoal: r.optimization_goal ?? null, dailyBudgetMinor: opt(r.daily_budget), lifetimeBudgetMinor: opt(r.lifetime_budget),
      startTime: r.start_time ?? null, endTime: r.end_time ?? null, createdTime: r.created_time ?? null,
      targeting: summarize(r.targeting),
    }));
  });
}

export type MetaCreative = {
  id: string; name: string | null; title: string | null; body: string | null;
  thumbnailUrl: string | null; imageUrl: string | null; videoId: string | null;
  objectType: string | null; callToAction: string | null; linkUrl: string | null;
};

export type MetaAd = {
  id: string; name: string; adsetId: string; campaignId: string; status: string; effectiveStatus: string | null;
  createdTime: string | null; creative: MetaCreative | null;
};

type RawCreative = {
  id: string; name?: string; title?: string; body?: string; thumbnail_url?: string; image_url?: string; video_id?: string;
  object_type?: string; call_to_action_type?: string; link_url?: string;
  object_story_spec?: {
    link_data?: { message?: string; name?: string; link?: string; call_to_action?: { type?: string }; child_attachments?: { name?: string; description?: string }[] };
    video_data?: { message?: string; title?: string; video_id?: string; image_url?: string; call_to_action?: { type?: string } };
    photo_data?: { caption?: string; url?: string };
  };
  asset_feed_spec?: { bodies?: { text: string }[]; titles?: { text: string }[]; videos?: { video_id: string }[]; images?: { url?: string }[] };
};

/**
 * Le texte d'une créative vit à trois endroits selon son âge et son type : les champs plats,
 * `object_story_spec` (publication créée pour la pub) ou `asset_feed_spec` (créatives
 * dynamiques à plusieurs textes). On prend le premier renseigné, jamais une concaténation.
 */
function toCreative(c: RawCreative): MetaCreative {
  const s = c.object_story_spec; const af = c.asset_feed_spec;
  const body = c.body ?? s?.link_data?.message ?? s?.video_data?.message ?? s?.photo_data?.caption ?? af?.bodies?.[0]?.text ?? null;
  const title = c.title ?? s?.link_data?.name ?? s?.video_data?.title ?? af?.titles?.[0]?.text ?? s?.link_data?.child_attachments?.[0]?.name ?? null;
  const videoId = c.video_id ?? s?.video_data?.video_id ?? af?.videos?.[0]?.video_id ?? null;
  const imageUrl = c.image_url ?? s?.video_data?.image_url ?? s?.photo_data?.url ?? af?.images?.[0]?.url ?? null;
  const cta = c.call_to_action_type ?? s?.link_data?.call_to_action?.type ?? s?.video_data?.call_to_action?.type ?? null;
  const objectType = c.object_type ?? (videoId ? "VIDEO" : s?.link_data?.child_attachments?.length ? "CAROUSEL" : imageUrl ? "PHOTO" : null);
  return {
    id: c.id, name: c.name ?? null, title, body, thumbnailUrl: c.thumbnail_url ?? null, imageUrl, videoId,
    objectType, callToAction: cta, linkUrl: c.link_url ?? s?.link_data?.link ?? null,
  };
}

const CREATIVE_FIELDS = "id,name,title,body,thumbnail_url,image_url,video_id,object_type,call_to_action_type,link_url,object_story_spec,asset_feed_spec";

/** Publicités d'un compte (tous états) avec leur créative. */
export async function listAds(externalId: string): Promise<MetaAd[]> {
  type Raw = { id: string; name: string; adset_id: string; campaign_id: string; status: string; effective_status?: string; created_time?: string; creative?: RawCreative };
  return withToken(externalId, async (t) => {
    const rows = await paginate<Raw>(`${act(externalId)}/ads`, {
      fields: `id,name,adset_id,campaign_id,status,effective_status,created_time,creative{${CREATIVE_FIELDS}}`,
      effective_status: JSON.stringify(ALL_EFFECTIVE),
      limit: "200",
    }, t);
    return rows.map((r) => ({
      id: r.id, name: r.name, adsetId: r.adset_id, campaignId: r.campaign_id, status: r.status,
      effectiveStatus: r.effective_status ?? null, createdTime: r.created_time ?? null,
      creative: r.creative ? toCreative(r.creative) : null,
    }));
  });
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

export type MetaInsightRow = {
  date: string;
  campaignId: string;
  campaignName: string;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  landingPageViews: number;
  leads: number;
  purchases: number;
  revenue: number;
  /** Conversations démarrées (Messenger/WhatsApp) — le résultat des campagnes « Messages ». */
  messagingStarted: number;
  videoViews: number;
  postEngagement: number;
};

type Action = { action_type: string; value: string };
type RawInsight = {
  date_start: string;
  campaign_id: string; campaign_name: string;
  adset_id?: string; adset_name?: string; ad_id?: string; ad_name?: string;
  spend?: string; impressions?: string; reach?: string; clicks?: string; inline_link_clicks?: string;
  actions?: Action[]; action_values?: Action[];
};

const n = (v: string | undefined) => (v === undefined ? 0 : Number(v) || 0);

/**
 * Un achat Meta remonte sous plusieurs libellés selon la source (pixel, API de conversions,
 * boutique). `omni_purchase` les dédoublonne déjà ; on ne retient donc qu'un seul type par
 * ligne, sinon le même achat serait compté deux fois.
 */
const pick = (actions: Action[] | undefined, types: string[]): number => {
  if (!actions?.length) return 0;
  for (const t of types) {
    const hit = actions.find((a) => a.action_type === t);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
};

const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
const LEAD_TYPES = ["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"];
const LPV_TYPES = ["landing_page_view", "omni_landing_page_view"];
/** Meta remonte cette conversation sous plusieurs libellés selon la destination (Messenger, WhatsApp, Instagram). */
const MESSAGING_TYPES = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.total_messaging_connection",
  "onsite_conversion.messaging_first_reply",
];
const VIDEO_VIEW_TYPES = ["video_view"];
const ENGAGEMENT_TYPES = ["post_engagement", "page_engagement"];

const INSIGHT_FIELDS = [
  "date_start", "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
  "spend", "impressions", "reach", "clicks", "inline_link_clicks", "actions", "action_values",
].join(",");

/**
 * Insights journaliers d'un compte, au niveau publicité (le grain d'`ad_metrics`).
 *
 * `time_increment=1` donne une ligne par jour ; les journées sont découpées dans le fuseau
 * du compte publicitaire, pas dans celui de l'entreprise.
 */
export async function fetchInsights(
  externalId: string,
  since: string,
  until: string,
  attributionWindow: string,
  level: "ad" | "campaign" = "ad",
): Promise<MetaInsightRow[]> {
  const windows = attributionWindow.split(",").map((w) => w.trim()).filter(Boolean);
  const rows = await withToken(externalId, (t) => paginate<RawInsight>(`${act(externalId)}/insights`, {
    level,
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    action_attribution_windows: JSON.stringify(windows),
    fields: INSIGHT_FIELDS,
    limit: "500",
  }, t, 200));
  return rows.map((r) => ({
    date: r.date_start,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    adsetId: r.adset_id ?? null,
    adsetName: r.adset_name ?? null,
    adId: r.ad_id ?? null,
    adName: r.ad_name ?? null,
    spend: n(r.spend),
    impressions: Math.round(n(r.impressions)),
    reach: Math.round(n(r.reach)),
    clicks: Math.round(n(r.clicks)),
    linkClicks: Math.round(n(r.inline_link_clicks)),
    landingPageViews: Math.round(pick(r.actions, LPV_TYPES)),
    leads: Math.round(pick(r.actions, LEAD_TYPES)),
    purchases: Math.round(pick(r.actions, PURCHASE_TYPES)),
    revenue: pick(r.action_values, PURCHASE_TYPES),
    messagingStarted: Math.round(pick(r.actions, MESSAGING_TYPES)),
    videoViews: Math.round(pick(r.actions, VIDEO_VIEW_TYPES)),
    postEngagement: Math.round(pick(r.actions, ENGAGEMENT_TYPES)),
  }));
}

/** Jeton effectivement utilisé pour un compte (diagnostic), ou le premier configuré. */
export function tokenFor(externalId: string): string {
  return tokenByAccount.get(externalId.replace(/^act_/, "")) ?? metaToken();
}
