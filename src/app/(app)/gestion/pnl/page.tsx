import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { pnlStatement } from "@/lib/pnl";
import { MONTHS_SHORT } from "@/lib/pnl-shared";
import { fmtDate, fmtMAD, fmtPct, delta, today } from "@/lib/format";
import { PageHeader, Card, Kpi, Section, Badge, BrandDot } from "@/components/ui";
import { PnlMonthlyChart } from "@/components/charts";
import { PnlTable } from "@/components/gestion/pnl-table";
import { PnlTabs } from "@/components/gestion/gestion-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "P&L" };

const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export default async function PnlPage(props: { searchParams: Promise<{ year?: string; to?: string; brand?: string }> }) {
  await requireAdmin();
  const sp = await props.searchParams;
  const now = today();
  const curYear = now.getUTCFullYear();
  const year = Number(sp.year) >= 2020 && Number(sp.year) <= curYear + 1 ? Number(sp.year) : curYear;
  const defaultTo = year < curYear ? 12 : year === curYear ? now.getUTCMonth() + 1 : 12;
  const to = Number(sp.to) >= 1 && Number(sp.to) <= 12 ? Number(sp.to) : defaultTo;
  const brandId = sp.brand && /^[0-9a-f-]{36}$/i.test(sp.brand) ? sp.brand : null;

  const s = await pnlStatement(year, to, brandId);
  const k = s.kpis, p = s.previous.kpis;
  const partial = year === curYear && to === now.getUTCMonth() + 1;
  const prevHasCharges = s.previous.quality.monthsWithoutCharges.length < to;
  const COMPARABLE = /^(ca|cogs|marge_brute|taux_marge|marketing|revente_distributeur)/;
  const previous: Record<string, number | undefined> = {};
  for (const l of s.previous.lines) if (prevHasCharges || COMPARABLE.test(l.key)) previous[l.key] = l.total;

  const byKey = (key: string) => s.lines.find((l) => l.key === key)!;
  const chart = Array.from({ length: to }, (_, i) => ({
    month: `${year}-${String(i + 1).padStart(2, "0")}`,
    revenue: byKey("ca").months[i], gross: byKey("marge_brute").months[i], net: byKey("resultat_net").months[i],
  }));
  const brandName = brandId ? s.brandList.find((b) => b.id === brandId)?.name : null;
  const q = s.quality;
  const noCharges = q.monthsWithoutCharges.length === to;

  return (
    <>
      <PageHeader
        eyebrow="Gestion commerciale"
        title={`P&L ${year}${brandName ? ` — ${brandName}` : ""}`}
        subtitle={`De janvier à ${MONTHS_LONG[to - 1]}${partial ? " (mois en cours)" : ""}. CA HT de COMANET : ventes directes, ventes en bloc aux distributeurs et commissions de prestation ; la revente des distributeurs n'est pas notre CA.`}
        actions={<><Link href={`/gestion/pnl/charges?year=${year}&new=1`} className="btn-secondary btn-sm">+ Charge</Link><Link href={`/gestion/pnl/ventes-bloc?year=${year}&new=1`} className="btn-primary btn-sm">+ Vente en bloc</Link></>}
      >
        <PnlTabs current="/gestion/pnl" year={year} />
      </PageHeader>

      <form className="flex flex-wrap items-end gap-2 mb-4 text-[13px]" method="get">
        <label><span className="label block mb-1">Année</span>
          <select name="year" defaultValue={year} className="select h-9">{[curYear - 2, curYear - 1, curYear].map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </label>
        <label><span className="label block mb-1">Jusqu’à</span>
          <select name="to" defaultValue={to} className="select h-9">{MONTHS_LONG.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        </label>
        <label><span className="label block mb-1">Périmètre</span>
          <select name="brand" defaultValue={brandId ?? ""} className="select h-9">
            <option value="">Toute la société</option>
            {s.brandList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <button className="btn-primary btn-sm h-9">Afficher</button>
        <span className="text-[12px] text-faint ml-auto">
          Ventes COMANET au {s.freshness.direct ? fmtDate(s.freshness.direct) : "—"}
          {s.freshness.prestations.map((x) => ` · ${x.label} au ${x.last ? fmtDate(x.last) : "—"}`).join("")}
        </span>
      </form>

      {brandId && <div className="mb-4 rounded-2xl bg-surface-2 border border-line px-4 py-2.5 text-[12.5px] text-muted">Vue marque : CA, coût, marketing et charges <b>affectées à la marque</b>. Les frais communs (loyer, salaires non affectés…) ne sont pas répartis d’office — la contribution de la marque est ce qu’elle apporte pour les couvrir.</div>}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        <Kpi label="CA HT" value={fmtMAD(k.revenue, { compact: true })} delta={delta(k.revenue, p.revenue)} deltaLabel="vs N-1" />
        <Kpi label="Marge brute" value={fmtMAD(k.grossMargin, { compact: true })} sub={k.grossMarginPct !== null ? `${fmtPct(k.grossMarginPct, 1)} du CA` : "—"} />
        <Kpi label="Marketing" value={fmtMAD(k.marketing, { compact: true })} sub={k.revenue ? `${fmtPct((k.marketing / k.revenue) * 100, 1)} du CA` : "—"} invert delta={delta(k.marketing, p.marketing)} />
        <Kpi label="Résultat d'exploitation" value={fmtMAD(k.operatingResult, { compact: true })} tone={k.operatingResult < 0 ? "red" : "green"} sub={noCharges ? "aucune charge saisie" : undefined} />
        <Kpi label="Résultat net" value={fmtMAD(k.netResult, { compact: true })} tone={k.netResult < 0 ? "red" : "green"} sub={k.netMarginPct !== null ? `${fmtPct(k.netMarginPct, 1)} du CA` : "—"} />
        <Kpi label="Point mort mensuel" value={k.breakEvenMonthly !== null ? fmtMAD(k.breakEvenMonthly, { compact: true }) : "—"} sub={k.monthlyFixed ? `CA pour couvrir ${fmtMAD(k.monthlyFixed, { compact: true })} de fixes/mois` : "saisir les charges fixes"} />
      </div>

      {(noCharges || q.missingCost.length > 0 || q.bulkWithoutCost > 0 || q.unknownSites.length > 0) && (
        <Card className="mb-4" title="À compléter pour un P&L exact">
          <ul className="space-y-1.5 text-[13px]">
            {q.monthsWithoutCharges.length > 0 && (
              <li className="flex gap-2"><Badge tone="orange">Charges</Badge><span>Aucune charge saisie pour {q.monthsWithoutCharges.length === to ? "la période" : q.monthsWithoutCharges.map((m) => MONTHS_SHORT[m - 1]).join(", ")} : salaires, loyer, internet… <Link href={`/gestion/pnl/charges?year=${year}&new=1`} className="underline">Saisir les charges</Link> (une charge mensuelle se déclare une fois).</span></li>
            )}
            {q.missingCost.length > 0 && (
              <li className="flex gap-2"><Badge tone="red">Coût</Badge><span>{fmtMAD(q.missingCost.reduce((a, x) => a + x.amount, 0))} de ventes directes sans prix d’achat ({q.missingCost.map((x) => `${s.brandList.find((b) => b.id === x.brandId)?.name ?? "sans marque"} ${fmtMAD(x.amount, { compact: true })}`).join(", ")}) : leur coût n’est pas compté. <Link href="/produits" className="underline">Renseigner les prix d’achat</Link>.</span></li>
            )}
            {q.bulkWithoutCost > 0 && <li className="flex gap-2"><Badge tone="red">Coût</Badge><span>{fmtMAD(q.bulkWithoutCost)} de ventes en bloc sans coût d’achat. <Link href={`/gestion/pnl/ventes-bloc?year=${year}`} className="underline">Compléter</Link>.</span></li>}
            {q.unknownSites.length > 0 && <li className="flex gap-2"><Badge tone="yellow">Site</Badge><span>Sites non classés, exclus du P&L : {q.unknownSites.map((x) => `${x.site} (${fmtMAD(x.amount, { compact: true })})`).join(", ")}. <Link href="/gestion/pnl/regles" className="underline">Les classer</Link>.</span></li>}
          </ul>
        </Card>
      )}

      <Card className="mb-4" title="Évolution mensuelle"><PnlMonthlyChart data={chart} /></Card>

      <div className="mb-6"><PnlTable lines={s.lines} lastMonth={to} previous={previous} revenueTotal={k.revenue} /></div>
      {!prevHasCharges && <p className="-mt-4 mb-6 text-[12px] text-faint">N-1 : comparable pour le CA, la marge et le marketing ; pas pour les charges (aucune charge saisie sur {year - 1}).</p>}

      <Section title="Contribution par marque" description="CA COMANET, coût des ventes, marketing et charges affectées à la marque. Ce qui reste couvre les frais communs.">
        <div className="card overflow-x-auto">
          <table className="tbl w-full text-[13px] tabular-nums">
            <thead><tr><th className="text-left">Marque</th><th className="text-right">CA HT</th><th className="text-right">dont commission</th><th className="text-right">Coût des ventes</th><th className="text-right">Marge brute</th><th className="text-right">Marketing</th><th className="text-right">Charges affectées</th><th className="text-right">Contribution</th><th className="text-right">% CA</th></tr></thead>
            <tbody>
              {s.brands.map((b) => (
                <tr key={b.brandId}>
                  <td><Link href={`/gestion/pnl?year=${year}&to=${to}&brand=${b.brandId}`} className="inline-flex items-center gap-2 font-medium hover:underline"><BrandDot color={b.color} />{b.name}</Link>{b.missingCostAmount > 0 && <Badge tone="red" className="ml-2">coût incomplet</Badge>}</td>
                  <td className="text-right">{fmtMAD(b.revenue, { suffix: false })}</td>
                  <td className="text-right text-muted">{b.commission ? fmtMAD(b.commission, { suffix: false }) : "—"}</td>
                  <td className="text-right">{fmtMAD(b.cogs, { suffix: false })}</td>
                  <td className="text-right">{fmtMAD(b.grossMargin, { suffix: false })}</td>
                  <td className="text-right">{fmtMAD(b.marketing, { suffix: false })}</td>
                  <td className="text-right">{b.charges ? fmtMAD(b.charges, { suffix: false }) : "—"}</td>
                  <td className={`text-right font-semibold ${b.contribution < 0 ? "text-red" : ""}`}>{fmtMAD(b.contribution, { suffix: false })}</td>
                  <td className="text-right text-muted">{b.revenue ? fmtPct((b.contribution / b.revenue) * 100, 0) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
