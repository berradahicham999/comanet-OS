/**
 * COUVERTURE DE STOCK — définition officielle et unique (arithmétique pure, testable).
 *
 * `src/lib/stock.ts` lit la base et appelle ces fonctions ; toute autre page ou règle qui a
 * besoin d'une couverture passe par `productStocks()`. Aucune seconde formule n'est admise
 * (c'est ce qui faisait diverger `/marketing/campagnes/[id]` de l'Action Center).
 *
 * ── Période de calcul de la vente moyenne ───────────────────────────────────
 *  `avgMonthly` = quantités facturées (sell-in Sage) sur les `settings.avgSalesMonths`
 *  derniers mois de 30 jours précédant la **date de référence**, divisées par ce même
 *  nombre de mois. La date de référence est celle du dernier import de ventes
 *  (`getRefDate()`), jamais « aujourd'hui » : sans cela, un import en retard ferait
 *  chuter artificiellement la moyenne. Le mois est conventionnellement de 30 jours ;
 *  aucune conversion de fuseau n'intervient, les ventes sont datées en date civile.
 *
 * ── Formules ────────────────────────────────────────────────────────────────
 *  coverageMonths  = stock ÷ avgMonthly            (null si stock inconnu ou avgMonthly = 0)
 *  targetStock     = avgMonthly × (leadTime/30 + stockSécurité/30 + 1 mois de revue)
 *  recommendedOrder= max(0, targetStock − stock − enCommande), arrondi au MOQ supérieur
 *  stockoutDate    = dateRéférence + coverageMonths × 30 jours
 *  level           = seuils `settings.coverage` (vert / jaune / orange, en dessous : rouge)
 *
 * ── Cas limites ─────────────────────────────────────────────────────────────
 *  · Aucune photo de stock         → `level = "unknown"`, couverture `null`, commande 0.
 *    On ne commande pas sur un stock qu'on ne connaît pas.
 *  · Stock à 0 avec des ventes     → couverture 0 → `red`, rupture à la date de référence.
 *  · Stock négatif (avoir, erreur) → couverture négative → `red`, et la commande conseillée
 *    couvre le déficit. La valeur n'est pas ramenée à 0 : elle signale une anomalie.
 *  · avgMonthly = 0 (aucune vente) → couverture `null`, `level = "none"` (pas de rotation),
 *    commande conseillée 0. Un produit sans rotation ne se réapprovisionne pas tout seul.
 *  · Historique plus court que la fenêtre → la moyenne est mécaniquement basse ; c'est
 *    assumé et documenté, aucune extrapolation n'est faite.
 *  · Produit ou marque inactifs    → exclus en amont par `productStocks()` (`where p.active`).
 *
 * ── Prévision saisonnière (depuis le 03/10/2026) ────────────────────────────
 *  Quand `forecast` est fourni (série de demande modélisée par `src/lib/forecast-shared.ts` : reste du mois
 *  en cours, puis mois civils entiers, et base désaisonnalisée au-delà), la couverture, la date de rupture et
 *  le stock cible se calculent en **parcourant** cette série au lieu de diviser par une moyenne plate :
 *  coverage = jours consommés avant épuisement ÷ 30 ; targetStock = demande modélisée sur
 *  (leadTime + sécurité + 30 jours). La commande conseillée garde sa formule. Sans `forecast`, la vente
 *  moyenne reste la règle (même résultat qu'avant). Une base modélisée nulle = pas de rotation.
 *
 * ── Produit « en tension » ──────────────────────────────────────────────────
 *  Un produit est en tension quand sa couverture est connue, inférieure à
 *  `settings.stockTightCoverageMonths`, et que sa rotation dépasse
 *  `settings.stockTightMinMonthlyUnits` (sous ce volume, une couverture courte n'a pas
 *  d'enjeu). C'est la définition utilisée par la règle « campagne active + produit en
 *  tension » et par le garde-fou de scaling publicitaire.
 */

import type { DemandForecast } from "./forecast-shared";

export type CoverageLevel = "green" | "yellow" | "orange" | "red" | "none" | "unknown";

export const LEVEL_LABEL: Record<CoverageLevel, string> = {
  green: "Confortable",
  yellow: "À surveiller",
  orange: "Tendu",
  red: "Critique",
  none: "Pas de rotation",
  unknown: "Stock non renseigné",
};

/** Seuils de couverture, tels que stockés dans `settings.coverage`. */
export type CoverageThresholds = { green: number; yellow: number; orange: number };

/** Jours conventionnels dans un « mois » de couverture. */
export const DAYS_PER_MONTH = 30;

export function coverageLevel(months: number | null, t: CoverageThresholds): CoverageLevel {
  if (months === null || !Number.isFinite(months)) return "none";
  if (months >= t.green) return "green";
  if (months >= t.yellow) return "yellow";
  if (months >= t.orange) return "orange";
  return "red";
}

export type CoverageInput = {
  /** Quantité en stock à la dernière photo. */
  stock: number;
  /** `false` quand aucune photo de stock n'existe pour ce produit. */
  stockKnown: boolean;
  /** Commande fournisseur déjà passée et non reçue. */
  onOrder: number;
  /** Vente moyenne mensuelle (unités), sell-in. */
  avgMonthly: number;
  leadTimeDays: number;
  safetyStockDays: number;
  moq: number | null;
  /** Demande modélisée (`demandSeries()`) ; absente = vente moyenne plate. */
  forecast?: DemandForecast | null;
};

export type { DemandForecast };

