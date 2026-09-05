import Link from "next/link";
import { AlertTriangle, ArrowRight, Upload } from "lucide-react";
import { requireAccess } from "@/lib/access";
import { cockpitData } from "@/lib/cockpit";
import { listUsers } from "@/lib/users";
import { PageHeader, Card, Kpi, Delta, Badge, BrandDot, Progress, Section } from "@/components/ui";
import { MonthlyRevenueChart } from "@/components/charts";
import { RecommendationCard } from "@/components/recommendation-card";
import { fmtMAD, fmtNum, fmtPct, fmtDate, fmtDateLong, fmtMonth, delta, months } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CockpitPage() {
  const user = await requireAccess("cockpit");
  const [d, users] = await Promise.all([cockpitData(), listUsers()]);
  const { cmp, objective, annualObj, ytd, ytdN1, series, seriesN1 } = d.commercial;
  const mtd = cmp.current.amount;
  const realisation = objective ? (mtd / objective) * 100 : null;
  const chart = series.map((s, i) => ({ month: s.month, amount: s.amount, prev: seriesN1[i]?.amount ?? 0 }));
  const topRecs = d.recs.filter((r) => !r.existingTask).slice(0, 4);
  const critical = d.recs.filter((r) => r.priority === "CRITICAL" && !r.existingTask).length;
  const monthLabel = fmtMonth(d.refDate.ref);

  return (
    <>
      <PageHeader
        eyebrow="COMANET TODAY"
        title={`Bonjour ${user.name}`}
        subtitle={<>{fmtDateLong(d.refDate.ref)} · {critical > 0 ? <span className="text-red font-medium">{critical} action{critical > 1 ? "s" : ""} critique{critical > 1 ? "s" : ""}</span> : "aucune action critique"} · {d.recs.filter((r) => !r.existingTask).length} recommandations ouvertes</>}
        actions={<Link href="/actions" className="btn-primary">Action Center <ArrowRight size={16} /></Link>}
      />

      {d.refDate.staleDays > 3 && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-yellow/30 bg-yellow-soft px-4 py-3 text-[13px]">
          <AlertTriangle size={16} className="text-yellow shrink-0" />
          <span>Dernière vente importée le <b>{fmtDate(d.refDate.lastSale)}</b> ({d.refDate.staleDays} jours). Le cockpit est calé sur cette date.</span>
          <Link href="/imports" className="btn-secondary btn-sm ml-auto"><Upload size={14} /> Importer les ventes</Link>
        </div>
      )}

      {/* ---------------- Commercial ---------------- */}
      <Section title="Commercial" description={`${monthLabel} — à date (${d.proj.day}/${d.proj.daysInMonth} jours)`}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card href="/ventes">
            <div className="label">CA du mois</div>
            <div className="kpi mt-2">{fmtMAD(mtd, { compact: true })}</div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
              <span className="flex items-center gap-1"><Delta value={delta(mtd, cmp.m1.amount)} /> vs M-1</span>
              <span className="flex items-center gap-1"><Delta value={delta(mtd, cmp.n1.amount)} /> vs N-1</span>
            </div>
          </Card>
          <Card>
            <div className="label">Objectif du mois</div>
            <div className="kpi mt-2">{objective ? fmtMAD(objective, { compact: true }) : "—"}</div>
            {objective ? (
              <>
                <div className="mt-2 flex items-center justify-between text-[12px]">
                  <span className={realisation! >= 100 ? "text-green font-medium" : realisation! >= d.proj.progress * 100 ? "text-ink-2 font-medium" : "text-orange font-medium"}>{fmtPct(realisation)} réalisé</span>
                  <span className="text-faint">rythme : {fmtMAD(d.proj.runRate, { compact: true })}</span>
                </div>
                <Progress value={realisation!} tone={realisation! >= 100 ? "green" : realisation! >= d.proj.progress * 100 ? "accent" : "orange"} className="mt-1.5" />
              </>
            ) : <div className="text-[12px] text-faint mt-2">Définir dans Paramètres</div>}
          </Card>
          <Card href="/ventes?period=ytd">
            <div className="label">CA année en cours</div>
            <div className="kpi mt-2">{fmtMAD(ytd.amount, { compact: true })}</div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
              <span className="flex items-center gap-1"><Delta value={delta(ytd.amount, ytdN1.amount)} /> vs N-1 à date</span>
              {annualObj && <span>{fmtPct((ytd.amount / annualObj) * 100)} de l&apos;objectif annuel</span>}
            </div>
          </Card>
          <Card href="/clients">
            <div className="label">Activité du mois</div>
            <div className="kpi mt-2">{fmtNum(cmp.current.clients)} <span className="text-[14px] font-medium text-muted">clients</span></div>
            <div className="mt-2 text-[12px] text-muted">{fmtNum(cmp.current.orders)} commandes · {fmtNum(cmp.current.quantity)} unités · panier {fmtMAD(cmp.current.orders ? mtd / cmp.current.orders : 0, { compact: true })}</div>
          </Card>
        </div>

        <div className="grid lg:grid-cols-5 gap-3 mt-3">
          <Card className="lg:col-span-3" title="CA mensuel — 13 mois vs N-1" action={<Link href="/ventes" className="text-[12px] text-accent font-medium">Analyser →</Link>}>
            <MonthlyRevenueChart data={chart} />
          </Card>
          <Card className="lg:col-span-2" title={`Par marque — ${monthLabel}`} pad={false}>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Marque</th><th className="num">CA</th><th className="num">vs M-1</th><th className="num">Obj.</th></tr></thead>
                <tbody>
                  {d.brandTable.map((b) => {
                    const dlt = delta(b.amount, b.prev);
                    const pct = b.objective ? (b.amount / b.objective) * 100 : null;
                    return (
                      <tr key={b.id}>
                        <td><Link href={`/marques/${b.id}`} className="flex items-center gap-2 font-medium hover:underline"><BrandDot color={b.color} />{b.name}</Link></td>
                        <td className="num font-medium">{fmtMAD(b.amount, { compact: true, suffix: false })}</td>
                        <td className="num"><Delta value={dlt} size="xs" /></td>
                        <td className="num">{pct === null ? <span className="text-faint">—</span> : <span className={pct >= 100 ? "text-green" : pct < 60 ? "text-red" : "text-ink-2"}>{fmtPct(pct)}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </Section>

      {/* ---------------- Blocs opérationnels ---------------- */}
      <Section title="Pilotage" description="Marketing · Terrain · Digital · Réglementaire · Stock">
        <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
          <Card href="/marketing" title="Marketing">
            <div className="kpi">{fmtMAD(d.marketing.available, { compact: true })}</div>
            <div className="text-[12px] text-muted mt-1">disponible sur {fmtMAD(d.marketing.budget, { compact: true })}</div>
            <Progress value={d.marketing.budget ? (d.marketing.engaged / d.marketing.budget) * 100 : 0} tone={d.marketing.budget && d.marketing.engaged / d.marketing.budget > 0.9 ? "orange" : "accent"} className="mt-3" />
            <div className="mt-2 grid grid-cols-2 gap-1 text-[12px]">
              <span className="text-muted">Engagé</span><span className="num font-medium">{fmtMAD(d.marketing.engaged, { compact: true, suffix: false })}</span>
              <span className="text-muted">Dépensé</span><span className="num font-medium">{fmtMAD(d.marketing.spent, { compact: true, suffix: false })}</span>
            </div>
          </Card>

          <Card href="/terrain" title="Terrain">
            <div className="kpi">{d.terrain.today.length} <span className="text-[14px] font-medium text-muted">animation{d.terrain.today.length > 1 ? "s" : ""} aujourd&apos;hui</span></div>
            <div className="text-[12px] text-muted mt-1">{fmtNum(d.terrain.sales7.units)} u. vendues sur 7 j ({d.terrain.sales7.animations} animations)</div>
            <div className="mt-3 space-y-1 text-[12px]">
              <div className="flex justify-between gap-2"><span className="text-muted">Top animatrice</span><span className="font-medium truncate">{d.terrain.topAnimatrice?.name ?? "—"}</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted">Top produit</span><span className="font-medium truncate">{d.terrain.topProduct?.name ?? "—"}</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted">Top point de vente</span><span className="font-medium truncate">{d.terrain.topClient?.name ?? "—"}</span></div>
            </div>
          </Card>

          <Card href="/marketing" title="Digital · 30 j">
            <div className="kpi">{d.digital.roas !== null ? `${d.digital.roas.toFixed(1)}×` : "—"} <span className="text-[14px] font-medium text-muted">ROAS</span></div>
            <div className="text-[12px] text-muted mt-1">{fmtMAD(d.digital.spend, { compact: true })} dépensés · {fmtMAD(d.digital.revenue, { compact: true })} attribués</div>
            <div className="mt-3 space-y-1 text-[12px]">
              <div className="flex justify-between"><span className="text-muted">CPA</span><span className="font-medium">{d.digital.cpa !== null ? fmtMAD(d.digital.cpa) : "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted">Campagnes à traiter</span><span className="font-medium">{d.recs.filter((r) => r.rule === "ads-performance" && !r.existingTask).length}</span></div>
            </div>
          </Card>

          <Card href="/reglementaire" title="Réglementaire">
            <div className="kpi text-red">{d.regulatory.critical} <span className="text-[14px] font-medium text-muted">critique{d.regulatory.critical > 1 ? "s" : ""}</span></div>
            <div className="text-[12px] text-muted mt-1">expirés ou ≤ 30 jours</div>
            <div className="mt-3 space-y-1 text-[12px]">
              <div className="flex justify-between"><span className="text-muted">Expirent ≤ 120 j</span><span className="font-medium">{d.regulatory.soon}</span></div>
              <div className="flex justify-between"><span className="text-muted">Documents manquants</span><span className="font-medium">{d.regulatory.missing}</span></div>
              <div className="flex justify-between"><span className="text-muted">Dossiers suivis</span><span className="font-medium">{d.regulatory.total}</span></div>
            </div>
          </Card>

          <Card href="/stock" title="Stock">
            <div className="kpi text-orange">{d.stock.red + d.stock.orange} <span className="text-[14px] font-medium text-muted">sous seuil</span></div>
            <div className="text-[12px] text-muted mt-1">{d.stock.red} critiques · {d.stock.orange} tendus</div>
            <div className="mt-3 space-y-1 text-[12px]">
              <div className="flex justify-between"><span className="text-muted">Ruptures</span><span className="font-medium text-red">{d.stock.stockout}</span></div>
              <div className="flex justify-between"><span className="text-muted">Surstock (&gt; 6 mois)</span><span className="font-medium">{d.stock.overstock}</span></div>
              <div className="flex justify-between"><span className="text-muted">À commander</span><span className="font-medium">{d.stock.toOrder.length}</span></div>
            </div>
          </Card>
        </div>
      </Section>

      {/* ---------------- Action Center ---------------- */}
      <Section title="Actions prioritaires" description="Générées automatiquement à partir des données — chaque action peut devenir une tâche." action={<Link href="/actions" className="btn-secondary btn-sm">Tout voir ({d.recs.filter((r) => !r.existingTask).length})</Link>}>
        {topRecs.length === 0 ? (
          <Card><div className="text-sm text-muted">Aucune action ouverte. Tout est sous contrôle.</div></Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {topRecs.map((r) => <RecommendationCard key={r.key} rec={r} users={users} compact redirectTo="/" />)}
          </div>
        )}
      </Section>

      {/* ---------------- Stock à risque ---------------- */}
      {(d.stock.red + d.stock.orange > 0) && (
        <Section title="Produits à risque de rupture" action={<Link href="/stock" className="btn-secondary btn-sm">Purchase forecast</Link>}>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Produit</th><th className="num">Stock</th><th className="num">Ventes/mois</th><th className="num">Couverture</th><th className="num">Rupture estimée</th><th className="num">Commande conseillée</th></tr></thead>
              <tbody>
                {d.stock.list.filter((p) => p.level === "red" || p.level === "orange").sort((a, b) => (a.coverageMonths ?? 0) - (b.coverageMonths ?? 0)).slice(0, 8).map((p) => (
                  <tr key={p.productId}>
                    <td><Link href={`/produits/${p.productId}`} className="flex items-center gap-2 hover:underline"><BrandDot color={p.brandColor ?? "#999"} /><span className="font-medium truncate max-w-[260px]">{p.name}</span></Link></td>
                    <td className="num">{fmtNum(p.stock)}</td>
                    <td className="num">{fmtNum(p.avgMonthly)}</td>
                    <td className="num"><Badge tone={p.level === "red" ? "red" : "orange"}>{months(p.coverageMonths ?? 0)}</Badge></td>
                    <td className="num">{fmtDate(p.stockoutDate)}</td>
                    <td className="num font-medium">{p.recommendedOrder ? fmtNum(p.recommendedOrder) + " u." : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}
