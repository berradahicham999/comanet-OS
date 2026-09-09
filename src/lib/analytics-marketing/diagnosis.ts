/**
 * Verdict par canal × marque — logique PURE (testée sans base).
 *
 * Les canaux de régie (Meta, TikTok, Google) gardent le moteur officiel `diagnose()` de
 * `src/lib/ads.ts` avec `settings.ads` : ce module l'appelle, il ne le recopie pas. Les autres
 * canaux suivent une règle générique sur le coût par résultat, lue dans `settings.analytics
 * .channelDiagnosis`, et l'animation en point de vente une règle de rentabilité explicite :
 * sell-out TTC ÷ coût (multiple attendu dans Paramètres). Chaque verdict dit d'abord POURQUOI,
 * puis QUOI FAIRE. Sans volume suffisant, le verdict est WATCH — jamais déguisé en « stable ».
 */
import { animationMinMultipleOf, type AnalyticsSettings, type AdThresholds } from "@/lib/settings";
import { diagnose, kpis, type AdRow } from "@/lib/ads";
import type { AdVerdict } from "@/lib/marketing-shared";
import type { Aggregate } from "./metrics";
import { ratio, type ResultKey } from "./shared";

export type ChannelVerdict = {
  verdict: AdVerdict;
  headline: string;
  why: string;
  actions: string[];
  /** Coût par résultat retenu (et la clé de résultat utilisée), s'il est calculable. */
  costPerResult: { value: number; key: ResultKey; prev: number | null; portfolio: number | null } | null;
  /** Modèle appliqué. */
  engine: "ADS" | "ANIMATION" | "GENERIC";
};

const fmt = (v: number) => Math.round(v).toLocaleString("fr-FR");
const pct = (cur: number | null, ref: number | null) => (cur === null || ref === null || ref === 0 ? null : ((cur - ref) / ref) * 100);
const fmtDelta = (v: number | null) => (v === null ? "n/a" : `${v > 0 ? "+" : ""}${Math.round(v)} %`);

/** Résultat propre effectif : clé principale si > 0, sinon repli si > 0, sinon null. */
export function effectiveResult(a: Aggregate, key: ResultKey | null, fallback: ResultKey | null): { key: ResultKey; value: number } | null {
  if (key && (a.results[key] ?? 0) > 0) return { key, value: a.results[key]! };
  if (fallback && (a.results[fallback] ?? 0) > 0) return { key: fallback, value: a.results[fallback]! };
  return null;
}

export type DiagnosisInput = {
  /** Agrégat canal × marque sur la période. */
  cur: Aggregate;
  /** Même périmètre, période précédente (null : indisponible). */
  prev: Aggregate | null;
  /** Le canal sur tout le portefeuille, même période (référence inter-marques). */
  portfolio: Aggregate | null;
  channel: { key: string; family: string; resultMetric: ResultKey | null; fallbackResultMetric: ResultKey | null };
  days: number;
  /** Produits poussés en tension de stock (véto sur SCALE). */
  stockTension?: string[];
};

function adRowOf(a: Aggregate, days: number, key: string): AdRow {
  const r = a.results;
  return {
    key, platform: key, campaignName: key, campaignId: null, brandId: null, brandName: null, brandColor: null,
    spend: a.spend.spent, impressions: r.IMPRESSIONS ?? 0, reach: r.REACH ?? 0, clicks: r.CLICKS ?? 0, linkClicks: r.LINK_CLICKS ?? 0,
    landingPageViews: 0, leads: r.LEADS ?? 0, purchases: r.PURCHASES ?? 0, messagingStarted: r.MESSAGES_STARTED ?? 0,
    revenue: a.attributed.revenue, days, objective: null,
  };
}

const ADS_CHANNELS = new Set(["META_ADS", "TIKTOK_ADS", "GOOGLE_ADS"]);

