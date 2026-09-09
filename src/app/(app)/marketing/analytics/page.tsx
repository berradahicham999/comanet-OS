import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { pageContext, withFilters, type SearchParams } from "@/lib/analytics-marketing/context";
import { aggregate, aggregateBy, monthlySeries, pairKey } from "@/lib/analytics-marketing/queries";
import { compute } from "@/lib/analytics-marketing/metrics";
import { rankPairs } from "@/lib/analytics-marketing/analysis";
import { getRecommendations } from "@/lib/rules";
import { PageHeader, Card, Tabs, Section, Badge, BrandDot } from "@/components/ui";
import { ANALYTICS_TABS, MeasuredValue, formatMetric, fmtCostPerResult } from "@/components/analytics";
import { AnalyticsFilters } from "@/components/analytics-filters";
import { Bars } from "@/components/analytics-charts";
import { AskBlock } from "@/components/analytics-ask";
import { fmtMAD, fmtNum, fmtMonth, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics marketing" };

export default async function AnalyticsHomePage(props: { searchParams: Promise<SearchParams & { q?: string }> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const ctx = await pageContext(sp);
  const { filter, prevFilter, settings, metrics, period } = ctx;
  const mctx = { settings: settings.analytics, health: { stockCoverageOk: null, dataQuality: ctx.completeness } };

  const [total, prevTotal, byBrand, byChannel, pairs, byProduct, series, recs] = await Promise.all([
    aggregate(filter), aggregate(prevFilter), aggregateBy("brand", filter), aggregateBy("channel", filter), aggregateBy("brand_channel", filter), aggregateBy("product", filter),
    monthlySeries(filter, period.end, 13), getRecommendations(),
  ]);
  const openActions = recs.filter((r) => (r.category === "MARKETING" || r.category === "BUDGET") && !r.existingTask).length;
  const channelOf = (k: string) => ctx.channels.find((c) => c.key === k);
  const brandOf = (id: string) => ctx.brands.find((b) => b.id === id);
  const ranking = rankPairs(pairs.map((p) => { const [brandId, channelKey] = p.key.split("|"); const c = channelOf(channelKey); return { brandId, channelKey, agg: p.aggregate, resultMetric: c?.resultMetric ?? null, fallback: c?.fallbackResultMetric ?? null }; }), settings.analytics);
  const pairLabel = (p: { brandId: string; channelKey: string } | null) => (p ? `${brandOf(p.brandId)?.name ?? "?"} × ${channelOf(p.channelKey)?.label ?? p.channelKey}` : null);
  const spend = compute("SPEND_SPENT", total, mctx), budgetPct = compute("BUDGET_CONSUMED_PCT", total, mctx);
  const sellIn = compute("SELL_IN", total, mctx), objective = compute("OBJECTIVE_ATTAINMENT", total, mctx);
  const roi = compute("ROI_MEASURED", total, mctx), roiC = compute("ROI_CORRELATED", total, mctx);
  const prevSpend = compute("SPEND_SPENT", prevTotal, mctx);
  const spendDelta = spend.ok && prevSpend.ok && prevSpend.value > 0 ? ((spend.value - prevSpend.value) / prevSpend.value) * 100 : null;
  const unit = (k: string) => (metrics.get(k)?.unit ?? "COUNT") as "MAD" | "PCT" | "RATIO" | "COUNT" | "MULTIPLE" | "SCORE" | "POINTS";
  const closed = series.filter((m) => m.month < period.end.slice(0, 7));

  return (
    <>
      <PageHeader eyebrow="Marketing" title="Analytics marketing" subtitle={`Où va l'argent, ce que ça rapporte, où le mettre le mois prochain. ${period.label} · comparé à ${period.prev.label}.${ctx.staleDays > 0 ? ` Ventes Sage importées jusqu'au ${fmtDate(ctx.ref)} : les périodes sont calées sur cette date.` : ""}`}
        actions={ctx.completeness !== null && <Link href="/marketing/analytics/qualite" className="btn-ghost btn-sm">Complétude {Math.round(ctx.completeness * 100)} %</Link>} />
      <div className="mb-4"><Tabs tabs={ANALYTICS_TABS} current="/marketing/analytics" /></div>
      <AnalyticsFilters period={ctx.periodKey} brand={ctx.brandId} channel={ctx.channelKey} city={ctx.city} brands={ctx.brands} channels={ctx.channels.filter((c) => c.active)} cities={ctx.cities} />
      {ctx.channelKey && <p className="text-xs text-muted mb-3">Filtre canal actif : les ventes, l&apos;objectif et le budget restent ceux du périmètre marque (les ventes n&apos;ont pas de canal).</p>}

      <div className="mb-6"><AskBlock ctx={ctx} q={sp.q?.trim() || null} /></div>

      <Section title="Les six chiffres du mois">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <Card title="Dépense vs budget">
            <MeasuredValue m={spend} unit="MAD" size="lg" />
            <div className="text-xs text-muted mt-1">{spendDelta !== null && <span className={spendDelta > 0 ? "text-orange-700" : "text-green-700"}>{spendDelta > 0 ? "+" : ""}{Math.round(spendDelta)} % vs {period.prev.label}</span>}</div>
            <div className="mt-2 text-sm">{budgetPct.ok ? <span>{formatMetric(budgetPct.value, "PCT")} de l&apos;enveloppe annuelle consommée</span> : <MeasuredValue m={budgetPct} unit="PCT" size="sm" />}</div>
          </Card>
          <Card title="CA sell-in vs objectif">
            <MeasuredValue m={sellIn} unit="MAD" size="lg" />
            <div className="mt-2 text-sm">{objective.ok ? <span className={objective.value >= 100 ? "text-green-700" : "text-orange-700"}>{formatMetric(objective.value, "PCT")} de l&apos;objectif</span> : <MeasuredValue m={objective} unit="PCT" size="sm" />}</div>
          </Card>
          <Card title="ROI global">
            <MeasuredValue m={roi} unit="MULTIPLE" attribution="MEASURED" size="lg" />
            <div className="mt-2 text-sm"><span className="text-muted">Retour observé : </span><MeasuredValue m={roiC} unit="MULTIPLE" attribution="CORRELATION" size="sm" /></div>
          </Card>
          <Card title="Meilleur couple marque × canal">
            {ranking.best ? <><div className="font-semibold">{pairLabel(ranking.best)}</div><div className="text-xs text-muted mt-1">coût par {(ctx.metrics.get(ranking.best.resultKey ?? "")?.label ?? ranking.best.resultKey ?? "").toLowerCase()} : {fmtCostPerResult(ranking.best.costPerResult ?? 0, ranking.best.resultKey)} · {(ranking.best.relative as number).toFixed(2)}× la médiane du canal</div></> : <span className="text-xs text-muted">données insuffisantes : il faut au moins deux marques mesurées sur un même canal</span>}
          </Card>
          <Card title="Pire couple marque × canal">
            {ranking.worst ? <><div className="font-semibold">{pairLabel(ranking.worst)}</div><div className="text-xs text-muted mt-1">coût par {(ctx.metrics.get(ranking.worst.resultKey ?? "")?.label ?? ranking.worst.resultKey ?? "").toLowerCase()} : {fmtCostPerResult(ranking.worst.costPerResult ?? 0, ranking.worst.resultKey)} · {(ranking.worst.relative as number).toFixed(2)}× la médiane du canal</div></> : <span className="text-xs text-muted">données insuffisantes</span>}
          </Card>
          <Card title="Actions ouvertes" href="/actions">
            <div className="text-2xl font-semibold tabular-nums">{openActions}</div>
            <div className="text-xs text-muted">recommandations marketing et budget sans tâche créée</div>
          </Card>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-3 mt-6">
        <Card title="Par marque" href={withFilters("/marketing/analytics/marques", ctx)} action={<span className="text-xs text-accent">voir →</span>}>
          <Bars rows={byBrand.filter((r) => r.key).slice(0, 6).map((r) => { const b = brandOf(r.key); return { label: b?.name ?? "?", value: r.aggregate.spend.rows ? r.aggregate.spend.spent : null, color: b?.color, sub: r.aggregate.sales.rows ? `CA ${fmtMAD(r.aggregate.sales.sellIn, { compact: true })}` : "pas de vente" }; })} />
          {byBrand.length === 0 && <p className="text-xs text-muted">Aucune dépense ni vente sur la période.</p>}
        </Card>
        <Card title="Par canal" href={withFilters("/marketing/analytics/canaux", ctx)} action={<span className="text-xs text-accent">voir →</span>}>
          <Bars rows={byChannel.slice(0, 6).map((r) => { const c = channelOf(r.key); const cpr = compute("COST_PER_RESULT", r.aggregate, { ...mctx, resultMetric: { key: c?.resultMetric ?? null, fallback: c?.fallbackResultMetric ?? null } }); return { label: c?.label ?? r.key, value: r.aggregate.spend.measurableRows ? r.aggregate.spend.spent : null, color: c?.color, sub: cpr.ok ? `${fmtCostPerResult(cpr.value, c?.resultMetric && (r.aggregate.results[c.resultMetric] ?? 0) > 0 ? c.resultMetric : c?.fallbackResultMetric ?? null)} / ${(ctx.metrics.get(c?.resultMetric && (r.aggregate.results[c.resultMetric] ?? 0) > 0 ? c.resultMetric : c?.fallbackResultMetric ?? "")?.label ?? "résultat").toLowerCase()}` : r.aggregate.spend.rows && !r.aggregate.spend.measurableRows ? "coût non mesuré" : "résultat non mesuré" }; })} />
          {byChannel.length === 0 && <p className="text-xs text-muted">Aucune dépense sur la période.</p>}
        </Card>
        <Card title="Par produit" href={withFilters("/marketing/analytics/produits", ctx)} action={<span className="text-xs text-accent">voir →</span>}>
          <p className="text-sm text-ink-2">Ce qu&apos;on pousse contre ce qui se vend : quatre cas (continuer, arrêter, amplifier, dormant), croisés avec la couverture de stock.</p>
          <p className="text-xs text-muted mt-2">{fmtNum(byProduct.filter((r) => r.key).length)} produit(s) avec dépense ou vente sur la période.</p>
        </Card>
      </div>

      <Section title="Tendance 13 mois" description="Dépense marketing (journées closes) et sell-in par mois. Une dépense non mesurable (coût absent) n'est pas comptée : la colonne « complétude » le dit." className="mt-6">
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2">Mois</th><th className="px-2 py-2 text-right">Dépense</th><th className="px-2 py-2 text-right">Complétude</th><th className="px-2 py-2 text-right">Sell-in HT</th><th className="px-2 py-2 text-right">Sell-out TTC</th><th className="px-4 py-2 text-right">Intensité</th></tr></thead>
              <tbody>
                {series.map((m) => {
                  const intensity = m.salesRows && m.rows && m.sellIn > 0 ? (m.spent / m.sellIn) * 100 : null;
                  const partial = m.month >= period.end.slice(0, 7);
                  return (
                    <tr key={m.month} className="border-t border-line">
                      <td className="px-4 py-1.5">{fmtMonth(m.month + "-01")}{partial && <Badge tone="gray" className="ml-1">en cours</Badge>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{m.rows ? fmtMAD(m.spent, { compact: true }) : <span className="text-muted">—</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">{m.rows ? `${Math.round((m.measurableRows / m.rows) * 100)} %` : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{m.salesRows ? fmtMAD(m.sellIn, { compact: true }) : <span className="text-muted">pas d&apos;import</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{m.sellOut > 0 ? fmtMAD(m.sellOut, { compact: true }) : <span className="text-muted">—</span>}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{intensity === null ? <span className="text-muted">—</span> : `${intensity.toFixed(1)} %`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {closed.filter((m) => m.rows && m.salesRows).length < 6 && <p className="px-4 py-2 text-xs text-muted">Moins de six mois complets avec dépense et ventes : pas de corrélation calculée.</p>}
        </Card>
      </Section>

      <p className="text-xs text-muted mt-4 flex items-center gap-2"><BrandDot color="#9ca3af" /> Tout chiffre « corrélation observée » compare des périodes, il ne prouve pas une cause. Les chiffres « mesurés » viennent de la régie, d&apos;un code promo ou d&apos;une saisie. {fmtNum(total.spend.unmeasuredRows)} ligne(s) de dépense sans montant sur la période.</p>
    </>
  );
}
