/**
 * Statut et risque de stock d'une référence — logique PURE, calée sur les définitions officielles.
 *
 * Rien n'est recalculé ici : la couverture vient de `productStocks()` (`stock-math.ts`), la tension de
 * `isUnderTension()`, le surstock de `isOverstock()`. Ce module ne fait que traduire ces notions dans le
 * vocabulaire de l'agent (CRITICAL / LOW / HEALTHY / OVERSTOCK, RUPTURE_RISQUE / SURSTOCK) et convertir
 * les mois en jours. Tous les seuils viennent de `settings` :
 *   CRITICAL   = niveau rouge (couverture < `coverage.orange` mois)
 *   LOW        = niveau orange (couverture < `coverage.yellow` mois)
 *   OVERSTOCK  = `isOverstock()` (couverture > `analytics.productCases.overstockMonths` sur ≥ N unités)
 *   RUPTURE_RISQUE = niveau rouge OU `isUnderTension()` (couverture < `stockTightCoverageMonths` avec rotation)
 * Sans photo de stock : UNKNOWN. Sans vente sur la fenêtre : NO_ROTATION. Jamais estimé.
 */
import { DAYS_PER_MONTH, isOverstock, isUnderTension } from "@/lib/stock-math";
import type { ProductStock } from "@/lib/stock";
import type { ComanetSettings } from "@/lib/settings";
import type { InventoryRow, StockRisk, StockStatus } from "./types";

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  CRITICAL: "critique", LOW: "bas", HEALTHY: "sain", OVERSTOCK: "surstock", NO_ROTATION: "pas de rotation", UNKNOWN: "stock non renseigné",
};
export const STOCK_RISK_LABELS: Record<StockRisk, string> = {
  RUPTURE_RISQUE: "risque de rupture", SURSTOCK: "surstock", HEALTHY: "sain", NO_ROTATION: "pas de rotation", UNKNOWN: "stock non renseigné",
};

export type StockThresholdsDays = {
  criticalBelowDays: number;
  lowBelowDays: number;
  comfortableFromDays: number;
  tensionBelowDays: number;
  tensionMinMonthlyUnits: number;
  overstockAboveDays: number;
  overstockMinUnits: number;
  avgWindowMonths: number;
};

/** Seuils Paramètres exprimés en jours (mois conventionnel de 30 jours), pour l'agent et l'écran. */
export function stockThresholdsDays(s: ComanetSettings): StockThresholdsDays {
  return {
    criticalBelowDays: s.coverage.orange * DAYS_PER_MONTH,
    lowBelowDays: s.coverage.yellow * DAYS_PER_MONTH,
    comfortableFromDays: s.coverage.green * DAYS_PER_MONTH,
    tensionBelowDays: s.stockTightCoverageMonths * DAYS_PER_MONTH,
    tensionMinMonthlyUnits: s.stockTightMinMonthlyUnits,
    overstockAboveDays: s.analytics.productCases.overstockMonths * DAYS_PER_MONTH,
    overstockMinUnits: s.analytics.productCases.overstockMinUnits,
    avgWindowMonths: s.avgSalesMonths,
  };
}

export function daysOfStock(coverageMonths: number | null): number | null {
  return coverageMonths === null || !Number.isFinite(coverageMonths) ? null : Math.round(coverageMonths * DAYS_PER_MONTH);
}

type StockLike = Pick<ProductStock, "stockKnown" | "stock" | "avgMonthly" | "coverageMonths" | "level">;

const overstockThresholds = (s: ComanetSettings) => ({ overstockMonths: s.analytics.productCases.overstockMonths, overstockMinUnits: s.analytics.productCases.overstockMinUnits });

export function stockStatusOf(p: StockLike, s: ComanetSettings): StockStatus {
  if (!p.stockKnown) return "UNKNOWN";
  if (!(p.avgMonthly > 0)) return "NO_ROTATION";
  if (p.level === "red") return "CRITICAL";
  if (p.level === "orange") return "LOW";
  if (isOverstock(p, overstockThresholds(s))) return "OVERSTOCK";
  return "HEALTHY";
}

