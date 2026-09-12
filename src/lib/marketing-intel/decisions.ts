/**
 * Moteur de décision marketing — logique PURE (testée sans base).
 *
 * Transforme la performance produit (ventes × stock × marge × signal Ads) en recommandations
 * ACTION / POURQUOI / DONNÉES / IMPACT ATTENDU / CONFIANCE. Il ne décide jamais sur les ventes seules :
 *
 *   ventes ↑ + stock faible   → RESTOCK (ne pas accélérer la publicité avant réassort)
 *   ventes ↓ + stock élevé    → CREATE_PROMOTION / FOCUS_SELL_OUT (opportunité d'écoulement)
 *   ventes ↑ + stock élevé    → PUSH (accélération possible)
 *   ventes ↓ + stock faible   → DO_NOT_PROMOTE (problème à diagnostiquer avant de dépenser)
 *   marge faible + Ads performantes → OPTIMIZE (ne jamais scaler automatiquement)
 *   gros contributeur stable et sain → MAINTAIN
 *
 * Seuils : `settings.marketingIntel` (contribution, marge faible, volume minimal, nombre de décisions) et
 * `settings.analytics.productCases.sellingGrowthPct` (croissance). Le stock est lu tel que qualifié par
 * `inventory.ts`. Une donnée manquante baisse la confiance et n'est jamais remplacée par une estimation.
 * Le moteur recommande ; il n'exécute rien.
 */
import type { ComanetSettings } from "@/lib/settings";
import { profileThresholds } from "./performance";
import type { Confidence, Decision, Fact, MarketingAction, ProductPerf, SalesTargets } from "./types";

