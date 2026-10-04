import Link from "next/link";
import clsx from "clsx";
import { requireAccess, canDo } from "@/lib/access";
import { listUsers } from "@/lib/users";
import { getRefDate } from "@/lib/ref-date";
import { decisionScopeFor } from "@/lib/decisions/server";
import { buildMarketingCommandCenter, type BrandCockpit } from "@/lib/marketing-plan/command-center";
import type { MarketingPeriodKey } from "@/lib/marketing-intel/build";
import { AD_SPEND_SOURCE_LABEL } from "@/lib/budget";
import { STOCK_RISK_LABELS } from "@/lib/marketing-intel/inventory";
import { PLAN_STATUS } from "@/lib/marketing-plan/shared";
import { BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import { PageHeader, Card, Kpi, Badge, BrandDot, Section, Empty, Tabs, Progress, StatusBadge, PriorityBadge } from "@/components/ui";
import { DecisionCard } from "@/components/decision-card";
import { fmtMAD, fmtPct, fmtNum, fmtDate, fmtDateShort, fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Command Center marketing" };

const PERIODS: { key: MarketingPeriodKey; label: string }[] = [{ key: "7d", label: "7 jours" }, { key: "30d", label: "30 jours" }, { key: "90d", label: "90 jours" }];
const money = (v: number | null) => (v === null ? "—" : fmtMAD(v, { compact: true }));

function BrandTile({ c, href }: { c: BrandCockpit; href: string }) {
  const t = c.overview.targets;
  const f = c.focus;
  return (
    <div className="card p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2"><BrandDot color={c.color} className="h-3 w-3" /><Link href={href} className="font-semibold text-[15px] hover:underline flex-1 truncate">{c.name}</Link>{c.plan ? <Badge tone={PLAN_STATUS[c.plan.status as keyof typeof PLAN_STATUS]?.tone ?? "gray"}>{c.plan.name}</Badge> : <Link href="/marketing/plan" className="text-[11px] text-accent hover:underline">créer le plan</Link>}</div>
      <div className="grid grid-cols-3 gap-2 text-[12px]">
        <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Budget</div><div className="font-medium">{c.budget.hasBudget ? `${Math.round(c.budget.consumedPct ?? 0)} %` : "—"}</div><div className="text-[10.5px] text-muted">{c.budget.hasBudget ? `reste ${money(c.budget.remaining)}` : "non défini"}</div></div>
        <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Objectif mois</div><div className={clsx("font-medium", t.monthly.forecastPct !== null && (t.monthly.forecastPct >= 100 ? "text-green" : "text-orange"))}>{t.monthly.pct === null ? "—" : fmtPct(t.monthly.pct, 0)}</div><div className="text-[10.5px] text-muted">{t.monthly.forecastPct === null ? "non renseigné" : `projeté ${fmtPct(t.monthly.forecastPct, 0)}`}</div></div>
        <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Actions</div><div className={clsx("font-medium", c.actions.late > 0 && "text-red")}>{c.actions.open}{c.actions.late > 0 ? ` · ${c.actions.late} en retard` : ""}</div><div className="text-[10.5px] text-muted">{c.stockAlerts.length} alerte(s) stock</div></div>
      </div>
      {f ? (
        <div className="rounded-xl bg-surface-2 p-3 text-[12.5px]">
          <div className="flex items-center gap-2"><Badge tone="accent">{f.recommendationLabel}</Badge><span className="font-medium truncate">{f.entity.name}</span><PriorityBadge priority={f.priority} /></div>
          <p className="text-ink-2 mt-1 line-clamp-2">{f.why[0]}</p>
        </div>
      ) : <div className="rounded-xl bg-surface-2 p-3 text-[12.5px] text-muted">Rien à pousser en priorité : ventes stables et stock sain, ou données insuffisantes.</div>}
      {c.doNotPush.length > 0 && <div className="text-[11.5px] text-muted">Ne pas pousser : {c.doNotPush.slice(0, 3).map((d) => d.entity.name).join(", ")}</div>}
      <Link href={href} className="btn-secondary btn-sm mt-auto">Ouvrir le cockpit {c.name}</Link>
    </div>
  );
}

export default async function MarketingCommandCenterPage(props: { searchParams: Promise<{ brand?: string; period?: string }> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const period = (PERIODS.some((p) => p.key === sp.period) ? sp.period : "30d") as MarketingPeriodKey;
  const [scope, users, canCreate, canEdit, refDate] = await Promise.all([decisionScopeFor(sp.brand ?? null, period), listUsers(), canDo("marketing", "create"), canDo("marketing", "edit"), getRefDate()]);
  if (scope.allBrands.length === 0) return <><PageHeader eyebrow="Marketing" title="Command Center" /><Empty title="Aucune marque dans votre périmètre" hint="Demander l'assignation d'une marque à un administrateur (Paramètres → Utilisateurs)." /></>;
  const data = await buildMarketingCommandCenter({ ctx: scope.ctx, perms: scope.perms, brands: scope.allBrands, selectedBrandId: scope.selectedBrandId, period });
  const sel = data.selected;
  const href = (b: string | null, p: string) => `/marketing?${new URLSearchParams({ ...(b ? { brand: b } : {}), period: p }).toString()}`;
  const back = href(scope.selectedBrandId, period);
  const budget = sel ? sel.budget : data.totals.budget;
  const targets = sel?.overview.targets ?? null;
  const annualTarget = sel ? targets!.annual : null;
  const perfAlerts = data.decisions.proposed.filter((d) => d.domain === "ADS_INTEL" && (d.priority === "HIGH" || d.priority === "CRITICAL" || d.doNotPush));
  const budgetAlerts = data.brands.filter((b) => b.budget.hasBudget && (b.budget.consumedPct ?? 0) >= scope.ctx.settings.budgetAlertPct);
  const stockAlerts = data.brands.flatMap((b) => b.stockAlerts.map((p) => ({ brand: b.name, p })));
  const maxDecisions = scope.ctx.settings.marketingPlan.maxDecisions;

  return (
    <>
      <PageHeader eyebrow="Marketing" title="Command Center" subtitle={<>Quoi pousser maintenant, pourquoi, avec quel budget, par qui et pour quand. Ventes au {fmtDate(refDate.ref)}{refDate.staleDays > 3 ? ` (retard ${refDate.staleDays} j)` : ""} · calculé à {fmtTime(data.decisions.computedAt)} · période {data.period.label}.</>}
        actions={<><Link href="/marketing/studio" className="btn-secondary btn-sm">Studio créatif</Link><Link href="/marketing/plan" className="btn-secondary btn-sm">Plan marketing</Link><Link href="/marketing/priorites" className="btn-primary btn-sm">Priorités & actions</Link></>}>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Tabs current={href(scope.selectedBrandId, period)} tabs={[{ href: href(null, period), label: "Toutes les marques" }, ...scope.allBrands.map((b) => ({ href: href(b.id, period), label: b.name }))]} />
          <div className="flex gap-1 ml-auto">{PERIODS.map((p) => <Link key={p.key} href={href(scope.selectedBrandId, p.key)} className={clsx("text-[12px] px-2 py-1 rounded-md border", p.key === period ? "bg-black/5 border-line-2" : "border-line hover:border-line-2")}>{p.label}</Link>)}</div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
          <Kpi label={`Budget ${data.year}`} value={budget && budget.hasBudget ? fmtMAD(budget.annual, { compact: true }) : "—"} sub={budget && budget.hasBudget ? "enveloppe annuelle" : "non défini"} />
          <Kpi label="Consommé" value={budget ? fmtMAD(budget.consumed, { compact: true }) : "—"} sub={budget ? (budget.consumedPct === null ? "sans budget" : `${Math.round(budget.consumedPct)} % · régie ${AD_SPEND_SOURCE_LABEL[budget.adSource]}`) : ""} tone={budget && budget.consumedPct !== null && budget.consumedPct >= 100 ? "red" : undefined} />
          <Kpi label="Restant" value={budget ? money(budget.remaining) : "—"} tone={budget && budget.remaining !== null && budget.remaining < 0 ? "red" : "green"} sub={budget ? `dépensé ${fmtMAD(budget.spent, { compact: true })}` : ""} />
          <Kpi label={`CA objectif ${data.year}`} value={sel ? money(annualTarget?.objective ?? null) : "par marque"} sub={sel ? (annualTarget?.objective ? `réalisé ${fmtMAD(annualTarget.realized, { compact: true })} (${fmtPct(annualTarget.pct ?? 0, 0)})` : "non renseigné") : "choisir une marque"} />
          <Kpi label="Objectif du mois" value={sel ? (targets!.monthly.pct === null ? "—" : fmtPct(targets!.monthly.pct, 0)) : `${data.brands.filter((b) => b.overview.targets.monthly.forecastPct !== null && b.overview.targets.monthly.forecastPct < 100).length} en retard`} sub={sel ? (targets!.monthly.forecastPct === null ? "non renseigné" : `projection ${fmtPct(targets!.monthly.forecastPct, 0)} au rythme actuel`) : "marques sous leur objectif projeté"} tone={sel && targets!.monthly.forecastPct !== null ? (targets!.monthly.forecastPct >= 100 ? "green" : "orange") : undefined} />
          <Kpi label="Campagnes actives" value={fmtNum(data.totals.activeCampaigns)} sub={`${data.totals.plannedCampaigns} planifiée(s) · ${data.totals.pendingContent} contenu(s) à publier`} />
          <Kpi label="Actions ouvertes" value={fmtNum(data.actions.counters.open)} sub={`${fmtMAD(data.actions.counters.budgetOpen, { compact: true })} prévus · ${data.actions.counters.blocked} bloquée(s)`} href="/marketing/priorites" />
          <Kpi label="En retard" value={fmtNum(data.actions.counters.late)} tone={data.actions.counters.late > 0 ? "red" : "green"} sub="actions dont l'échéance est passée" href="/marketing/priorites" />
        </div>
      </PageHeader>

      {sel ? (
        <>
          <Section title={`Quoi pousser maintenant — ${sel.name}`} description="Moteur de décision : ventes × stock × marge × Ads, règles de l'Action Center et intelligence Ads, structure commune. Approuver crée l'action et sa tâche ; rien n'est exécuté sans ce clic.">
            {data.decisions.notes.length > 0 && <ul className="text-[12px] text-amber-800 mb-2 space-y-0.5">{data.decisions.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            {sel.proposed.length === 0 ? <Card><p className="text-[13px] text-ink-2">Aucune action à recommander sur {data.period.label} : ventes stables et stock sain, ou données insuffisantes. Les actions planifiées restent dans Priorités & actions.</p></Card> : (
              <div className="space-y-3">{sel.proposed.slice(0, maxDecisions).map((d, i) => <DecisionCard key={d.id} d={d} rank={i + 1} users={users} canDecide={canCreate} back={back} />)}</div>
            )}
            {sel.doNotPush.length > 0 && (
              <div className="mt-4"><div className="label mb-2">À ne pas pousser</div><div className="space-y-3">{sel.doNotPush.slice(0, 5).map((d) => <DecisionCard key={d.id} d={d} rank={null} users={users} canDecide={canEdit} back={back} compact />)}</div></div>
            )}
          </Section>
          <div className="grid lg:grid-cols-3 gap-4 mb-6">
            <Card title="Plan et budget" action={sel.plan ? <Link href={`/marketing/plan/${sel.plan.id}`} className="text-[12px] text-accent">Ouvrir le plan</Link> : <Link href="/marketing/plan" className="text-[12px] text-accent">Créer un plan</Link>}>
              {sel.plan ? <p className="text-[13px]"><b>{sel.plan.name}</b> · <Badge tone={PLAN_STATUS[sel.plan.status as keyof typeof PLAN_STATUS]?.tone ?? "gray"}>{PLAN_STATUS[sel.plan.status as keyof typeof PLAN_STATUS]?.label ?? sel.plan.status}</Badge> · {fmtDateShort(sel.plan.periodStart)} → {fmtDateShort(sel.plan.periodEnd)}</p> : <p className="text-[13px] text-muted">Aucun plan pour {data.year}. Le budget et l&apos;objectif existants seront repris par le plan.</p>}
              {sel.budget.hasBudget && <><Progress value={Math.min(100, sel.budget.consumedPct ?? 0)} tone={(sel.budget.consumedPct ?? 0) > 90 ? "orange" : "accent"} className="mt-3" /><div className="text-[12px] text-muted mt-1">Engagé {fmtMAD(sel.budget.consumed, { compact: true })} sur {fmtMAD(sel.budget.annual, { compact: true })} · prévu non engagé {fmtMAD(sel.budget.planned, { compact: true })}</div></>}
              <div className="mt-3 text-[12px] text-muted">{sel.overview.marketing ? `${sel.overview.marketing.activeCampaigns} campagne(s) active(s) · ${sel.overview.marketing.upcomingContents} contenu(s) à venir · ${sel.overview.marketing.runningActivations} activation(s) en cours` : "activité marketing non accessible"}</div>
            </Card>
            <Card title="Alertes stock" action={<Link href={`/marketing/agent?brand=${sel.id}`} className="text-[12px] text-accent">Agent marketing</Link>}>
              {sel.stockAlerts.length === 0 ? <p className="text-[13px] text-muted">Aucun produit en risque de rupture.</p> : (
                <ul className="space-y-1 text-[12.5px]">{sel.stockAlerts.slice(0, 6).map((p) => <li key={p.productId} className="flex items-center gap-2"><Badge tone="red">{p.stock ? STOCK_RISK_LABELS[p.stock.risk] : "stock"}</Badge><Link href={`/produits/${p.productId}`} className="hover:underline flex-1 truncate">{p.name}</Link><span className="text-muted">{p.stock?.daysOfStock !== null && p.stock?.daysOfStock !== undefined ? `${p.stock.daysOfStock} j` : "—"}</span></li>)}</ul>
              )}
            </Card>
            <Card title="Actions en retard" action={<Link href={`/marketing/priorites?brand=${sel.id}`} className="text-[12px] text-accent">Toutes les actions</Link>}>
              {data.actions.late.length === 0 ? <p className="text-[13px] text-muted">Aucune action en retard.</p> : (
                <ul className="space-y-1 text-[12.5px]">{data.actions.late.slice(0, 6).map((a) => <li key={a.id} className="flex items-center gap-2"><StatusBadge status={a.status} /><Link href={`/marketing/priorites/${a.id}`} className="hover:underline flex-1 truncate">{a.title}</Link><span className="text-red">{a.dueDate ? fmtDateShort(a.dueDate) : ""}</span><span className="text-muted">{a.assigneeName ?? "non assignée"}</span></li>)}</ul>
              )}
            </Card>
          </div>
        </>
      ) : (
        <Section title="Quoi pousser maintenant, par marque" description="La décision n°1 de chaque marque, son budget, son objectif du mois et ses actions. Ouvrir une marque pour approuver ou refuser.">
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{data.brands.map((c) => <BrandTile key={c.id} c={c} href={href(c.id, period)} />)}</div>
        </Section>
      )}

      <Section title="Alertes et opportunités" description="Budget, performance publicitaire, stock et exécution : ce qui demande un arbitrage cette semaine.">
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
          <Card title="Budget">
            {budgetAlerts.length === 0 ? <p className="text-[12.5px] text-muted">Aucune marque au-dessus du seuil d&apos;alerte ({scope.ctx.settings.budgetAlertPct} %).</p> : <ul className="space-y-1 text-[12.5px]">{budgetAlerts.map((b) => <li key={b.id} className="flex items-center gap-2"><Badge tone={(b.budget.consumedPct ?? 0) >= 100 ? "red" : "orange"}>{Math.round(b.budget.consumedPct ?? 0)} %</Badge><Link href={`/marketing/budgets?brand=${b.id}`} className="hover:underline">{b.name}</Link><span className="text-muted ml-auto">reste {money(b.budget.remaining)}</span></li>)}</ul>}
          </Card>
          <Card title="Performance Ads">
            {perfAlerts.length === 0 ? <p className="text-[12.5px] text-muted">Aucune alerte de l&apos;intelligence Ads sur la période.</p> : <ul className="space-y-1 text-[12.5px]">{perfAlerts.slice(0, 6).map((d) => <li key={d.id} className="flex items-center gap-2"><Badge tone={d.doNotPush ? "red" : "orange"}>{d.recommendationLabel}</Badge><span className="truncate flex-1">{d.entity.name}</span></li>)}</ul>}
            <Link href="/marketing/ads" className="btn-ghost btn-sm mt-2">Digital Ads</Link>
          </Card>
          <Card title="Stock">
            {stockAlerts.length === 0 ? <p className="text-[12.5px] text-muted">Aucun produit en risque de rupture.</p> : <ul className="space-y-1 text-[12.5px]">{stockAlerts.slice(0, 6).map(({ brand, p }) => <li key={p.productId} className="flex items-center gap-2"><Badge tone="red">{p.stock?.daysOfStock !== null && p.stock?.daysOfStock !== undefined ? `${p.stock.daysOfStock} j` : "rupture"}</Badge><Link href={`/produits/${p.productId}`} className="hover:underline truncate flex-1">{p.name}</Link><span className="text-muted">{brand}</span></li>)}</ul>}
          </Card>
          <Card title="Opportunités">
            {data.decisions.proposed.filter((d) => d.recommendation === "PUSH" || d.recommendation === "SCALE" || d.recommendation === "INCREASE_BUDGET" || d.recommendation === "BOOST_DIGITAL").length === 0 ? <p className="text-[12.5px] text-muted">Aucune opportunité d&apos;accélération détectée sur la période.</p> : (
              <ul className="space-y-1 text-[12.5px]">{data.decisions.proposed.filter((d) => d.recommendation === "PUSH" || d.recommendation === "SCALE" || d.recommendation === "INCREASE_BUDGET" || d.recommendation === "BOOST_DIGITAL").slice(0, 6).map((d) => <li key={d.id} className="flex items-center gap-2"><Badge tone="green">{d.recommendationLabel}</Badge><span className="truncate flex-1">{d.entity.name}</span>{d.category && <span className="text-muted">{BUDGET_CATEGORY_LABELS[d.category]}</span>}</li>)}</ul>
            )}
          </Card>
        </div>
      </Section>

      <div className="text-[11.5px] text-faint">Corrélation ≠ attribution : un CA n&apos;est « attribué » que s&apos;il est mesuré (conversion régie, code promo, montant saisi). Les décisions sont des recommandations calculées ; la validation humaine reste la règle. Analyses détaillées : <Link href="/marketing/analytics" className="underline">Analytics</Link>.</div>
    </>
  );
}
