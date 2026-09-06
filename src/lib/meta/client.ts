/**
 * Client Graph API Meta — lecture seule.
 *
 * Aucune écriture n'est possible depuis COMANET OS : le jeton attendu ne porte que la
 * permission `ads_read`. Mettre en pause ou rebudgéter une campagne reste un geste manuel
 * dans Ads Manager.
 *
 * La version de l'API est épinglée : Meta déprécie les versions au bout de ~2 ans et change
 * la forme des réponses entre versions. On la change explicitement, jamais par surprise.
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
  ) {
    super(message);
    this.name = "MetaError";
  }
}

/** Le jeton n'est jamais stocké en base : variable d'environnement Vercel uniquement. */
export function metaToken(): string {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new MetaError("META_ACCESS_TOKEN manquant : ajoutez le jeton dans les variables d'environnement.", null, null, false, true);
  return t;
}

export function hasMetaToken(): boolean {
  return Boolean(process.env.META_ACCESS_TOKEN);
}

type GraphResponse<T> = { data?: T[]; paging?: { next?: string; cursors?: { after?: string } }; error?: MetaApiError };
/** Une lecture d'objet unique renvoie l'objet lui-même, pas une enveloppe `{ data: [...] }`. */
type GraphObject<T> = T & { error?: MetaApiError };
type MetaApiError = { message: string; type?: string; code?: number; error_subcode?: number };

const AUTH_CODES = new Set([10, 102, 190, 200, 2635]);
const RATE_CODES = new Set([4, 17, 32, 613, 80000, 80004]);

function toError(e: MetaApiError): MetaError {
  const code = e.code ?? null;
  return new MetaError(e.message || "Erreur Meta inconnue", code, e.error_subcode ?? null, code !== null && RATE_CODES.has(code), code !== null && AUTH_CODES.has(code));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Un appel Graph, avec reprise sur limite de débit.
 *
 * Meta répond 400 (pas 429) sur dépassement de quota, avec un code applicatif : c'est le
 * corps de la réponse qui fait foi, pas le statut HTTP.
 */
async function call<T>(url: string, attempt = 0): Promise<GraphResponse<T>> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch (err) {
    if (attempt < 3) { await sleep(2000 * 2 ** attempt); return call<T>(url, attempt + 1); }
    throw new MetaError(`Réseau injoignable : ${err instanceof Error ? err.message : String(err)}`, null, null, false, false);
  }
  const body = (await res.json().catch(() => ({}))) as GraphResponse<T>;
  if (body.error) {
    const err = toError(body.error);
    if (err.isRateLimit && attempt < 4) { await sleep(30_000 * (attempt + 1)); return call<T>(url, attempt + 1); }
    throw err;
  }
  if (!res.ok) throw new MetaError(`HTTP ${res.status} sur l'API Meta`, null, null, res.status === 429, res.status === 401);
  return body;
}

/** Lecture d'un objet unique (un compte, une campagne) plutôt que d'une collection. */
async function callObject<T>(url: string): Promise<T> {
  return (await call<never>(url)) as unknown as GraphObject<T>;
}

function buildUrl(path: string, params: Record<string, string | undefined>): string {
  const u = new URL(`${GRAPH}/${META_API_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  u.searchParams.set("access_token", metaToken());
  return u.toString();
}

/** Suit la pagination jusqu'au bout. `limit` de page volontairement haut : moins d'allers-retours. */
async function paginate<T>(path: string, params: Record<string, string | undefined>): Promise<T[]> {
  let url = buildUrl(path, { ...params, limit: params.limit ?? "500" });
  const out: T[] = [];
  for (let page = 0; page < 60; page++) {
    const body = await call<T>(url);
    if (body.data?.length) out.push(...body.data);
    if (!body.paging?.next) break;
    url = body.paging.next;
  }
  return out;
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

/** Comptes auxquels le jeton donne accès. Sert à proposer une liste à l'écran de configuration. */
export async function listAccounts(): Promise<MetaAccount[]> {
  type Raw = { id: string; account_id: string; name: string; currency: string; timezone_name: string; account_status: number };
  const rows = await paginate<Raw>("me/adaccounts", { fields: ACCOUNT_FIELDS });
  return rows.map((r) => ({
    id: r.id, accountId: r.account_id, name: r.name, currency: r.currency,
    timezone: r.timezone_name, status: r.account_status,
    businessId: null, businessName: null,
  }));
}

export async function getAccount(externalId: string): Promise<MetaAccount> {
  const act = externalId.startsWith("act_") ? externalId : `act_${externalId}`;
  type Raw = { id: string; account_id: string; name: string; currency: string; timezone_name: string; account_status: number };
  const r = await callObject<Raw>(buildUrl(act, { fields: ACCOUNT_FIELDS }));
  return {
    id: r.id, accountId: r.account_id, name: r.name, currency: r.currency,
    timezone: r.timezone_name, status: r.account_status,
    businessId: null, businessName: null,
  };
}

/* ------------------------------------------------------------------ */
/* Campagnes                                                           */
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
  "daily_budget", "lifetime_budget", "budget_remaining", "start_time", "stop_time",
].join(",");

/**
 * Campagnes d'un compte avec leur état de diffusion et leurs budgets.
 *
 * C'est ce que les insights ne disent pas : une campagne mise en pause ou à budget épuisé
 * n'apparaît pas dans les chiffres du jour, elle y manque. `effective_status` est demandé en
 * plus de `status` parce que c'est lui qui décrit ce qui se passe vraiment.
 */
export async function listCampaigns(externalId: string): Promise<MetaCampaign[]> {
  const act = externalId.startsWith("act_") ? externalId : `act_${externalId}`;
  type Raw = {
    id: string; name: string; status: string; effective_status?: string; objective?: string;
    daily_budget?: string; lifetime_budget?: string; budget_remaining?: string;
    start_time?: string; stop_time?: string;
  };
  // `effective_status` filtre les campagnes archivées : elles n'ont plus d'état à surveiller.
  const rows = await paginate<Raw>(`${act}/campaigns`, {
    fields: CAMPAIGN_FIELDS,
    effective_status: JSON.stringify(["ACTIVE", "PAUSED", "IN_PROCESS", "WITH_ISSUES", "CAMPAIGN_PAUSED"]),
  });
  const opt = (v: string | undefined) => (v === undefined || v === "" ? null : Number(v) || 0);
  return rows.map((r) => ({
    id: r.id, name: r.name, status: r.status,
    effectiveStatus: r.effective_status ?? null,
    objective: r.objective ?? null,
    dailyBudgetMinor: opt(r.daily_budget),
    lifetimeBudgetMinor: opt(r.lifetime_budget),
    budgetRemainingMinor: opt(r.budget_remaining),
    startTime: r.start_time ?? null,
    stopTime: r.stop_time ?? null,
  }));
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
const LPV_TYPES = ["landing_page_view"];
/** Meta remonte cette conversation sous plusieurs libellés selon la destination (Messenger, WhatsApp, Instagram). */
const MESSAGING_TYPES = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.total_messaging_connection",
  "onsite_conversion.messaging_first_reply",
];

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
  const act = externalId.startsWith("act_") ? externalId : `act_${externalId}`;
  const windows = attributionWindow.split(",").map((w) => w.trim()).filter(Boolean);
  const rows = await paginate<RawInsight>(`${act}/insights`, {
    level,
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    action_attribution_windows: JSON.stringify(windows),
    fields: INSIGHT_FIELDS,
    limit: "500",
  });
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
  }));
}
