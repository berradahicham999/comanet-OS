/**
 * PRÉVISION SAISONNIÈRE PAR RÉFÉRENCE — définition officielle et unique (arithmétique pure, testable).
 *
 * Remplace la vente moyenne « plate » sur N mois comme base du stock cible et de la commande conseillée
 * (`computeCoverage()` dans `stock-math.ts`). `src/lib/stock.ts` lit l'historique mensuel en base et appelle
 * `buildForecast()` ; aucune page ne recalcule une prévision à la main.
 *
 * ── Ce qu'est cette prévision ───────────────────────────────────────────────
 *  Une **modélisation**, jamais une mesure : elle est étiquetée « modélisée » partout où elle s'affiche.
 *  Elle ne remplace pas la vente moyenne (`avgMonthly`, qui reste la rotation constatée) : elle s'y ajoute
 *  pour projeter les mois à venir en tenant compte des événements saisonniers connus (Ramadan, saison
 *  solaire, rentrée), définis dans `settings.forecast` — aucune date ni coefficient n'est écrit ici.
 *
 * ── Méthode ─────────────────────────────────────────────────────────────────
 *  1. Indice saisonnier d'un mois civil = produit, sur les événements qui concernent le produit, de
 *     (1 + (coefficient − 1) × part du mois couverte par l'événement). Un Ramadan à ×0,8 qui couvre 21 des
 *     28 jours de février donne 1 + (0,8 − 1) × 21/28 = 0,85 pour février. Les mois sans événement valent 1.
 *  2. Base désaisonnalisée = moyenne, sur les `baseMonths` derniers mois civils complets, de
 *     (ventes du mois ÷ indice du mois). Les mois antérieurs à la première vente du produit sont exclus
 *     (une référence lancée il y a deux mois n'a pas six mois à zéro). Sans aucun mois de base, la base est
 *     la vente moyenne glissante (`avgMonthly`) : le modèle ne prétend pas en savoir plus que la rotation.
 *  3. Prévision d'un mois à venir = base × indice de ce mois. Aucune tendance n'est extrapolée : une hausse
 *     récente n'est pas prolongée, seule la saisonnalité connue l'est.
 *
 * ── Portée d'un événement ───────────────────────────────────────────────────
 *  `keywords` vides : tous les produits. Sinon, l'événement ne concerne que les produits dont le nom ou la
 *  catégorie contient un des mots-clés (sans accents ni casse) : « solaire », « SPF »… Les fenêtres sont soit
 *  explicites (Ramadan : une par année, il recule d'environ 11 jours par an), soit récurrentes chaque année
 *  (du 1er mai au 31 août), y compris à cheval sur le nouvel an (du 1er novembre au 28 février).
 *
 * ── Ce que le modèle refuse de faire ────────────────────────────────────────
 *  · Inventer un coefficient : il vient des réglages, et la page Paramètres affiche le ratio **observé** dans
 *    l'historique à côté du coefficient saisi (corrélation observée, pas causalité) pour le calibrer.
 *  · Combler un historique absent : un produit sans vente a une base nulle et une prévision nulle.
 */

export type SeasonWindow = { start: string; end: string };
/** Fenêtre récurrente chaque année (mois 1–12, jour 1–31). `start` après `end` = à cheval sur le nouvel an. */
export type RecurringWindow = { startMonth: number; startDay: number; endMonth: number; endDay: number };

export type SeasonEvent = {
  key: string;
  label: string;
  /** Coefficient appliqué aux ventes des jours couverts : 0,8 = −20 %, 1,5 = +50 %. */
  multiplier: number;
  /** Fenêtres explicites (AAAA-MM-JJ, bornes incluses), une par année. */
  windows: SeasonWindow[];
  /** Fenêtre qui revient chaque année. */
  recurring: RecurringWindow | null;
  /** Mots-clés (nom ou catégorie du produit). Vide : tous les produits. */
  keywords: string[];
};

export type ForecastSettings = {
  /** Mois civils complets servant de base désaisonnalisée. */
  baseMonths: number;
  /** Mois à venir affichés dans la prévision. */
  horizonMonths: number;
  events: SeasonEvent[];
};

export type ForecastProduct = { name: string; category: string | null };

export type ForecastMonth = {
  /** AAAA-MM. */
  month: string;
  /** Jours du mois civil. */
  days: number;
  /** Indice saisonnier du mois (1 = neutre). */
  index: number;
  /** Quantité prévue sur le mois entier (modélisée). */
  qty: number;
  /** Événements qui touchent le mois, avec la part du mois couverte. */
  events: { key: string; label: string; multiplier: number; share: number }[];
};

export type MonthlyForecast = {
  method: "MODELISEE";
  /** Base désaisonnalisée (unités par mois). */
  baseline: number;
  /** Mois de base effectivement utilisés (AAAA-MM) et ce qu'ils valaient désaisonnalisés. */
  base: { month: string; qty: number; index: number }[];
  /** `true` quand aucun mois de base n'existait : la base est la vente moyenne glissante. */
  fallbackToAverage: boolean;
  months: ForecastMonth[];
  /** Jours restants du premier mois après la date de référence (demande encore à venir ce mois-ci). */
  remainingDaysFirstMonth: number;
};

