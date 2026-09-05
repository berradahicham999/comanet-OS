import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { getRefDate } from "@/lib/ref-date";
import { PageHeader, Card, Badge, Tabs, Delta } from "@/components/ui";
import { fmtMAD, fmtNum, fmtDateShort, addDays, iso, delta, today } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Animations" };

export default async function TerrainPage(props: { searchParams: Promise<{ view?: string; animatrice?: string }> }) {
  const user = await requireAccess("terrain");
  const sp = await props.searchParams;
  const t = today();
  const d30 = iso(addDays(t, -30)), d60 = iso(addDays(t, -60));
  const mine = user.role === "ANIMATRICE" ? user.id : sp.animatrice || null;
  const view = sp.view ?? "recent";
  const [kpi, list] = await Promise.all([
    db.execute(sql`
      with a as (select a.*, coalesce((select sum(quantity_sold) from animation_lines al where al.animation_id = a.id),0)::float8 as sold,
        coalesce((select sum(al.quantity_sold * coalesce(p.price_wholesale,0)) from animation_lines al join products p on p.id = al.product_id where al.animation_id = a.id),0)::float8 as revenue
        from animations a where a.status = 'DONE' ${mine ? sql`and a.animatrice_id = ${mine}::uuid` : sql``})
      select count(*) filter (where date >= ${d30}::date)::int as n30, count(*) filter (where date >= ${d60}::date and date < ${d30}::date)::int as n_prev,
        coalesce(sum(sold) filter (where date >= ${d30}::date),0)::float8 as units30, coalesce(sum(sold) filter (where date >= ${d60}::date and date < ${d30}::date),0)::float8 as units_prev,
        coalesce(sum(revenue) filter (where date >= ${d30}::date),0)::float8 as rev30, coalesce(sum(cost) filter (where date >= ${d30}::date),0)::float8 as cost30,
        coalesce(sum(customers_advised) filter (where date >= ${d30}::date),0)::int as cust30
      from a`),
    db.execute(sql`
      select a.id, a.date::text as date, a.status::text as status, c.name as client, c.city, u.name as animatrice, b.name as brand, b.color, a.cost::float8 as cost, a.customers_advised, a.comment,
        coalesce((select sum(quantity_sold) from animation_lines al where al.animation_id = a.id),0)::int as sold,
        coalesce((select sum(al.quantity_sold * coalesce(p.price_wholesale,0)) from animation_lines al join products p on p.id = al.product_id where al.animation_id = a.id),0)::float8 as revenue
      from animations a join clients c on c.id = a.client_id left join users u on u.id = a.animatrice_id left join brands b on b.id = a.brand_id
      where ${view === "planned" ? sql`a.status = 'PLANNED' and a.date >= ${iso(t)}::date` : view === "all" ? sql`true` : sql`a.status = 'DONE'`}
      ${mine ? sql`and a.animatrice_id = ${mine}::uuid` : sql``}
      order by ${view === "planned" ? sql`a.date asc` : sql`a.date desc`} limit 100`),
  ]);
  const k = kpi.rows[0] as { n30: number; n_prev: number; units30: number; units_prev: number; rev30: number; cost30: number; cust30: number };
  const qs = (v: string) => `/terrain?view=${v}${sp.animatrice ? `&animatrice=${sp.animatrice}` : ""}`;

  return (
    <>
      <PageHeader eyebrow="Terrain" title="Animations" subtitle="Sell-out constaté en point de vente, coût et impact des animations." actions={<><Link href="/terrain/saisie" className="btn-primary btn-sm">+ Saisir</Link>{user.role !== "ANIMATRICE" && <Link href="/terrain/animatrices" className="btn-secondary btn-sm">Performance animatrices</Link>}</>}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <Card><div className="label">Animations · 30 j</div><div className="kpi mt-2">{k.n30}</div><div className="mt-2 text-[12px] text-muted flex items-center gap-1"><Delta value={delta(k.n30, k.n_prev)} /> vs 30 j précédents</div></Card>
          <Card><div className="label">Unités vendues · 30 j</div><div className="kpi mt-2">{fmtNum(k.units30)}</div><div className="mt-2 text-[12px] text-muted flex items-center gap-1"><Delta value={delta(k.units30, k.units_prev)} /> · {fmtNum(k.n30 ? k.units30 / k.n30 : 0, 1)} u./animation</div></Card>
          <Card><div className="label">CA sell-out (PPH) · 30 j</div><div className="kpi mt-2">{fmtMAD(k.rev30, { compact: true })}</div><div className="mt-2 text-[12px] text-muted">coût {fmtMAD(k.cost30, { compact: true })} · ROI {k.cost30 ? `${(k.rev30 / k.cost30).toFixed(1)}×` : "—"}</div></Card>
          <Card><div className="label">Clientes conseillées · 30 j</div><div className="kpi mt-2">{fmtNum(k.cust30)}</div><div className="mt-2 text-[12px] text-muted">transformation {k.cust30 ? `${Math.round((k.units30 / k.cust30) * 100)} %` : "—"}</div></Card>
        </div>
        <Tabs current={qs(view)} tabs={[{ href: qs("recent"), label: "Réalisées" }, { href: qs("planned"), label: "Planifiées" }, { href: qs("all"), label: "Toutes" }]} />
      </PageHeader>

      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Date</th><th>Point de vente</th><th>Animatrice</th><th>Marque</th><th className="num">Vendu</th><th className="num">CA PPH</th><th className="num">Conseillées</th><th className="num">Coût</th><th>Commentaire</th></tr></thead>
          <tbody>
            {(list.rows as { id: string; date: string; status: string; client: string; city: string | null; animatrice: string | null; brand: string | null; color: string | null; cost: number; customers_advised: number; comment: string | null; sold: number; revenue: number }[]).map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap"><Link href={`/terrain/${a.id}`} className="font-medium hover:underline">{fmtDateShort(a.date)}</Link>{a.status === "PLANNED" && <Badge tone="blue" className="ml-1">prévue</Badge>}{a.status === "CANCELLED" && <Badge tone="gray" className="ml-1">annulée</Badge>}</td>
                <td>{a.client}<span className="text-faint text-[11px]"> {a.city}</span></td>
                <td className="text-muted">{a.animatrice ?? "—"}</td>
                <td className="text-muted">{a.brand ?? "Multi"}</td>
                <td className="num font-medium">{a.sold}</td>
                <td className="num">{fmtMAD(a.revenue, { suffix: false })}</td>
                <td className="num">{a.customers_advised}</td>
                <td className="num text-muted">{a.cost ? fmtMAD(a.cost, { suffix: false }) : "—"}</td>
                <td className="text-muted max-w-[260px] truncate" title={a.comment ?? ""}>{a.comment ?? ""}</td>
              </tr>
            ))}
            {list.rows.length === 0 && <tr><td colSpan={9} className="text-center text-muted py-8">Aucune animation. <Link href="/terrain/saisie" className="text-accent font-medium">Saisir la première</Link>.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
