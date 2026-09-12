/**
 * Performance produit — logique PURE : croissance, contribution, profil commercial, catégorie, top SKU.
 *
 * Profil commercial d'un produit sur la période (seuils : `settings.marketingIntel` et
 * `settings.analytics.productCases.sellingGrowthPct`) :
 *  - INSUFFICIENT_DATA : CA sous `minPeriodRevenueMad` sur la période ET sur la période précédente ;
 *  - UNDERPERFORMER    : baisse d'au moins `sellingGrowthPct` % vs période précédente ;
 *  - STAR              : contribution ≥ `starContributionPct` % ET croissance ≥ `sellingGrowthPct` % ;
 *  - GROWTH            : croissance ≥ seuil, contribution sous le seuil ;
 *  - CASH_COW          : contribution ≥ seuil, croissance sous le seuil (stable ou légère baisse) ;
 *  - STABLE            : le reste.
 * Sans période comparable (aucune vente Sage sur la fenêtre précédente), la croissance est `null` : le produit
 * n'est jamais STAR / GROWTH / UNDERPERFORMER — seulement CASH_COW ou STABLE — et la raison le dit.
 * La catégorie finale fait primer le stock : STOCK_RISK et OVERSTOCK changent l'action, pas le profil.
 */
import type { DimRow } from "@/lib/analytics";
import type { ProductRow } from "@/lib/products";
import type { ComanetSettings } from "@/lib/settings";
import { marginPct as officialMargin } from "@/lib/stock-math";
import type { InventoryRow, ProductCategory, ProductPerf, SalesProfile, StockRisk } from "./types";

export const PROFILE_LABELS: Record<SalesProfile, string> = {
  STAR: "star (gros contributeur en croissance)", GROWTH: "en croissance", CASH_COW: "cash cow (gros contributeur stable)",
  UNDERPERFORMER: "en baisse", STABLE: "stable", INSUFFICIENT_DATA: "données insuffisantes",
};
export const CATEGORY_LABELS: Record<ProductCategory, string> = { ...PROFILE_LABELS, STOCK_RISK: "risque de rupture", OVERSTOCK: "surstock" };

export function growthPct(cur: number, prev: number | null): number | null {
  if (prev === null || !(prev > 0)) return null;
  return ((cur - prev) / prev) * 100;
}

export type ProfileThresholds = { starContributionPct: number; minPeriodRevenueMad: number; growthPct: number };

export function profileThresholds(s: ComanetSettings): ProfileThresholds {
  return { starContributionPct: s.marketingIntel.starContributionPct, minPeriodRevenueMad: s.marketingIntel.minPeriodRevenueMad, growthPct: s.analytics.productCases.sellingGrowthPct };
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 10) / 10} %`;
const mad = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} MAD`;

export function salesProfileOf(input: { revenue: number; revenuePrev: number | null; growthPct: number | null; contributionPct: number | null }, t: ProfileThresholds): { profile: SalesProfile; reasons: string[] } {
  const reasons: string[] = [];
  const g = input.growthPct;
  const big = input.contributionPct !== null && input.contributionPct >= t.starContributionPct;
  if (input.revenue < t.minPeriodRevenueMad && (input.revenuePrev === null || input.revenuePrev < t.minPeriodRevenueMad)) {
    reasons.push(`CA ${mad(input.revenue)} sous le minimum de ${mad(t.minPeriodRevenueMad)} sur la période : pas de lecture possible`);
    return { profile: "INSUFFICIENT_DATA", reasons };
  }
  if (g === null) reasons.push("pas de période précédente comparable : croissance non mesurable");
  else reasons.push(`sell-in ${pct(g)} vs période précédente`);
  if (input.contributionPct !== null) reasons.push(`${Math.round(input.contributionPct * 10) / 10} % du CA du périmètre`);
  if (g !== null && g <= -t.growthPct) return { profile: "UNDERPERFORMER", reasons };
  if (big && g !== null && g >= t.growthPct) return { profile: "STAR", reasons };
  if (g !== null && g >= t.growthPct) return { profile: "GROWTH", reasons };
  if (big) return { profile: "CASH_COW", reasons };
  return { profile: "STABLE", reasons };
}

export function categoryOf(profile: SalesProfile, risk: StockRisk | null | undefined): ProductCategory {
  if (risk === "RUPTURE_RISQUE") return "STOCK_RISK";
  if (risk === "SURSTOCK") return "OVERSTOCK";
  return profile;
}

