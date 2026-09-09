import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { pageContext, withFilters, type SearchParams } from "@/lib/analytics-marketing/context";
import { aggregateBy } from "@/lib/analytics-marketing/queries";
import { classifyProduct, stockAdvice, PRODUCT_CASE_META, type ProductCase } from "@/lib/analytics-marketing/analysis";
import { productStocks } from "@/lib/stock";
import { isOverstock, isUnderTension } from "@/lib/stock-math";
import { PageHeader, Card, Tabs, Section, Badge, BrandDot, Empty, Kpi } from "@/components/ui";
import { ANALYTICS_TABS } from "@/components/analytics";
import { AnalyticsFilters } from "@/components/analytics-filters";
import { Matrix } from "@/components/analytics-charts";
import { fmtMAD, fmtNum, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics · Par produit" };

const ORDER: Record<ProductCase, number> = { POUSSE_VEND_PAS: 0, PAS_POUSSE_VEND: 1, POUSSE_VEND: 2, DORMANT: 3 };
const STOCK_TONE = { RUPTURE: "red", TENSION: "orange", SURSTOCK: "purple", OK: "green", INCONNU: "gray" } as const;

export default async function AnalyticsProductsPage(props: { searchParams: Promise<SearchParams & { cas?: string }> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const ctx = await pageContext(sp);
  const { filter, prevFilter, settings, period } = ctx;
  const t = settings.analytics.productCases;
  const scopeIds = ctx.brands.map((b) => b.id);
  const brandIds = ctx.brandId ? [ctx.brandId] : scopeIds;

  const [rows, prevRows, exposures, stocks, products] = await Promise.all([
    aggregateBy("product", { ...filter, brandIds }),
    aggregateBy("product", { ...prevFilter, brandIds }),
    db.execute<{ product_id: string; exposures: number; kinds: string[] }>(sql`
      select product_id, count(distinct source_kind || ':' || source_id::text)::int as exposures, array_agg(distinct source_kind) as kinds
      from (select product_id, source_kind, source_id from fact_marketing_spend where product_id is not null and day >= ${filter.range.start}::date and day < ${filter.range.end}::date
            union select product_id, source_kind, source_id from fact_marketing_result where product_id is not null and day >= ${filter.range.start}::date and day < ${filter.range.end}::date) x
      group by 1`),
    productStocks({}, ctx.ref),
    db.execute<{ id: string; name: string; brand_id: string | null; active: boolean }>(sql`select id, name, brand_id, active from products where active order by name`),
  ]);
  const expo = new Map(exposures.rows.map((r) => [r.product_id, r]));
  const stockOf = new Map(stocks.map((s) => [s.productId, s]));
  const brandOf = (id: string | null) => ctx.brands.find((b) => b.id === id);
  const noProduct = rows.find((r) => r.key === "")?.aggregate;

  // Médiane de sell-in par marque sur la période (produits de la marque ayant une ligne).
  const byBrandSales = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.key) continue;
    const p = products.rows.find((x) => x.id === r.key);
    if (!p?.brand_id) continue;
    byBrandSales.set(p.brand_id, [...(byBrandSales.get(p.brand_id) ?? []), r.aggregate.sales.sellIn]);
  }
  const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  // Marque à un seul produit : la médiane de la marque n'a pas de sens, on compare au portefeuille.
  const portfolioMedian = median([...byBrandSales.values()].flat().filter((v) => v > 0));

  const table = products.rows
    .filter((p) => p.brand_id && brandIds.includes(p.brand_id))
    .map((p) => {
      const a = rows.find((r) => r.key === p.id)?.aggregate;
      const prev = prevRows.find((r) => r.key === p.id)?.aggregate;
      const e = expo.get(p.id);
      const st = stockOf.get(p.id);
      const sib = byBrandSales.get(p.brand_id!) ?? [];
      const signal = { spent: a?.spend.spent ?? 0, exposures: e?.exposures ?? 0, sellIn: a?.sales.sellIn ?? 0, sellInPrev: prev && prev.sales.rows > 0 ? prev.sales.sellIn : null, brandMedianSellIn: sib.length > 1 ? median(sib) : Number.isFinite(portfolioMedian) ? portfolioMedian : null };
      const c = classifyProduct(signal, t);
      const advice = stockAdvice({ stockKnown: st?.stockKnown ?? false, stock: st?.stock ?? 0, coverageMonths: st?.coverageMonths ?? null, underTension: st ? isUnderTension(st, settings) : false, overstock: st ? isOverstock(st, { overstockMonths: t.overstockMonths, overstockMinUnits: t.overstockMinUnits }) : false });
      return { p, a, signal, c, advice, kinds: e?.kinds ?? [], st };
    })
    .filter((r) => r.a || r.signal.exposures > 0 || (r.st?.avgMonthly ?? 0) > 0)
    .sort((x, y) => ORDER[x.c.cls] - ORDER[y.c.cls] || y.signal.sellIn - x.signal.sellIn);

  const counts = Object.fromEntries((Object.keys(PRODUCT_CASE_META) as ProductCase[]).map((k) => [k, table.filter((r) => r.c.cls === k).length])) as Record<ProductCase, number>;
  const shown = sp.cas && sp.cas in PRODUCT_CASE_META ? table.filter((r) => r.c.cls === sp.cas) : table;
  const maxSpend = Math.max(1, ...table.map((r) => r.signal.spent));
  const points = table.filter((r) => r.signal.sellIn > 0 || r.signal.spent > 0).slice(0, 60).map((r) => ({ id: r.p.id, label: r.p.name.length > 18 ? r.p.name.slice(0, 17) + "…" : r.p.name, x: (r.signal.spent / maxSpend) * 100, y: r.c.growthPct === null ? 0 : Math.max(-50, Math.min(150, r.c.growthPct)) + 50, color: brandOf(r.p.brand_id)?.color, size: r.signal.sellIn / 1000, href: `/produits/${r.p.id}` }));

  return (
    <>
      <PageHeader eyebrow="Marketing · Analytics" title="Par produit" subtitle={`Ce qu'on pousse contre ce qui se vend. ${period.label}. Poussé = dépense ≥ ${fmtMAD(t.pushedMinSpend)} ou ≥ ${t.pushedMinExposures} actions ; se vend = croissance ≥ ${t.sellingGrowthPct} % ou au-dessus de la médiane de la marque (Paramètres).`} />
      <div className="mb-4"><Tabs tabs={ANALYTICS_TABS} current="/marketing/analytics/produits" /></div>
      <AnalyticsFilters period={ctx.periodKey} brand={ctx.brandId} channel={ctx.channelKey} city={ctx.city} brands={ctx.brands} channels={ctx.channels.filter((c) => c.active)} cities={ctx.cities} hide={["channel"]} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {(Object.keys(PRODUCT_CASE_META) as ProductCase[]).map((k) => (
          <Kpi key={k} label={PRODUCT_CASE_META[k].label} value={String(counts[k])} tone={PRODUCT_CASE_META[k].tone === "gray" ? undefined : PRODUCT_CASE_META[k].tone} sub={PRODUCT_CASE_META[k].action} href={withFilters("/marketing/analytics/produits", ctx, { cas: sp.cas === k ? null : k })} />
        ))}
      </div>

      {noProduct && noProduct.spend.spent > 0 && (
        <p className="text-xs text-muted mb-4">{fmtMAD(noProduct.spend.spent, { compact: true })} de dépenses sans produit sur la période : comptées au niveau marque, absentes de ce tableau. <Link href="/marketing/analytics/qualite" className="underline">Voir la qualité des données</Link>.</p>
      )}

      {shown.length === 0 ? <Empty title="Aucun produit avec ventes ou action marketing sur la période" /> : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted">
                <th className="px-4 py-2">Produit</th><th className="px-2 py-2">Cas</th><th className="px-2 py-2 text-right">Sell-in HT</th><th className="px-2 py-2 text-right">Sell-out TTC</th><th className="px-2 py-2 text-right">Dépense allouée</th><th className="px-2 py-2 text-right">Actions</th><th className="px-2 py-2 text-right">Croissance</th><th className="px-4 py-2">Stock</th>
              </tr></thead>
              <tbody>
                {shown.map(({ p, a, signal, c, advice, kinds }) => (
                  <tr key={p.id} className="border-t border-line align-top">
                    <td className="px-4 py-2"><Link href={`/produits/${p.id}`} className="inline-flex items-center gap-2 font-medium hover:underline"><BrandDot color={brandOf(p.brand_id)?.color ?? "#999"} />{p.name}</Link><div className="text-[11px] text-muted">{brandOf(p.brand_id)?.name}</div></td>
                    <td className="px-2 py-2"><Badge tone={PRODUCT_CASE_META[c.cls].tone}>{PRODUCT_CASE_META[c.cls].label}</Badge><div className="text-[11px] text-muted mt-1 max-w-[220px]">{advice.level === "RUPTURE" || advice.level === "TENSION" ? (c.cls === "PAS_POUSSE_VEND" || c.cls === "POUSSE_VEND" ? "Ne pas pousser : stock insuffisant." : PRODUCT_CASE_META[c.cls].action) : advice.level === "SURSTOCK" && c.cls === "DORMANT" ? "Surstock dormant : le marketing peut l'écouler (offre ciblée, animation)." : PRODUCT_CASE_META[c.cls].action}</div></td>
                    <td className="px-2 py-2 text-right tabular-nums">{a?.sales.rows ? fmtMAD(signal.sellIn, { compact: true }) : <span className="text-muted">aucune</span>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{a && a.sales.sellOut > 0 ? fmtMAD(a.sales.sellOut, { compact: true }) : <span className="text-muted">—</span>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{a?.spend.measurableRows ? fmtMAD(signal.spent, { compact: true }) : a?.spend.rows ? <span className="text-muted">non mesurée</span> : <span className="text-muted">—</span>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{signal.exposures || "—"}{kinds.length > 0 && <div className="text-[11px] text-muted">{kinds.map((k) => k.toLowerCase().replace("_", " ")).join(", ")}</div>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{c.growthPct === null ? <span className="text-muted text-xs">pas encore comparable</span> : <span className={c.growthPct >= 0 ? "text-green-700" : "text-red-700"}>{fmtPct(c.growthPct, 0, true)}</span>}</td>
                    <td className="px-4 py-2"><Badge tone={STOCK_TONE[advice.level]} dot>{advice.level === "OK" ? "ok" : advice.level.toLowerCase()}</Badge><div className="text-[11px] text-muted mt-1 max-w-[200px]">{advice.label}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Section title="Poussé × croissance des ventes" description="Horizontal : dépense allouée (en % du produit le plus poussé). Vertical : croissance du sell-in vs période précédente, recentrée (50 = stable). Taille : sell-in." className="mt-6">
        <Card>{points.length ? <Matrix points={points} xLabel="dépense allouée (% du max)" yLabel="croissance recentrée" diagonal={false} quadrants={{ tl: "pépites à amplifier", tr: "continuer", bl: "dormants", br: "arrêter ou changer d'angle", xSplit: (t.pushedMinSpend / maxSpend) * 100, ySplit: 50 + t.sellingGrowthPct }} /> : <p className="text-xs text-muted">Aucun produit avec dépense ou vente sur la période.</p>}</Card>
      </Section>

      <p className="text-xs text-muted mt-4">{fmtNum(table.length)} produit(s) analysé(s). Le stock vient du dernier instantané importé ; sans instantané, aucune recommandation de pousser n&apos;est faite.</p>
    </>
  );
}
