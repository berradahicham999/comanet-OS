/**
 * Orchestration du Ads Command Center : charge les données (data.ts), fait tourner les moteurs
 * (benchmark → tendance → anomalies → fatigue → winners → contenu → recommandations) et
 * renvoie UNE charge utile sérialisable pour la page unique. Réutilisée telle quelle par
 * `agent.ts` (fonctions pour l'IA) : l'interface ne contient aucune logique.
 */
import { RESULT_LABELS, brandAverages } from "@/lib/ads";
import { totals as salesTotals } from "@/lib/analytics";
import { addDays, iso, startOfMonth, today, fmtDate } from "@/lib/format";
import { getSettings, type ComanetSettings } from "@/lib/settings";
import { productStocks } from "@/lib/stock";
import { isUnderTension } from "@/lib/stock-math";
import { listBrands } from "@/lib/users";
import { backfillStates } from "@/lib/meta/backfill";
import { allocationOf } from "./allocation";
import { anomaliesOf } from "./anomaly";
import { benchmarkFor } from "./benchmark";
import { opportunitiesOf, patternsOf } from "./content";
import { childrenOf, dailySeries, historyBounds, monthlyHistory, perfByLevel, sourcesIn, syncStatus, type MonthRow, type PerfFilter } from "./data";
import { fatigueOf } from "./fatigue";
import { healthOf } from "./health";
import { loadMemory, memoryOf, persistMemory } from "./memory";
import { dailyResults, kindOfSeries, metricOf, pct, stabilityOf, trendOf } from "./metrics";
import { pushOf } from "./push";
import { recommend, topActions } from "./recommend";
import { classify } from "./winners";
import type { Anomaly, Benchmark, BudgetStatus, BusinessImpact, CommandCenterData, DataStatus, EntityDetail, EntityLevel, EntityPerf, Fatigue, Range, Recommendation, Trend, WinnerVerdict } from "./types";

export type PeriodKey = "today" | "7d" | "14d" | "30d" | "mtd" | "90d" | "year" | "custom";
export const PERIOD_KEYS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Aujourd'hui" }, { key: "7d", label: "7 j" }, { key: "14d", label: "14 j" }, { key: "30d", label: "30 j" },
  { key: "mtd", label: "Mois" }, { key: "90d", label: "90 j" }, { key: "year", label: "Année" }, { key: "custom", label: "Perso." },
];

export type AdsPeriod = { key: PeriodKey; start: string; end: string; label: string; prev: Range; prevLabel: string; days: number };

/** Période publicitaire, calée sur aujourd'hui (la régie est en direct, pas sur le dernier import Sage). */
export function resolveAdsPeriod(key: string | undefined, custom?: { start?: string; end?: string }, ref = today()): AdsPeriod {
  const k = (PERIOD_KEYS.some((p) => p.key === key) ? key : "30d") as PeriodKey;
  const tomorrow = iso(addDays(ref, 1));
  let start: string, end = tomorrow, label: string;
  switch (k) {
    case "today": start = iso(ref); label = "Aujourd'hui"; break;
    case "7d": start = iso(addDays(ref, -6)); label = "7 derniers jours"; break;
    case "14d": start = iso(addDays(ref, -13)); label = "14 derniers jours"; break;
    case "mtd": start = iso(startOfMonth(ref)); label = "Mois en cours"; break;
    case "90d": start = iso(addDays(ref, -89)); label = "90 derniers jours"; break;
    case "year": start = `${ref.getUTCFullYear()}-01-01`; label = "Année en cours"; break;
    case "custom": {
      start = custom?.start && /^\d{4}-\d{2}-\d{2}$/.test(custom.start) ? custom.start : iso(addDays(ref, -29));
      const e = custom?.end && /^\d{4}-\d{2}-\d{2}$/.test(custom.end) ? custom.end : iso(ref);
      end = iso(addDays(new Date(e + "T12:00:00Z"), 1)); label = `${fmtDate(start)} → ${fmtDate(e)}`; break;
    }
    default: start = iso(addDays(ref, -29)); label = "30 derniers jours";
  }
  const days = Math.max(1, Math.round((new Date(end + "T12:00:00Z").getTime() - new Date(start + "T12:00:00Z").getTime()) / 86400000));
  const prev = { start: iso(addDays(new Date(start + "T12:00:00Z"), -days)), end: start };
  return { key: k, start, end, label, prev, prevLabel: `${days} j précédents`, days };
}

