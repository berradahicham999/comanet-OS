import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notFound } from "next/navigation";
import { requireAccess, brandFilter } from "@/lib/access";
import { listBrands } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import { aggregate, aggregateBy, listChannels, listMetricDefinitions, monthlySeries } from "@/lib/analytics-marketing/queries";
import { compute } from "@/lib/analytics-marketing/metrics";
import { channelVerdicts, reallocationsFrom } from "@/lib/analytics-marketing/decision";
import { reallocationSentence } from "@/lib/analytics-marketing/reallocation";
import { classifyInvestment, INVESTMENT_LABELS } from "@/lib/analytics-marketing/analysis";
import { dataCompleteness, qualityReport } from "@/lib/analytics-marketing/quality";
import { verdictMeta } from "@/lib/ads";
import { PageHeader, Card, Badge, BrandDot, Section } from "@/components/ui";
import { MeasuredValue, fmtCostPerResult } from "@/components/analytics";
import { PrintButton } from "@/components/print-button";
import { fmtMAD, fmtMonth, fmtNum, fmtPct, iso, startOfMonth, addMonths, today } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revue mensuelle de marque" };

const TONE: Record<string, "green" | "blue" | "orange" | "red" | "gray"> = { SCALE: "green", MAINTAIN: "blue", OPTIMIZE: "orange", STOP: "red", WATCH: "gray" };

/**
 * MONTHLY BRAND REVIEW : une page par marque et par mois, générée depuis la couche de faits,
 * imprimable (Imprimer / enregistrer en PDF) et partageable par son adresse.
 */