/** Série de demande pour `computeCoverage()` : premier mois proraté aux jours restants, puis les mois entiers. */
export type DemandForecast = { baseline: number; series: { qty: number; days: number }[] };

const MS_DAY = 86400000;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** L'événement concerne-t-il ce produit ? Sans mot-clé, oui pour tous. */
export function eventApplies(e: SeasonEvent, p: ForecastProduct): boolean {
  const kws = e.keywords.map(norm).filter(Boolean);
  if (!kws.length) return true;
  const hay = norm(`${p.name} ${p.category ?? ""}`);
  return kws.some((k) => hay.includes(k));
}

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const parseIso = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d) ? utc(y, m, d) : NaN; };
/** Dernier jour valide d'un mois (un 31 février devient 28 ou 29). */
const clampDay = (y: number, m: number, d: number) => Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate());

/** Fenêtres [début, fin) en millisecondes UTC d'un événement, pour les années qui touchent [from, to). */
export function eventWindows(e: SeasonEvent, from: number, to: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const w of e.windows) {
    const s = parseIso(w.start), en = parseIso(w.end);
    if (!Number.isFinite(s) || !Number.isFinite(en) || en < s) continue;
    out.push({ start: s, end: en + MS_DAY });
  }
  const r = e.recurring;
  if (r && r.startMonth >= 1 && r.startMonth <= 12 && r.endMonth >= 1 && r.endMonth <= 12) {
    const y0 = new Date(from).getUTCFullYear() - 1, y1 = new Date(to).getUTCFullYear();
    for (let y = y0; y <= y1; y++) {
      const s = utc(y, r.startMonth, clampDay(y, r.startMonth, r.startDay));
      const crosses = r.startMonth > r.endMonth || (r.startMonth === r.endMonth && r.startDay > r.endDay);
      const ey = crosses ? y + 1 : y;
      const en = utc(ey, r.endMonth, clampDay(ey, r.endMonth, r.endDay)) + MS_DAY;
      if (en > s) out.push({ start: s, end: en });
    }
  }
  return out.filter((w) => w.end > from && w.start < to);
}

/** Part de [from, to) couverte par au moins une fenêtre de l'événement (fenêtres fusionnées, 0 à 1). */
export function coveredShare(e: SeasonEvent, from: number, to: number): number {
  const total = to - from;
  if (total <= 0) return 0;
  const ws = eventWindows(e, from, to).map((w) => ({ start: Math.max(w.start, from), end: Math.min(w.end, to) })).sort((a, b) => a.start - b.start);
  let covered = 0, cursor = from;
  for (const w of ws) {
    const s = Math.max(w.start, cursor);
    if (w.end > s) { covered += w.end - s; cursor = w.end; }
  }
  return Math.min(1, covered / total);
}

/** Indice saisonnier d'un intervalle [from, to) pour un produit : produit des facteurs de chaque événement concerné. */
export function seasonIndex(events: SeasonEvent[], p: ForecastProduct, from: number, to: number): { index: number; events: ForecastMonth["events"] } {
  let index = 1;
  const hits: ForecastMonth["events"] = [];
  for (const e of events) {
    if (!(e.multiplier > 0) || !eventApplies(e, p)) continue;
    const share = coveredShare(e, from, to);
    if (share <= 0) continue;
    index *= 1 + (e.multiplier - 1) * share;
    hits.push({ key: e.key, label: e.label, multiplier: e.multiplier, share });
  }
  return { index: Math.max(index, 1e-6), events: hits };
}

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const monthBounds = (y: number, m: number) => ({ from: utc(y, m, 1), to: utc(y, m + 1, 1), days: Math.round((utc(y, m + 1, 1) - utc(y, m, 1)) / MS_DAY) });

export type ForecastInput = {
  product: ForecastProduct;
  /** Ventes par mois civil (AAAA-MM → unités), sell-in. Les mois absents valent 0. */
  history: Record<string, number>;
  /** Premier mois de vente connu (AAAA-MM), `null` si aucune vente. */
  firstSaleMonth: string | null;
  /** Date de référence (dernier import de ventes). */
  ref: Date;
  /** Vente moyenne glissante, base de repli sans mois complet. */
  avgMonthly: number;
  settings: ForecastSettings;
  /** Nombre de mois à projeter (au moins `settings.horizonMonths`). */
  horizonMonths?: number;
};