const ALL: Range = { start: "2000-01-01", end: "2100-01-01" };
const isActive = (e: EntityPerf) => e.effectiveStatus === "ACTIVE";

/**
 * Une référence n'est comparable que si elle a du volume : quelques résultats sur une poignée
 * de dirhams donnent des écarts de +26 000 % qui ne veulent rien dire. En dessous, on affiche
 * « pas encore comparable » plutôt qu'un écart trompeur.
 */
const MIN_REF_RESULTS = 10;
function comparableRef(prev: EntityPerf | null | undefined, minSpend: number): EntityPerf | null {
  if (!prev) return null;
  return prev.spend >= minSpend / 2 && prev.results >= MIN_REF_RESULTS ? prev : null;
}

function budgetOf(monthSpend: number, closedDays: number, ref: Date, s: ComanetSettings): BudgetStatus {
  const daysInMonth = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsed = ref.getUTCDate();
  const budget = s.adsIntel.monthlyBudgetMad > 0 ? s.adsIntel.monthlyBudgetMad : null;
  const projected = closedDays > 0 ? (monthSpend / closedDays) * daysInMonth : null;
  const consumedPct = budget ? (monthSpend / budget) * 100 : null;
  let status: BudgetStatus["status"] = "UNDEFINED";
  if (budget && projected !== null) status = projected > budget * 1.1 ? "OVERSPENDING" : projected > budget * 0.95 ? "WATCH" : "ON_TRACK";
  return { monthSpend, monthlyBudget: budget, consumedPct, projected, status, daysElapsed, daysInMonth };
}

