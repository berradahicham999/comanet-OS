import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { getRefDate } from "@/lib/ref-date";
import { byDim, periodRange, shiftRange, annualObjective, totals } from "@/lib/analytics";
import { listBrands } from "@/lib/users";
import { budgetConsumptionByBrand } from "@/lib/budget";
import { PageHeader, Card, BrandDot, Delta, Progress, Badge } from "@/components/ui";
import { fmtMAD, fmtNum, fmtPct, delta } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marques" };

export default async function MarquesPage() {
  await requireAccess("marques");
  const { ref } = await getRefDate();
  const year = ref.getUTCFullYear();
  const ytd = periodRange("ytd", ref), ytdN1 = shiftRange(ytd, -12);
  const [brands, cur, prev, counts, budgets] = await Promise.all([
    listBrands(),
    byDim("brand", ytd.start, ytd.end),
    byDim("brand", ytdN1.start, ytdN1.end),
    db.execute(sql`select brand_id, count(*)::int as n from products where active group by brand_id`),
    budgetConsumptionByBrand(year),
  ]);
  const objectives = await Promise.all(brands.map((b) => annualObjective(year, b.id)));
  const total = await totals(ytd.start, ytd.end);
  const curMap = new Map(cur.map((r) => [r.id, r])), prevMap = new Map(prev.map((r) => [r.id, r.amount]));
  const countMap = new Map((counts.rows as { brand_id: string; n: number }[]).map((r) => [r.brand_id, r.n]));
  // Budget consommé : définition officielle unique (`src/lib/budget.ts`).
  const budgetMap = budgets;

  return (
    <>
      <PageHeader eyebrow="Portefeuille" title="Marques" subtitle={`Année ${year} à date · ${fmtMAD(total.amount, { compact: true })} au total`} />
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {brands.map((b, i) => {
          const c = curMap.get(b.id);
          const amount = c?.amount ?? 0;
          const obj = objectives[i];
          const bud = budgetMap.get(b.id);
          return (
            <Card key={b.id} href={`/marques/${b.id}`} className={!b.active ? "opacity-60" : ""}>
              <div className="flex items-center gap-2 mb-3"><BrandDot color={b.color} /><span className="font-semibold text-[15px]">{b.name}</span>{!b.active && <Badge tone="gray">pipeline</Badge>}<span className="ml-auto text-[12px] text-muted">{countMap.get(b.id) ?? 0} produits</span></div>
              <div className="flex items-end justify-between">
                <div><div className="label">CA {year} à date</div><div className="kpi mt-1">{fmtMAD(amount, { compact: true })}</div></div>
                <div className="text-right text-[12px] text-muted"><div className="flex items-center gap-1 justify-end"><Delta value={delta(amount, prevMap.get(b.id) ?? 0)} /> vs N-1</div><div>{fmtPct(total.amount ? (amount / total.amount) * 100 : 0)} du total</div></div>
              </div>
              {obj ? (<><div className="mt-3 flex justify-between text-[12px]"><span className="text-muted">Objectif {year} : {fmtMAD(obj, { compact: true })}</span><span className="font-medium">{fmtPct((amount / obj) * 100)}</span></div><Progress value={(amount / obj) * 100} tone={amount / obj >= 0.6 ? "accent" : "orange"} className="mt-1" /></>) : <div className="mt-3 text-[12px] text-faint">Pas d&apos;objectif {year}</div>}
              {bud?.hasBudget && <div className="mt-2 text-[12px] text-muted">Budget marketing {fmtMAD(bud.annual, { compact: true })} · consommé {bud.consumedPct === null ? "—" : fmtPct(bud.consumedPct)}</div>}
              <div className="mt-2 text-[12px] text-muted">{fmtNum(c?.quantity ?? 0)} unités · {c?.clients ?? 0} clients</div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