export const ACTION_LABELS: Record<MarketingAction, string> = {
  PUSH: "Pousser", MAINTAIN: "Maintenir", OPTIMIZE: "Optimiser avant d'investir", REDUCE: "Réduire", STOP: "Arrêter",
  RESTOCK: "Réapprovisionner avant de pousser", DO_NOT_PROMOTE: "Ne pas pousser", CREATE_CONTENT: "Créer du contenu",
  CREATE_PROMOTION: "Créer une promotion", ACTIVATE_INFLUENCER: "Activer une influenceuse", BOOST_DIGITAL: "Renforcer le digital",
  FOCUS_SELL_OUT: "Concentrer l'effort sur le sell-out",
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = { HIGH: "élevée", MEDIUM: "moyenne", LOW: "faible" };

/** Signal de l'intelligence Ads pour un produit (`recommend_products_to_push`). */
export type AdsSignal = { decision: string; costPerResult: number | null; why: string[] };

export type DecisionInputs = {
  rows: ProductPerf[];
  settings: ComanetSettings;
  brandName: string;
  /** Signal Ads par produit ; `null` = Ads non lus (droits ou données absentes). */
  ads: Map<string, AdsSignal> | null;
  targets: SalesTargets | null;
  /** Période de comparaison disponible sur le périmètre. */
  comparable: boolean;
  periodLabel: string;
};

const mad = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} MAD`;
const pct = (v: number, signed = true) => `${signed && v >= 0 ? "+" : ""}${Math.round(v * 10) / 10} %`;

function facts(p: ProductPerf, periodLabel: string): Fact[] {
  const f: Fact[] = [{ label: `CA sell-in ${periodLabel}`, value: mad(p.revenue), tag: "CONFIRMED" }];
  f.push(p.growthPct === null ? { label: "Croissance", value: "pas encore comparable", tag: "MISSING" } : { label: "Croissance vs période précédente", value: pct(p.growthPct), tag: "CALCULATED" });
  if (p.contributionPct !== null) f.push({ label: "Contribution au CA", value: pct(p.contributionPct, false), tag: "CALCULATED" });
  if (p.stock && p.stock.stockKnown) {
    f.push({ label: "Stock", value: `${p.stock.stock} unités`, tag: "CONFIRMED" });
    f.push(p.stock.daysOfStock === null ? { label: "Couverture", value: "non mesurable (pas de rotation)", tag: "MISSING" } : { label: "Couverture", value: `${p.stock.daysOfStock} jours`, tag: "CALCULATED" });
  } else f.push({ label: "Stock", value: "non renseigné", tag: "MISSING" });
  f.push(p.marginPct === null ? { label: "Marge", value: "non disponible", tag: "MISSING" } : { label: "Marge brute", value: pct(p.marginPct, false), tag: "CALCULATED" });
  return f;
}

function confidenceOf(p: ProductPerf, min: number, needsMargin: boolean): { confidence: Confidence; why: string[] } {
  const missing: string[] = [];
  if (!p.stock?.stockKnown) missing.push("stock non renseigné");
  if (p.growthPct === null) missing.push("période précédente non comparable");
  if (p.revenue < min) missing.push("volume faible sur la période");
  if (needsMargin && p.marginPct === null) missing.push("marge inconnue");
  const confidence: Confidence = missing.length === 0 ? "HIGH" : missing.length === 1 ? "MEDIUM" : "LOW";
  return { confidence, why: missing.length ? missing.map((m) => `donnée manquante : ${m}`) : ["stock, ventes et période de comparaison disponibles"] };
}

const WEIGHT: Record<Confidence, number> = { HIGH: 1, MEDIUM: 0.8, LOW: 0.6 };

function make(p: ProductPerf, i: DecisionInputs, d: { action: MarketingAction; secondary?: MarketingAction[]; title: string; why: string[]; impact: string; doNotPush?: boolean; base: number; needsMargin?: boolean }): Decision {
  const c = confidenceOf(p, i.settings.marketingIntel.minPeriodRevenueMad, !!d.needsMargin);
  return {
    key: `${d.action}:${p.productId}`, scope: "product", productId: p.productId, productName: p.name, brandName: p.brandName ?? i.brandName,
    action: d.action, secondaryActions: d.secondary ?? [], title: d.title, why: d.why.slice(0, 5), data: facts(p, i.periodLabel), expectedImpact: d.impact,
    confidence: c.confidence, confidenceWhy: c.why, doNotPush: !!d.doNotPush,
    score: (d.base + (p.contributionPct ?? 0)) * WEIGHT[c.confidence],
  };
}

/** Décision pour un produit ; `null` quand il n'y a rien à recommander (stable, sain, petit contributeur). */
export function decideProduct(p: ProductPerf, i: DecisionInputs): Decision | null {
  const s = i.settings, t = profileThresholds(s);
  const g = p.growthPct;
  const up = g !== null && g >= t.growthPct, down = g !== null && g <= -t.growthPct;
  const risk = p.stock?.risk ?? "UNKNOWN";
  const lowStock = risk === "RUPTURE_RISQUE", highStock = risk === "SURSTOCK";
  const big = p.profile === "STAR" || p.profile === "CASH_COW";
  const lowMargin = p.marginPct !== null && p.marginPct < s.marketingIntel.lowMarginPct;
  const ads = i.ads?.get(p.productId) ?? null;
  const adsPush = !!ads && (ads.decision === "PUSH" || ads.decision === "PUSH_MORE");
  const days = p.stock?.daysOfStock;
  const growthWhy = g === null ? "croissance non mesurable (pas de période comparable)" : `sell-in ${pct(g)} vs période précédente`;
  const stockWhy = p.stock?.stockKnown ? (days === null ? "stock connu mais sans rotation" : `${days} jours de couverture (stock ${p.stock.stock} unités)`) : "stock non renseigné";
  const contribWhy = p.contributionPct !== null ? `${pct(p.contributionPct, false)} du CA du périmètre` : null;

  if (p.profile === "INSUFFICIENT_DATA" && !lowStock && !highStock) return null;

  if (lowStock) {
    if (down) return make(p, i, {
      action: "DO_NOT_PROMOTE", secondary: ["RESTOCK"], title: "Diagnostiquer avant d'agir", doNotPush: true, base: 60,
      why: [growthWhy, stockWhy, "ventes en baisse ET stock court : la baisse peut venir de la disponibilité, pas de la demande", ...(p.stock?.stockoutDate ? [`rupture prévisible le ${p.stock.stockoutDate}`] : [])],
      impact: "Éviter de dépenser sur un produit dont la baisse peut être mécanique (rupture, distribution). Vérifier sell-out terrain, disponibilité chez les grossistes et prix avant toute action.",
    });
    return make(p, i, {
      action: "RESTOCK", secondary: ["DO_NOT_PROMOTE"], title: "Réapprovisionner avant toute accélération", doNotPush: true, base: up || big ? 100 : 75,
      why: [growthWhy, stockWhy, ...(contribWhy ? [contribWhy] : []), ...(p.stock?.stockoutDate ? [`rupture prévisible le ${p.stock.stockoutDate}`] : []), ...(p.stock && p.stock.recommendedOrder > 0 ? [`commande conseillée : ${p.stock.recommendedOrder} unités`] : [])],
      impact: "Sécuriser les ventes en cours : toute publicité ou animation avant réassort transformerait la demande en ruptures chez les clients.",
    });
  }

  if (highStock) {
    if (up) return make(p, i, {
      action: "PUSH", secondary: adsPush ? ["BOOST_DIGITAL"] : ["CREATE_CONTENT", "BOOST_DIGITAL"], title: "Accélérer : demande en hausse et stock long", base: 85,
      why: [growthWhy, stockWhy, ...(contribWhy ? [contribWhy] : []), ...(adsPush ? ["l'intelligence Ads le classe déjà à pousser"] : [])],
      impact: "Augmentation probable du sell-out et réduction du stock immobilisé, sans risque de rupture à court terme.",
    });
    return make(p, i, {
      action: down ? "CREATE_PROMOTION" : "FOCUS_SELL_OUT", secondary: down ? ["FOCUS_SELL_OUT", "CREATE_CONTENT"] : ["CREATE_PROMOTION", "ACTIVATE_INFLUENCER"],
      title: down ? "Surstock et ventes en baisse : opportunité d'écoulement" : "Surstock : écouler avant de pousser du neuf", base: down ? 70 : 55,
      why: [stockWhy, growthWhy, ...(contribWhy ? [contribWhy] : []), "le stock couvre largement la demande : une offre ciblée ou une animation ne créera pas de rupture"],
      impact: "Écouler le surstock (offre pharmacien, animation, contenu) et libérer de la trésorerie ; mesurer sur le sell-in des 30 jours suivants.",
    });
  }

  if (lowMargin && (adsPush || up)) return make(p, i, {
    action: "OPTIMIZE", secondary: ["MAINTAIN"], title: "Marge faible : ne pas scaler automatiquement", base: 50, needsMargin: true,
    why: [`marge brute ${pct(p.marginPct as number, false)} sous le seuil de ${s.marketingIntel.lowMarginPct} %`, growthWhy, ...(adsPush ? ["l'intelligence Ads le classe à pousser"] : []), stockWhy],
    impact: "Protéger la rentabilité : revoir prix, remise ou coût par résultat avant d'augmenter les budgets.",
  });

  if (up) return make(p, i, {
    action: "PUSH", secondary: adsPush ? ["BOOST_DIGITAL"] : ["CREATE_CONTENT"], title: "Pousser : ventes en hausse, stock disponible", base: 80, needsMargin: false,
    why: [growthWhy, stockWhy, ...(contribWhy ? [contribWhy] : []), ...(p.marginPct !== null ? [`marge brute ${pct(p.marginPct, false)}`] : []), ...(adsPush ? ["l'intelligence Ads le classe déjà à pousser"] : [])],
    impact: "Augmentation probable du sell-out et des commandes ; surveiller la couverture après deux semaines.",
  });

  if (down) return make(p, i, {
    action: "OPTIMIZE", secondary: ["CREATE_CONTENT", "FOCUS_SELL_OUT"], title: "Comprendre la baisse avant de dépenser", base: 45,
    why: [growthWhy, stockWhy, ...(contribWhy ? [contribWhy] : []), "stock sain : la baisse ne vient pas de la disponibilité"],
    impact: "Identifier la cause (concurrence, prix, saisonnalité, clients perdus) avant d'investir ; comparer avec le sell-out terrain et les clients de la marque.",
  });

  if (big) return make(p, i, {
    action: "MAINTAIN", secondary: [], title: "Maintenir : gros contributeur stable", base: 20,
    why: [...(contribWhy ? [contribWhy] : []), growthWhy, stockWhy],
    impact: "Conserver le niveau d'activité actuel ; ne pas cannibaliser avec des promotions.",
  });

  return null;
}

/** Décision de niveau marque à partir des objectifs (écart au mois et à l'année). */
export function decideBrand(i: DecisionInputs): Decision | null {
  const t = i.targets;
  if (!t || t.monthly.objective === null) return null;
  const m = t.monthly;
  if (m.forecastRunRate === null || m.forecastGap === null || m.forecastGap <= 0) return null;
  const data: Fact[] = [
    { label: `Objectif du mois ${t.month}/${t.year}`, value: mad(m.objective as number), tag: "CONFIRMED" },
    { label: "Réalisé à date", value: `${mad(m.realized)} (${pct(m.pct ?? 0, false)})`, tag: "CONFIRMED" },
    { label: "Projection fin de mois au rythme actuel", value: mad(m.forecastRunRate), tag: "CALCULATED" },
    { label: "Écart projeté", value: mad(m.forecastGap), tag: "CALCULATED" },
  ];
  return {
    key: `FOCUS_SELL_OUT:brand`, scope: "brand", productId: null, productName: null, brandName: i.brandName,
    action: "FOCUS_SELL_OUT", secondaryActions: ["PUSH"], title: "Écart à l'objectif du mois",
    why: [`réalisé ${mad(m.realized)} sur ${mad(m.objective as number)} au jour ${m.dayOfMonth}/${m.daysInMonth}`, `projection ${mad(m.forecastRunRate)} au rythme actuel, soit un écart de ${mad(m.forecastGap)}`, "l'écart se comble d'abord sur les produits PUSH ci-dessus, jamais sur ceux en risque de rupture"],
    data, expectedImpact: "Réduire l'écart à l'objectif en concentrant l'effort commercial et marketing sur les produits disponibles et en croissance.",
    confidence: "MEDIUM", confidenceWhy: ["projection linéaire au rythme courant : les commandes grossistes sont irrégulières (cadence 2 semaines)"], doNotPush: false, score: 65,
  };
}

export type DecisionSet = { decisions: Decision[]; doNotPush: Decision[]; considered: number; notes: string[] };

export function decide(i: DecisionInputs): DecisionSet {
  const notes: string[] = [];
  if (!i.comparable) notes.push("Aucune période précédente comparable : les croissances ne sont pas mesurables, la confiance est abaissée.");
  if (i.ads === null) notes.push("Signal Ads non lu (droits ou données absentes) : les décisions ne tiennent pas compte des campagnes.");
  const all = i.rows.map((p) => decideProduct(p, i)).filter((d): d is Decision => d !== null);
  const brand = decideBrand(i);
  const ranked = [...all, ...(brand ? [brand] : [])].sort((a, b) => b.score - a.score);
  const limit = Math.max(1, i.settings.marketingIntel.maxDecisions);
  const doNotPush = ranked.filter((d) => d.doNotPush);
  const decisions = ranked.filter((d) => !d.doNotPush).slice(0, limit);
  if (all.length === 0) notes.push("Aucun produit ne justifie une action : ventes stables et stock sain, ou données insuffisantes.");
  return { decisions, doNotPush: doNotPush.slice(0, limit), considered: i.rows.length, notes };
}
