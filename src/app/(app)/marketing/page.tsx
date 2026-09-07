import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, brandFilter } from "@/lib/access";
import { getRefDate } from "@/lib/ref-date";
import { listBrands } from "@/lib/users";
import { resolvePeriod, PERIOD_OPTIONS, type PeriodParam } from "@/lib/periods";
import { PageHeader, Card, Kpi, Badge, BrandDot, Progress, Section, Empty, Tabs } from "@/components/ui";
import { MonthlyRevenueChart } from "@/components/charts";
import { fmtMAD, fmtNum, fmtPct, fmtDate, fmtDateShort, delta } from "@/lib/format";
import { BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import {
  budgetSummary, spendBreakdown, marketingTimeline, correlation, correlationLabel,
  salesTotal, marketingCounters, attribution, brandScorecard, marketingCalendar,
} from "@/lib/marketing";
import { CAMPAIGN_STATUS, campaignTypeLabel } from "@/lib/marketing-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing" };

const FAMILY_LABELS: Record<string, string> = { ads: "Publicité digitale", influence: "Influence & UGC", content: "Création de contenu", trade: "Trade & terrain", events: "Événementiel", other: "Autres" };
const KIND_TONE: Record<string, "purple" | "accent" | "blue" | "green"> = { CAMPAGNE: "purple", INFLUENCE: "accent", ACTIVATION: "blue", CONTENU: "green" };