/** Jours couverts par `stock` en consommant la série puis la base (null si la base est nulle et la série épuisée). */
export function daysCovered(stock: number, f: DemandForecast): number | null {
  let left = stock, days = 0;
  for (const m of f.series) {
    if (m.days <= 0) continue;
    if (m.qty <= 0) { days += m.days; continue; }
    if (left >= m.qty) { left -= m.qty; days += m.days; continue; }
    return days + (m.days * left) / m.qty;
  }
  if (!(f.baseline > 0)) return null;
  return days + (left / f.baseline) * DAYS_PER_MONTH;
}

/** Demande modélisée sur les `days` prochains jours : série puis base au-delà. */
export function demandOver(days: number, f: DemandForecast): number {
  let left = days, qty = 0;
  for (const m of f.series) {
    if (left <= 0) break;
    if (m.days <= 0) continue;
    const take = Math.min(left, m.days);
    qty += (m.qty * take) / m.days;
    left -= take;
  }
  if (left > 0) qty += (f.baseline * left) / DAYS_PER_MONTH;
  return qty;
}

export type CoverageResult = {
  coverageMonths: number | null;
  level: CoverageLevel;
  targetStock: number;
  recommendedOrder: number;
  /** Nombre de jours avant rupture, ou `null` si non calculable. */
  daysToStockout: number | null;
};

export function computeCoverage(input: CoverageInput, t: CoverageThresholds): CoverageResult {
  const { stock, stockKnown, onOrder, avgMonthly, leadTimeDays, safetyStockDays, moq } = input;
  const f = input.forecast ?? null;
  const hasRotation = f ? Number.isFinite(f.baseline) && f.baseline > 0 : Number.isFinite(avgMonthly) && avgMonthly > 0;
  // Stock cible = délai fournisseur + stock de sécurité + 1 mois de revue.
  const targetDays = leadTimeDays + safetyStockDays + DAYS_PER_MONTH;
  const targetMonths = targetDays / DAYS_PER_MONTH;

  let coverageMonths: number | null = null;
  let targetStock = 0;
  if (f && hasRotation) {
    // Parcours de la demande modélisée ; un stock nul ou négatif garde sa lecture (0 ou déficit) via la base.
    if (stockKnown) {
      const d = stock > 0 ? daysCovered(stock, f) : stock / f.baseline * DAYS_PER_MONTH;
      coverageMonths = d === null ? null : d / DAYS_PER_MONTH;
    }
    targetStock = Math.round(demandOver(targetDays, f));
  } else if (hasRotation) {
    coverageMonths = stockKnown ? stock / avgMonthly : null;
    targetStock = Math.round(avgMonthly * targetMonths);
  }

  let recommendedOrder = stockKnown && hasRotation ? Math.max(0, targetStock - stock - onOrder) : 0;
  if (moq && moq > 0 && recommendedOrder > 0) recommendedOrder = Math.ceil(recommendedOrder / moq) * moq;

  return {
    coverageMonths,
    level: !stockKnown ? "unknown" : coverageLevel(coverageMonths, t),
    targetStock,
    recommendedOrder: Math.round(recommendedOrder),
    daysToStockout: coverageMonths === null ? null : Math.round(coverageMonths * DAYS_PER_MONTH),
  };
}

/** Tendance du dernier mois vs la moyenne, en %. `null` si la moyenne est nulle. */
export function trendPct(lastMonthQty: number | null, avgMonthly: number): number | null {
  if (lastMonthQty === null || !Number.isFinite(avgMonthly) || avgMonthly <= 0) return null;
  return ((lastMonthQty - avgMonthly) / avgMonthly) * 100;
}

/**
 * Prix réellement encaissé par unité, HT : le PPH (chez COMANET, égal au prix public TTC) ramené hors taxe, moins la
 * remise client moyenne de la fiche. Remise non renseignée = aucune remise déduite. `null` si le PPH est inconnu ou nul.
 */
export function netSellingPrice(priceWholesale: number | null, taxRatePct: number | null, avgDiscountPct: number | null): number | null {
  if (priceWholesale === null || !Number.isFinite(priceWholesale) || priceWholesale <= 0) return null;
  const ht = priceWholesale / (1 + Math.max(0, taxRatePct ?? 0) / 100);
  return ht * (1 - Math.min(100, Math.max(0, avgDiscountPct ?? 0)) / 100);
}

/** Marge brute en % du prix encaissé (`netSellingPrice()`), `null` si le coût ou le prix est inconnu ou nul. */
export function marginPct(costPrice: number | null, netPrice: number | null): number | null {
  if (costPrice === null || netPrice === null || netPrice <= 0) return null;
  return ((netPrice - costPrice) / netPrice) * 100;
}

/** Seuils de tension, tels que stockés dans `settings`. */
export type TensionThresholds = { stockTightCoverageMonths: number; stockTightMinMonthlyUnits: number };

export type TensionInput = { coverageMonths: number | null; avgMonthly: number };

/**
 * Produit « en tension » : couverture connue et courte, sur un produit qui tourne.
 * Définition unique, partagée par la règle stock/campagne et le garde-fou de scaling.
 */
export function isUnderTension(p: TensionInput, t: TensionThresholds): boolean {
  return p.coverageMonths !== null && p.coverageMonths < t.stockTightCoverageMonths && p.avgMonthly > t.stockTightMinMonthlyUnits;
}

export type OverstockThresholds = { overstockMonths: number; overstockMinUnits: number };
export type OverstockInput = { coverageMonths: number | null; stock: number };

/**
 * Produit « en surstock » : couverture connue et longue, sur un volume qui compte.
 * Définition unique, partagée par la règle stock et l'analyse marketing par produit.
 */
export function isOverstock(p: OverstockInput, t: OverstockThresholds): boolean {
  return p.coverageMonths !== null && p.coverageMonths > t.overstockMonths && p.stock >= t.overstockMinUnits;
}
