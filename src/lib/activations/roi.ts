import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { iso, today } from "@/lib/format";
import type { ActivationSettings } from "@/lib/settings";
import { pgArray } from "@/lib/sql-array";
import { activationBudget } from "./budget";
import { activationRefs } from "./refs";
import { getActivation, type ActivationDetail } from "./queries";
import type { ActivationScope } from "./access";
import { scopeSql } from "./access";
import { compareSales, measurementWindows, roiVerdict, unitCost, type SalesComparison, type VerdictResult, type WindowSales } from "./shared";

/**
 * Mesure du retour d'une activation à partir des ventes Sage déjà importées (sell-in HT).
 *
 * Périmètre des ventes comparées, du plus précis au plus large :
 *  1. les points de vente rattachés à l'activation ;
 *  2. sinon les clients actifs de la ville de l'activation ;
 *  … croisés avec les produits rattachés, sinon les produits des marques rattachées.
 * Sans point de vente ni ville, aucun impact n'est calculé (« non mesurable »), rien n'est estimé.
 * La comparaison elle-même est dans `compareSales()` (logique pure, testée).
 */
export type SalesScope = { clientIds: string[]; byCity: string | null; productIds: string[]; brandIds: string[] };

export function salesScopeOf(a: Pick<ActivationDetail, "clientIds" | "clientId" | "city" | "productIds" | "productId" | "brandIds" | "brandId">): SalesScope {
  const clientIds = [...new Set([...a.clientIds, ...(a.clientId ? [a.clientId] : [])])];
  const productIds = [...new Set([...a.productIds, ...(a.productId ? [a.productId] : [])])];
  const brandIds = [...new Set([...a.brandIds, ...(a.brandId ? [a.brandId] : [])])];
  return { clientIds, byCity: clientIds.length ? null : a.city, productIds, brandIds };
}

export type SalesImpact = {
  scope: SalesScope; scopeLabel: string;
  windows: ReturnType<typeof measurementWindows>;
  before: WindowSales; during: WindowSales; after: WindowSales;
  comparison: SalesComparison;
};

export async function salesImpact(a: ActivationDetail, settings: ActivationSettings, todayIso = iso(today())): Promise<SalesImpact | null> {
  const scope = salesScopeOf(a);
  if (!scope.clientIds.length && !scope.byCity) return null;
  const windows = measurementWindows(a.date, a.endDate, settings);
  const clientCond = scope.clientIds.length ? sql`s.client_id = any(${pgArray(scope.clientIds)})` : sql`s.client_id in (select id from clients where lower(city) = lower(${scope.byCity!}))`;
  const productCond = scope.productIds.length ? sql`s.product_id = any(${pgArray(scope.productIds)})` : scope.brandIds.length ? sql`p.brand_id = any(${pgArray(scope.brandIds)})` : sql`true`;
  const win = (w: { start: string; end: string }) => sql`(select coalesce(sum(s.quantity), 0)::float8 as qty, coalesce(sum(s.amount), 0)::float8 as amount from sales s join products p on p.id = s.product_id where ${clientCond} and ${productCond} and s.date >= ${w.start}::date and s.date < ${w.end}::date)`;
  const r = await db.execute<{ bq: number; ba: number; dq: number; da: number; aq: number; aa: number }>(sql`
    select b.qty as bq, b.amount as ba, d.qty as dq, d.amount as da, a.qty as aq, a.amount as aa
    from ${win(windows.before)} b, ${win(windows.during)} d, ${win(windows.after)} a`);
  const x = r.rows[0];
  const days = (w: { start: string; end: string }) => Math.round((new Date(w.end + "T12:00:00Z").getTime() - new Date(w.start + "T12:00:00Z").getTime()) / 86_400_000);
  const before = { days: days(windows.before), qty: x.bq, amount: x.ba };
  const during = { days: days(windows.during), qty: x.dq, amount: x.da };
  const after = { days: days(windows.after), qty: x.aq, amount: x.aa };
  const scopeLabel = `${scope.clientIds.length ? `${scope.clientIds.length} point${scope.clientIds.length > 1 ? "s" : ""} de vente` : `clients de ${scope.byCity}`} × ${scope.productIds.length ? `${scope.productIds.length} produit${scope.productIds.length > 1 ? "s" : ""}` : scope.brandIds.length ? `produits de ${scope.brandIds.length > 1 ? `${scope.brandIds.length} marques` : "la marque"}` : "tous produits"}`;
  return { scope, scopeLabel, windows, before, during, after, comparison: compareSales(before, during, after, windows.after.end, todayIso) };
}

