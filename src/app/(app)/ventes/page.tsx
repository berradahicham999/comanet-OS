import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { byDim, dailySeries, filterOptions, monthlySeries, totals, type Dim, type SalesFilter } from "@/lib/analytics";
import { getRefDate } from "@/lib/ref-date";
import { resolvePeriod, type PeriodParam } from "@/lib/periods";
import { PageHeader, Card, Delta, Tabs, BrandDot, Badge } from "@/components/ui";
import { SalesFilters, type FilterValues } from "@/components/sales-filters";
import { MonthlyRevenueChart, SimpleLine } from "@/components/charts";
import { delta, fmtMAD, fmtNum, fmtPct, fmtDateShort } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ventes" };

const DIMS: { key: Dim; label: string; href: (id: string) => string | null }[] = [
  { key: "brand", label: "Par marque", href: (id) => `/marques/${id}` },
  { key: "product", label: "Par produit", href: (id) => `/produits/${id}` },
  { key: "client", label: "Par client", href: (id) => `/clients/${id}` },
  { key: "city", label: "Par ville", href: () => null },
  { key: "channel", label: "Par canal", href: () => null },
  { key: "rep", label: "Par commercial", href: () => null },
  { key: "clientType", label: "Par type de client", href: () => null },
];

export default async function VentesPage(props: { searchParams: Promise<FilterValues> }) {
  await requireAccess("ventes");
  const sp = await props.searchParams;
  const { ref } = await getRefDate();
  const period = resolvePeriod(sp.period as PeriodParam, ref, { start: sp.start, end: sp.end });
  const filter: SalesFilter = { brandId: sp.brand || undefined, city: sp.city || undefined, channel: sp.channel || undefined, salesRep: sp.rep || undefined, clientType: sp.type || undefined };
  const dim = (DIMS.find((d) => d.key === sp.dim)?.key ?? "brand") as Dim;

  const [cur, prev, n1, rows, prevRows, options, series] = await Promise.all([
    totals(period.start, period.end, filter),
    totals(period.prev.start, period.prev.end, filter),
    totals(period.n1.start, period.n1.end, filter),
    byDim(dim, period.start, period.end, filter, 300),
    byDim(dim, period.prev.start, period.prev.end, filter, 2000),
    filterOptions(),
    period.days > 62 ? monthlySeries(Math.min(24, Math.ceil(period.days / 30) + 1), filter, ref).then((s) => ({ kind: "monthly" as const, data: s.filter((m) => m.month >= period.start.slice(0, 7)) })) : dailySeries(period.start, period.end, filter).then((d) => ({ kind: "daily" as const, data: d })),
  ]);
  const prevMap = new Map(prevRows.map((r) => [r.id, r.amount]));
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, String(v));
    return `/ventes?${p.toString()}`;
  };
  const dimDef = DIMS.find((d) => d.key === dim)!;

  return (
    <>
      <PageHeader eyebrow="Analytique commerciale" title="Ventes" subtitle={`${period.label} · comparé à ${period.prev.label} et N-1`}>
        <SalesFilters values={{ ...sp, dim }} options={options} action="/ventes" />
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card>
          <div className="label">Chiffre d&apos;affaires HT</div>
          <div className="kpi mt-2">{fmtMAD(cur.amount, { compact: true })}</div>
          <div className="mt-2 flex flex-wrap gap-x-3 text-[12px] text-muted"><span className="flex items-center gap-1"><Delta value={delta(cur.amount, prev.amount)} /> {period.prev.label}</span><span className="flex items-center gap-1"><Delta value={delta(cur.amount, n1.amount)} /> N-1</span></div>
        </Card>
        <Card>
          <div className="label">Unités vendues</div>
          <div className="kpi mt-2">{fmtNum(cur.quantity)}</div>
          <div className="mt-2 flex flex-wrap gap-x-3 text-[12px] text-muted"><span className="flex items-center gap-1"><Delta value={delta(cur.quantity, prev.quantity)} /> {period.prev.label}</span></div>
        </Card>
        <Card>
          <div className="label">Commandes</div>
          <div className="kpi mt-2">{fmtNum(cur.orders)}</div>
          <div className="mt-2 text-[12px] text-muted">panier moyen {fmtMAD(cur.orders ? cur.amount / cur.orders : 0, { compact: true })}</div>
        </Card>
        <Card>
          <div className="label">Clients actifs</div>
          <div className="kpi mt-2">{fmtNum(cur.clients)}</div>
          <div className="mt-2 flex flex-wrap gap-x-3 text-[12px] text-muted"><span className="flex items-center gap-1"><Delta value={delta(cur.clients, prev.clients)} /> {period.prev.label}</span><span>{fmtMAD(cur.clients ? cur.amount / cur.clients : 0, { compact: true })} / client</span></div>
        </Card>
      </div>

      <Card className="mb-4" title={series.kind === "monthly" ? "CA mensuel" : "CA journalier"}>
        {series.kind === "monthly"
          ? <MonthlyRevenueChart data={series.data.map((m) => ({ month: m.month, amount: m.amount }))} height={200} />
          : <SimpleLine data={series.data.map((d) => ({ day: fmtDateShort(d.day), amount: d.amount }))} xKey="day" yKey="amount" height={200} />}
      </Card>

      <div className="mb-3">
        <Tabs current={qs({ dim })} tabs={DIMS.map((d) => ({ href: qs({ dim: d.key }), label: d.label }))} />
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th><th>{dimDef.label.replace("Par ", "")}</th>{dim === "product" && <th>Marque</th>}{dim === "client" && <th>Ville</th>}
              <th className="num">CA HT</th><th className="num">Part</th><th className="num">Unités</th><th className="num">Commandes</th><th className="num">Clients</th><th className="num">vs {period.prev.label}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const href = dimDef.href(r.id);
              return (
                <tr key={r.id}>
                  <td className="text-faint">{i + 1}</td>
                  <td className="font-medium">
                    {dim === "brand" && <BrandDot color={r.extra ?? "#999"} className="mr-2" />}
                    {href ? <Link href={href} className="hover:underline">{r.name}</Link> : r.name}
                  </td>
                  {dim === "product" && <td className="text-muted">{r.extra}</td>}
                  {dim === "client" && <td className="text-muted">{r.extra}</td>}
                  <td className="num font-medium">{fmtMAD(r.amount, { suffix: false })}</td>
                  <td className="num text-muted">{fmtPct(total ? (r.amount / total) * 100 : 0, 1)}</td>
                  <td className="num">{fmtNum(r.quantity)}</td>
                  <td className="num">{fmtNum(r.orders)}</td>
                  <td className="num">{fmtNum(r.clients)}</td>
                  <td className="num"><Delta value={delta(r.amount, prevMap.get(r.id) ?? 0)} size="xs" /></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={9} className="text-center text-muted py-8">Aucune vente sur cette période.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length >= 300 && <div className="text-[12px] text-faint mt-2"><Badge tone="gray">300 premières lignes</Badge></div>}
    </>
  );
}
