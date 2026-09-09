import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { pageContext, withFilters, type SearchParams } from "@/lib/analytics-marketing/context";
import { aggregateBy, monthlySeries } from "@/lib/analytics-marketing/queries";
import { compute } from "@/lib/analytics-marketing/metrics";
import { classifyInvestment, channelMix, INVESTMENT_LABELS } from "@/lib/analytics-marketing/analysis";
import { PageHeader, Card, Tabs, Section, Badge, BrandDot, Empty } from "@/components/ui";
import { ANALYTICS_TABS, MeasuredValue } from "@/components/analytics";
import { AnalyticsFilters } from "@/components/analytics-filters";
import { Matrix, Bars } from "@/components/analytics-charts";
import { fmtMAD, fmtPct, fmtMonth } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics · Par marque" };

export default async function AnalyticsBrandsPage(props: { searchParams: Promise<SearchParams> }) {
  await requireAccess("marketing");
  const ctx = await pageContext(await props.searchParams);
  const { filter, prevFilter, settings, period } = ctx;
  const mctx = { settings: settings.analytics, health: { stockCoverageOk: null, dataQuality: ctx.completeness } };
  // Le portefeuille = toutes les marques du périmètre de droits, même quand une marque est sélectionnée.
  const scopeIds = ctx.brands.map((b) => b.id);
  const scopeFilter = { ...filter, brandIds: scopeIds };

  const [rows, prevRows, pairs, series] = await Promise.all([
    aggregateBy("brand", scopeFilter),
    aggregateBy("brand", { ...prevFilter, brandIds: scopeIds }),
    aggregateBy("brand_channel", scopeFilter),
    ctx.brandId ? monthlySeries({ ...filter }, period.end, 12) : Promise.resolve(null),
  ]);
  const channelOf = (k: string) => ctx.channels.find((c) => c.key === k);
  const brands = ctx.brands.filter((b) => !ctx.brandId || b.id === ctx.brandId);
  const mixOf = (scope: typeof pairs) => ctx.channels.map((c) => ({ key: c.key, spent: scope.filter((p) => p.key.endsWith(`|${c.key}`)).reduce((s, p) => s + p.aggregate.spend.spent, 0) }));
  const portfolioMix = mixOf(pairs);

  const table = brands.map((b) => {
    const a = rows.find((r) => r.key === b.id)?.aggregate;
    const prev = prevRows.find((r) => r.key === b.id)?.aggregate ?? null;
    if (!a) return { b, a: null, prev, cls: classifyInvestment(null, null, settings.analytics.investmentBalancePts), m: null };
    const spendShare = compute("SPEND_SHARE", a, mctx), salesShare = compute("SALES_SHARE", a, mctx);
    const cls = classifyInvestment(spendShare.ok ? spendShare.value / 100 : null, salesShare.ok ? salesShare.value / 100 : null, settings.analytics.investmentBalancePts);
    return {
      b, a, prev, cls,
      m: {
        sellIn: compute("SELL_IN", a, mctx), sellOut: compute("SELL_OUT", a, mctx), spend: compute("SPEND_SPENT", a, mctx),
        intensity: compute("MARKETING_INTENSITY", a, mctx), spendShare, salesShare, roi: compute("ROI_MEASURED", a, mctx), roiC: compute("ROI_CORRELATED", a, mctx),
        objective: compute("OBJECTIVE_ATTAINMENT", a, mctx), health: compute("HEALTH_SCORE", a, mctx), growth: compute("SALES_GROWTH_PREV", a, mctx),
      },
    };
  });
  const points = table.filter((t) => t.m && t.m.spendShare.ok && t.m.salesShare.ok).map((t) => ({ id: t.b.id, label: t.b.name, x: (t.m!.spendShare as { value: number }).value, y: (t.m!.salesShare as { value: number }).value, color: t.b.color, size: t.a!.spend.spent / 1000, href: withFilters("/marketing/analytics/marques", ctx, { brand: t.b.id }) }));

  return (
    <>
      <PageHeader eyebrow="Marketing · Analytics" title="Par marque" subtitle={`Le portefeuille : qui reçoit l'argent, qui fait le chiffre. ${period.label}.`}
        actions={<Link href={`/marketing/analytics/revue/${ctx.brandId ?? brands[0]?.id ?? ""}`} className="btn-ghost btn-sm">Revue mensuelle</Link>} />
      <div className="mb-4"><Tabs tabs={ANALYTICS_TABS} current="/marketing/analytics/marques" /></div>
      <AnalyticsFilters period={ctx.periodKey} brand={ctx.brandId} channel={ctx.channelKey} city={ctx.city} brands={ctx.brands} channels={ctx.channels.filter((c) => c.active)} cities={ctx.cities} />

      {table.length === 0 ? <Empty title="Aucune marque dans votre périmètre" /> : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted">
                <th className="px-4 py-2">Marque</th><th className="px-2 py-2 text-right">Sell-in HT</th><th className="px-2 py-2 text-right">Sell-out TTC</th><th className="px-2 py-2 text-right">Dépense</th>
                <th className="px-2 py-2 text-right">Intensité</th><th className="px-2 py-2 text-right">Part budget / part CA</th><th className="px-2 py-2 text-right">ROI mesuré</th><th className="px-2 py-2 text-right">Objectif</th><th className="px-4 py-2 text-right">Santé</th>
              </tr></thead>
              <tbody>
                {table.map(({ b, m, cls }) => (
                  <tr key={b.id} className="border-t border-line align-top">
                    <td className="px-4 py-2"><Link href={withFilters("/marketing/analytics/marques", ctx, { brand: b.id })} className="inline-flex items-center gap-2 font-medium hover:underline"><BrandDot color={b.color} />{b.name}</Link><div className="mt-1"><Badge tone={INVESTMENT_LABELS[cls.cls].tone}>{INVESTMENT_LABELS[cls.cls].label}{cls.balancePts !== null && ` (${cls.balancePts > 0 ? "+" : ""}${cls.balancePts.toFixed(1)} pt)`}</Badge></div></td>
                    {m ? <>
                      <td className="px-2 py-2 text-right"><MeasuredValue m={m.sellIn} unit="MAD" size="sm" />{m.growth.ok && <div className="text-[11px] text-muted">{fmtPct(m.growth.value, 0, true)} vs préc.</div>}</td>
                      <td className="px-2 py-2 text-right"><MeasuredValue m={m.sellOut} unit="MAD" size="sm" /></td>
                      <td className="px-2 py-2 text-right"><MeasuredValue m={m.spend} unit="MAD" size="sm" /></td>
                      <td className="px-2 py-2 text-right"><MeasuredValue m={m.intensity} unit="PCT" size="sm" /></td>
                      <td className="px-2 py-2 text-right tabular-nums text-xs">{m.spendShare.ok ? fmtPct(m.spendShare.value) : "—"} / {m.salesShare.ok ? fmtPct(m.salesShare.value) : "—"}</td>
                      <td className="px-2 py-2 text-right">{m.roi.ok ? <MeasuredValue m={m.roi} unit="MULTIPLE" attribution="MEASURED" size="sm" /> : <div><MeasuredValue m={m.roiC} unit="MULTIPLE" attribution="CORRELATION" size="sm" /></div>}</td>
                      <td className="px-2 py-2 text-right"><MeasuredValue m={m.objective} unit="PCT" size="sm" /></td>
                      <td className="px-4 py-2 text-right"><MeasuredValue m={m.health} unit="SCORE" size="sm" /></td>
                    </> : <td colSpan={8} className="px-2 py-2 text-xs text-muted">aucune dépense ni vente sur la période</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2 mt-6">
        <Section title="Matrice part du budget × part du CA" description={`Au-dessus de la diagonale : la marque fait plus de CA que sa part de budget (sous-investie). En dessous : sur-investie. Tolérance ± ${settings.analytics.investmentBalancePts} pt (Paramètres).`}>
          <Card>{points.length ? <Matrix points={points} xLabel="part des dépenses marketing" yLabel="part du sell-in" /> : <p className="text-xs text-muted">Il faut au moins une marque avec dépense et ventes mesurées sur la période.</p>}</Card>
        </Section>
        <Section title={ctx.brandId ? `Mix de canaux de ${brands[0]?.name ?? ""}` : "Mix de canaux du portefeuille"} description="Répartition des dépenses mesurables par canal ; la barre noire marque la part moyenne du portefeuille.">
          <Card>
            {(() => {
              const entity = mixOf(ctx.brandId ? pairs.filter((p) => p.key.startsWith(`${ctx.brandId}|`)) : pairs);
              const mix = channelMix(entity, portfolioMix);
              return mix.length ? <Bars rows={mix.map((r) => ({ label: channelOf(r.key)?.label ?? r.key, value: r.share * 100, ref: r.portfolioShare === null ? null : r.portfolioShare * 100, color: channelOf(r.key)?.color, sub: `${fmtMAD(r.spent, { compact: true })}${r.deltaPts !== null && ctx.brandId ? ` · ${r.deltaPts > 0 ? "+" : ""}${r.deltaPts.toFixed(0)} pt vs portefeuille` : ""}` }))} money={false} max={100} refLabel="part moyenne du portefeuille" /> : <p className="text-xs text-muted">Aucune dépense mesurable sur la période.</p>;
            })()}
          </Card>
        </Section>
      </div>

      {series && (
        <Section title="Tendance 12 mois" description="Dépense et sell-in mensuels de la marque." className="mt-6">
          <Card pad={false}>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2">Mois</th><th className="px-2 py-2 text-right">Dépense</th><th className="px-2 py-2 text-right">Sell-in HT</th><th className="px-4 py-2 text-right">Sell-out TTC</th></tr></thead>
              <tbody>{series.map((m) => (
                <tr key={m.month} className="border-t border-line"><td className="px-4 py-1.5">{fmtMonth(m.month + "-01")}</td><td className="px-2 py-1.5 text-right tabular-nums">{m.rows ? fmtMAD(m.spent, { compact: true }) : "—"}</td><td className="px-2 py-1.5 text-right tabular-nums">{m.salesRows ? fmtMAD(m.sellIn, { compact: true }) : <span className="text-muted">pas d&apos;import</span>}</td><td className="px-4 py-1.5 text-right tabular-nums">{m.sellOut > 0 ? fmtMAD(m.sellOut, { compact: true }) : "—"}</td></tr>
              ))}</tbody>
            </table>
          </Card>
        </Section>
      )}

      <p className="text-xs text-muted mt-4">Score de santé : objectif {settings.analytics.healthWeights.objective}, retour {settings.analytics.healthWeights.roi}, intensité {settings.analytics.healthWeights.intensity}, stock {settings.analytics.healthWeights.stockCoverage}, données {settings.analytics.healthWeights.dataQuality} (poids modifiables dans Paramètres). Une composante non mesurable sort du dénominateur.</p>
    </>
  );
}