export type PerfInputs = {
  /** Ventes par produit sur la période et sur la période précédente (`null` = non comparable). */
  cur: DimRow[];
  prev: DimRow[] | null;
  catalog: ProductRow[];
  inventory: Map<string, InventoryRow> | null;
  /** CA total du périmètre sur la période (dénominateur de la contribution). */
  scopeRevenue: number;
  settings: ComanetSettings;
  internalCosts: boolean;
};

/** Assemble la performance de chaque produit ayant vendu (période ou précédente) ou ayant du stock connu. */
export function buildProductPerfRows(i: PerfInputs): ProductPerf[] {
  const t = profileThresholds(i.settings);
  const curMap = new Map(i.cur.map((r) => [r.id, r]));
  const prevMap = new Map((i.prev ?? []).map((r) => [r.id, r]));
  const catMap = new Map(i.catalog.map((p) => [p.id, p]));
  const ids = new Set<string>([...curMap.keys(), ...prevMap.keys()]);
  if (i.inventory) for (const [id, r] of i.inventory) if (r.stockKnown && (r.stock ?? 0) > 0) ids.add(id);
  const out: ProductPerf[] = [];
  for (const id of ids) {
    const c = curMap.get(id), p = prevMap.get(id), cat = catMap.get(id), st = i.inventory?.get(id) ?? null;
    if (!c && !p && !cat) continue;
    const revenue = c?.amount ?? 0, units = c?.quantity ?? 0;
    const revenuePrev = i.prev === null ? null : (p?.amount ?? 0);
    const unitsPrev = i.prev === null ? null : (p?.quantity ?? 0);
    const g = growthPct(revenue, revenuePrev);
    const contributionPct = i.scopeRevenue > 0 ? (revenue / i.scopeRevenue) * 100 : null;
    const margin = i.internalCosts ? (st?.marginPct ?? (cat ? officialMargin(cat.costPrice, cat.priceWholesale) : null)) : null;
    const { profile, reasons } = salesProfileOf({ revenue, revenuePrev, growthPct: g, contributionPct }, t);
    if (st && st.risk === "RUPTURE_RISQUE") reasons.push(st.daysOfStock === null ? "stock en rupture" : `${st.daysOfStock} jours de stock : risque de rupture`);
    if (st && st.risk === "SURSTOCK") reasons.push(`${st.daysOfStock} jours de stock : surstock`);
    if (st && !st.stockKnown) reasons.push("stock non renseigné");
    out.push({
      productId: id, sku: cat?.sku ?? st?.sku ?? null, name: c?.name ?? p?.name ?? cat?.name ?? st?.name ?? id,
      brandId: cat?.brandId ?? st?.brandId ?? null, brandName: cat?.brandName ?? st?.brandName ?? c?.extra ?? null,
      revenue, units, orders: c?.orders ?? 0, clients: c?.clients ?? 0, revenuePrev, unitsPrev,
      growthPct: g, unitsGrowthPct: growthPct(units, unitsPrev), contributionPct, marginPct: margin,
      revenue12: cat?.revenue12 ?? 0, units12: cat?.qty12 ?? 0, clients12: cat?.clients12 ?? 0, units3: cat?.qty3 ?? 0, unitsPrev3: cat?.qtyPrev3 ?? 0,
      trend3Pct: cat ? growthPct(cat.qty3, cat.qtyPrev3) : null, lastSale: cat?.lastSale ?? st?.lastSale ?? null,
      stock: st, profile, category: categoryOf(profile, st?.risk), reasons,
    });
  }
  return out.sort((a, b) => b.revenue - a.revenue || b.revenue12 - a.revenue12);
}

export type TopMetric = "revenue" | "units" | "growth" | "margin";

export function topSkus(rows: ProductPerf[], metric: TopMetric, limit: number): ProductPerf[] {
  const key = (r: ProductPerf) => metric === "revenue" ? r.revenue : metric === "units" ? r.units : metric === "growth" ? (r.growthPct ?? -Infinity) : (r.marginPct ?? -Infinity);
  const eligible = metric === "growth" ? rows.filter((r) => r.growthPct !== null && r.profile !== "INSUFFICIENT_DATA") : metric === "margin" ? rows.filter((r) => r.marginPct !== null) : rows;
  return [...eligible].sort((a, b) => key(b) - key(a)).slice(0, Math.max(1, limit));
}
