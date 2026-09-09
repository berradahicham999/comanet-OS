import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { pageContext, withFilters, type SearchParams } from "@/lib/analytics-marketing/context";
import { aggregateBy } from "@/lib/analytics-marketing/queries";
import { compute } from "@/lib/analytics-marketing/metrics";
import type { ChannelVerdict } from "@/lib/analytics-marketing/diagnosis";
import { channelVerdicts } from "@/lib/analytics-marketing/decision";
import { CHANNEL_FAMILIES, type ChannelFamily } from "@/lib/analytics-marketing/shared";
import { verdictMeta } from "@/lib/ads";
import { PageHeader, Card, Tabs, Section, Badge, BrandDot, Empty } from "@/components/ui";
import { ANALYTICS_TABS, MeasuredValue, PER_100_KEYS, fmtCostPerResult } from "@/components/analytics";
import { AnalyticsFilters } from "@/components/analytics-filters";
import { Bars } from "@/components/analytics-charts";
import { fmtMAD, fmtNum, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics · Par canal" };

const PER_100 = PER_100_KEYS;
const fmtCpr = fmtCostPerResult;
const TONE: Record<string, "green" | "blue" | "orange" | "red" | "gray"> = { SCALE: "green", MAINTAIN: "blue", OPTIMIZE: "orange", STOP: "red", WATCH: "gray" };

export default async function AnalyticsChannelsPage(props: { searchParams: Promise<SearchParams> }) {
  await requireAccess("marketing");
  const ctx = await pageContext(await props.searchParams);
  const { filter, prevFilter, settings, period } = ctx;
  const mctx = { settings: settings.analytics, health: { stockCoverageOk: null, dataQuality: ctx.completeness } };
  const scopeFilter = { ...filter, channelKeys: null };
  const scopePrev = { ...prevFilter, channelKeys: null };

  const [byChannel, prevByChannel, allVerdicts] = await Promise.all([
    aggregateBy("channel", scopeFilter), aggregateBy("channel", scopePrev),
    channelVerdicts({ range: filter.range, prev: filter.prev!, brandIds: filter.brandIds ?? null, ref: ctx.ref, settings }),
  ]);
  const channelOf = (k: string) => ctx.channels.find((c) => c.key === k);
  const brandOf = (id: string) => ctx.brands.find((b) => b.id === id);
  const totalSpend = byChannel.reduce((s, r) => s + r.aggregate.spend.spent, 0);

  const channelRows = byChannel
    .filter((r) => !ctx.channelKey || r.key === ctx.channelKey)
    .map((r) => {
      const c = channelOf(r.key);
      const prev = prevByChannel.find((p) => p.key === r.key)?.aggregate ?? null;
      const rm = { key: c?.resultMetric ?? null, fallback: c?.fallbackResultMetric ?? null };
      const cpr = compute("COST_PER_RESULT", r.aggregate, { ...mctx, resultMetric: rm });
      const prevCpr = prev ? compute("COST_PER_RESULT", prev, { ...mctx, resultMetric: rm }) : null;
      const trend = cpr.ok && prevCpr?.ok && prevCpr.value > 0 ? ((cpr.value - prevCpr.value) / prevCpr.value) * 100 : null;
      const resultKey = rm.key && (r.aggregate.results[rm.key] ?? 0) > 0 ? rm.key : rm.fallback && (r.aggregate.results[rm.fallback] ?? 0) > 0 ? rm.fallback : rm.key;
      return { c, key: r.key, a: r.aggregate, spend: compute("SPEND_SPENT", r.aggregate, mctx), cpr, trend, resultKey, resultValue: resultKey ? r.aggregate.results[resultKey] ?? 0 : null, attributed: compute("ATTRIBUTED_REVENUE", r.aggregate, mctx), share: totalSpend > 0 ? (r.aggregate.spend.spent / totalSpend) * 100 : null };
    });

  // Verdicts canal × marque (point d'entrée unique : decision.ts)
  const verdicts = allVerdicts
    .filter((p) => !ctx.channelKey || p.channelKey === ctx.channelKey)
    .map((p) => ({ brandId: p.brandId, channelKey: p.channelKey, c: p.channel, b: brandOf(p.brandId), a: p.agg, v: p.verdict, stockTension: p.stockTension }))
    .sort((x, y) => ORDER[x.v.verdict] - ORDER[y.v.verdict] || y.a.spend.spent - x.a.spend.spent);

  const compareMode = ctx.brandId ? "inter-canaux à marque constante" : ctx.channelKey ? "inter-marques à canal constant" : "vue d'ensemble";

  return (
    <>
      <PageHeader eyebrow="Marketing · Analytics" title="Par canal" subtitle={`Où l'argent travaille : dépense, résultat propre, coût par résultat, verdict par canal × marque. ${period.label} · ${compareMode}.`} />
      <div className="mb-4"><Tabs tabs={ANALYTICS_TABS} current="/marketing/analytics/canaux" /></div>
      <AnalyticsFilters period={ctx.periodKey} brand={ctx.brandId} channel={ctx.channelKey} city={ctx.city} brands={ctx.brands} channels={ctx.channels.filter((c) => c.active)} cities={ctx.cities} />

      {channelRows.length === 0 ? <Empty title="Aucune dépense sur la période" hint={<span>Les canaux se remplissent depuis la régie, les dépenses, l&apos;influence, les contenus, les animations et les échantillons. <Link href="/marketing/analytics/qualite" className="underline">Voir la qualité des données</Link>.</span>} /> : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted">
                <th className="px-4 py-2">Canal</th><th className="px-2 py-2 text-right">Dépense</th><th className="px-2 py-2 text-right">Part</th><th className="px-2 py-2 text-right">Résultat propre</th><th className="px-2 py-2 text-right">Coût / résultat</th><th className="px-2 py-2 text-right">Tendance</th><th className="px-4 py-2 text-right">CA mesuré</th>
              </tr></thead>
              <tbody>
                {channelRows.map((r) => (
                  <tr key={r.key} className="border-t border-line align-top">
                    <td className="px-4 py-2"><Link href={withFilters("/marketing/analytics/canaux", ctx, { channel: r.key })} className="inline-flex items-center gap-2 font-medium hover:underline"><BrandDot color={r.c?.color ?? "#999"} />{r.c?.label ?? r.key}</Link><div className="text-[11px] text-muted">{CHANNEL_FAMILIES[(r.c?.family ?? "OTHER") as ChannelFamily]}</div></td>
                    <td className="px-2 py-2 text-right"><MeasuredValue m={r.spend} unit="MAD" size="sm" /></td>
                    <td className="px-2 py-2 text-right tabular-nums text-xs">{r.share === null ? "—" : fmtPct(r.share)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-xs">{r.resultValue ? <>{fmtNum(r.resultValue)}<div className="text-muted">{ctx.metrics.get(r.resultKey ?? "")?.label ?? r.resultKey}</div></> : <span className="text-muted">non mesuré</span>}</td>
                    <td className="px-2 py-2 text-right">{r.cpr.ok ? <span className="text-sm font-medium tabular-nums">{fmtCpr(r.cpr.value, r.resultKey)}</span> : <MeasuredValue m={r.cpr} unit="MAD" size="sm" />}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-xs">{r.trend === null ? <span className="text-muted">pas encore comparable</span> : <span className={r.trend > 0 ? "text-orange-700" : "text-green-700"}>{r.trend > 0 ? "+" : ""}{Math.round(r.trend)} % coût/résultat</span>}</td>
                    <td className="px-4 py-2 text-right"><MeasuredValue m={r.attributed} unit="MAD" attribution="MEASURED" size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-muted">« Résultat propre » : la métrique de chaque canal (Paramètres → Analytics). La contribution aux ventes n&apos;est affichée que lorsqu&apos;un CA a réellement été mesuré ; le reste est une corrélation observée, visible par marque.</p>
        </Card>
      )}

      <Section title="Verdict par canal × marque" description="Pourquoi d'abord, quoi faire ensuite. Régie : moteur Digital Ads (seuils Paramètres → Publicité). Animation : sell-out TTC attendu par jour. Autres canaux : coût par résultat vs période précédente et vs les autres marques." className="mt-6">
        {verdicts.length === 0 ? <Empty title="Aucun couple canal × marque à diagnostiquer" /> : (
          <div className="grid gap-3 md:grid-cols-2">
            {verdicts.map(({ brandId, channelKey, c, b, a, v }) => (
              <Card key={`${brandId}|${channelKey}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium"><BrandDot color={b?.color ?? "#999"} />{b?.name ?? "?"} <span className="text-muted">×</span> {c.label}</div>
                  <Badge tone={TONE[v.verdict]} dot>{verdictMeta(v.verdict).label}</Badge>
                </div>
                <div className="text-sm font-medium mt-2">{v.headline}</div>
                <p className="text-sm text-ink-2 mt-1"><span className="text-muted">Pourquoi : </span>{v.why}</p>
                <ul className="text-sm mt-2 space-y-1 list-disc pl-5">{v.actions.map((x) => <li key={x}>{x}</li>)}</ul>
                <div className="text-[11px] text-muted mt-2 flex flex-wrap gap-x-3">
                  <span>dépense {a.spend.measurableRows ? fmtMAD(a.spend.spent, { compact: true }) : "non mesurée"}</span>
                  {v.costPerResult && <span>coût par {ctx.metrics.get(v.costPerResult.key)?.label.toLowerCase() ?? v.costPerResult.key} : {fmtCpr(v.costPerResult.value, v.costPerResult.key)}</span>}
                  <span>moteur {v.engine === "ADS" ? "Digital Ads" : v.engine === "ANIMATION" ? "rentabilité animation" : "coût par résultat"}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2 mt-6">
        <Section title="Dépense par canal" description="Journées closes, montants mesurables.">
          <Card><Bars rows={channelRows.map((r) => ({ label: r.c?.label ?? r.key, value: r.a.spend.measurableRows ? r.a.spend.spent : null, color: r.c?.color }))} /></Card>
        </Section>
        <Section title="Coût par résultat" description="Comparable au sein d'un même canal seulement : chaque canal mesure un résultat différent.">
          <Card><Bars rows={channelRows.filter((r) => r.cpr.ok).map((r) => ({ label: r.c?.label ?? r.key, value: PER_100.has(r.resultKey ?? "") ? (r.cpr as { value: number }).value * 100 : (r.cpr as { value: number }).value, color: r.c?.color, sub: PER_100.has(r.resultKey ?? "") ? `pour 100 MAD de ${ctx.metrics.get(r.resultKey ?? "")?.label.toLowerCase()}` : ctx.metrics.get(r.resultKey ?? "")?.label }))} /></Card>
        </Section>
      </div>
    </>
  );
}

const ORDER: Record<ChannelVerdict["verdict"], number> = { STOP: 0, OPTIMIZE: 1, SCALE: 2, MAINTAIN: 3, WATCH: 4 };