export function stockRiskOf(p: StockLike, s: ComanetSettings): StockRisk {
  if (!p.stockKnown) return "UNKNOWN";
  if (!(p.avgMonthly > 0)) return "NO_ROTATION";
  if (p.level === "red" || isUnderTension(p, s)) return "RUPTURE_RISQUE";
  if (isOverstock(p, overstockThresholds(s))) return "SURSTOCK";
  return "HEALTHY";
}

export type SalesExtra = { unitsLast30: number | null; revenueLast30: number | null; lastSale: string | null };

export function inventoryRow(p: ProductStock, extra: SalesExtra, s: ComanetSettings, internalCosts: boolean): InventoryRow {
  return {
    productId: p.productId, sku: p.sku, name: p.name, brandId: p.brandId, brandName: p.brandName,
    stockKnown: p.stockKnown, stock: p.stockKnown ? p.stock : null, onOrder: p.onOrder, stockDate: p.stockDate,
    avgMonthly: p.avgMonthly, avgDailySales: p.avgMonthly > 0 ? p.avgMonthly / DAYS_PER_MONTH : 0,
    unitsLast30: extra.unitsLast30, revenueLast30: extra.revenueLast30, lastSale: extra.lastSale,
    daysOfStock: p.stockKnown ? daysOfStock(p.coverageMonths) : null, coverageMonths: p.stockKnown ? p.coverageMonths : null, stockoutDate: p.stockoutDate,
    recommendedOrder: p.recommendedOrder, level: p.level, status: stockStatusOf(p, s), risk: stockRiskOf(p, s),
    trendPct: p.trendPct, marginPct: internalCosts ? p.marginPct : null, stockValue: internalCosts ? p.stockValue : null,
  };
}

export type InventorySummary = {
  products: number;
  known: number;
  byStatus: Record<StockStatus, number>;
  byRisk: Record<StockRisk, number>;
  totalUnits: number;
  /** Valeur au prix d'achat des références connues ; `null` si coûts masqués. */
  stockValue: number | null;
  /** Couverture moyenne pondérée = stock total connu ÷ rotation totale, en jours (CALCULATED) ; `null` sans rotation. */
  avgDaysOfStock: number | null;
  stockDate: string | null;
};

export function inventorySummary(rows: InventoryRow[], internalCosts: boolean): InventorySummary {
  const byStatus = { CRITICAL: 0, LOW: 0, HEALTHY: 0, OVERSTOCK: 0, NO_ROTATION: 0, UNKNOWN: 0 } as Record<StockStatus, number>;
  const byRisk = { RUPTURE_RISQUE: 0, SURSTOCK: 0, HEALTHY: 0, NO_ROTATION: 0, UNKNOWN: 0 } as Record<StockRisk, number>;
  let totalUnits = 0, value = 0, rotation = 0, rotatingStock = 0;
  for (const r of rows) {
    byStatus[r.status]++;
    byRisk[r.risk]++;
    if (r.stockKnown && r.stock !== null) {
      totalUnits += r.stock;
      value += r.stockValue ?? 0;
      if (r.avgMonthly > 0) { rotation += r.avgMonthly; rotatingStock += Math.max(0, r.stock); }
    }
  }
  const known = rows.filter((r) => r.stockKnown);
  const stockDate = known.map((r) => r.stockDate).filter((d): d is string => !!d).sort().at(-1) ?? null;
  return {
    products: rows.length, known: known.length, byStatus, byRisk, totalUnits,
    stockValue: internalCosts ? value : null,
    avgDaysOfStock: rotation > 0 ? Math.round((rotatingStock / rotation) * DAYS_PER_MONTH) : null,
    stockDate,
  };
}