export type ActivationRoi = {
  activation: ActivationDetail;
  budget: Awaited<ReturnType<typeof activationBudget>>;
  impact: SalesImpact | null;
  unit: { contact: number | null; sample: number | null; pharmacy: number | null };
  verdict: VerdictResult;
};

/** Fiche synthèse complète : coût, résultats, impact ventes, verdict. */
export async function activationRoi(id: string, scope: ActivationScope, settings: ActivationSettings, todayIso = iso(today())): Promise<ActivationRoi | null> {
  const refs = await activationRefs();
  const a = await getActivation(id, scope, refs, settings, todayIso);
  if (!a) return null;
  const [budget, impact] = await Promise.all([activationBudget(id), salesImpact(a, settings, todayIso)]);
  const t = budget.totals;
  const unit = { contact: unitCost(t.fullCost, a.participants), sample: unitCost(t.fullCost, a.samples), pharmacy: unitCost(t.fullCost, a.pharmaciesReached) };
  const verdict = roiVerdict({ fullCost: t.fullCost, comparison: impact?.comparison ?? null, attributedRevenue: a.attributedRevenue, hasResults: a.hasResults, hasSalesScope: !!impact, unit }, settings);
  return { activation: a, budget, impact, unit, verdict };
}

/* ------------------------------ Comparatif ------------------------------ */

export type CompareRow = {
  key: string; label: string; color: string | null;
  count: number; fullCost: number; planned: number; participants: number; samples: number; pharmacies: number; attributedRevenue: number;
  /** Activations dont la comparaison ventes est complète, et somme de leurs incréments. */
  measured: number; increment: number; roi: number | null; costPerContact: number | null;
};

/**
 * Comparatif entre activations terminées : par type, marque ou ville. L'incrément de CA est
 * recalculé activation par activation avec la même définition que la fiche synthèse.
 */
export async function compareActivations(dim: "type" | "brand" | "city", filters: { start?: string | null; end?: string | null; brand?: string | null; type?: string | null }, scope: ActivationScope, settings: ActivationSettings, todayIso = iso(today())): Promise<CompareRow[]> {
  const refs = await activationRefs();
  const ids = (await db.execute<{ id: string }>(sql`
    select a.id from activations a join activation_statuses s on s.key = a.status
    where s.is_done and not s.is_cancelled
      ${filters.start ? sql`and a.date >= ${filters.start}::date` : sql``} ${filters.end ? sql`and a.date < ${filters.end}::date` : sql``}
      ${filters.brand ? sql`and (a.brand_id = ${filters.brand}::uuid or exists (select 1 from activation_brands x where x.activation_id = a.id and x.brand_id = ${filters.brand}::uuid))` : sql``}
      ${filters.type ? sql`and a.type = ${filters.type}` : sql``}
      ${scopeSql(scope)} order by a.date desc limit 400`)).rows.map((r) => r.id);
  const rows = new Map<string, CompareRow>();
  for (const id of ids) {
    const a = await getActivation(id, scope, refs, settings, todayIso);
    if (!a) continue;
    const [budget, impact] = await Promise.all([activationBudget(id), salesImpact(a, settings, todayIso)]);
    const key = dim === "type" ? a.type : dim === "brand" ? (a.brandId ?? "—") : (a.city ?? "—");
    const label = dim === "type" ? (refs.types.find((t) => t.key === a.type)?.label ?? a.type) : dim === "brand" ? (a.brand ?? "Sans marque") : (a.city ?? "Sans ville");
    const e = rows.get(key) ?? { key, label, color: dim === "brand" ? a.color : null, count: 0, fullCost: 0, planned: 0, participants: 0, samples: 0, pharmacies: 0, attributedRevenue: 0, measured: 0, increment: 0, roi: null, costPerContact: null };
    e.count++; e.fullCost += budget.totals.fullCost; e.planned += budget.totals.planned;
    e.participants += a.participants ?? 0; e.samples += a.samples ?? 0; e.pharmacies += a.pharmaciesReached ?? 0; e.attributedRevenue += a.attributedRevenue ?? 0;
    if (impact?.comparison.comparable && impact.comparison.increment != null) { e.measured++; e.increment += impact.comparison.increment; }
    rows.set(key, e);
  }
  return [...rows.values()].map((e) => ({ ...e, roi: e.measured > 0 && e.fullCost > 0 ? e.increment / e.fullCost : null, costPerContact: unitCost(e.fullCost, e.participants) })).sort((x, y) => (y.roi ?? -Infinity) - (x.roi ?? -Infinity) || y.fullCost - x.fullCost);
}