export default async function BrandReviewPage(props: { params: Promise<{ brand: string }>; searchParams: Promise<{ mois?: string }> }) {
  await requireAccess("marketing");
  const { brand: brandId } = await props.params;
  const sp = await props.searchParams;
  const [scope, brands, settings, channels, defs, completeness] = await Promise.all([brandFilter(), listBrands(), getSettings(), listChannels(), listMetricDefinitions(), dataCompleteness()]);
  const brand = brands.find((b) => b.id === brandId && b.active && !b.mergedIntoId && (scope === null || scope.includes(b.id)));
  if (!brand) notFound();

  const month = sp.mois && /^\d{4}-\d{2}$/.test(sp.mois) ? sp.mois : iso(addMonths(startOfMonth(today()), -1)).slice(0, 7);
  const start = `${month}-01`;
  const monthStart = new Date(start + "T12:00:00Z");
  const end = iso(addMonths(monthStart, 1));
  const prev = { start: iso(addMonths(monthStart, -1)), end: start };
  const n1 = { start: iso(addMonths(monthStart, -12)), end: iso(addMonths(monthStart, -11)) };
  const range = { start, end };
  const ref = new Date(end + "T12:00:00Z");
  const mctx = { settings: settings.analytics, health: { stockCoverageOk: null, dataQuality: completeness } };

  const [a, prevA, byChannel, verdicts, byProduct, series, quality] = await Promise.all([
    aggregate({ range, prev, n1, brandIds: [brandId] }),
    aggregate({ range: prev, brandIds: [brandId] }),
    aggregateBy("channel", { range, prev, brandIds: [brandId] }),
    channelVerdicts({ range, prev, brandIds: [brandId], ref, settings }),
    aggregateBy("product", { range, prev, brandIds: [brandId] }),
    monthlySeries({ brandIds: [brandId] }, end, 12),
    qualityReport(),
  ]);
  const labels = { brand: () => brand.name, channel: (k: string) => channels.find((c) => c.key === k)?.label ?? k, result: (k: string) => defs.find((d) => d.key === k)?.label ?? k };
  const reallocations = reallocationsFrom(verdicts, settings, labels);
  const m = {
    sellIn: compute("SELL_IN", a, mctx), sellOut: compute("SELL_OUT", a, mctx), spend: compute("SPEND_SPENT", a, mctx), budgetPct: compute("BUDGET_CONSUMED_PCT", a, mctx),
    intensity: compute("MARKETING_INTENSITY", a, mctx), objective: compute("OBJECTIVE_ATTAINMENT", a, mctx), growth: compute("SALES_GROWTH_PREV", a, mctx), growthN1: compute("SALES_GROWTH_N1", a, mctx),
    roi: compute("ROI_MEASURED", a, mctx), roiC: compute("ROI_CORRELATED", a, mctx), attributed: compute("ATTRIBUTED_REVENUE", a, mctx), health: compute("HEALTH_SCORE", a, mctx),
    spendShare: compute("SPEND_SHARE", a, mctx), salesShare: compute("SALES_SHARE", a, mctx), margin: compute("MARGIN", a, mctx),
  };
  const inv = classifyInvestment(m.spendShare.ok ? m.spendShare.value / 100 : null, m.salesShare.ok ? m.salesShare.value / 100 : null, settings.analytics.investmentBalancePts);
  const prevSpend = compute("SPEND_SPENT", prevA, mctx);
  const topProducts = byProduct.filter((r) => r.key).sort((x, y) => y.aggregate.sales.sellIn - x.aggregate.sales.sellIn).slice(0, 8);
  const productNames = new Map((await db.execute<{ id: string; name: string }>(sql`select id::text as id, name from products where brand_id = ${brandId}::uuid`)).rows.map((r) => [r.id, r.name]));
  const brandIssues = quality.issues.filter((i) => i.count > 0 && (i.samples.some((s) => s.toLowerCase().includes(brand.name.toLowerCase())) || ["brands-no-budget", "brands-no-objective", "months-no-sales", "anim-no-cost"].includes(i.key)));

  return (
    <>
      <div className="print:hidden">
        <PageHeader eyebrow="Marketing · Analytics" title={`Revue mensuelle — ${brand.name}`} subtitle={`${fmtMonth(start)} · générée depuis la couche de faits, comparée au mois précédent et au même mois N-1.`}
          actions={<div className="flex gap-2 items-center"><form method="get" className="flex gap-2"><input type="month" name="mois" defaultValue={month} className="h-9 rounded-lg border border-line-2 bg-surface px-2 text-sm" /><button className="btn-ghost btn-sm">Changer de mois</button></form><PrintButton /></div>} />
        <div className="flex gap-2 flex-wrap mb-4 text-xs">
          {brands.filter((b) => b.active && !b.mergedIntoId && (scope === null || scope.includes(b.id))).map((b) => <Link key={b.id} href={`/marketing/analytics/revue/${b.id}?mois=${month}`} className={b.id === brandId ? "btn-primary btn-sm" : "btn-ghost btn-sm"}>{b.name}</Link>)}
        </div>
      </div>
      <div className="hidden print:block mb-4"><h1 className="text-2xl font-semibold">{brand.name} — revue mensuelle {fmtMonth(start)}</h1><p className="text-sm text-muted">COMANET OS · générée le {new Date().toLocaleDateString("fr-FR")} · complétude des données {completeness === null ? "—" : `${Math.round(completeness * 100)} %`}</p></div>

      <Section title="Les chiffres du mois">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card title="CA sell-in"><MeasuredValue m={m.sellIn} unit="MAD" size="lg" /><div className="text-xs text-muted mt-1">{m.growth.ok && `${fmtPct(m.growth.value, 0, true)} vs mois précédent`}{m.growthN1.ok && ` · ${fmtPct(m.growthN1.value, 0, true)} vs N-1`}</div><div className="text-xs mt-1">{m.objective.ok ? <span className={m.objective.value >= 100 ? "text-green-700" : "text-orange-700"}>{fmtPct(m.objective.value)} de l&apos;objectif</span> : <MeasuredValue m={m.objective} unit="PCT" size="sm" />}</div></Card>
          <Card title="Sell-out terrain"><MeasuredValue m={m.sellOut} unit="MAD" size="lg" /><div className="text-xs text-muted mt-1">Marge sell-in : <MeasuredValue m={m.margin} unit="MAD" size="sm" /></div></Card>
          <Card title="Dépense marketing"><MeasuredValue m={m.spend} unit="MAD" size="lg" /><div className="text-xs text-muted mt-1">{prevSpend.ok && m.spend.ok && prevSpend.value > 0 && `${fmtPct(((m.spend.value - prevSpend.value) / prevSpend.value) * 100, 0, true)} vs mois précédent`}</div><div className="text-xs mt-1">{m.budgetPct.ok ? `${fmtPct(m.budgetPct.value)} de l'enveloppe annuelle` : <MeasuredValue m={m.budgetPct} unit="PCT" size="sm" />}</div></Card>
          <Card title="Retour"><MeasuredValue m={m.roi} unit="MULTIPLE" attribution="MEASURED" size="lg" /><div className="text-xs mt-1"><span className="text-muted">Retour observé : </span><MeasuredValue m={m.roiC} unit="MULTIPLE" attribution="CORRELATION" size="sm" /></div></Card>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <Card title="Intensité marketing"><MeasuredValue m={m.intensity} unit="PCT" size="md" /></Card>
          <Card title="Place dans le portefeuille"><div className="text-sm">{m.spendShare.ok ? fmtPct(m.spendShare.value) : "—"} du budget · {m.salesShare.ok ? fmtPct(m.salesShare.value) : "—"} du CA</div><Badge tone={INVESTMENT_LABELS[inv.cls].tone} className="mt-1">{INVESTMENT_LABELS[inv.cls].label}{inv.balancePts !== null && ` (${inv.balancePts > 0 ? "+" : ""}${inv.balancePts.toFixed(1)} pt)`}</Badge></Card>
          <Card title="CA mesuré"><MeasuredValue m={m.attributed} unit="MAD" attribution="MEASURED" size="md" /></Card>
          <Card title="Score de santé"><MeasuredValue m={m.health} unit="SCORE" size="md" /></Card>
        </div>
      </Section>

      <Section title="Canaux du mois" description="Dépense, résultat propre, coût par résultat et verdict." className="mt-6">
        <Card pad={false}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2">Canal</th><th className="px-2 py-2 text-right">Dépense</th><th className="px-2 py-2 text-right">Résultat propre</th><th className="px-2 py-2 text-right">Coût / résultat</th><th className="px-4 py-2">Verdict</th></tr></thead>
            <tbody>
              {byChannel.length === 0 && <tr><td colSpan={5} className="px-4 py-3 text-xs text-muted">Aucune dépense ni résultat enregistré ce mois.</td></tr>}
              {byChannel.map((r) => {
                const c = channels.find((x) => x.key === r.key);
                const v = verdicts.find((x) => x.channelKey === r.key)?.verdict;
                const rm = { key: c?.resultMetric ?? null, fallback: c?.fallbackResultMetric ?? null };
                const cpr = compute("COST_PER_RESULT", r.aggregate, { ...mctx, resultMetric: rm });
                const rk = rm.key && (r.aggregate.results[rm.key] ?? 0) > 0 ? rm.key : rm.fallback && (r.aggregate.results[rm.fallback] ?? 0) > 0 ? rm.fallback : null;
                return (
                  <tr key={r.key} className="border-t border-line align-top">
                    <td className="px-4 py-2"><span className="inline-flex items-center gap-2"><BrandDot color={c?.color ?? "#999"} />{c?.label ?? r.key}</span></td>
                    <td className="px-2 py-2 text-right"><MeasuredValue m={compute("SPEND_SPENT", r.aggregate, mctx)} unit="MAD" size="sm" /></td>
                    <td className="px-2 py-2 text-right text-xs tabular-nums">{rk ? <>{fmtNum(r.aggregate.results[rk] ?? 0)}<div className="text-muted">{labels.result(rk)}</div></> : <span className="text-muted">non mesuré</span>}</td>
                    <td className="px-2 py-2 text-right text-xs">{cpr.ok ? fmtCostPerResult(cpr.value, rk) : <MeasuredValue m={cpr} unit="MAD" size="sm" />}</td>
                    <td className="px-4 py-2">{v ? <><Badge tone={TONE[v.verdict]} dot>{verdictMeta(v.verdict).label}</Badge><div className="text-xs mt-1">{v.headline}</div><div className="text-[11px] text-muted">{v.why}</div></> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2 mt-6">
        <Section title="Décisions proposées" description="Réallocations et actions issues des verdicts. Chaque proposition existe aussi dans l'Action Center.">
          <Card>
            {reallocations.length === 0 && verdicts.every((v) => v.verdict.verdict === "MAINTAIN" || v.verdict.verdict === "WATCH") ? <p className="text-sm text-muted">Rien à réallouer ce mois : aucun canal en échec avec un canal performant en face.</p> : (
              <ul className="space-y-3 text-sm">
                {reallocations.map((r) => <li key={r.key}><div className="font-medium">{reallocationSentence(r, labels)}</div><div className="text-xs text-muted">Confiance {r.confidence.toLowerCase()} — {r.confidenceWhy}.</div></li>)}
                {verdicts.filter((v) => v.verdict.verdict === "STOP" || v.verdict.verdict === "OPTIMIZE").map((v) => <li key={v.channelKey}><div className="font-medium">{labels.channel(v.channelKey)} : {v.verdict.headline}</div><ul className="list-disc pl-5 text-xs text-ink-2">{v.verdict.actions.map((x) => <li key={x}>{x}</li>)}</ul></li>)}
              </ul>
            )}
            <Link href={`/actions?brand=${brandId}`} className="btn-ghost btn-sm mt-3 print:hidden">Ouvrir l&apos;Action Center</Link>
          </Card>
        </Section>
        <Section title="Produits du mois" description="Les huit premiers par sell-in, avec la dépense qui leur a été allouée.">
          <Card pad={false}>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2">Produit</th><th className="px-2 py-2 text-right">Sell-in</th><th className="px-2 py-2 text-right">Sell-out</th><th className="px-4 py-2 text-right">Dépense allouée</th></tr></thead>
              <tbody>
                {topProducts.length === 0 && <tr><td colSpan={4} className="px-4 py-3 text-xs text-muted">Aucune vente ce mois.</td></tr>}
                {topProducts.map((r) => <tr key={r.key} className="border-t border-line"><td className="px-4 py-1.5 truncate max-w-[220px]">{productNames.get(r.key) ?? r.key.slice(0, 8)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmtMAD(r.aggregate.sales.sellIn, { compact: true })}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.aggregate.sales.sellOut > 0 ? fmtMAD(r.aggregate.sales.sellOut, { compact: true }) : "—"}</td><td className="px-4 py-1.5 text-right tabular-nums">{r.aggregate.spend.measurableRows ? fmtMAD(r.aggregate.spend.spent, { compact: true }) : "—"}</td></tr>)}
              </tbody>
            </table>
          </Card>
        </Section>
      </div>

      <Section title="Tendance 12 mois" className="mt-6">
        <Card pad={false}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2">Mois</th><th className="px-2 py-2 text-right">Dépense</th><th className="px-2 py-2 text-right">Sell-in</th><th className="px-4 py-2 text-right">Sell-out</th></tr></thead>
            <tbody>{series.map((s) => <tr key={s.month} className="border-t border-line"><td className="px-4 py-1">{fmtMonth(s.month + "-01")}</td><td className="px-2 py-1 text-right tabular-nums">{s.rows ? fmtMAD(s.spent, { compact: true }) : "—"}</td><td className="px-2 py-1 text-right tabular-nums">{s.salesRows ? fmtMAD(s.sellIn, { compact: true }) : <span className="text-muted">pas d&apos;import</span>}</td><td className="px-4 py-1 text-right tabular-nums">{s.sellOut > 0 ? fmtMAD(s.sellOut, { compact: true }) : "—"}</td></tr>)}</tbody>
          </table>
        </Card>
      </Section>

      {brandIssues.length > 0 && (
        <Section title="Ce qui manque pour fiabiliser cette revue" className="mt-6">
          <Card><ul className="text-sm space-y-1">{brandIssues.map((i) => <li key={i.key}><span className="font-medium">{i.label}</span> — {i.owner}{i.count > 1 ? ` (${fmtNum(i.count)})` : ""}</li>)}</ul></Card>
        </Section>
      )}
      <p className="text-xs text-muted mt-4">Complétude des données : {completeness === null ? "—" : `${Math.round(completeness * 100)} %`}. « Corrélation observée » compare des périodes et ne prouve pas une cause ; « mesuré » vient de la régie, d&apos;un code promo ou d&apos;une saisie.</p>
    </>
  );
}
