import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSettings } from "./settings";
import { addDays, addMonths, iso, today } from "./format";
import {
  computeCoverage,
  coverageLevel,
  isUnderTension,
  marginPct,
  netSellingPrice,
  trendPct,
  DAYS_PER_MONTH,
  LEVEL_LABEL,
  type CoverageLevel,
} from "./stock-math";
import { buildForecast, demandSeries, type MonthlyForecast } from "./forecast-shared";

// Les formules vivent dans `stock-math.ts` (pures et testées) ; ce fichier ne fait que lire
// la base et les appliquer. Réexportées ici : les pages importent historiquement `@/lib/stock`.
export { coverageLevel, LEVEL_LABEL, isUnderTension };
export type { CoverageLevel };

export type ProductStock = {
  productId: string;
  sku: string;
  name: string;
  brandId: string | null;
  brandName: string | null;
  brandColor: string | null;
  category: string | null;
  stock: number; // stock réel COMANET + dernières photos des dépôts externes
  stockKnown: boolean; // false = ni mouvement dans le journal, ni photo d'un dépôt externe
  /** Stock réel de l'entrepôt COMANET (journal, dépôts internes vendables). */
  stockInternal: number;
  /** Dernière photo de chaque dépôt externe (Cospharma, Pharmafirst), avec sa date. */
  stockExternal: { warehouseKey: string; quantity: number; date: string }[];
  onOrder: number;
  stockDate: string | null;
  avgMonthly: number; // ventes moyennes mensuelles (sell-in)
  /** Prévision mensuelle modélisée (saisonnalité) : base du stock cible et de la commande conseillée. */
  forecast: MonthlyForecast;
  trendPct: number | null; // dernier mois complet vs moyenne
  coverageMonths: number | null; // null si pas de ventes
  level: CoverageLevel;
  stockoutDate: string | null;
  leadTimeDays: number;
  safetyStockDays: number;
  moq: number | null;
  recommendedOrder: number;
  targetStock: number;
  costPrice: number | null;
  priceWholesale: number | null;
  marginPct: number | null;
  stockValue: number; // au prix d'achat
  fieldSellOut30d: number; // sell-out constaté terrain (unités) 30 j
  fieldStockAvg: number | null; // stock rayon moyen constaté 30 j
};

/**
 * Couverture et recommandation d'achat pour tous les produits (ou un sous-ensemble).
 * Définition et cas limites : voir l'en-tête de `src/lib/stock-math.ts`.
 *
 * `ref` est la date de référence des ventes (dernier import), pas « aujourd'hui ».
 */