export async function buildCommandCenter(opts: { periodKey?: string; brandId?: string | null; custom?: { start?: string; end?: string }; now?: Date; persist?: boolean } = {}): Promise<CommandCenterData> {
  const now = opts.now ?? today();
  const settings = await getSettings();
  const s = settings.adsIntel; const t = settings.ads;
  const period = resolveAdsPeriod(opts.periodKey, opts.custom, now);
  const range: Range = { start: period.start, end: period.end };
  const brandId = opts.brandId ?? null;
  const f: PerfFilter = { brandId };
  const todayIso = iso(now);

  const [brandsList, campaigns, campaignsPrev, ads, creatives, creativesPrev, brandsCur, brandsPrev, products,
    creativesAll, productsAll, bounds, sync, backfill, totalSeries, monthSeries, memoryStored, srcCur, srcPrev] = await Promise.all([
    listBrands(),
    perfByLevel("campaign", range, f), perfByLevel("campaign", period.prev, f),
    perfByLevel("ad", range, f),
    perfByLevel("creative", range, f), perfByLevel("creative", period.prev, f),
    perfByLevel("brand", range, f), perfByLevel("brand", period.prev, f),
    perfByLevel("product", range, f),
    perfByLevel("creative", ALL, f), perfByLevel("product", ALL, f),
    historyBounds(f), syncStatus(), backfillStates(),
    dailySeries({ start: iso(addDays(new Date(period.start + "T12:00:00Z"), -42)), end: period.end }, f),
    dailySeries({ start: iso(startOfMonth(now)), end: iso(addDays(now, 1)) }, f),
    loadMemory(brandId),
    sourcesIn(range, f), sourcesIn(period.prev, f),
  ]);
  // Comparer des journées API à des cumuls importés (mensuels) n'a pas de sens : la période
  // précédente n'est comparable que si les deux périodes viennent de la même source.
  const prevComparable = srcCur.api === srcPrev.api && srcCur.import === srcPrev.import;
  const brandNames = new Map(brandsList.map((b) => [b.id, b.name]));

  // Historique mensuel par marque et par produit (pour les benchmarks « historique » et « meilleur mois »).
  const brandIds = [...new Set(brandsCur.map((b) => b.brandId).filter((x): x is string => Boolean(x)))];
  const productIds = [...new Set(products.map((p) => p.productId).filter((x): x is string => Boolean(x)))].slice(0, 12);
  const [brandHist, productHist, stocks] = await Promise.all([
    Promise.all(brandIds.map(async (id) => [id, await monthlyHistory({ brandId: id })] as const)),
    Promise.all(productIds.map(async (id) => [id, await monthlyHistory({ productId: id })] as const)),
    productStocks({ productIds }, now).catch(() => []),
  ]);
  const historyByBrand = new Map<string, MonthRow[]>(brandHist);
  const historyByProduct = new Map<string, MonthRow[]>(productHist);
  const brandHistKey = new Map<string, MonthRow[]>();
  for (const b of brandsCur) if (b.brandId) brandHistKey.set(b.key, historyByBrand.get(b.brandId) ?? []);

  // Séries journalières des entités analysées (campagnes et créatives à dépense significative, bornées).
  const seriesRange: Range = { start: iso(addDays(new Date(period.start + "T12:00:00Z"), -21)), end: period.end };
  const campaignTargets = campaigns.filter((c) => c.spend >= t.minSpend / 2 || isActive(c)).slice(0, 15);
  const creativeTargets = creatives.filter((c) => c.spend >= t.minSpend / 2 || isActive(c)).slice(0, 15);
  const [campaignSeries, creativeSeries, brandSeries] = await Promise.all([
    Promise.all(campaignTargets.map(async (c) => [c.key, c.externalCampaignId ? await dailySeries(seriesRange, { externalCampaignId: c.externalCampaignId }) : []] as const)),
    Promise.all(creativeTargets.map(async (c) => [c.key, c.externalCreativeId ? await dailySeries(seriesRange, { externalCreativeId: c.externalCreativeId }) : []] as const)),
    Promise.all(brandsCur.map(async (b) => [b.key, b.brandId ? await dailySeries(range, { brandId: b.brandId }) : []] as const)),
  ]);
  const seriesOf = new Map([...campaignSeries, ...creativeSeries]);
  const inPeriod = <T extends { date: string }>(pts: T[]): T[] => pts.filter((p) => p.date >= period.start);

  // Références de coût par (marque, résultat) sur la période, par la définition officielle.
  const brandAvg = new Map<string, ReturnType<typeof brandAverages>>();
  for (const b of brandsCur) brandAvg.set(b.brandId ?? "none", brandAverages(campaigns.filter((c) => (c.brandId ?? "none") === (b.brandId ?? "none"))));
  const brandRefCost = new Map<string, number | null>();
  for (const b of brandsCur) brandRefCost.set(`${b.brandId ?? "none"}|${b.resultKind}`, b.costPerResult);
  const stockTightOf = (productId: string | null) => {
    const st = productId ? stocks.find((x) => x.productId === productId) : undefined;
    return st && isUnderTension(st, settings) ? st.name : null;
  };
  const prevCampaign = new Map(prevComparable ? campaignsPrev.map((c) => [c.key, comparableRef(c, t.minSpend)]) : []);
  const prevCreative = new Map(prevComparable ? creativesPrev.map((c) => [c.key, comparableRef(c, t.minSpend)]) : []);

  const analyze = (e: EntityPerf, prev: EntityPerf | null, peers: EntityPerf[]) => {
    const series = seriesOf.get(e.key) ?? [];
    const kind = e.resultKind;
    const trend = trendOf(inPeriod(series), "costPerResult", kind);
    const stability = stabilityOf(inPeriod(series), kind);
    const fatigue: Fatigue | null = series.length ? fatigueOf(series, kind, s) : null;
    const benchmark: Benchmark = benchmarkFor(e, {
      previous: prev, brandRows: peers.filter((p) => p.brandId === e.brandId), objectiveRows: peers.filter((p) => p.objective === e.objective),
      brandHistory: e.brandId ? historyByBrand.get(e.brandId) ?? [] : [], productHistory: e.productId ? historyByProduct.get(e.productId) ?? [] : [], minSpend: s.winnerMinSpend,
    });
    const refCost = brandRefCost.get(`${e.brandId ?? "none"}|${kind}`) ?? benchmark.historical.costPerResult;
    const winner = classify(e, refCost ?? null, trend, fatigue, stability, s, t, todayIso);
    const rec = recommend({ entity: e, previous: prev, brandAvg: brandAvg.get(e.brandId ?? "none") ?? null, benchmark, fatigue, trend, stability, winner, stockTight: stockTightOf(e.productId), isActive: isActive(e) }, s, t);
    return { trend, stability, fatigue, benchmark, winner, rec };
  };

  const winnerVerdicts: Record<string, WinnerVerdict> = {};
  const recs: Recommendation[] = [];
  for (const c of campaigns) {
    const a = analyze(c, prevCampaign.get(c.key) ?? null, campaigns);
    winnerVerdicts[`campaign:${c.key}`] = a.winner;
    if (isActive(c) || c.spend >= t.minSpend) recs.push(a.rec);
  }
  const creativeHealth: CommandCenterData["creativeHealth"] = [];
  const winnersByProduct = new Map<string, WinnerVerdict[]>();
  for (const c of creatives) {
    const a = analyze(c, prevCreative.get(c.key) ?? null, creatives);
    winnerVerdicts[`creative:${c.key}`] = a.winner;
    if (c.productId) winnersByProduct.set(c.productId, [...(winnersByProduct.get(c.productId) ?? []), a.winner]);
    if (isActive(c) || a.winner.cls === "FATIGUING") creativeHealth.push({ ...c, fatigue: a.fatigue ?? { status: "INSUFFICIENT", frequency: c.frequency, ctrDeltaPct: null, cpcDeltaPct: null, cpmDeltaPct: null, costDeltaPct: null, reasons: [] }, trend: a.trend });
    // Une créative fatiguée mérite l'Action Center même si sa campagne semble stable.
    if (a.fatigue?.status === "FATIGUING" && isActive(c)) recs.push({ ...a.rec, id: `creative:${c.key}`, title: `${(c.brandName ?? "SANS MARQUE").toUpperCase()} — créative « ${c.campaignName.slice(0, 60)} »` });
  }
  for (const p of products) winnerVerdicts[`product:${p.key}`] = classify(p, brandRefCost.get(`${p.brandId ?? "none"}|${p.resultKind}`) ?? null, { direction: "unknown", pct: null, points: 0 }, null, null, s, t, todayIso);

  // Résultat majoritaire (en dépense) de la période : c'est lui que suivent le snapshot, la santé et les anomalies.
  const kindSpend = new Map<string, number>();
  for (const c of campaigns) kindSpend.set(c.resultKind, (kindSpend.get(c.resultKind) ?? 0) + c.spend);
  const mainKind = ([...kindSpend.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? kindOfSeries(null, totalSeries)) as EntityPerf["resultKind"];

  // Allocation par marque, tendance par marque (sur le résultat officiel de la marque, pas un résultat deviné).
  const brandKind = new Map(brandsCur.map((b) => [b.key, b.resultKind]));
  const brandTrends = new Map<string, Trend>(brandSeries.map(([k, ser]) => [k, trendOf(ser, "costPerResult", brandKind.get(k) ?? mainKind)]));
  const allocation = allocationOf(brandsCur, prevComparable ? brandsPrev.filter((b) => comparableRef(b, t.minSpend)) : [], brandHistKey, brandTrends, s, t);

  // Quoi pousser, quoi publier, mémoire.
  const push = pushOf(products, productsAll, brandRefCost, winnersByProduct, stocks, settings);
  const patterns = patternsOf(creativesAll, s);
  const content = opportunitiesOf(patterns, push, creatives.filter(isActive), s, now);
  const memoryFresh = memoryOf({ patterns, allocation, push, productsAll, historyByBrand, brandNames, s, now });
  if (opts.persist !== false && !brandId && memoryFresh.length) await persistMemory(memoryFresh);
  const memory = memoryFresh.length ? memoryFresh.slice(0, 12) : memoryStored.slice(0, 12);

  // Anomalies (compte ou marque), tendance et stabilité globales.
  const anomalies: Anomaly[] = anomaliesOf(totalSeries, mainKind, brandId ? brandNames.get(brandId) ?? "Marque" : "Tous comptes", s);
  const periodSeries = inPeriod(totalSeries);
  const totalTrend = trendOf(periodSeries, "costPerResult", mainKind);
  const totalStability = stabilityOf(periodSeries, mainKind);

  // Snapshot.
  const spend = campaigns.reduce((a, c) => a + c.spend, 0);
  const spendPrev = campaignsPrev.reduce((a, c) => a + c.spend, 0);
  const resultsOf = (rows: EntityPerf[]) => rows.filter((c) => c.resultKind === mainKind).reduce((a, c) => a + c.results, 0);
  const spendOfKind = (rows: EntityPerf[]) => rows.filter((c) => c.resultKind === mainKind).reduce((a, c) => a + c.spend, 0);
  const results = resultsOf(campaigns); const resultsPrev = prevComparable ? resultsOf(campaignsPrev) : 0;
  const costCur = results > 0 ? (mainKind === "reach" ? (spendOfKind(campaigns) / results) * 1000 : spendOfKind(campaigns) / results) : null;
  const costPrev = resultsPrev > 0 ? (mainKind === "reach" ? (spendOfKind(campaignsPrev) / resultsPrev) * 1000 : spendOfKind(campaignsPrev) / resultsPrev) : null;
  const sumOf = (k: keyof Pick<EntityPerf, "messagingStarted" | "landingPageViews" | "impressions" | "reach" | "revenue">) => campaigns.reduce((a, c) => a + (c[k] as number), 0);
  const clicks = campaigns.reduce((a, c) => a + (c.linkClicks || c.clicks), 0);
  const revenue = sumOf("revenue");

  // Budget du mois (journées closes) et impact business.
  const monthClosed = monthSeries.filter((p) => !p.partial);
  const budget = budgetOf(monthClosed.reduce((a, p) => a + p.spend, 0), monthClosed.length, now, settings);
  const [sellIn, sellInPrev] = await Promise.all([
    salesTotals(period.start, period.end, brandId ? { brandId } : {}).catch(() => null),
    salesTotals(period.prev.start, period.prev.end, brandId ? { brandId } : {}).catch(() => null),
  ]);
  const valuePer = s.valuePerResult[mainKind];
  const estimatedValue = valuePer && results > 0 ? results * valuePer : null;
  const impact: BusinessImpact = {
    spend, results, resultKind: mainKind, costPerResult: costCur, measuredRevenue: revenue, roas: spend > 0 && revenue > 0 ? revenue / spend : null,
    sellIn: sellIn?.amount ?? null, sellInPrev: sellInPrev?.amount ?? null, sellInDeltaPct: pct(sellIn?.amount ?? null, sellInPrev?.amount ?? null),
    spendToSalesPct: sellIn && sellIn.amount > 0 ? (spend / sellIn.amount) * 100 : null,
    estimatedValue, contribution: estimatedValue !== null ? estimatedValue - spend : null,
    notes: [
      revenue > 0 ? "CA mesuré : valeur de conversion remontée par la régie." : "Aucun CA attribué : la régie ne remonte aucune valeur de conversion (pas de pixel d'achat).",
      sellIn ? "Sell-in Sage de la marque sur la période : corrélation observée, jamais une attribution." : "Sell-in indisponible sur la période.",
      estimatedValue === null ? `Contribution non mesurable : aucune valeur par ${RESULT_LABELS[mainKind].one} saisie (Paramètres → adsIntel.valuePerResult).` : `Valeur estimée à ${valuePer} MAD par ${RESULT_LABELS[mainKind].one} (réglage saisi, pas une mesure).`,
    ],
  };

  const activeWinners = campaigns.filter((c) => isActive(c) && winnerVerdicts[`campaign:${c.key}`]?.cls === "WINNER").length
    + creatives.filter((c) => isActive(c) && winnerVerdicts[`creative:${c.key}`]?.cls === "WINNER").length;
  const fatiguing = creativeHealth.filter((c) => c.fatigue.status === "FATIGUING").length;
  const health = healthOf({ brands: allocation, totalSpend: spend, trend: totalTrend, budget, stability: totalStability, winners: activeWinners, fatiguing, anomalies, recs, closedRows: bounds.closedRows, minSpend: t.minSpend, creatives: creativeHealth });

  const rank = (level: "campaign" | "creative" | "product", rows: EntityPerf[]) =>
    [...rows].filter((r) => level !== "product" || r.productId).filter((r) => { const w = winnerVerdicts[`${level}:${r.key}`]; return w && w.cls !== "INSUFFICIENT_DATA" && w.cls !== "UNDERPERFORMING"; })
      .sort((a, b) => (winnerVerdicts[`${level}:${b.key}`]?.score ?? 0) - (winnerVerdicts[`${level}:${a.key}`]?.score ?? 0)).slice(0, 3);
  const problems = [...campaigns, ...creatives].filter((r) => { const w = winnerVerdicts[`${r.level}:${r.key}`]; return w && (w.cls === "UNDERPERFORMING" || w.cls === "FATIGUING"); })
    .sort((a, b) => b.spend - a.spend).slice(0, 4);

  const unavailableMonths = backfill.flatMap((b) => b.gaps.map((g) => g.month));
  const lastOk = sync.lastSuccessfulSync ?? sync.accounts.reduce<string | null>((a, x) => (x.status === "OK" && x.lastSyncAt && (!a || x.lastSyncAt > a) ? x.lastSyncAt : a), null);
  const data: DataStatus = {
    connected: sync.accounts.length > 0,
    verdict: !sync.accounts.length ? "NONE" : sync.accounts.every((a) => a.status === "ERROR") ? "DOWN" : sync.accounts.some((a) => a.status === "ERROR") || (lastOk !== null && Date.now() - new Date(lastOk).getTime() > 6 * 3600e3) ? "DEGRADED" : "LIVE",
    lastSuccessfulSync: lastOk, lastSyncError: sync.accounts.find((a) => a.error)?.error ?? sync.lastSyncError,
    accounts: sync.accounts, historyFirstDay: bounds.firstDay, historyLastDay: bounds.lastDay, closedRows: bounds.closedRows,
    backfill: backfill.map((b) => ({ name: b.name, status: b.status, cursor: b.cursor, gaps: b.gaps })), unavailableMonths: [...new Set(unavailableMonths)].sort(),
  };

  return {
    period: { key: period.key, start: period.start, end: period.end, label: period.label, prevLabel: prevComparable ? period.prevLabel : "pas encore comparable (source différente)", days: period.days },
    brandId,
    brands: brandsList.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name, color: b.color })),
    health,
    snapshot: {
      spend, spendDelta: prevComparable ? pct(spend, spendPrev) : null, results, resultsDelta: prevComparable ? pct(results, resultsPrev) : null, resultKind: mainKind, resultLabel: RESULT_LABELS[mainKind].many,
      costPerResult: costCur, costDelta: prevComparable && resultsPrev >= MIN_REF_RESULTS ? pct(costCur, costPrev) : null, costLabel: RESULT_LABELS[mainKind].cost,
      messages: sumOf("messagingStarted"), landing: sumOf("landingPageViews"), clicks, impressions: sumOf("impressions"), reach: sumOf("reach"),
      revenue, roas: spend > 0 && revenue > 0 ? revenue / spend : null, activeCampaigns: campaigns.filter(isActive).length,
    },
    actions: topActions(recs, 5),
    allActions: [...recs].sort((a, b) => b.priority - a.priority),
    allocation: allocation.sort((a, b) => b.spend - a.spend),
    winners: { campaigns: rank("campaign", campaigns), creatives: rank("creative", creatives), products: rank("product", products), offers: patterns.filter((p) => p.dimension === "offer").slice(0, 3) },
    problems,
    winnerVerdicts,
    push: push.slice(0, 8),
    content,
    patterns: patterns.slice(0, 40),
    creativeHealth: creativeHealth.sort((a, b) => b.spend - a.spend).slice(0, 8),
    anomalies: anomalies.slice(0, 5),
    budget,
    impact,
    memory,
    data,
    entities: { campaigns, ads, creatives, products },
    thresholds: { minSpend: t.minSpend, minDays: t.minDays, winnerMinSpend: s.winnerMinSpend, winnerMinDays: s.winnerMinDays },
  };
}

