import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { getRefDate } from "@/lib/ref-date";
import { getSettings } from "@/lib/settings";
import { listBrands } from "@/lib/users";
import { PageHeader, Card, Badge, BrandDot, Progress, Tabs, Section } from "@/components/ui";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import { budgetConsumptionByBrand, AD_SPEND_SOURCE_LABEL } from "@/lib/budget";
import { fmtMAD, fmtPct, fmtDate, fmtDateShort, iso } from "@/lib/format";
import { CAMPAIGN_STATUS } from "@/lib/marketing-shared";
import { saveBudget, saveBudgetLine, deleteBudgetLine, saveExpense, deleteExpense } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Budgets marketing" };

const STATUS_LABEL = { PLANNED: "Prévu", COMMITTED: "Engagé", SPENT: "Dépensé" } as const;

export default async function MarketingBudgetsPage(props: { searchParams: Promise<{ brand?: string; year?: string }> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const { ref } = await getRefDate();
  const year = Number(sp.year) || ref.getUTCFullYear();
  const [brands, settings] = await Promise.all([listBrands(), getSettings()]);
  const activeBrands = brands.filter((b) => b.active);
  const brandId = sp.brand && activeBrands.some((b) => b.id === sp.brand) ? sp.brand : null;

  const [consumption, budgetRows, lineRows, expenseRows, campaignRows, marginRows] = await Promise.all([
    budgetConsumptionByBrand(year),
    db.execute(sql`select brand_id, amount::float8 as amount, reference_revenue::float8 as ref, pct_of_revenue::float8 as pct from budgets where year = ${year}`),
    db.execute(sql`select id, brand_id, label, category::text as category, amount::float8 as amount from budget_lines where year = ${year} order by amount desc`),
    db.execute(sql`select e.id, e.brand_id, e.label, e.category::text as category, e.status::text as status, e.amount::float8 as amount, e.date::text as date, e.attributed_revenue::float8 as revenue, e.conversions, e.campaign_id, c.name as campaign from marketing_expenses e left join campaigns c on c.id = e.campaign_id where extract(year from e.date) = ${year} order by e.date desc`),
    db.execute(sql`select c.*, coalesce((select sum(amount) from marketing_expenses e where e.campaign_id = c.id and e.status <> 'PLANNED'),0)::float8 as spend, coalesce((select sum(attributed_revenue) from marketing_expenses e where e.campaign_id = c.id),0)::float8 as revenue, coalesce((select sum(conversions) from marketing_expenses e where e.campaign_id = c.id),0)::float8 as conversions from campaigns c order by c.status, c.start_date desc`),
    db.execute(sql`select p.brand_id, sum(s.amount)::float8 as revenue, sum(s.quantity * coalesce(p.cost_price,0))::float8 as cost, sum(case when p.cost_price is null then s.amount else 0 end)::float8 as unknown from sales s join products p on p.id = s.product_id where s.date >= ${iso(new Date(Date.UTC(year, 0, 1)))}::date group by p.brand_id`),
  ]);
  type Budget = { brand_id: string; amount: number; ref: number | null; pct: number | null };
  type Line = { id: string; brand_id: string; label: string; category: string; amount: number };
  type Expense = { id: string; brand_id: string; label: string; category: string; status: "PLANNED" | "COMMITTED" | "SPENT"; amount: number; date: string; revenue: number | null; conversions: number | null; campaign_id: string | null; campaign: string | null };
  type Campaign = { id: string; brand_id: string; name: string; channel: string; objective: string | null; start_date: string | null; end_date: string | null; budget: number | null; status: string; spend: number; revenue: number; conversions: number };
  const budgetsBy = new Map((budgetRows.rows as Budget[]).map((b) => [b.brand_id, b]));
  const marginBy = new Map((marginRows.rows as { brand_id: string; revenue: number; cost: number; unknown: number }[]).map((m) => [m.brand_id, m.revenue > 0 && m.unknown / m.revenue < 0.5 ? ((m.revenue - m.unknown) - m.cost) / (m.revenue - m.unknown) * 100 : settings.defaultMarginPct]));
  const brandsToShow = brandId ? activeBrands.filter((b) => b.id === brandId) : activeBrands;
  const lines = lineRows.rows as Line[], expenses = expenseRows.rows as Expense[], campaigns = campaignRows.rows as Campaign[];

  // Consommation : définition officielle unique (`src/lib/budget.ts`), la même que le cockpit,
  // /marketing et la règle `budget-overrun`. « Engagé » inclut donc la dépense de régie.
  const consumed = (id: string) => consumption.get(id)?.consumed ?? 0;
  const totals = { budget: 0, planned: 0, engaged: 0, spent: 0, revenue: 0 };
  for (const b of activeBrands) {
    const c = consumption.get(b.id);
    totals.budget += c?.annual ?? 0;
    totals.engaged += c?.consumed ?? 0;
    totals.spent += c?.spent ?? 0;
    totals.planned += c?.planned ?? 0;
    for (const e of expenses.filter((e) => e.brand_id === b.id)) totals.revenue += e.revenue ?? 0;
  }

  return (
    <>
      <PageHeader eyebrow="Marketing Operating System" title="Budgets & campagnes" subtitle={`Année ${year} · budget prévu / engagé / dépensé / restant par marque, croisé avec le CA attribué et la marge.`}
        actions={<><Link href="/marketing" className="btn-secondary btn-sm">Vue d&apos;ensemble</Link><Link href="/imports?type=BUDGETS" className="btn-ghost btn-sm">Importer budgets</Link></>}>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
          <Card><div className="label">Budget annuel</div><div className="kpi mt-2">{fmtMAD(totals.budget, { compact: true })}</div></Card>
          <Card><div className="label">Prévu (actions)</div><div className="kpi mt-2">{fmtMAD(totals.planned, { compact: true })}</div><div className="text-[12px] text-muted mt-1">{fmtPct(totals.budget ? (totals.planned / totals.budget) * 100 : 0)} du budget</div></Card>
          <Card><div className="label">Engagé</div><div className="kpi mt-2">{fmtMAD(totals.engaged, { compact: true })}</div><Progress value={totals.budget ? (totals.engaged / totals.budget) * 100 : 0} className="mt-2" /></Card>
          <Card><div className="label">Dépensé</div><div className="kpi mt-2">{fmtMAD(totals.spent, { compact: true })}</div></Card>
          <Card><div className="label">Disponible</div><div className={`kpi mt-2 ${totals.budget - totals.engaged < 0 ? "text-red" : "text-green"}`}>{fmtMAD(totals.budget - totals.engaged, { compact: true })}</div><div className="text-[12px] text-muted mt-1">CA attribué {fmtMAD(totals.revenue, { compact: true })}</div></Card>
        </div>
        <Tabs current={brandId ? `/marketing/budgets?brand=${brandId}` : "/marketing/budgets"} tabs={[{ href: "/marketing/budgets", label: "Toutes les marques" }, ...activeBrands.map((b) => ({ href: `/marketing/budgets?brand=${b.id}`, label: b.name }))]} />
      </PageHeader>

      <div className="space-y-6">
        {brandsToShow.map((b) => {
          const bud = budgetsBy.get(b.id);
          const bl = lines.filter((l) => l.brand_id === b.id);
          const ex = expenses.filter((e) => e.brand_id === b.id);
          const c = consumption.get(b.id);
          const planned = c?.planned ?? 0, engaged = consumed(b.id), spent = c?.spent ?? 0;
          const revenue = ex.reduce((a, e) => a + (e.revenue ?? 0), 0);
          const margin = marginBy.get(b.id) ?? settings.defaultMarginPct;
          const grossMargin = revenue * (margin / 100);
          const roi = engaged ? ((grossMargin - engaged) / engaged) * 100 : null;
          const byCat = new Map<string, { plan: number; spent: number }>();
          for (const l of bl) byCat.set(l.category, { plan: (byCat.get(l.category)?.plan ?? 0) + l.amount, spent: byCat.get(l.category)?.spent ?? 0 });
          for (const e of ex) if (e.status !== "PLANNED") byCat.set(e.category, { plan: byCat.get(e.category)?.plan ?? 0, spent: (byCat.get(e.category)?.spent ?? 0) + e.amount });
          const camps = campaigns.filter((c) => c.brand_id === b.id);
          return (
            <section key={b.id} className="card overflow-hidden">
              <div className="px-4 sm:px-5 py-4 border-b border-line flex flex-wrap items-center gap-3">
                <BrandDot color={b.color} className="h-3 w-3" /><Link href={`/marques/${b.id}`} className="font-semibold text-[16px] hover:underline">{b.name}</Link>
                <div className="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
                  <span><span className="text-muted">Budget </span><b>{bud ? fmtMAD(bud.amount, { compact: true }) : "—"}</b>{bud?.pct ? <span className="text-faint"> ({fmtPct(bud.pct)} du CA réf.)</span> : null}</span>
                  <span><span className="text-muted">Prévu </span><b>{fmtMAD(planned, { compact: true })}</b></span>
                  <span><span className="text-muted">Engagé </span><b>{fmtMAD(engaged, { compact: true })}</b>{c && c.adSpend !== 0 ? <span className="text-faint"> (dont {fmtMAD(c.adSpend, { compact: true })} de publicité, {AD_SPEND_SOURCE_LABEL[c.adSource]})</span> : null}</span>
                  <span><span className="text-muted">Dépensé </span><b>{fmtMAD(spent, { compact: true })}</b></span>
                  <span><span className="text-muted">Restant </span><b className={bud && bud.amount - engaged < 0 ? "text-red" : "text-green"}>{bud ? fmtMAD(bud.amount - engaged, { compact: true }) : "—"}</b></span>
                </div>
              </div>
              {bud && <Progress value={(engaged / bud.amount) * 100} tone={engaged / bud.amount > 0.9 ? "orange" : "accent"} className="rounded-none h-1" />}
              <div className="grid lg:grid-cols-3 gap-4 p-4 sm:p-5">
                <div>
                  <div className="label mb-2">Plan par catégorie</div>
                  <table className="tbl text-[12.5px]"><thead><tr><th>Catégorie</th><th className="num">Plan</th><th className="num">Engagé</th></tr></thead><tbody>
                    {[...byCat.entries()].sort((a, b) => b[1].plan - a[1].plan).map(([cat, v]) => <tr key={cat}><td>{BUDGET_CATEGORY_LABELS[cat as keyof typeof BUDGET_CATEGORY_LABELS] ?? cat}</td><td className="num">{fmtMAD(v.plan, { compact: true, suffix: false })}</td><td className={`num ${v.plan && v.spent > v.plan ? "text-red font-medium" : ""}`}>{v.spent ? fmtMAD(v.spent, { compact: true, suffix: false }) : "—"}</td></tr>)}
                    {byCat.size === 0 && <tr><td colSpan={3} className="text-muted text-center py-3">Aucune ligne de budget.</td></tr>}
                  </tbody></table>
                  <details className="mt-2"><summary className="cursor-pointer text-[12px] text-accent font-medium">Lignes de plan ({bl.length}) · modifier</summary>
                    <ul className="mt-2 space-y-1 text-[12px]">{bl.map((l) => <li key={l.id} className="flex items-center gap-2"><span className="flex-1 truncate">{l.label}</span><span className="font-medium">{fmtMAD(l.amount, { compact: true, suffix: false })}</span><form action={deleteBudgetLine}><input type="hidden" name="id" value={l.id} /><button className="text-faint hover:text-red" type="submit" title="Supprimer">×</button></form></li>)}</ul>
                    <form action={saveBudgetLine} className="mt-2 grid grid-cols-[1fr_auto] gap-1.5"><input type="hidden" name="brandId" value={b.id} /><input type="hidden" name="year" value={year} /><input name="label" placeholder="Libellé (ex: Influence)" className="input h-8 text-[12px]" required /><input name="amount" placeholder="MAD" className="input h-8 text-[12px] w-24" required /><select name="category" className="select h-8 text-[12px] col-span-2"><option value="">Catégorie auto</option>{BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{BUDGET_CATEGORY_LABELS[c]}</option>)}</select><button className="btn-secondary btn-sm col-span-2" type="submit">Ajouter la ligne</button></form>
                    <form action={saveBudget} className="mt-3 grid grid-cols-2 gap-1.5 border-t border-line pt-2"><input type="hidden" name="brandId" value={b.id} /><input type="hidden" name="year" value={year} /><input name="amount" defaultValue={bud?.amount ?? ""} placeholder="Budget annuel" className="input h-8 text-[12px]" required /><input name="referenceRevenue" defaultValue={bud?.ref ?? ""} placeholder="CA de référence" className="input h-8 text-[12px]" /><button className="btn-secondary btn-sm col-span-2" type="submit">Enregistrer le budget {year}</button></form>
                  </details>
                </div>
                <div className="lg:col-span-2">
                  <div className="flex items-center justify-between mb-2"><div className="label">Actions & dépenses ({ex.length})</div><div className="text-[12px] text-muted">CA attribué <b>{fmtMAD(revenue, { compact: true })}</b> · marge {Math.round(margin)} % → <b>{fmtMAD(grossMargin, { compact: true })}</b> · ROI réel <b className={roi !== null && roi < 0 ? "text-red" : "text-green"}>{roi === null ? "—" : fmtPct(roi, 0, true)}</b></div></div>
                  <div className="overflow-x-auto"><table className="tbl text-[12.5px]"><thead><tr><th>Date</th><th>Action</th><th>Catégorie</th><th>Statut</th><th className="num">Montant</th><th className="num">CA attribué</th><th className="num">ROAS</th><th></th></tr></thead><tbody>
                    {ex.slice(0, 12).map((e) => <tr key={e.id}><td className="whitespace-nowrap">{fmtDateShort(e.date)}</td><td>{e.label}{e.campaign && <span className="text-faint"> · {e.campaign}</span>}</td><td className="text-muted">{BUDGET_CATEGORY_LABELS[e.category as keyof typeof BUDGET_CATEGORY_LABELS]}</td><td><Badge tone={e.status === "SPENT" ? "green" : e.status === "COMMITTED" ? "blue" : "gray"}>{STATUS_LABEL[e.status]}</Badge></td><td className="num font-medium">{fmtMAD(e.amount, { suffix: false })}</td><td className="num">{e.revenue ? fmtMAD(e.revenue, { suffix: false }) : "—"}</td><td className="num">{e.revenue && e.amount ? (e.revenue / e.amount).toFixed(1) + "×" : "—"}</td><td><form action={deleteExpense}><input type="hidden" name="id" value={e.id} /><button className="text-faint hover:text-red" type="submit" title="Supprimer">×</button></form></td></tr>)}
                    {ex.length === 0 && <tr><td colSpan={8} className="text-muted text-center py-3">Aucune action saisie pour {year}.</td></tr>}
                  </tbody></table></div>
                  <details className="mt-2"><summary className="cursor-pointer text-[12px] text-accent font-medium">+ Ajouter une action / dépense</summary>
                    <form action={saveExpense} className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-1.5 text-[12px]">
                      <input type="hidden" name="brandId" value={b.id} />
                      <input name="label" placeholder="Libellé" className="input h-8 col-span-2" required />
                      <input type="date" name="date" defaultValue={iso(new Date())} className="input h-8" required />
                      <input name="amount" placeholder="Montant MAD" className="input h-8" required />
                      <select name="category" className="select h-8"><option value="">Catégorie auto</option>{BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{BUDGET_CATEGORY_LABELS[c]}</option>)}</select>
                      <select name="status" className="select h-8"><option value="PLANNED">Prévu</option><option value="COMMITTED">Engagé</option><option value="SPENT">Dépensé</option></select>
                      <select name="campaignId" className="select h-8"><option value="">Campagne (facultatif)</option>{camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                      <input name="attributedRevenue" placeholder="CA attribué" className="input h-8" />
                      <input name="conversions" placeholder="Conversions" className="input h-8" />
                      <button className="btn-secondary btn-sm col-span-2 md:col-span-3" type="submit">Enregistrer</button>
                    </form>
                  </details>
                  <div className="flex items-center justify-between mt-4 mb-2"><div className="label">Campagnes ({camps.length})</div><Link href={`/marketing/campagnes?brand=${b.id}`} className="text-[12px] text-accent font-medium hover:underline">Ouvrir le module campagnes →</Link></div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {camps.slice(0, 6).map((c) => { const roas = c.spend ? c.revenue / c.spend : null; const cpa = c.conversions ? c.spend / c.conversions : null; const meta = CAMPAIGN_STATUS[c.status] ?? { label: c.status, tone: "gray" as const }; return (
                      <Link key={c.id} href={`/marketing/campagnes/${c.id}`} className="rounded-xl border border-line p-3 text-[12.5px] hover:border-accent transition-colors">
                        <div className="flex items-center gap-2"><span className="font-medium flex-1 truncate">{c.name}</span><Badge tone={meta.tone}>{meta.label}</Badge><Badge tone="gray">{c.channel}</Badge></div>
                        <div className="text-muted mt-1">{c.objective ?? ""} {c.start_date && <span>· {fmtDateShort(c.start_date)} → {fmtDateShort(c.end_date)}</span>}</div>
                        <div className="mt-2 grid grid-cols-4 gap-1 text-center"><div><div className="text-[10px] text-muted">Budget</div><div className="font-medium">{c.budget ? fmtMAD(c.budget, { compact: true, suffix: false }) : "—"}</div></div><div><div className="text-[10px] text-muted">Dépensé</div><div className="font-medium">{fmtMAD(c.spend, { compact: true, suffix: false })}</div></div><div><div className="text-[10px] text-muted">ROAS mesuré</div><div className="font-medium">{roas !== null ? roas.toFixed(1) + "×" : "—"}</div></div><div><div className="text-[10px] text-muted">CPA</div><div className="font-medium">{cpa !== null ? fmtMAD(cpa, { suffix: false }) : "—"}</div></div></div>
                      </Link>
                    ); })}
                    {camps.length === 0 && <div className="text-[12.5px] text-muted">Aucune campagne. <Link href={`/marketing/campagnes?brand=${b.id}`} className="text-accent">En créer une</Link>.</div>}
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <Section title="" className="mt-6"><Card><div className="label mb-1">Note V1</div><p className="text-[13px] text-ink-2">Les performances Ads (dépense, conversions, CA attribué) sont saisies ici par action ou importées par CSV ; la connexion directe Meta / TikTok / Google est prévue en V3. L&apos;Ads Intelligence (SCALE / MAINTAIN / OPTIMIZE / STOP) s&apos;appuie sur ces données et remonte dans l&apos;Action Center. Marge utilisée pour le ROI : coût de revient des produits vendus quand il est connu, sinon {settings.defaultMarginPct} % par défaut (Paramètres). Dernière donnée de vente : {fmtDate(ref)}.</p></Card></Section>
    </>
  );
}