export async function productStocks(
  opts: { productId?: string; brandId?: string; productIds?: string[] } = {},
  ref?: Date,
): Promise<ProductStock[]> {
  if (opts.productIds && opts.productIds.length === 0) return [];
  const s = await getSettings();
  const t = ref ?? today();
  // moyenne mensuelle = ventes des N derniers mois glissants (jusqu'à la date de référence) / N
  const avgStart = iso(addDays(t, -DAYS_PER_MONTH * s.avgSalesMonths));
  const avgEnd = iso(addDays(t, 1));
  const lastMonthStart = iso(addDays(t, -DAYS_PER_MONTH));
  const d30 = iso(addDays(t, -30));
  // Mois civils complets de la base désaisonnalisée (prévision), avant le mois de référence.
  const historyStart = iso(addMonths(t, -s.forecast.baseMonths));

  // Stock = journal de l'entrepôt COMANET (dépôts internes vendables : ce qui est physiquement chez nous, échantillons
  // compris) + dernière photo de chaque dépôt externe (Cospharma, Pharmafirst : connus seulement par import).
  // Les photos « globales » sans dépôt (anciens exports Sage) n'entrent plus dans le stock : elles ne servent qu'au
  // contrôle de la bascule.
  const r = await db.execute(sql`
    with internal as (
      select m.product_id, sum(m.quantity)::float8 as q from stock_movements m join warehouses w on w.key = m.warehouse_key
      where w.kind = 'INTERNE' and w.sellable group by 1
    ),
    external_last as (
      select distinct on (s2.product_id, s2.warehouse_key) s2.product_id, s2.warehouse_key, s2.quantity::float8 as quantity, s2.on_order::float8 as on_order, s2.date::text as date
      from stock_snapshots s2 join warehouses w on w.key = s2.warehouse_key
      where w.kind = 'EXTERNE' order by s2.product_id, s2.warehouse_key, s2.date desc, s2.created_at desc
    ),
    external as (
      select product_id, sum(quantity)::float8 as q, sum(on_order)::float8 as on_order, min(date) as date,
        json_agg(json_build_object('warehouseKey', warehouse_key, 'quantity', quantity, 'date', date) order by warehouse_key) as detail
      from external_last group by 1
    ),
    latest as (
      select coalesce(i.product_id, e.product_id) as product_id, coalesce(i.q, 0)::float8 as internal_qty, e.detail as external_detail,
        (coalesce(i.q, 0) + coalesce(e.q, 0))::float8 as quantity, coalesce(e.on_order, 0)::float8 as on_order,
        coalesce(e.date, ${iso(today())}) as date
      from internal i full join external e on e.product_id = i.product_id
    ),
    avg_sales as (
      select product_id, sum(quantity)::float8 / ${s.avgSalesMonths} as avg_monthly
      from sales where date >= ${avgStart}::date and date < ${avgEnd}::date group by product_id
    ),
    last_month as (
      select product_id, sum(quantity)::float8 as qty from sales where date >= ${lastMonthStart}::date and date < ${avgEnd}::date group by product_id
    ),
    -- Historique mensuel (mois civils) de la base désaisonnalisée de la prévision, et premier mois de vente du produit.
    monthly as (
      select product_id, json_object_agg(m, qty) as months, min(first_month) as first_month from (
        select product_id, to_char(date_trunc('month', date), 'YYYY-MM') as m, sum(quantity)::float8 as qty,
               min(to_char(date_trunc('month', date), 'YYYY-MM')) over (partition by product_id) as first_month
        from sales where date >= ${historyStart}::date and date < ${avgEnd}::date group by product_id, m
      ) x group by product_id
    ),
    first_sale as (
      select product_id, to_char(date_trunc('month', min(date)), 'YYYY-MM') as first_month from sales group by product_id
    ),
    -- Commandes en cours = reste à recevoir des commandes fournisseurs ouvertes ; à défaut, la valeur de la photo importée.
    open_po as (
      select l.product_id, sum(l.quantity - l.received_qty)::float8 as qty
      from purchase_document_lines l join purchase_documents d on d.id = l.document_id
      where d.type = 'COMMANDE' and d.status in ('VALIDE', 'PARTIELLE') and l.product_id is not null and l.quantity > l.received_qty
      group by l.product_id
    ),
    field as (
      select al.product_id, sum(al.quantity_sold)::float8 as sold, avg(al.stock_observed)::float8 as stock_avg
      from animation_lines al join animations a on a.id = al.animation_id
      where a.status = 'DONE' and a.date >= ${d30}::date group by al.product_id
    )
    select p.id as product_id, p.sku, p.name, p.brand_id, b.name as brand_name, b.color as brand_color, p.category,
           coalesce(l.quantity, 0) as stock, coalesce(po.qty, l.on_order, 0) as on_order, l.date as stock_date,
           coalesce(l.internal_qty, 0) as internal_qty, l.external_detail,
           coalesce(a.avg_monthly, 0) as avg_monthly, lm.qty as last_month_qty,
           mo.months as monthly, fs.first_month,
           p.lead_time_days, p.safety_stock_days, p.moq,
           p.cost_price::float8 as cost_price, p.price_wholesale::float8 as price_wholesale,
           tr.rate::float8 as tax_rate, p.avg_client_discount_pct::float8 as avg_discount,
           coalesce(f.sold, 0) as field_sold, f.stock_avg as field_stock_avg
    from products p
    left join brands b on b.id = p.brand_id
    left join tax_rates tr on tr.key = coalesce(p.tax_rate_key, ${s.gestion.defaultTaxRateKey})
    left join latest l on l.product_id = p.id
    left join open_po po on po.product_id = p.id
    left join avg_sales a on a.product_id = p.id
    left join last_month lm on lm.product_id = p.id
    left join monthly mo on mo.product_id = p.id
    left join first_sale fs on fs.product_id = p.id
    left join field f on f.product_id = p.id
    where p.active
      ${opts.productId ? sql`and p.id = ${opts.productId}::uuid` : sql``}
      ${opts.brandId ? sql`and p.brand_id = ${opts.brandId}::uuid` : sql``}
      ${opts.productIds ? sql`and p.id in (${sql.join(opts.productIds.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``}
    order by b.name, p.name`);

  return (r.rows as Record<string, unknown>[]).map((row) => {
    const stockKnown = row.stock_date !== null && row.stock_date !== undefined;
    const stock = Number(row.stock), onOrder = Number(row.on_order), avg = Number(row.avg_monthly);
    const lastMonthQty = row.last_month_qty === null ? null : Number(row.last_month_qty);
    const leadTimeDays = Number(row.lead_time_days), safety = Number(row.safety_stock_days);
    const moq = row.moq === null ? null : Number(row.moq);
    // Prévision modélisée : horizon au moins égal à la fenêtre du stock cible (délai + sécurité + revue).
    const forecast = buildForecast({
      product: { name: String(row.name), category: row.category ? String(row.category) : null },
      history: (row.monthly ?? {}) as Record<string, number>,
      firstSaleMonth: row.first_month ? String(row.first_month) : null,
      ref: t, avgMonthly: avg, settings: s.forecast,
      horizonMonths: Math.max(s.forecast.horizonMonths, Math.ceil((leadTimeDays + safety + DAYS_PER_MONTH) / 28) + 1),
    });
    const cov = computeCoverage(
      { stock, stockKnown, onOrder, avgMonthly: avg, leadTimeDays, safetyStockDays: safety, moq, forecast: demandSeries(forecast) },
      s.coverage,
    );
    const cost = row.cost_price === null ? null : Number(row.cost_price);
    const pw = row.price_wholesale === null ? null : Number(row.price_wholesale);
    return {
      productId: String(row.product_id), sku: String(row.sku), name: String(row.name),
      brandId: row.brand_id ? String(row.brand_id) : null, brandName: row.brand_name ? String(row.brand_name) : null,
      brandColor: row.brand_color ? String(row.brand_color) : null, category: row.category ? String(row.category) : null,
      stock, stockKnown, onOrder, stockDate: row.stock_date ? String(row.stock_date) : null,
      stockInternal: Number(row.internal_qty),
      stockExternal: ((row.external_detail ?? []) as { warehouseKey: string; quantity: number; date: string }[]).map((e) => ({ warehouseKey: e.warehouseKey, quantity: Number(e.quantity), date: e.date })),
      avgMonthly: avg, forecast, trendPct: trendPct(lastMonthQty, avg),
      coverageMonths: cov.coverageMonths, level: cov.level,
      stockoutDate: cov.daysToStockout === null ? null : iso(addDays(t, cov.daysToStockout)),
      leadTimeDays, safetyStockDays: safety, moq,
      recommendedOrder: cov.recommendedOrder, targetStock: cov.targetStock,
      costPrice: cost, priceWholesale: pw,
      marginPct: marginPct(cost, netSellingPrice(pw, row.tax_rate === null ? null : Number(row.tax_rate), row.avg_discount === null ? null : Number(row.avg_discount))),
      stockValue: stock * (cost ?? 0),
      fieldSellOut30d: Number(row.field_sold), fieldStockAvg: row.field_stock_avg === null ? null : Number(row.field_stock_avg),
    };
  });
}

export function stockSummary(list: ProductStock[]) {
  return {
    red: list.filter((p) => p.level === "red").length,
    orange: list.filter((p) => p.level === "orange").length,
    yellow: list.filter((p) => p.level === "yellow").length,
    green: list.filter((p) => p.level === "green").length,
    overstock: list.filter((p) => p.coverageMonths !== null && p.coverageMonths > 6).length,
    stockout: list.filter((p) => p.stockKnown && p.stock <= 0 && p.avgMonthly > 0).length,
    unknown: list.filter((p) => !p.stockKnown).length,
    toOrder: list.filter((p) => p.recommendedOrder > 0),
    value: list.reduce((a, p) => a + p.stockValue, 0),
  };
}