export function buildForecast(input: ForecastInput): MonthlyForecast {
  const { product, history, firstSaleMonth, ref, avgMonthly, settings } = input;
  const events = settings.events ?? [];
  const y = ref.getUTCFullYear(), m = ref.getUTCMonth() + 1;
  const baseMonths = Math.max(1, Math.round(settings.baseMonths));
  const horizon = Math.max(1, Math.round(input.horizonMonths ?? settings.horizonMonths));

  // Base : les N mois civils complets avant le mois de référence, à partir de la première vente.
  const base: MonthlyForecast["base"] = [];
  for (let k = 1; k <= baseMonths; k++) {
    const d = new Date(utc(y, m - k, 1));
    const by = d.getUTCFullYear(), bm = d.getUTCMonth() + 1, key = ym(by, bm);
    if (firstSaleMonth && key < firstSaleMonth) continue;
    const b = monthBounds(by, bm);
    const { index } = seasonIndex(events, product, b.from, b.to);
    base.push({ month: key, qty: history[key] ?? 0, index });
  }
  base.reverse();
  const fallbackToAverage = base.length === 0;
  const baseline = fallbackToAverage ? Math.max(0, avgMonthly) : base.reduce((a, b) => a + b.qty / b.index, 0) / base.length;

  const months: ForecastMonth[] = [];
  for (let k = 0; k < horizon; k++) {
    const d = new Date(utc(y, m + k, 1));
    const fy = d.getUTCFullYear(), fm = d.getUTCMonth() + 1;
    const b = monthBounds(fy, fm);
    const si = seasonIndex(events, product, b.from, b.to);
    months.push({ month: ym(fy, fm), days: b.days, index: si.index, qty: baseline * si.index, events: si.events });
  }
  const remainingDaysFirstMonth = Math.max(0, months[0].days - ref.getUTCDate());
  return { method: "MODELISEE", baseline, base, fallbackToAverage, months, remainingDaysFirstMonth };
}

/** Série de demande à partir de la date de référence : reste du mois en cours, puis mois entiers. */
export function demandSeries(f: MonthlyForecast): DemandForecast {
  const series = f.months.map((mo, i) => {
    if (i > 0) return { qty: mo.qty, days: mo.days };
    const share = mo.days > 0 ? f.remainingDaysFirstMonth / mo.days : 0;
    return { qty: mo.qty * share, days: f.remainingDaysFirstMonth };
  }).filter((x) => x.days > 0);
  return { baseline: f.baseline, series };
}

/**
 * Ratio observé d'un événement dans l'historique : ventes journalières moyennes des jours couverts ÷ ventes
 * journalières moyennes des autres jours, sur des ventes **journalières** des produits concernés. Corrélation
 * observée dans les données, affichée à côté du coefficient saisi pour le calibrer ; `null` sans assez de jours
 * de chaque côté.
 */
export function observedEventRatio(e: SeasonEvent, daily: { date: string; qty: number }[], minDaysEachSide = 14): { ratio: number | null; daysIn: number; daysOut: number } {
  if (!daily.length) return { ratio: null, daysIn: 0, daysOut: 0 };
  const sorted = [...daily].sort((a, b) => (a.date < b.date ? -1 : 1));
  const from = parseIso(sorted[0].date), to = parseIso(sorted[sorted.length - 1].date) + MS_DAY;
  const ws = eventWindows(e, from, to);
  let qIn = 0, qOut = 0, dIn = 0, dOut = 0;
  for (const d of daily) {
    const t = parseIso(d.date);
    if (ws.some((w) => t >= w.start && t < w.end)) { qIn += d.qty; dIn++; } else { qOut += d.qty; dOut++; }
  }
  if (dIn < minDaysEachSide || dOut < minDaysEachSide || qOut <= 0) return { ratio: null, daysIn: dIn, daysOut: dOut };
  return { ratio: (qIn / dIn) / (qOut / dOut), daysIn: dIn, daysOut: dOut };
}

/** Prévision « plate » (aucun événement) à partir d'une base : doublure de test et repli sans historique. */
export function flatForecast(baseline: number, ref = new Date(Date.UTC(2026, 8, 1, 12)), horizonMonths = 6): MonthlyForecast {
  const firstSaleMonth = `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, "0")}`; // aucun mois complet : repli sur la base donnée
  return buildForecast({ product: { name: "", category: null }, history: {}, firstSaleMonth, ref, avgMonthly: baseline, settings: { baseMonths: 1, horizonMonths, events: [] } });
}

/** Lien « Commander » : commande fournisseur pré-remplie avec les quantités conseillées (`/gestion/achats/nouveau`). */
export function orderPrefillHref(supplierId: string, lines: { productId: string; qty: number }[]): string {
  const l = lines.filter((x) => x.qty > 0).map((x) => `${x.productId}:${Math.round(x.qty)}`).join(",");
  return `/gestion/achats/nouveau?type=COMMANDE&supplier=${encodeURIComponent(supplierId)}&lines=${encodeURIComponent(l)}`;
}

/** Lecture du paramètre `lines` d'un lien « Commander » : `productId:qty,…`, lignes invalides ignorées. */
export function parseOrderPrefill(raw: string | null | undefined): { productId: string; qty: number }[] {
  if (!raw) return [];
  return raw.split(",").map((part) => {
    const [productId, q] = part.split(":");
    const qty = Math.round(Number(q));
    return /^[0-9a-f-]{36}$/i.test(productId ?? "") && Number.isFinite(qty) && qty > 0 ? { productId, qty } : null;
  }).filter((x): x is { productId: string; qty: number } => x !== null);
}
