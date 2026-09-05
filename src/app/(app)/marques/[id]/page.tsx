import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { brands as brandsTable } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { getRefDate } from "@/lib/ref-date";
import { byDim, compareMonth, monthlySeries, periodRange, shiftRange, totals, annualObjective, objectiveFor } from "@/lib/analytics";
import { productStocks, LEVEL_LABEL } from "@/lib/stock";
import { getRecommendations } from "@/lib/rules";
import { listUsers } from "@/lib/users";
import { PageHeader, Card, BrandDot, Delta, Progress, Badge, Section } from "@/components/ui";
import { MonthlyRevenueChart, HBarChart } from "@/components/charts";
import { RecommendationCard } from "@/components/recommendation-card";
import { fmtMAD, fmtNum, fmtPct, delta, months, fmtMonth } from "@/lib/format";
import { BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import { updateBrand } from "../actions";

export const dynamic = "force-dynamic";
const LEVEL_TONE = { green: "green", yellow: "yellow", orange: "orange", red: "red", none: "gray", unknown: "gray" } as const;

export default async function BrandPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("marques");
  const { id } = await props.params;
  const brand = await db.query.brands.findFirst({ where: eq(brandsTable.id, id) });
  if (!brand) notFound();
  const { ref } = await getRefDate();
  const year = ref.getUTCFullYear(), month = ref.getUTCMonth() + 1;
  const ytd = periodRange("ytd", ref), ytdN1 = shiftRange(ytd, -12);
  const f = { brandId: id };
  const [cmp, ytdT, ytdN1T, series, seriesN1, products, clients, cities, stocks, recs, users, annualObj, monthObj, budget, lines, expenses] = await Promise.all([
    compareMonth(f, ref), totals(ytd.start, ytd.end, f), totals(ytdN1.start, ytdN1.end, f),
    monthlySeries(13, f, ref), monthlySeries(13, f, new Date(Date.UTC(ref.getUTCFullYear() - 1, ref.getUTCMonth(), ref.getUTCDate(), 12))),
    byDim("product", ytd.start, ytd.end, f, 50), byDim("client", ytd.start, ytd.end, f, 10), byDim("city", ytd.start, ytd.end, f, 8),
    productStocks({ brandId: id }, ref), getRecommendations(), listUsers(), annualObjective(year, id), objectiveFor(year, month, id),
    db.execute(sql`select amount::float8 as amount, reference_revenue::float8 as ref, pct_of_revenue::float8 as pct from budgets where brand_id = ${id}::uuid and year = ${year}`),
    db.execute(sql`select label, category::text as category, amount::float8 as amount from budget_lines where brand_id = ${id}::uuid and year = ${year} order by amount desc`),
    db.execute(sql`select category::text as category, status::text as status, sum(amount)::float8 as amount from marketing_expenses where brand_id = ${id}::uuid and extract(year from date) = ${year} group by 1, 2`),
  ]);
  const brandRecs = recs.filter((r) => r.brandId === id && !r.existingTask);
  const bud = budget.rows[0] as { amount: number; ref: number | null; pct: number | null } | undefined;
  const engaged = (expenses.rows as { category: string; status: string; amount: number }[]).filter((e) => e.status !== "PLANNED").reduce((a, e) => a + e.amount, 0);
  const chart = series.map((m, i) => ({ month: m.month, amount: m.amount, prev: seriesN1[i]?.amount ?? 0 }));

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/marques" className="hover:underline">Marques</Link>}
        title={<span className="flex items-center gap-2"><BrandDot color={brand.color} className="h-3.5 w-3.5" />{brand.name}{!brand.active && <Badge tone="gray">pipeline</Badge>}</span>}
        subtitle={brand.positioning ?? undefined}
        actions={<><Link href={`/ventes?brand=${id}`} className="btn-secondary btn-sm">Ventes</Link><Link href={`/marketing?brand=${id}`} className="btn-secondary btn-sm">Marketing</Link><Link href={`/stock?brand=${id}`} className="btn-secondary btn-sm">Stock</Link></>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card><div className="label">CA {fmtMonth(ref)} (à date)</div><div className="kpi mt-2">{fmtMAD(cmp.current.amount, { compact: true })}</div><div className="mt-2 flex flex-wrap gap-x-3 text-[12px] text-muted"><span className="flex items-center gap-1"><Delta value={delta(cmp.current.amount, cmp.m1.amount)} /> M-1</span><span className="flex items-center gap-1"><Delta value={delta(cmp.current.amount, cmp.n1.amount)} /> N-1</span></div>{monthObj && <div className="mt-1 text-[12px] text-muted">objectif {fmtMAD(monthObj, { compact: true })} · {fmtPct((cmp.current.amount / monthObj) * 100)}</div>}</Card>
        <Card><div className="label">CA {year} à date</div><div className="kpi mt-2">{fmtMAD(ytdT.amount, { compact: true })}</div><div className="mt-2 flex flex-wrap gap-x-3 text-[12px] text-muted"><span className="flex items-center gap-1"><Delta value={delta(ytdT.amount, ytdN1T.amount)} /> N-1</span></div>{annualObj && <><Progress value={(ytdT.amount / annualObj) * 100} className="mt-2" /><div className="mt-1 text-[12px] text-muted">{fmtPct((ytdT.amount / annualObj) * 100)} de {fmtMAD(annualObj, { compact: true })}</div></>}</Card>
        <Card><div className="label">Clients actifs {year}</div><div className="kpi mt-2">{ytdT.clients}</div><div className="mt-2 text-[12px] text-muted">{fmtNum(ytdT.quantity)} unités · {ytdT.orders} commandes</div></Card>
        <Card href={`/marketing?brand=${id}`}><div className="label">Budget marketing {year}</div><div className="kpi mt-2">{bud ? fmtMAD(bud.amount, { compact: true }) : "—"}</div>{bud && <><Progress value={(engaged / bud.amount) * 100} className="mt-2" tone={engaged / bud.amount > 0.9 ? "orange" : "accent"} /><div className="mt-1 text-[12px] text-muted">engagé {fmtMAD(engaged, { compact: true })} ({fmtPct(bud.amount ? (engaged / bud.amount) * 100 : 0)}){bud.pct ? ` · ${fmtPct(bud.pct)} du CA de réf.` : ""}</div></>}</Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Card className="lg:col-span-2" title="CA mensuel — 13 mois vs N-1"><MonthlyRevenueChart data={chart} height={220} /></Card>
        <Card title={`Top villes ${year}`}><HBarChart data={cities.map((c) => ({ name: c.name, amount: c.amount }))} color={brand.color} /></Card>
      </div>

      {brandRecs.length > 0 && (
        <Section title={`Actions ${brand.name}`} action={<Link href="/actions" className="btn-secondary btn-sm">Action Center</Link>}>
          <div className="grid md:grid-cols-2 gap-3">{brandRecs.slice(0, 4).map((r) => <RecommendationCard key={r.key} rec={r} users={users} compact redirectTo={`/marques/${id}`} />)}</div>
        </Section>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Section title={`Produits — ${year} à date`}>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Produit</th><th className="num">CA</th><th className="num">Part</th><th className="num">Unités</th><th className="num">Stock</th><th>Couverture</th></tr></thead>
                <tbody>
                  {products.map((p) => { const st = stocks.find((s) => s.productId === p.id); return (
                    <tr key={p.id}><td><Link href={`/produits/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td><td className="num font-medium">{fmtMAD(p.amount, { suffix: false })}</td><td className="num text-muted">{fmtPct(ytdT.amount ? (p.amount / ytdT.amount) * 100 : 0)}</td><td className="num">{fmtNum(p.quantity)}</td><td className="num">{st?.stockKnown ? fmtNum(st.stock) : "n/c"}</td><td>{st && st.stockKnown ? <Badge tone={LEVEL_TONE[st.level]}>{st.coverageMonths === null ? LEVEL_LABEL[st.level] : months(st.coverageMonths)}</Badge> : "—"}</td></tr>
                  ); })}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title={`Top clients — ${year} à date`}>
            <div className="table-wrap"><table className="tbl"><thead><tr><th>Client</th><th>Ville</th><th className="num">CA</th><th className="num">Unités</th><th className="num">Commandes</th></tr></thead><tbody>
              {clients.map((c) => <tr key={c.id}><td><Link href={`/clients/${c.id}`} className="font-medium hover:underline">{c.name}</Link></td><td className="text-muted">{c.extra}</td><td className="num font-medium">{fmtMAD(c.amount, { suffix: false })}</td><td className="num">{fmtNum(c.quantity)}</td><td className="num">{c.orders}</td></tr>)}
            </tbody></table></div>
          </Section>
        </div>
        <div className="space-y-4">
          {lines.rows.length > 0 && (
            <Card title={`Plan budget ${year}`}>
              <ul className="text-[13px] space-y-1.5">{(lines.rows as { label: string; category: string; amount: number }[]).map((l, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{l.label} <span className="text-faint text-[11px]">{BUDGET_CATEGORY_LABELS[l.category as keyof typeof BUDGET_CATEGORY_LABELS]}</span></span><span className="font-medium shrink-0">{fmtMAD(l.amount, { compact: true })}</span></li>)}</ul>
            </Card>
          )}
          <Card title="Stratégie marketing">
            <form action={updateBrand} className="space-y-2 text-[13px]">
              <input type="hidden" name="id" value={id} />
              <label className="block"><span className="label block mb-1">Positionnement</span><textarea name="positioning" defaultValue={brand.positioning ?? ""} className="textarea min-h-[56px]" /></label>
              <label className="block"><span className="label block mb-1">Cible</span><textarea name="target" defaultValue={brand.target ?? ""} className="textarea min-h-[56px]" /></label>
              <label className="block"><span className="label block mb-1">Objectifs & KPI</span><textarea name="objectives" defaultValue={brand.objectives ?? ""} className="textarea min-h-[56px]" /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="label block mb-1">Couleur</span><input type="color" name="color" defaultValue={brand.color} className="input h-9 p-1" /></label>
                <label className="block"><span className="label block mb-1">Alias (import)</span><input name="aliases" defaultValue={brand.aliases.join(", ")} className="input h-9" /></label>
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={brand.active} /> Marque active</label>
              {user.role !== "ANIMATRICE" && <button className="btn-secondary btn-sm w-full" type="submit">Enregistrer</button>}
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