/** Détail d'une entité pour le drawer : sous-objets, série, benchmark, historique mensuel, recommandation. */
export async function entityDetail(level: EntityLevel, externalId: string, periodKey?: string, custom?: { start?: string; end?: string }): Promise<EntityDetail | null> {
  const settings = await getSettings();
  const s = settings.adsIntel; const t = settings.ads;
  const now = today();
  const period = resolveAdsPeriod(periodKey, custom, now);
  const range: Range = { start: period.start, end: period.end };
  const filterKey: PerfFilter =
    level === "campaign" ? { externalCampaignId: externalId } : level === "adset" ? { externalAdsetId: externalId } : level === "ad" ? { externalAdId: externalId }
      : level === "creative" ? { externalCreativeId: externalId } : level === "product" ? { productId: externalId } : { brandId: externalId };
  const [cur, prevRaw, children, series, months] = await Promise.all([
    perfByLevel(level, range, filterKey), perfByLevel(level, period.prev, filterKey), childrenOf(level, externalId, range),
    dailySeries({ start: iso(addDays(new Date(period.start + "T12:00:00Z"), -21)), end: period.end }, filterKey), monthlyHistory(filterKey),
  ]);
  const entity = cur[0] ?? (await perfByLevel(level, ALL, filterKey))[0];
  if (!entity) return null;
  const prev = [comparableRef(prevRaw[0], t.minSpend)].filter((x): x is EntityPerf => x !== null);
  const [peers, brandHistory, productHistory] = await Promise.all([
    perfByLevel(level === "brand" || level === "product" ? "campaign" : level, range, { brandId: entity.brandId }),
    entity.brandId ? monthlyHistory({ brandId: entity.brandId }) : Promise.resolve([]),
    entity.productId ? monthlyHistory({ productId: entity.productId }) : Promise.resolve([]),
  ]);
  const kind = entity.resultKind;
  const inPeriod = series.filter((p) => p.date >= period.start);
  const trend = trendOf(inPeriod, "costPerResult", kind);
  const stability = stabilityOf(inPeriod, kind);
  const fatigue = series.length ? fatigueOf(series, kind, s) : null;
  const benchmark = benchmarkFor(entity, { previous: prev[0] ?? null, brandRows: peers, objectiveRows: peers.filter((p) => p.objective === entity.objective), brandHistory, productHistory, minSpend: s.winnerMinSpend });
  const refCost = brandAverages(peers).costPerResult ?? benchmark.historical.costPerResult;
  const winner = classify(entity, refCost, trend, fatigue, stability, s, t, iso(now));
  const recommendation = recommend({ entity, previous: prev[0] ?? null, brandAvg: brandAverages(peers), benchmark, fatigue, trend, stability, winner, stockTight: null, isActive: entity.effectiveStatus === "ACTIVE" }, s, t);
  return {
    entity, daily: series.filter((p) => !p.partial), benchmark, fatigue, trend, winner, recommendation, children,
    history: months.map((m) => { const r = dailyResults({ ...m, date: m.month }, kind); return { month: m.month, spend: m.spend, results: r, costPerResult: r > 0 ? (kind === "reach" ? (m.spend / r) * 1000 : m.spend / r) : null }; }),
  };
}

export type HistorySearch = { q?: string; brandId?: string | null; productId?: string | null; objective?: string | null; start?: string; end?: string; level?: "campaign" | "ad" | "creative"; sort?: "spend" | "cost" | "results"; limit?: number };

/** Recherche dans l'historique complet : « les meilleurs ads Auracos de 2024 ». */
export async function searchHistory(q: HistorySearch): Promise<EntityPerf[]> {
  const range: Range = { start: q.start && /^\d{4}-\d{2}-\d{2}$/.test(q.start) ? q.start : "2000-01-01", end: q.end && /^\d{4}-\d{2}-\d{2}$/.test(q.end) ? iso(addDays(new Date(q.end + "T12:00:00Z"), 1)) : "2100-01-01" };
  const rows = await perfByLevel(q.level ?? "ad", range, { brandId: q.brandId ?? null, productId: q.productId ?? null, objective: q.objective ?? null, search: q.q ?? null });
  const sorted = q.sort === "cost" ? rows.filter((r) => r.costPerResult !== null).sort((a, b) => a.costPerResult! - b.costPerResult!)
    : q.sort === "results" ? rows.sort((a, b) => b.results - a.results) : rows;
  return sorted.slice(0, q.limit ?? 30);
}

export { metricOf };
