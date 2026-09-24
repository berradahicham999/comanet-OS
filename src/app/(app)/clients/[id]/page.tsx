import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { clients as clientsTable, tasks as tasksTable } from "@/db/schema";
import { requireAccess, canDo, clientInScope } from "@/lib/access";
import { clientIntel, SEGMENT_META } from "@/lib/clients";
import { getRefDate } from "@/lib/ref-date";
import { monthlySeries, ORDER_KEY } from "@/lib/analytics";
import { PageHeader, Card, Badge, Delta, Section, PriorityBadge, StatusBadge, Tabs } from "@/components/ui";
import { ClientStockTab } from "./stock-tab";
import { MonthlyRevenueChart } from "@/components/charts";
import { fmtMAD, fmtNum, fmtDate, fmtDateShort, addDays, iso } from "@/lib/format";
import { updateClient } from "../actions";
import { readingsForClient } from "@/lib/client-stock";
import { SECTORS, cityToSector } from "@/lib/sectors";
import { ClientInfosTab } from "./infos-tab";
import { billingReadiness } from "@/lib/gestion/clients-shared";

export const dynamic = "force-dynamic";

const REC_TONE: Record<string, "red" | "orange" | "blue" | "green" | "accent" | "gray"> = { RELANCE: "blue", REACTIVATION: "red", ANALYSE: "orange", ANIMATION: "accent", DEVELOPPEMENT: "green", NONE: "gray" };