export function diagnoseChannel(input: DiagnosisInput, settings: AnalyticsSettings, ads: AdThresholds): ChannelVerdict {
  const { cur, prev, portfolio, channel, days } = input;
  const t = settings.channelDiagnosis;
  const res = effectiveResult(cur, channel.resultMetric, channel.fallbackResultMetric);
  const cpr = res && cur.spend.spent > 0 ? cur.spend.spent / res.value : null;
  const prevRes = prev ? effectiveResult(prev, res?.key ?? channel.resultMetric, channel.fallbackResultMetric) : null;
  const prevCpr = prevRes && prev && prev.spend.spent > 0 && prevRes.key === res?.key ? prev.spend.spent / prevRes.value : null;
  const portRes = portfolio && res ? effectiveResult(portfolio, res.key, null) : null;
  const portCpr = portRes && portfolio && portfolio.spend.spent > 0 ? portfolio.spend.spent / portRes.value : null;
  const costPerResult = cpr !== null && res ? { value: cpr, key: res.key, prev: prevCpr, portfolio: portCpr } : null;
  const veto = (v: ChannelVerdict): ChannelVerdict => {
    if (v.verdict === "SCALE" && input.stockTension?.length) {
      return { ...v, verdict: "MAINTAIN", headline: "Bonne performance, mais stock sous tension", why: `${v.why} Cependant ${input.stockTension.length} produit(s) poussé(s) sont en rupture ou sous un mois de couverture.`, actions: ["Ne pas augmenter avant réassort ; vérifier la commande conseillée dans Stock & achats.", ...v.actions.filter((a) => !/augmenter/i.test(a))] };
    }
    return v;
  };

  /* ---- Régie : moteur officiel des Ads. Campagnes « Messages » (ni achat ni lead, mais des
     conversations) : le moteur Ads conclurait STOP faute de conversion ; on juge alors sur le
     coût par conversation (règle générique), comme le fait /marketing/ads par objectif. ---- */
  const messagesOnly = (cur.results.PURCHASES ?? 0) === 0 && (cur.results.LEADS ?? 0) === 0 && (cur.results.MESSAGES_STARTED ?? 0) > 0;
  if (ADS_CHANNELS.has(channel.key) && !messagesOnly) {
    const curK = kpis(adRowOf(cur, days, channel.key));
    const refK = prev ? kpis(adRowOf(prev, days, channel.key)) : null;
    const portK = portfolio ? kpis(adRowOf(portfolio, days, channel.key)) : null;
    const d = diagnose(curK, refK, portK ? { cpa: portK.cpa, roas: portK.roas, ctr: portK.ctr } : null, ads);
    return veto({ verdict: d.verdict, headline: d.headline, why: d.diagnostic, actions: d.actions, costPerResult, engine: "ADS" });
  }

  /* ---- Volume insuffisant ---- */
  if (cur.spend.rows === 0 && !res) {
    return { verdict: "WATCH", headline: "Aucune donnée sur la période", why: "Ni dépense ni résultat enregistrés pour ce canal et cette marque.", actions: ["Rien à arbitrer ; vérifier la saisie si une action a eu lieu."], costPerResult, engine: "GENERIC" };
  }
  if (cur.spend.measurableRows === 0 && cur.spend.rows > 0) {
    return { verdict: "WATCH", headline: "Dépense non mesurable", why: `${cur.spend.rows} ligne(s) sans montant (coût non renseigné) : le coût par résultat ne peut pas être calculé.`, actions: ["Renseigner le coût ou le tarif journalier dans Paramètres → Analytics."], costPerResult, engine: "GENERIC" };
  }
  if (cur.spend.spent < t.minSpend) {
    return { verdict: "WATCH", headline: "Trop peu de dépense pour trancher", why: `${fmt(cur.spend.spent)} MAD sur la période, sous le seuil d'analyse de ${fmt(t.minSpend)} MAD.`, actions: ["Laisser tourner ou regrouper sur une période plus longue avant d'arbitrer."], costPerResult, engine: "GENERIC" };
  }

  /* ---- Animation en point de vente : rentabilité explicite ---- */
  if (channel.family === "TERRAIN") {
    const sellout = cur.results.SELLOUT_AMOUNT ?? 0;
    const multiple = ratio(sellout, cur.spend.spent);
    if (multiple === null || sellout === 0) {
      return { verdict: "STOP", headline: "Animations sans sell-out constaté", why: `${fmt(cur.spend.spent)} MAD de coût d'animation sans aucune vente en rayon enregistrée.`, actions: ["Vérifier la saisie des lignes produit par les animatrices avant de conclure.", "Si la saisie est bonne : revoir le point de vente ou le planning."], costPerResult, engine: "ANIMATION" };
    }
    const prevMultiple = prev ? ratio(prev.results.SELLOUT_AMOUNT ?? 0, prev.spend.spent) : null;
    const dm = pct(multiple, prevMultiple);
    const minMultiple = animationMinMultipleOf(settings);
    const base = `Sell-out ${fmt(sellout)} MAD TTC pour ${fmt(cur.spend.spent)} MAD de coût : ${multiple.toFixed(1)}× (attendu ≥ ${minMultiple.toFixed(1)}×${settings.animationTargetSelloutPerDay ? `, soit ${fmt(settings.animationTargetSelloutPerDay)} MAD TTC par jour` : ""}${prevMultiple !== null ? ` ; ${fmtDelta(dm)} vs période précédente` : ""}).`;
    if (multiple >= minMultiple) {
      return veto({ verdict: "SCALE", headline: `Rentable : ${multiple.toFixed(1)}× le coût`, why: base, actions: ["Augmenter les jours d'animation sur les points de vente les mieux placés.", "Vérifier la couverture de stock des produits vendus avant d'ajouter des jours."], costPerResult, engine: "ANIMATION" });
    }
    if (multiple < settings.animationStopSelloutMultiple) {
      return { verdict: "STOP", headline: `Ne couvre pas son coût : ${multiple.toFixed(1)}×`, why: base, actions: ["Arrêter ou déplacer les animations des points de vente les moins performants (voir le classement par point de vente dans Terrain).", "Revoir le brief produit et l'objectif d'unités par ville."], costPerResult, engine: "ANIMATION" };
    }
    return { verdict: "OPTIMIZE", headline: `Sous l'objectif : ${multiple.toFixed(1)}×`, why: base, actions: ["Concentrer les jours sur les points de vente au-dessus de l'objectif.", "Travailler le panier moyen (produits complémentaires) plutôt que le nombre de jours."], costPerResult, engine: "ANIMATION" };
  }

  /* ---- Générique : coût par résultat ---- */
  if (!costPerResult) {
    return { verdict: "WATCH", headline: "Dépense sans résultat mesuré", why: `${fmt(cur.spend.spent)} MAD dépensés sans résultat « ${channel.resultMetric ?? "—"} » saisi sur la période.`, actions: ["Saisir les résultats (portée, participants, contacts…) sur les actions concernées.", "Sans résultat après saisie : arrêter ou changer d'angle."], costPerResult, engine: "GENERIC" };
  }
  const dPrev = pct(costPerResult.value, costPerResult.prev);
  const vsPort = costPerResult.portfolio !== null && costPerResult.portfolio > 0 ? costPerResult.value / costPerResult.portfolio : null;
  const detail = `Coût par ${costPerResult.key.toLowerCase().replace(/_/g, " ")} : ${fmt(costPerResult.value)} MAD${dPrev !== null ? ` (${fmtDelta(dPrev)} vs période précédente)` : ""}${vsPort !== null ? `, ${vsPort.toFixed(1)}× la moyenne du canal sur le portefeuille` : ""}.`;
  if (vsPort !== null && vsPort > t.costVsPortfolioFactor) {
    return { verdict: "STOP", headline: "Coût par résultat très au-dessus des autres marques", why: detail, actions: ["Couper ou réduire ce canal pour cette marque et réallouer vers un canal moins cher au résultat.", "Comparer le format et la cible avec la marque la plus efficace sur ce canal."], costPerResult, engine: "GENERIC" };
  }
  if (dPrev !== null && dPrev > t.costRisePct) {
    return { verdict: "OPTIMIZE", headline: `Coût par résultat en hausse de ${Math.round(dPrev)} %`, why: detail, actions: ["Identifier ce qui a changé (format, prestataire, cible) et revenir à la version efficace.", "Réduire la dépense tant que le coût ne redescend pas."], costPerResult, engine: "GENERIC" };
  }
  if ((dPrev !== null && dPrev < -t.costDropPct) || (vsPort !== null && vsPort < 1 / t.costVsPortfolioFactor)) {
    return veto({ verdict: "SCALE", headline: "Coût par résultat en amélioration", why: detail, actions: [`Augmenter la dépense par paliers de ${settings.reallocation.maxShiftPct} % maximum par mois.`, "Vérifier la couverture de stock des produits poussés avant d'augmenter."], costPerResult, engine: "GENERIC" });
  }
  return { verdict: "MAINTAIN", headline: "Coût par résultat stable", why: detail, actions: ["Ne rien changer ce mois ; surveiller la tendance sur trois semaines."], costPerResult, engine: "GENERIC" };
}
