import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSettings } from "./settings";
import { addMonths, iso } from "./format";
import { eventApplies, observedEventRatio, type ForecastSettings, type SeasonEvent } from "./forecast-shared";

/**
 * Lectures en base autour de la prévision saisonnière. Les formules vivent dans `forecast-shared.ts` ;
 * la prévision par produit est construite par `productStocks()` (`stock.ts`). Ici : le ratio observé de
 * chaque événement dans l'historique (pour calibrer les coefficients) et le fournisseur à proposer pour
 * une marque (bouton « Commander »).
 */

export type ObservedRatio = { key: string; label: string; multiplier: number; ratio: number | null; daysIn: number; daysOut: number; products: number };

/**
 * Ratio observé par événement : ventes journalières (sell-in) des produits concernés pendant les jours
 * couverts ÷ hors de ces jours, sur `monthsBack` mois. Les jours sans vente comptent pour 0 (série
 * complète), sinon le ratio serait faussé par les jours manquants. Corrélation observée, jamais une preuve.
 */
export async function observedEventRatios(settings?: ForecastSettings, ref = new Date(), monthsBack = 36): Promise<ObservedRatio[]> {
  const s = settings ?? (await getSettings()).forecast;
  const from = iso(addMonths(ref, -monthsBack)), to = iso(ref);
  const products = (await db.execute<{ id: string; name: string; category: string | null }>(sql`select id, name, category from products where active`)).rows;
  const out: ObservedRatio[] = [];
  for (const e of s.events as SeasonEvent[]) {
    const ids = products.filter((p) => eventApplies(e, p)).map((p) => p.id);
    if (!ids.length) { out.push({ key: e.key, label: e.label, multiplier: e.multiplier, ratio: null, daysIn: 0, daysOut: 0, products: 0 }); continue; }
    const r = await db.execute<{ date: string; qty: number }>(sql`
      with days as (select generate_series(${from}::date, ${to}::date, interval '1 day')::date as d),
      sold as (select date, sum(quantity)::float8 as qty from sales where date >= ${from}::date and date <= ${to}::date
               and product_id in (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)}) group by date)
      select days.d::text as date, coalesce(sold.qty, 0) as qty from days left join sold on sold.date = days.d order by days.d`);
    const daily = r.rows.map((x) => ({ date: x.date, qty: Number(x.qty) }));
    // On ne mesure qu'à partir de la première vente de ces produits : avant, les zéros ne sont pas des jours sans vente mais des jours sans produit.
    const first = daily.findIndex((d) => d.qty > 0);
    const o = observedEventRatio(e, first < 0 ? [] : daily.slice(first));
    out.push({ key: e.key, label: e.label, multiplier: e.multiplier, ratio: o.ratio, daysIn: o.daysIn, daysOut: o.daysOut, products: ids.length });
  }
  return out;
}

export type BrandSupplier = { id: string; name: string; currency: string };

/** Fournisseur de marchandises proposé pour chaque marque (le premier actif rattaché à la marque). */
export async function suppliersByBrand(): Promise<Map<string, BrandSupplier>> {
  const r = await db.execute<{ brand_id: string; id: string; legal_name: string; currency: string }>(sql`
    select distinct on (sb.brand_id) sb.brand_id, s.id, s.legal_name, s.currency
    from supplier_brands sb join suppliers s on s.id = sb.supplier_id
    where s.active and s.nature = 'MARCHANDISES' order by sb.brand_id, s.legal_name`);
  return new Map(r.rows.map((x) => [x.brand_id, { id: x.id, name: x.legal_name, currency: x.currency }]));
}
