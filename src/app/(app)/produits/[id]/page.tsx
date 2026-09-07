import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { products as productsTable, tasks as tasksTable, regulatoryFiles, contentItems } from "@/db/schema";
import { requireAccess, canDo, hasFlag } from "@/lib/access";
import { getRefDate } from "@/lib/ref-date";
import { monthlySeries } from "@/lib/analytics";
import { productStocks, LEVEL_LABEL } from "@/lib/stock";
import { listBrands } from "@/lib/users";
import { PageHeader, Card, Badge, Delta, Section, PriorityBadge, StatusBadge, BrandDot } from "@/components/ui";
import { MonthlyRevenueChart } from "@/components/charts";
import { ProductForm } from "@/components/product-form";
import { fmtMAD, fmtNum, fmtDate, fmtDateShort, addDays, iso, months, delta } from "@/lib/format";
import { mergeProduct, addStockSnapshot } from "../actions";

export const dynamic = "force-dynamic";

const LEVEL_TONE = { green: "green", yellow: "yellow", orange: "orange", red: "red", none: "gray", unknown: "gray" } as const;

export default async function ProductPage(props: { params: Promise<{ id: string }> }) {
  await requireAccess("produits");
  const seeMargins = await hasFlag("seeMargins");
  const { id } = await props.params;
  const product = await db.query.products.findFirst({ where: eq(productsTable.id, id) });
  if (!product) notFound();
  const { ref } = await getRefDate();
  const [stockList, series, seriesN1, topClients, aliases, brands, regs, contents, openTasks, kpi, others, objectives, medicalActivity] = await Promise.all([
    productStocks({ productId: id }, ref),
    monthlySeries(13, { productId: id }, ref),
    monthlySeries(13, { productId: id }, new Date(Date.UTC(ref.getUTCFullYear() - 1, ref.getUTCMonth(), ref.getUTCDate(), 12))),
    db.execute(sql`select c.id, c.name, c.city, sum(s.quantity)::float8 as qty, sum(s.amount)::float8 as amount, max(s.date)::text as last_date from sales s join clients c on c.id = s.client_id where s.product_id = ${id}::uuid and s.date >= ${iso(addDays(ref, -365))}::date group by c.id, c.name, c.city order by amount desc limit 15`),
    db.execute(sql`select alias, source from product_aliases where product_id = ${id}::uuid order by alias`),
    listBrands(),
    db.select().from(regulatoryFiles).where(eq(regulatoryFiles.productId, id)),
    db.select().from(contentItems).where(eq(contentItems.productId, id)).orderBy(desc(contentItems.date)).limit(10),
    db.select().from(tasksTable).where(sql`${tasksTable.entityId} = ${id}::uuid and ${tasksTable.status} in ('TODO','IN_PROGRESS')`).orderBy(desc(tasksTable.createdAt)),
    db.execute(sql`
      select coalesce(sum(case when date >= ${iso(addDays(ref, -365))}::date then amount end),0)::float8 as revenue12,
             coalesce(sum(case when date >= ${iso(addDays(ref, -365))}::date then quantity end),0)::float8 as qty12,
             count(distinct case when date >= ${iso(addDays(ref, -365))}::date then client_id end)::int as clients12,
             coalesce(sum(case when date >= ${iso(addDays(ref, -730))}::date and date < ${iso(addDays(ref, -365))}::date then amount end),0)::float8 as revenue_prev12,
             max(date)::text as last_sale, min(date)::text as first_sale
      from sales where product_id = ${id}::uuid and date <= ${iso(ref)}::date`),
    db.execute(sql`select id, name from products where id <> ${id}::uuid and active order by name`),
    db.execute(sql`select year, month, amount::float8 as amount, units::float8 as units from objectives where product_id = ${id}::uuid order by year desc, month nulls first`),
    db.execute(sql`
      select count(distinct vp.visit_id)::int as visits, count(distinct v.doctor_id)::int as doctors,
        coalesce((select sum(vs.quantity)::int from visit_samples vs where vs.product_id = ${id}::uuid), 0) as samples
      from visit_products vp join doctor_visits v on v.id = vp.visit_id where vp.product_id = ${id}::uuid`),
  ]);
  const st = stockList[0];
  const k = kpi.rows[0] as { revenue12: number; qty12: number; clients12: number; revenue_prev12: number; last_sale: string | null; first_sale: string | null };
  const chart = series.map((m, i) => ({ month: m.month, amount: m.amount, prev: seriesN1[i]?.amount ?? 0 }));
  const brand = brands.find((b) => b.id === product.brandId);

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/produits" className="hover:underline">Produits</Link>}
        title={<span className="flex items-center gap-2 flex-wrap">{brand && <BrandDot color={brand.color} />}{product.name}{(product.needsReview || !product.brandId) && <Badge tone="yellow">à rattacher</Badge>}{!product.active && <Badge tone="gray">inactif</Badge>}</span>}
        subtitle={[brand?.name, product.sku ? `Code ${product.sku}` : null, product.category, product.priceWholesale ? `PPH ${fmtMAD(product.priceWholesale)}` : null].filter(Boolean).join(" · ")}
        actions={<Link href={`/taches/nouvelle?entityType=product&entityId=${id}&title=${encodeURIComponent(product.name)}`} className="btn-primary btn-sm">+ Tâche</Link>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card><div className="label">CA 12 mois</div><div className="kpi mt-2">{fmtMAD(k.revenue12, { compact: true })}</div><div className="mt-2 text-[12px] text-muted flex items-center gap-1"><Delta value={delta(k.revenue12, k.revenue_prev12)} /> vs 12 mois précédents</div></Card>
        <Card><div className="label">Unités 12 mois</div><div className="kpi mt-2">{fmtNum(k.qty12)}</div><div className="mt-2 text-[12px] text-muted">{k.clients12} clients · {fmtNum(st?.avgMonthly ?? 0)} u./mois en moyenne (3 m)</div></Card>
        <Card href="/stock"><div className="label">Stock</div><div className="kpi mt-2">{st?.stockKnown ? fmtNum(st.stock) : "n/c"}</div><div className="mt-2 text-[12px] text-muted flex items-center gap-2">{st && <Badge tone={LEVEL_TONE[st.level]}>{st.coverageMonths === null ? LEVEL_LABEL[st.level] : months(st.coverageMonths)}</Badge>}{st?.stockDate && <span>au {fmtDateShort(st.stockDate)}</span>}</div></Card>
        <Card><div className="label">Purchase forecast</div><div className="kpi mt-2">{st && st.recommendedOrder > 0 ? `${fmtNum(st.recommendedOrder)} u.` : "—"}</div><div className="mt-2 text-[12px] text-muted">{st?.stockoutDate ? `rupture estimée ${fmtDateShort(st.stockoutDate)}` : "pas de rupture prévue"} · lead time {product.leadTimeDays} j</div></Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Card className="lg:col-span-2" title="CA mensuel — 13 mois vs N-1"><MonthlyRevenueChart data={chart} height={220} /></Card>
        <Card title="Mettre à jour le stock">
          <form action={addStockSnapshot} className="space-y-2 text-[13px]">
            <input type="hidden" name="productId" value={id} />
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="label block mb-1">Stock (unités)</span><input name="quantity" defaultValue={st?.stockKnown ? st.stock : ""} className="input h-9" inputMode="numeric" required /></label>
              <label className="block"><span className="label block mb-1">Commande en cours</span><input name="onOrder" defaultValue={st?.onOrder ?? 0} className="input h-9" inputMode="numeric" /></label>
            </div>
            <label className="block"><span className="label block mb-1">Date</span><input type="date" name="date" defaultValue={iso(new Date())} className="input h-9" /></label>
            <button className="btn-secondary btn-sm w-full" type="submit">Enregistrer la photo de stock</button>
          </form>
          {st && st.stockKnown && (
            <dl className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
              <dt className="text-muted">Stock cible</dt><dd className="font-medium text-right">{fmtNum(st.targetStock)} u.</dd>
              {seeMargins && <><dt className="text-muted">Valeur stock</dt><dd className="font-medium text-right">{fmtMAD(st.stockValue, { compact: true })}</dd>
              <dt className="text-muted">Marge</dt><dd className="font-medium text-right">{st.marginPct !== null ? `${Math.round(st.marginPct)} %` : "n/c"}</dd></>}
              <dt className="text-muted">Sell-out terrain 30 j</dt><dd className="font-medium text-right">{fmtNum(st.fieldSellOut30d)} u.</dd>
            </dl>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Section title="Top clients — 12 mois">
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Client</th><th>Ville</th><th className="num">Unités</th><th className="num">CA</th><th>Dernier achat</th></tr></thead>
                <tbody>
                  {(topClients.rows as { id: string; name: string; city: string | null; qty: number; amount: number; last_date: string }[]).map((c) => (
                    <tr key={c.id}><td><Link href={`/clients/${c.id}`} className="font-medium hover:underline">{c.name}</Link></td><td className="text-muted">{c.city ?? "—"}</td><td className="num">{fmtNum(c.qty)}</td><td className="num font-medium">{fmtMAD(c.amount, { suffix: false })}</td><td>{fmtDateShort(c.last_date)}</td></tr>
                  ))}
                  {topClients.rows.length === 0 && <tr><td colSpan={5} className="text-center text-muted py-6">Aucune vente sur 12 mois.</td></tr>}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title="Réglementaire">
              {regs.length === 0 ? <Card><div className="text-sm text-muted">Aucun dossier. <Link href={`/reglementaire/nouveau?product=${id}`} className="text-accent font-medium">Créer un dossier</Link></div></Card> : (
                <div className="space-y-2">{regs.map((r) => (
                  <Link key={r.id} href={`/reglementaire/${r.id}`} className="card px-4 py-3 block hover:border-line-2">
                    <div className="flex items-center justify-between gap-2"><span className="font-medium">{r.dossier}</span><Badge tone={r.status === "VALIDE" ? "green" : r.status === "EXPIRE" ? "red" : "orange"}>{r.status}</Badge></div>
                    <div className="text-[12px] text-muted mt-0.5">Expire le {fmtDate(r.expiryDate)}{r.missingDocuments ? ` · manque : ${r.missingDocuments}` : ""}</div>
                  </Link>
                ))}</div>
              )}
            </Section>
            <Section title="Contenus">
              {contents.length === 0 ? <Card><div className="text-sm text-muted">Aucun contenu planifié. <Link href={`/marketing/planning?product=${id}`} className="text-accent font-medium">Planifier</Link></div></Card> : (
                <div className="space-y-2">{contents.map((c) => (
                  <div key={c.id} className="card px-4 py-3"><div className="flex items-center justify-between gap-2"><span className="font-medium truncate">{c.title}</span><Badge tone="blue">{c.status}</Badge></div><div className="text-[12px] text-muted mt-0.5">{fmtDateShort(c.date)} · {[c.format, c.platform].filter(Boolean).join(" · ")}</div></div>
                ))}</div>
              )}
            </Section>
          </div>

          <Section title="Tâches ouvertes">
            {openTasks.length === 0 ? <Card><div className="text-sm text-muted">Aucune tâche ouverte pour ce produit.</div></Card> : (
              <div className="space-y-2">{openTasks.map((t) => (
                <Link key={t.id} href={`/taches/${t.id}`} className="card px-4 py-3 flex items-center gap-3 hover:border-line-2"><div className="flex-1 min-w-0"><div className="font-medium truncate">{t.title}</div><div className="text-[12px] text-muted">Échéance {fmtDate(t.dueDate)}</div></div><PriorityBadge priority={t.priority} /><StatusBadge status={t.status} /></Link>
              ))}</div>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Card title="Fiche produit"><ProductForm product={product} brands={brands} /></Card>
          {objectives.rows.length > 0 && (
            <Card title="Objectifs">
              <ul className="text-[13px] space-y-1">{(objectives.rows as { year: number; month: number | null; amount: number; units: number | null }[]).map((o, i) => <li key={i} className="flex justify-between"><span className="text-muted">{o.year}{o.month ? ` · M${o.month}` : " (annuel)"}</span><span className="font-medium">{fmtMAD(o.amount, { compact: true })}{o.units ? ` · ${fmtNum(o.units)} u.` : ""}</span></li>)}</ul>
            </Card>
          )}
          <Card title="Désignations rattachées">
            <ul className="text-[12px] space-y-1">{(aliases.rows as { alias: string; source: string }[]).map((a) => <li key={a.alias} className="flex justify-between gap-2"><span className="truncate">{a.alias}</span><span className="text-faint shrink-0">{a.source}</span></li>)}</ul>
            {(await canDo("produits", "validate")) && (
              <details className="mt-3">
                <summary className="cursor-pointer text-[12.5px] font-medium text-accent">Fusionner ce produit dans un autre…</summary>
                <form action={mergeProduct} className="mt-2 space-y-2">
                  <input type="hidden" name="sourceId" value={id} />
                  <select name="targetId" className="select h-9 text-[12px]" required>
                    <option value="">Choisir le produit cible</option>
                    {(others.rows as { id: string; name: string }[]).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <p className="text-[11px] text-faint">Toutes les ventes, stocks, dossiers et contenus seront transférés vers la cible ; ce produit sera supprimé et sa désignation conservée comme alias.</p>
                  <button className="btn-secondary btn-sm w-full" type="submit">Fusionner</button>
                </form>
              </details>
            )}
          </Card>
          {(() => {
            const m = medicalActivity.rows[0] as { visits: number; doctors: number; samples: number };
            return m.visits > 0 || m.samples > 0 ? (
              <Card title="Activité médicale">
                <ul className="text-[13px] space-y-1.5">
                  <li className="flex justify-between"><span className="text-muted">Médecins visités avec ce produit</span><span className="font-medium">{fmtNum(m.doctors)}</span></li>
                  <li className="flex justify-between"><span className="text-muted">Visites où présenté</span><span className="font-medium">{fmtNum(m.visits)}</span></li>
                  <li className="flex justify-between"><span className="text-muted">Échantillons distribués</span><span className="font-medium">{fmtNum(m.samples)}</span></li>
                </ul>
              </Card>
            ) : null;
          })()}
          {k.first_sale && <div className="text-[11px] text-faint px-1">Première vente {fmtDate(k.first_sale)} · dernière {fmtDate(k.last_sale)}</div>}
        </div>
      </div>
    </>
  );
}