export default async function ClientPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; releve?: string; brand?: string; sort?: string; done?: string; error?: string }> }) {
  await requireAccess("clients");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const tab = sp.tab === "stock" ? "stock" : sp.tab === "infos" ? "infos" : "apercu";
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const client = await db.query.clients.findFirst({ where: eq(clientsTable.id, id) });
  if (!client) notFound();
  if (!(await clientInScope(id))) notFound();
  const { ref } = await getRefDate();
  const [intelList, series, products, orders, animations, openTasks, aliases, stockReadings, canEdit] = await Promise.all([
    clientIntel({ clientId: id, includeArchived: true }, ref),
    monthlySeries(13, { clientId: id }, ref),
    db.execute(sql`
      select p.id, p.name, b.name as brand, b.color,
        sum(s.quantity)::float8 as qty, sum(s.amount)::float8 as amount, max(s.date)::text as last_date,
        count(distinct ${ORDER_KEY})::int as orders
      from sales s join products p on p.id = s.product_id left join brands b on b.id = p.brand_id
      where s.client_id = ${id}::uuid and s.date >= ${iso(addDays(ref, -365))}::date
      group by p.id, p.name, b.name, b.color order by amount desc`),
    db.execute(sql`
      select s.date::text as date, coalesce(s.invoice_ref, s.lvc_ref, '—') as ref, s.site, sum(s.amount)::float8 as amount, sum(s.quantity)::float8 as qty, count(*)::int as lines
      from sales s where s.client_id = ${id}::uuid group by s.date, coalesce(s.invoice_ref, s.lvc_ref, '—'), s.site order by s.date desc limit 25`),
    db.execute(sql`
      select a.id, a.date::text as date, a.status::text as status, u.name as animatrice, b.name as brand, coalesce(sum(al.quantity_sold),0)::int as sold, coalesce(sum(al.stock_observed),0)::int as stock
      from animations a left join users u on u.id = a.animatrice_id left join brands b on b.id = a.brand_id left join animation_lines al on al.animation_id = a.id
      where a.client_id = ${id}::uuid group by a.id, u.name, b.name order by a.date desc limit 10`),
    db.select().from(tasksTable).where(sql`${tasksTable.entityId} = ${id}::uuid and ${tasksTable.status} in ('TODO','IN_PROGRESS')`).orderBy(desc(tasksTable.createdAt)),
    db.execute(sql`select alias from client_aliases where client_id = ${id}::uuid order by alias`),
    readingsForClient(id),
    canDo("clients", "edit"),
  ]);
  const stockProducts = new Set(stockReadings.map((r) => r.productId)).size;
  const intel = intelList[0];
  if (!intel) notFound();
  const seg = SEGMENT_META[intel.segment];
  const rec = intel.recommendation;
  const billing = billingReadiness({ legalName: client.legalName, ice: client.ice, billingAddress: client.billingAddress, city: client.city, accountCode: client.accountCode, paymentDays: client.paymentDays, paymentModeKey: client.paymentModeKey });

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/clients" className="hover:underline">Clients</Link>}
        title={<span className="flex items-center gap-2 flex-wrap">{client.name} {intel.highPotential && <span title="Fort potentiel">⭐</span>} <Badge tone={seg.tone}>{seg.label}</Badge>{!client.active && <Badge tone="gray">archivé</Badge>}{client.blocked && <Badge tone="red">bloqué</Badge>}</span>}
        subtitle={[client.legalName && client.legalName !== client.name ? client.legalName : null, client.accountCode ? `Code ${client.accountCode}` : client.code, client.type, client.city, client.sector ? `Secteur : ${client.sector}` : null, client.salesRep ? `Commercial : ${client.salesRep}` : null].filter(Boolean).join(" · ")}
        actions={<Link href={`/taches/nouvelle?entityType=client&entityId=${id}&title=${encodeURIComponent(rec.title + " — " + client.name)}`} className="btn-primary btn-sm">+ Tâche</Link>}
      >
        <Tabs current={tab === "stock" ? `/clients/${id}?tab=stock` : tab === "infos" ? `/clients/${id}?tab=infos` : `/clients/${id}`} tabs={[{ href: `/clients/${id}`, label: "Vue d'ensemble" }, { href: `/clients/${id}?tab=infos`, label: billing.ready ? "Identité & conditions" : "Identité & conditions ⚠︎" }, { href: `/clients/${id}?tab=stock`, label: "Stock en point de vente", count: stockProducts }]} />
      </PageHeader>

      {tab === "infos" ? <ClientInfosTab client={client} billing={billing} sp={sp} /> : tab === "stock" ? <ClientStockTab clientId={id} clientName={client.name} sp={sp} /> : (<>
      {/* Recommandation */}
      <div className={`card card-pad mb-4 border-l-4`} style={{ borderLeftColor: rec.kind === "NONE" ? "#d6d6d1" : rec.kind === "REACTIVATION" ? "#dc2626" : rec.kind === "ANALYSE" ? "#ea580c" : rec.kind === "RELANCE" ? "#2563eb" : "#0f766e" }}>
        <div className="flex flex-wrap items-center gap-2 mb-1"><span className="label">Plan d&apos;action</span><Badge tone={REC_TONE[rec.kind]}>{rec.title}</Badge></div>
        <p className="text-[14px]">{rec.detail}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card><div className="label">CA 12 mois</div><div className="kpi mt-2">{fmtMAD(intel.revenue12, { compact: true })}</div><div className="mt-2 text-[12px] text-muted flex items-center gap-1"><Delta value={intel.growthPct} /> 3 mois vs 3 mois préc.</div></Card>
        <Card><div className="label">Commandes 12 mois</div><div className="kpi mt-2">{intel.orders12}</div><div className="mt-2 text-[12px] text-muted">panier {fmtMAD(intel.avgBasket, { compact: true })} · {fmtNum(intel.avgQtyPerOrder)} u./cmd</div></Card>
        <Card><div className="label">Rythme de commande</div><div className="kpi mt-2">{intel.avgIntervalDays ? `${Math.round(intel.avgIntervalDays)} j` : "—"}</div><div className="mt-2 text-[12px] text-muted">dernière : {fmtDate(intel.lastOrder)}{intel.prevOrder && ` · préc. ${fmtDateShort(intel.prevOrder)}`}</div></Card>
        <Card><div className="label">Prochaine commande théorique</div><div className={`kpi mt-2 ${intel.overdue ? "text-red" : ""}`}>{intel.nextTheoretical ? fmtDateShort(intel.nextTheoretical) : "—"}</div><div className="mt-2 text-[12px] text-muted">{intel.daysUntilNext === null ? "" : intel.daysUntilNext < 0 ? `en retard de ${-intel.daysUntilNext} j` : `dans ${intel.daysUntilNext} j`}{intel.fieldStock !== null && ` · stock rayon constaté ${fmtNum(intel.fieldStock)} u.`}</div></Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Card className="lg:col-span-2" title="CA mensuel — 13 mois">
          <MonthlyRevenueChart data={series.map((m) => ({ month: m.month, amount: m.amount }))} height={200} />
        </Card>
        <Card title="Fiche client">
          <form action={updateClient} className="space-y-2 text-[13px]">
            <fieldset disabled={!canEdit} className="space-y-2">
            <input type="hidden" name="id" value={client.id} />
            <label className="block"><span className="label block mb-1">Nom</span><input name="name" defaultValue={client.name} className="input h-9" /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="label block mb-1">Type</span>
                <select name="type" defaultValue={client.type} className="select h-9"><option value="PHARMACIE">Pharmacie</option><option value="PARAPHARMACIE">Parapharmacie</option><option value="GROSSISTE">Grossiste</option><option value="AUTRE">Autre</option></select>
              </label>
              <label className="block"><span className="label block mb-1">Ville</span><input name="city" defaultValue={client.city ?? ""} className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">Secteur</span>
                <select name="sector" defaultValue={client.sector ?? ""} className="select h-9">
                  <option value="">{cityToSector(client.city) ? `Auto (${cityToSector(client.city)})` : "Auto — d'après la ville"}</option>
                  {SECTORS.map((sct) => <option key={sct} value={sct}>{sct}</option>)}
                </select>
              </label>
              <label className="block"><span className="label block mb-1">Commercial</span><input name="salesRep" defaultValue={client.salesRep ?? ""} className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">Téléphone</span><input name="phone" defaultValue={client.phone ?? ""} className="input h-9" /></label>
            </div>
            <label className="block"><span className="label block mb-1">Canal</span><input name="channel" defaultValue={client.channel ?? ""} className="input h-9" placeholder="ex: Direct, Cospharma…" /></label>
            {canEdit && <button className="btn-secondary btn-sm w-full" type="submit">{client.needsReview ? "Qualifier le client" : "Enregistrer"}</button>}
            </fieldset>
          </form>
          <Link href={`/clients/${id}?tab=infos`} className="mt-2 block text-[12px] text-accent font-medium">{billing.ready ? "Identité légale et conditions →" : `Pour facturer : ${billing.missing.join(", ")} →`}</Link>
          {aliases.rows.length > 1 && <div className="mt-3 text-[11px] text-faint">Alias : {(aliases.rows as { alias: string }[]).map((a) => a.alias).join(" · ")}</div>}
        </Card>
      </div>

      <Section title="Produits achetés — 12 mois" description={`${intel.brands.length} marque${intel.brands.length > 1 ? "s" : ""} : ${intel.brands.join(", ") || "—"}`}>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Produit</th><th>Marque</th><th className="num">Unités</th><th className="num">CA</th><th className="num">Cmd</th><th>Dernier achat</th></tr></thead>
            <tbody>
              {(products.rows as { id: string; name: string; brand: string | null; color: string | null; qty: number; amount: number; last_date: string; orders: number }[]).map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/produits/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
                  <td className="text-muted">{p.brand ?? "—"}</td>
                  <td className="num">{fmtNum(p.qty)}</td>
                  <td className="num font-medium">{fmtMAD(p.amount, { suffix: false })}</td>
                  <td className="num">{p.orders}</td>
                  <td>{fmtDateShort(p.last_date)}</td>
                </tr>
              ))}
              {products.rows.length === 0 && <tr><td colSpan={6} className="text-center text-muted py-6">Aucun achat sur 12 mois.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Historique des commandes" description="25 dernières pièces">
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Pièce</th><th>Canal</th><th className="num">Lignes</th><th className="num">Unités</th><th className="num">Montant HT</th></tr></thead>
              <tbody>
                {(orders.rows as { date: string; ref: string; site: string | null; amount: number; qty: number; lines: number }[]).map((o, i) => (
                  <tr key={i}><td>{fmtDateShort(o.date)}</td><td className="text-muted">{o.ref}</td><td className="text-muted">{o.site ?? "—"}</td><td className="num">{o.lines}</td><td className="num">{fmtNum(o.qty)}</td><td className="num font-medium">{fmtMAD(o.amount, { suffix: false })}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <div>
          <Section title="Animations terrain" description="Sell-out constaté sur ce point de vente">
            {animations.rows.length === 0 ? <Card><div className="text-sm text-muted">Aucune animation enregistrée. <Link href={`/terrain/saisie?client=${id}`} className="text-accent font-medium">Saisir une animation</Link></div></Card> : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Animatrice</th><th>Marque</th><th className="num">Vendu</th><th className="num">Stock rayon</th></tr></thead>
                  <tbody>
                    {(animations.rows as { id: string; date: string; status: string; animatrice: string | null; brand: string | null; sold: number; stock: number }[]).map((a) => (
                      <tr key={a.id}><td><Link href={`/terrain/${a.id}`} className="hover:underline">{fmtDateShort(a.date)}</Link>{a.status === "PLANNED" && <Badge tone="blue" className="ml-1">prévue</Badge>}</td><td>{a.animatrice ?? "—"}</td><td className="text-muted">{a.brand ?? "—"}</td><td className="num font-medium">{a.sold}</td><td className="num">{a.stock}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          <Section title="Tâches ouvertes">
            {openTasks.length === 0 ? <Card><div className="text-sm text-muted">Aucune tâche ouverte pour ce client.</div></Card> : (
              <div className="space-y-2">
                {openTasks.map((t) => (
                  <Link key={t.id} href={`/taches/${t.id}`} className="card px-4 py-3 flex items-center gap-3 hover:border-line-2">
                    <div className="flex-1 min-w-0"><div className="font-medium truncate">{t.title}</div><div className="text-[12px] text-muted">Échéance {fmtDate(t.dueDate)}</div></div>
                    <PriorityBadge priority={t.priority} /><StatusBadge status={t.status} />
                  </Link>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
      </>)}
    </>
  );
}