export default async function MarketingOverviewPage(props: { searchParams: Promise<{ brand?: string; period?: string; start?: string; end?: string }> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const { ref, staleDays } = await getRefDate();
  const period = resolvePeriod((sp.period as PeriodParam) || "ytd", ref, { start: sp.start, end: sp.end });
  const scopeBrands = await brandFilter();
  const brands = (await listBrands()).filter((b) => b.active && (scopeBrands === null || scopeBrands.includes(b.id)));
  // Portée « assignés » sans marque choisie : on affiche la première marque assignée plutôt que le total toutes marques.
  const brandId = sp.brand && brands.some((b) => b.id === sp.brand) ? sp.brand : scopeBrands ? (brands[0]?.id ?? null) : null;
  const year = ref.getUTCFullYear();

  const [budget, spend, prevSpend, timeline, sales, prevSales, counters, attr, scores, calendar, campaignRows] = await Promise.all([
    budgetSummary(year, brandId),
    spendBreakdown(period, brandId),
    spendBreakdown(period.prev, brandId),
    marketingTimeline(period.end, 13, brandId),
    salesTotal(period, brandId),
    salesTotal(period.prev, brandId),
    marketingCounters(period, brandId),
    attribution(period, brandId),
    brandScorecard(period, period.prev),
    marketingCalendar({ start: period.start, end: period.end }, brandId),
    db.execute(sql`
      select c.id, c.name, c.type, c.status::text as status, c.channel::text as channel, c.start_date::text as start_date, c.end_date::text as end_date,
             c.budget::float8 as budget, b.name as brand, b.color as brand_color,
             coalesce((select sum(amount) from marketing_expenses e where e.campaign_id = c.id and e.status <> 'PLANNED'), 0)::float8 as spent,
             coalesce((select sum(spend) from ad_metrics m where m.campaign_id = c.id), 0)::float8 as ad_spend,
             coalesce((select sum(revenue) from ad_metrics m where m.campaign_id = c.id), 0)::float8 as ad_revenue
      from campaigns c join brands b on b.id = c.brand_id
      where c.status in ('ACTIVE','PLANNED') ${brandId ? sql`and c.brand_id = ${brandId}::uuid` : sql``}
      order by (c.status = 'ACTIVE') desc, c.start_date desc nulls last
      limit 8`),
  ]);

  // Corrélation dépense marketing / CA sur les 13 derniers mois (jamais présentée comme une causalité)
  const closed = timeline.slice(0, -1); // le mois en cours est partiel
  const r = correlation(closed.map((p) => p.marketing + p.adSpend), closed.map((p) => p.revenue));
  const rLag = correlation(closed.slice(0, -1).map((p) => p.marketing + p.adSpend), closed.slice(1).map((p) => p.revenue));

  const totalSpend = spend.total + attr.adSpend;
  const prevTotalSpend = prevSpend.total;
  const investmentRate = sales.revenue > 0 ? (totalSpend / sales.revenue) * 100 : null;
  const measuredRevenue = attr.adRevenue + attr.influenceRevenue + attr.activationRevenue + attr.expenseRevenue;
  const measuredCost = attr.adSpend + attr.influenceCost + attr.activationCost;
  const measuredRoas = measuredCost > 0 ? measuredRevenue / measuredCost : null;

  const families = (["ads", "influence", "content", "trade", "events", "other"] as const)
    .map((k) => ({ key: k, label: FAMILY_LABELS[k], amount: k === "ads" ? spend.ads + attr.adSpend : spend[k] }))
    .filter((f) => f.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const familyTotal = families.reduce((a, f) => a + f.amount, 0);

  const campaigns = campaignRows.rows as {
    id: string; name: string; type: string; status: string; channel: string; start_date: string | null; end_date: string | null;
    budget: number | null; brand: string; brand_color: string; spent: number; ad_spend: number; ad_revenue: number;
  }[];

  const chart = timeline.map((p) => ({ month: p.month, amount: p.revenue, prev: p.marketing + p.adSpend }));
  const upcoming = calendar.filter((e) => e.date >= new Date().toISOString().slice(0, 10)).slice(0, 8);

  // Signaux : ce qui demande un arbitrage cette semaine
  const signals: { tone: "red" | "orange" | "green" | "blue"; title: string; detail: string; href: string }[] = [];
  if (budget.consumedPct !== null && budget.consumedPct >= 90) signals.push({ tone: budget.consumedPct >= 100 ? "red" : "orange", title: `Budget ${year} consommé à ${Math.round(budget.consumedPct)} %`, detail: `Reste ${budget.remaining === null ? "—" : fmtMAD(budget.remaining, { compact: true })} sur ${fmtMAD(budget.annual, { compact: true })}. Toute nouvelle action demande un arbitrage.`, href: "/marketing/budgets" });
  if (budget.consumedPct !== null && budget.consumedPct < 40 && ref.getUTCMonth() >= 7) signals.push({ tone: "blue", title: `Budget ${year} sous-consommé (${Math.round(budget.consumedPct)} %)`, detail: `${budget.remaining === null ? "—" : fmtMAD(budget.remaining, { compact: true })} encore disponibles à ${11 - ref.getUTCMonth()} mois de la fin d'année.`, href: "/marketing/budgets" });
  if (attr.adSpend > 0 && attr.adRevenue === 0) signals.push({ tone: "orange", title: "Régie sans CA remonté", detail: `${fmtMAD(attr.adSpend, { compact: true })} de dépense publicitaire importée sans valeur de conversion : activez le suivi des achats ou saisissez le CA attribué.`, href: "/marketing/ads" });
  if (counters.pendingContent > 0) signals.push({ tone: "blue", title: `${counters.pendingContent} contenu(s) non publié(s) sur la période`, detail: "Planning éditorial en retard sur la période sélectionnée.", href: "/marketing/planning" });
  if (measuredCost > 0 && measuredRoas !== null && measuredRoas < 1) signals.push({ tone: "red", title: `ROAS mesuré ${measuredRoas.toFixed(2)}×`, detail: `Sur la part mesurable (${fmtMAD(measuredCost, { compact: true })}), le CA attribué est inférieur à la dépense.`, href: "/marketing/ads" });
  if (totalSpend > 0 && measuredCost / totalSpend < 0.4) signals.push({ tone: "orange", title: `${Math.round((1 - measuredCost / Math.max(totalSpend, 1)) * 100)} % de la dépense n'est pas mesurable`, detail: "Sans code promo, lien tracké ni CA saisi, le retour de ces actions reste une hypothèse.", href: "/marketing/budgets" });

  return (
    <>
      <PageHeader
        eyebrow="Marketing Command Center"
        title="Vue d'ensemble"
        subtitle={`${period.label}${brandId ? " · " + brands.find((b) => b.id === brandId)?.name : " · toutes marques"} · dernière donnée de vente ${fmtDate(ref)}${staleDays > 3 ? ` (retard de ${staleDays} j)` : ""}`}
        actions={
          <>
            <Link href="/marketing/campagnes" className="btn-secondary btn-sm">Campagnes</Link>
            <Link href="/marketing/budgets" className="btn-secondary btn-sm">Budgets</Link>
            <Link href="/imports?type=ADS" className="btn-ghost btn-sm">Importer Ads</Link>
          </>
        }
      >
        <form className="flex flex-wrap items-end gap-2 mb-3">
          {brandId && <input type="hidden" name="brand" value={brandId} />}
          <label className="block"><span className="label block mb-1">Période</span>
            <select name="period" defaultValue={period.key} className="select h-9 w-48">{PERIOD_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
          </label>
          {period.key === "custom" && (<><label className="block"><span className="label block mb-1">Du</span><input type="date" name="start" defaultValue={period.start} className="input h-9" /></label><label className="block"><span className="label block mb-1">Au</span><input type="date" name="end" defaultValue={sp.end ?? ""} className="input h-9" /></label></>)}
          <button className="btn-secondary btn-sm h-9" type="submit">Appliquer</button>
        </form>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
          <Kpi label="Investissement marketing" value={fmtMAD(totalSpend, { compact: true })} delta={delta(totalSpend, prevTotalSpend)} deltaLabel={period.prev.label} sub={`dont ${fmtMAD(attr.adSpend, { compact: true })} de régie`} />
          <Kpi label="CA facturé (Sage)" value={fmtMAD(sales.revenue, { compact: true })} delta={delta(sales.revenue, prevSales.revenue)} deltaLabel={period.prev.label} sub="périmètre marque sélectionnée" />
          <Kpi label="Taux d'investissement" value={investmentRate === null ? "—" : fmtPct(investmentRate, 1)} sub="dépense marketing / CA facturé" />
          <Kpi label="CA attribué (mesuré)" value={fmtMAD(measuredRevenue, { compact: true })} sub={`${fmtPct(sales.revenue > 0 ? (measuredRevenue / sales.revenue) * 100 : 0, 1)} du CA — part réellement traçable`} />
          <Kpi label="ROAS mesuré" value={measuredRoas === null ? "—" : measuredRoas.toFixed(2) + "×"} sub={measuredCost > 0 ? `sur ${fmtMAD(measuredCost, { compact: true })} traçables` : "aucune dépense traçable"} tone={measuredRoas !== null && measuredRoas < 1 ? "red" : measuredRoas !== null && measuredRoas >= 3 ? "green" : undefined} />
        </div>
        <Tabs current={brandId ? `/marketing?brand=${brandId}` : "/marketing"} tabs={[{ href: "/marketing", label: "Toutes les marques" }, ...brands.map((b) => ({ href: `/marketing?brand=${b.id}`, label: b.name }))]} />
      </PageHeader>

      {signals.length > 0 && (
        <Section title="À arbitrer" description="Ce que la période fait remonter, du plus urgent au moins urgent.">
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {signals.map((s, i) => (
              <Link key={i} href={s.href} className="card p-4 hover:border-accent transition-colors">
                <Badge tone={s.tone}>{s.tone === "red" ? "Critique" : s.tone === "orange" ? "À traiter" : s.tone === "green" ? "Opportunité" : "À suivre"}</Badge>
                <div className="font-semibold text-[14px] mt-2">{s.title}</div>
                <p className="text-[12.5px] text-ink-2 mt-1">{s.detail}</p>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <div className="grid lg:grid-cols-3 gap-4 mt-6">
        <Card className="lg:col-span-2 min-w-0" title="Marketing et ventes, 13 derniers mois" action={<span className="text-[11.5px] text-faint">barres : CA facturé · ligne : dépense marketing</span>}>
          <MonthlyRevenueChart data={chart} height={240} />
          <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">
            <b>Corrélation observée</b> entre la dépense marketing du mois et le CA du même mois : {correlationLabel(r)}.
            {rLag !== null && <> Avec un décalage d&apos;un mois (dépense M → CA M+1) : {correlationLabel(rLag)}.</>}
            <span className="text-faint"> Une corrélation n&apos;établit pas de causalité : saisonnalité, référencement et actions commerciales jouent aussi.</span>
          </div>
        </Card>

        <Card className="min-w-0" title="Répartition de la dépense" action={<Link href="/marketing/budgets" className="text-[12px] text-accent">Détail</Link>}>
          {families.length === 0 ? <Empty title="Aucune dépense sur la période" hint="Saisissez vos actions dans Budgets, ou importez un export de régie." /> : (
            <ul className="space-y-2.5">
              {families.map((f) => (
                <li key={f.key}>
                  <div className="flex items-baseline justify-between text-[12.5px]"><span>{f.label}</span><span className="font-medium">{fmtMAD(f.amount, { compact: true })} <span className="text-faint">{fmtPct((f.amount / familyTotal) * 100)}</span></span></div>
                  <Progress value={(f.amount / familyTotal) * 100} className="mt-1" tone={f.key === "ads" ? "accent" : f.key === "influence" ? "purple" : f.key === "trade" ? "blue" : "gray"} />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 pt-3 border-t border-line grid grid-cols-2 gap-y-2 text-[12.5px]">
            <div><div className="text-muted">Budget {year}</div><div className="font-medium">{fmtMAD(budget.annual, { compact: true })}</div></div>
            <div><div className="text-muted">Consommé</div><div className="font-medium">{fmtMAD(budget.consumed, { compact: true })} <span className="text-faint">{budget.consumedPct === null ? "budget non défini" : fmtPct(budget.consumedPct)}</span></div></div>
            <div><div className="text-muted">Disponible</div><div className={`font-medium ${budget.remaining !== null && budget.remaining < 0 ? "text-red" : "text-green"}`}>{budget.remaining === null ? "—" : fmtMAD(budget.remaining, { compact: true })}</div></div>
            <div><div className="text-muted">Prévu non engagé</div><div className="font-medium">{fmtMAD(budget.planned, { compact: true })}</div></div>
            {budget.adSpend > 0 && <div className="col-span-2 text-[11.5px] text-faint">Dont {fmtMAD(budget.adSpend, { compact: true })} de dépense régie importée, en plus des {fmtMAD(budget.committed, { compact: true })} saisis en actions.</div>}
          </div>
        </Card>
      </div>

      <Section title="Campagnes en cours et à venir" description="Les 8 campagnes actives ou planifiées les plus récentes." action={<Link href="/marketing/campagnes" className="btn-secondary btn-sm">Toutes les campagnes</Link>}>
        {campaigns.length === 0 ? (
          <Empty title="Aucune campagne active" hint="Créez une campagne pour relier budget, contenus, influence et ventes." action={<Link href="/marketing/campagnes" className="btn-primary btn-sm">Créer une campagne</Link>} />
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
            {campaigns.map((c) => {
              const meta = CAMPAIGN_STATUS[c.status] ?? { label: c.status, tone: "gray" as const };
              const spent = c.spent + c.ad_spend;
              const pct = c.budget ? (spent / c.budget) * 100 : null;
              const roas = c.ad_spend > 0 ? c.ad_revenue / c.ad_spend : null;
              return (
                <Link key={c.id} href={`/marketing/campagnes/${c.id}`} className="card p-4 hover:border-accent transition-colors">
                  <div className="flex items-center gap-2"><BrandDot color={c.brand_color} /><span className="text-[11.5px] text-muted truncate">{c.brand}</span><Badge tone={meta.tone} className="ml-auto">{meta.label}</Badge></div>
                  <div className="font-semibold text-[14px] mt-1.5 line-clamp-2">{c.name}</div>
                  <div className="text-[11.5px] text-muted mt-0.5">{campaignTypeLabel(c.type)}{c.start_date && ` · ${fmtDateShort(c.start_date)}${c.end_date ? ` → ${fmtDateShort(c.end_date)}` : ""}`}</div>
                  <div className="mt-2.5 text-[12px]">
                    <div className="flex justify-between"><span className="text-muted">Dépensé</span><span className="font-medium">{fmtMAD(spent, { compact: true })}{c.budget ? <span className="text-faint"> / {fmtMAD(c.budget, { compact: true })}</span> : null}</span></div>
                    {pct !== null && <Progress value={pct} tone={pct > 100 ? "red" : pct > 85 ? "orange" : "accent"} className="mt-1" />}
                    {roas !== null && <div className="flex justify-between mt-1.5"><span className="text-muted">ROAS régie</span><span className="font-medium">{roas.toFixed(2)}×</span></div>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      <div className="grid lg:grid-cols-2 gap-4 mt-6">
        <Card className="min-w-0" title="Scorecard par marque" action={<span className="text-[11.5px] text-faint">score relatif au meilleur de la période</span>}>
          <div className="overflow-x-auto">
            <table className="tbl text-[12.5px]">
              <thead><tr><th>Marque</th><th className="num">CA</th><th className="num">Dépense</th><th className="num">Comm.</th><th className="num">Digital</th><th className="num">Influence</th><th className="num">Contenu</th><th className="num">Trade</th><th className="num">Global</th></tr></thead>
              <tbody>
                {scores.map((s) => (
                  <tr key={s.brandId}>
                    <td><Link href={`/marketing?brand=${s.brandId}`} className="flex items-center gap-1.5 hover:underline"><BrandDot color={s.color} />{s.name}</Link></td>
                    <td className="num">{fmtMAD(s.revenue, { compact: true, suffix: false })}</td>
                    <td className="num">{fmtMAD(s.spend, { compact: true, suffix: false })}</td>
                    <td className="num">{Math.round(s.commercial)}</td>
                    <td className="num">{Math.round(s.digital)}</td>
                    <td className="num">{Math.round(s.influence)}</td>
                    <td className="num">{Math.round(s.content)}</td>
                    <td className="num">{Math.round(s.trade)}</td>
                    <td className="num font-semibold"><Badge tone={s.global >= 70 ? "green" : s.global >= 40 ? "yellow" : "red"}>{Math.round(s.global)}</Badge></td>
                  </tr>
                ))}
                {scores.length === 0 && <tr><td colSpan={9} className="text-muted text-center py-4">Aucune donnée sur la période.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="min-w-0" title="Calendrier 360" action={<Link href="/marketing/planning" className="text-[12px] text-accent">Planning éditorial</Link>}>
          {upcoming.length === 0 ? <Empty title="Rien de planifié sur la période" hint="Campagnes, contenus, collaborations et activations apparaissent ici." /> : (
            <ul className="divide-y divide-line">
              {upcoming.map((e) => (
                <li key={e.kind + e.id}>
                  <Link href={e.href} className="flex items-center gap-2.5 py-2 hover:bg-surface-2 -mx-2 px-2 rounded-lg">
                    <span className="text-[11.5px] text-muted w-14 shrink-0">{fmtDateShort(e.date)}</span>
                    <Badge tone={KIND_TONE[e.kind] ?? "gray"}>{e.kind}</Badge>
                    <span className="text-[12.5px] flex-1 truncate">{e.title}</span>
                    {e.brand && <span className="text-[11.5px] text-faint shrink-0">{e.brand}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[12px] pt-3 border-t border-line">
            <div><div className="kpi-sm">{fmtNum(counters.activeCampaigns)}</div><div className="text-muted">campagnes actives</div></div>
            <div><div className="kpi-sm">{fmtNum(counters.collaborations)}</div><div className="text-muted">collaborations</div></div>
            <div><div className="kpi-sm">{fmtNum(counters.published)}</div><div className="text-muted">contenus publiés</div></div>
          </div>
        </Card>
      </div>

      <Section title="Budget par catégorie" description={`Année ${year} — plan et réalisé, toutes marques confondues${brandId ? " (marque filtrée)" : ""}.`}>
        <Card>
          <div className="overflow-x-auto">
            <table className="tbl text-[12.5px]">
              <thead><tr><th>Catégorie</th><th className="num">Prévu</th><th className="num">Engagé + dépensé</th><th className="num">Dont payé</th><th className="num">Part</th></tr></thead>
              <tbody>
                {budget.byCategory.map((c) => {
                  const total = budget.byCategory.reduce((a, x) => a + x.committed + x.spent, 0);
                  const eng = c.committed + c.spent;
                  return (
                    <tr key={c.category}>
                      <td>{BUDGET_CATEGORY_LABELS[c.category as keyof typeof BUDGET_CATEGORY_LABELS] ?? c.category}</td>
                      <td className="num">{c.planned ? fmtMAD(c.planned, { compact: true, suffix: false }) : "—"}</td>
                      <td className="num font-medium">{eng ? fmtMAD(eng, { compact: true, suffix: false }) : "—"}</td>
                      <td className="num">{c.spent ? fmtMAD(c.spent, { compact: true, suffix: false }) : "—"}</td>
                      <td className="num">{total ? fmtPct((eng / total) * 100) : "—"}</td>
                    </tr>
                  );
                })}
                {budget.byCategory.length === 0 && <tr><td colSpan={5} className="text-muted text-center py-4">Aucune dépense enregistrée en {year}.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>
    </>
  );
}
