import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { getRefDate } from "@/lib/ref-date";
import { listPlans, getPlan } from "@/lib/marketing-plan/plan";
import { decisionScopeFor } from "@/lib/decisions/server";
import { buildBrandOverview } from "@/lib/marketing-intel/build";
import { decide, ACTION_LABELS } from "@/lib/marketing-intel/decisions";
import type { MarketingAction } from "@/lib/marketing-intel/types";
import { AD_SPEND_SOURCE_LABEL } from "@/lib/budget";
import { PLAN_STATUS } from "@/lib/marketing-plan/shared";
import { PageHeader, Card, Tabs, Section, Badge, BrandDot, Kpi, Empty, type Tone } from "@/components/ui";
import { ANALYTICS_TABS } from "@/components/analytics";
import { fmtMAD, fmtPct, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics · Plan vs réel" };

/** Lecture produit du moteur de décision, dans le vocabulaire du plan : pousser / maintenir / optimiser / réduire / arrêter / restocker / ne pas promouvoir. */
const PRODUCT_CLASS: Record<MarketingAction, { label: string; tone: Tone }> = {
  PUSH: { label: "À pousser", tone: "green" }, BOOST_DIGITAL: { label: "À pousser (digital)", tone: "green" }, MAINTAIN: { label: "À maintenir", tone: "blue" },
  OPTIMIZE: { label: "À optimiser", tone: "orange" }, REDUCE: { label: "À réduire", tone: "orange" }, STOP: { label: "À arrêter", tone: "red" },
  RESTOCK: { label: "À restocker", tone: "red" }, DO_NOT_PROMOTE: { label: "À ne pas promouvoir", tone: "red" },
  CREATE_CONTENT: { label: "À pousser (contenu)", tone: "accent" }, CREATE_PROMOTION: { label: "À écouler (promotion)", tone: "purple" },
  ACTIVATE_INFLUENCER: { label: "À pousser (influence)", tone: "accent" }, FOCUS_SELL_OUT: { label: "À écouler (sell-out)", tone: "purple" },
};

export default async function AnalyticsPlanPage(props: { searchParams: Promise<{ brand?: string; year?: string }> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const [scope, { ref }] = await Promise.all([decisionScopeFor(sp.brand ?? null), getRefDate()]);
  const year = Number(sp.year) || ref.getUTCFullYear();
  const plans = (await listPlans(scope.brands.map((b) => b.id))).filter((p) => p.year === year);
  const details = await Promise.all(plans.map((p) => getPlan(p.id)));
  const q = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, v); const s = p.toString(); return `/marketing/analytics/plan${s ? "?" + s : ""}`; };

  // Classement produit du moteur officiel (`decide()`), une marque à la fois quand elle est choisie.
  const overview = scope.selectedBrandId ? await buildBrandOverview(scope.ctx, { brandId: scope.selectedBrandId, brandName: scope.brands[0].name, period: "90d" }) : null;
  const classes = overview ? decide({ rows: overview.performance.rows, settings: scope.ctx.settings, brandName: overview.brand.name, ads: null, targets: overview.targets, comparable: overview.performance.comparable, periodLabel: overview.period.label }) : null;

  const totals = details.reduce((t, d) => d ? { budget: t.budget + (d.framing.budget ?? 0), allocated: t.allocated + d.framing.allocated, committed: t.committed + d.chain.committed, spent: t.spent + d.chain.spent } : t, { budget: 0, allocated: 0, committed: 0, spent: 0 });

  return (
    <>
      <div className="mb-4"><Tabs tabs={ANALYTICS_TABS} current="/marketing/analytics/plan" /></div>
      <PageHeader eyebrow="Analytics marketing" title="Plan vs réel" subtitle={`Année ${year} · budget planifié, alloué, engagé et dépensé par plan et par canal ; objectifs du plan ; classement des produits selon le moteur de décision. Ventes au ${fmtDate(ref)}.`}
        actions={<Link href="/marketing/plan" className="btn-secondary btn-sm">Plan marketing</Link>}>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Tabs current={q({ brand: sp.brand })} tabs={[{ href: q({ brand: "" }), label: "Toutes les marques" }, ...scope.allBrands.map((b) => ({ href: q({ brand: b.id }), label: b.name }))]} />
          <div className="flex gap-1 ml-auto">{[year - 1, year, year + 1].map((y) => <Link key={y} href={q({ year: String(y) })} className={`text-[12px] px-2 py-1 rounded-md border ${y === year ? "bg-black/5 border-line-2" : "border-line hover:border-line-2"}`}>{y}</Link>)}</div>
        </div>
        {details.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi label="Budget planifié" value={fmtMAD(totals.budget, { compact: true })} sub={`${details.length} plan(s)`} />
            <Kpi label="Alloué par canal" value={fmtMAD(totals.allocated, { compact: true })} sub={totals.budget ? `${fmtPct((totals.allocated / totals.budget) * 100, 0)} du planifié` : "—"} />
            <Kpi label="Engagé" value={fmtMAD(totals.committed, { compact: true })} sub={totals.budget ? `${fmtPct((totals.committed / totals.budget) * 100, 0)} du planifié` : "—"} tone={totals.budget && totals.committed > totals.budget ? "red" : undefined} />
            <Kpi label="Dépensé" value={fmtMAD(totals.spent, { compact: true })} />
            <Kpi label="Reste" value={fmtMAD(totals.budget - totals.committed, { compact: true })} tone={totals.budget - totals.committed < 0 ? "red" : "green"} />
          </div>
        )}
      </PageHeader>

      {details.length === 0 ? (
        <Empty title={`Aucun plan marketing pour ${year}`} hint="Créer un plan (Marketing → Plan marketing) : CA objectif, budget, allocation par canal. L'écart plan / réel est mesuré dès qu'une dépense est engagée." action={<Link href="/marketing/plan" className="btn-primary btn-sm">Ouvrir le plan marketing</Link>} />
      ) : details.map((d) => d && (
        <Section key={d.plan.id} title={<span className="inline-flex items-center gap-2"><BrandDot color={d.plan.brandColor} />{d.plan.brandName} — {d.plan.name} <Badge tone={PLAN_STATUS[d.plan.status].tone}>{PLAN_STATUS[d.plan.status].label}</Badge></span>} description={`CA objectif ${d.framing.revenueTarget === null ? "non renseigné" : fmtMAD(d.framing.revenueTarget, { compact: true })} · taux marketing ${d.framing.marketingRatePct === null ? "—" : fmtPct(d.framing.marketingRatePct, 1)} · régie ${AD_SPEND_SOURCE_LABEL[d.consumption.adSource]}`} action={<Link href={`/marketing/plan/${d.plan.id}`} className="btn-ghost btn-sm">Ouvrir</Link>}>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Budget par canal : alloué vs engagé vs dépensé" pad={false}>
              <table className="tbl text-[12.5px]">
                <thead><tr><th>Canal</th><th className="num">Alloué</th><th className="num">Engagé</th><th className="num">Écart</th><th className="num">Dépensé</th></tr></thead>
                <tbody>
                  {d.allocation.filter((a) => a.planned > 0 || a.committed > 0).map((a) => { const gap = a.committed - a.planned; return (
                    <tr key={a.category}><td>{a.label}</td><td className="num">{a.planned ? fmtMAD(a.planned, { suffix: false }) : "—"}</td><td className="num">{a.committed ? fmtMAD(a.committed, { suffix: false }) : "—"}</td><td className={`num ${a.planned > 0 && gap > 0 ? "text-red font-medium" : "text-muted"}`}>{a.planned > 0 ? (gap > 0 ? "+" : "") + fmtMAD(gap, { suffix: false }) : "non alloué"}</td><td className="num">{a.spent ? fmtMAD(a.spent, { suffix: false }) : "—"}</td></tr>
                  ); })}
                  {d.allocation.every((a) => !a.planned && !a.committed) && <tr><td colSpan={5} className="text-muted text-center py-3">Aucune allocation ni dépense.</td></tr>}
                </tbody>
                <tfoot><tr><th>Régie (hors canal)</th><th></th><th className="num">{fmtMAD(d.consumption.adSpend, { suffix: false })}</th><th></th><th></th></tr><tr><th>Total engagé (définition budget.ts)</th><th className="num">{fmtMAD(d.framing.allocated, { suffix: false })}</th><th className="num">{fmtMAD(d.chain.committed, { suffix: false })}</th><th className={`num ${d.chain.remaining !== null && d.chain.remaining < 0 ? "text-red" : ""}`}>{d.chain.remaining === null ? "—" : `reste ${fmtMAD(d.chain.remaining, { suffix: false })}`}</th><th className="num">{fmtMAD(d.chain.spent, { suffix: false })}</th></tr></tfoot>
              </table>
            </Card>
            <div className="space-y-4">
              <Card title="Axes : budget vs engagé" pad={false}>
                <table className="tbl text-[12.5px]"><thead><tr><th>Axe</th><th className="num">Budget</th><th className="num">Engagé</th><th className="num">Actions</th></tr></thead>
                  <tbody>{d.axes.map((a) => <tr key={a.id}><td>{a.name}{a.productName && <span className="text-muted"> · {a.productName}</span>}</td><td className="num">{fmtMAD(a.budget, { suffix: false })}</td><td className={`num ${a.budget > 0 && a.committed > a.budget ? "text-red font-medium" : ""}`}>{a.committed ? fmtMAD(a.committed, { suffix: false }) : "—"}</td><td className="num">{a.actions}</td></tr>)}{d.axes.length === 0 && <tr><td colSpan={4} className="text-muted text-center py-3">Aucun axe.</td></tr>}</tbody>
                </table>
              </Card>
              <Card title="Plan mensuel : budget vs actions" pad={false}>
                <table className="tbl text-[12.5px]"><thead><tr><th>Mois</th><th>Produit prioritaire</th><th className="num">Budget</th><th className="num">Actions (prévu)</th><th className="num">Actions</th></tr></thead>
                  <tbody>{d.months.filter((m) => m.budget > 0 || m.actions.length > 0).map((m) => <tr key={m.month}><td className="capitalize">{m.month.slice(0, 7)}</td><td>{m.focusProductName ?? "—"}</td><td className="num">{m.budget ? fmtMAD(m.budget, { suffix: false }) : "—"}</td><td className={`num ${m.budget > 0 && m.actionsBudget > m.budget ? "text-red" : ""}`}>{m.actionsBudget ? fmtMAD(m.actionsBudget, { suffix: false }) : "—"}</td><td className="num">{m.actions.length}</td></tr>)}{d.months.every((m) => !m.budget && !m.actions.length) && <tr><td colSpan={5} className="text-muted text-center py-3">Aucun mois budgété.</td></tr>}</tbody>
                </table>
              </Card>
            </div>
          </div>
        </Section>
      ))}

      {classes && overview && (
        <Section title={`Produits ${overview.brand.name} — lecture du moteur de décision (${overview.period.label})`} description="Ventes × stock × marge, seuils Paramètres → Agent marketing : à pousser, à maintenir, à optimiser, à réduire, à arrêter, à restocker, à ne pas promouvoir. Un produit absent n'appelle aucune action (stable et sain, ou données insuffisantes).">
          <Card pad={false}>
            <table className="tbl text-[12.5px]"><thead><tr><th>Produit</th><th>Lecture</th><th>Pourquoi</th><th>Confiance</th></tr></thead>
              <tbody>
                {[...classes.decisions, ...classes.doNotPush].filter((d) => d.productId).map((d) => { const c = PRODUCT_CLASS[d.action]; return (
                  <tr key={d.key}><td><Link href={`/produits/${d.productId}`} className="font-medium hover:underline">{d.productName}</Link></td><td><Badge tone={c.tone}>{c.label}</Badge> <span className="text-muted text-[11px]">{ACTION_LABELS[d.action]}</span></td><td className="text-ink-2">{d.why.slice(0, 2).join(" ; ")}</td><td className="text-muted">{d.confidence === "HIGH" ? "élevée" : d.confidence === "MEDIUM" ? "moyenne" : "faible"}</td></tr>
                ); })}
                {classes.decisions.length + classes.doNotPush.length === 0 && <tr><td colSpan={4} className="text-muted text-center py-3">Aucun produit n&apos;appelle une action sur la période.</td></tr>}
              </tbody>
            </table>
          </Card>
        </Section>
      )}
      {!scope.selectedBrandId && <p className="text-[12px] text-muted">Choisir une marque pour voir le classement des produits (à pousser, à maintenir, à restocker…).</p>}
    </>
  );
}
