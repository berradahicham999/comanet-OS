import Link from "next/link";
import { requireAccess, brandFilter, canDo } from "@/lib/access";
import { listBrands } from "@/lib/users";
import { getRefDate } from "@/lib/ref-date";
import { listPlans } from "@/lib/marketing-plan/plan";
import { PLAN_STATUS } from "@/lib/marketing-plan/shared";
import { PageHeader, Card, Badge, BrandDot, Empty, Progress, Section } from "@/components/ui";
import { fmtMAD, fmtPct, fmtDateShort } from "@/lib/format";
import { savePlanAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan marketing" };

export default async function MarketingPlansPage() {
  await requireAccess("marketing");
  const [scope, allBrands, { ref }, canCreate] = await Promise.all([brandFilter(), listBrands(), getRefDate(), canDo("marketing", "create")]);
  const brands = allBrands.filter((b) => b.active && !b.mergedIntoId && (scope === null || scope.includes(b.id)));
  const plans = await listPlans(scope);
  const year = ref.getUTCFullYear();

  return (
    <>
      <PageHeader eyebrow="Marketing" title="Plan marketing" subtitle="Objectifs commerciaux → budget → allocation par canal → axes → plan mensuel → actions. Le budget du plan est l'enveloppe annuelle de la marque, son CA objectif l'objectif de vente : rien n'est saisi deux fois."
        actions={<Link href="/marketing/budgets" className="btn-secondary btn-sm">Budget & dépenses</Link>} />

      {plans.length === 0 ? (
        <Empty title="Aucun plan marketing" hint="Créer le premier plan ci-dessous : une marque, une période, un CA objectif et un budget. L'allocation par canal sera ensuite proposée à partir de l'historique réel des dépenses." />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
          {plans.map((p) => {
            const st = PLAN_STATUS[p.status];
            const rate = p.budget && p.revenueTarget ? (p.budget / p.revenueTarget) * 100 : null;
            return (
              <Link key={p.id} href={`/marketing/plan/${p.id}`} className="card p-4 hover:border-accent transition-colors block">
                <div className="flex items-center gap-2"><BrandDot color={p.brandColor} /><span className="font-semibold text-[14px] flex-1 truncate">{p.name}</span><Badge tone={st.tone}>{st.label}</Badge></div>
                <div className="text-[12px] text-muted mt-1">{p.brandName} · {fmtDateShort(p.periodStart)} → {fmtDateShort(p.periodEnd)}</div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-[12px]">
                  <div><div className="text-[10.5px] text-muted uppercase tracking-wide">CA objectif</div><div className="font-semibold">{p.revenueTarget === null ? "—" : fmtMAD(p.revenueTarget, { compact: true })}</div></div>
                  <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Budget</div><div className="font-semibold">{p.budget === null ? "—" : fmtMAD(p.budget, { compact: true })}</div></div>
                  <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Taux marketing</div><div className="font-semibold">{rate === null ? "—" : fmtPct(rate, 1)}</div></div>
                </div>
                {p.budget !== null && p.budget > 0 && <Progress value={Math.min(100, ((p.consumed) / p.budget) * 100)} tone={p.consumedPct !== null && p.consumedPct > 90 ? "orange" : "accent"} className="mt-3" />}
                <div className="text-[11.5px] text-muted mt-1.5">Consommé {fmtMAD(p.consumed, { compact: true })}{p.consumedPct !== null ? ` (${Math.round(p.consumedPct)} %)` : ""} · alloué {fmtMAD(p.allocated, { compact: true })} · {p.axes} axe(s) · {p.openActions} action(s) ouverte(s)</div>
              </Link>
            );
          })}
        </div>
      )}

      {canCreate && (
        <Section title="Nouveau plan" description="Un plan par marque et par période. Le CA objectif et le budget exigent le droit « Valider une dépense » ou Administration ; ils peuvent être laissés vides et remplis plus tard.">
          <Card>
            <form action={savePlanAction} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[13px]">
              <label className="block"><span className="label block mb-1">Marque *</span><select name="brandId" className="select h-9" required><option value="">— choisir —</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label className="block lg:col-span-3"><span className="label block mb-1">Nom *</span><input name="name" className="input h-9" placeholder={`Ex : Plan marketing ${year + 1}`} required /></label>
              <label className="block"><span className="label block mb-1">Début *</span><input type="date" name="periodStart" defaultValue={`${year + 1}-01-01`} className="input h-9" required /></label>
              <label className="block"><span className="label block mb-1">Fin *</span><input type="date" name="periodEnd" defaultValue={`${year + 1}-12-31`} className="input h-9" required /></label>
              <label className="block"><span className="label block mb-1">CA objectif (MAD HT)</span><input name="revenueTarget" className="input h-9" placeholder="Ex : 5 000 000" /></label>
              <label className="block"><span className="label block mb-1">Budget marketing (MAD)</span><input name="budget" className="input h-9" placeholder="Ex : 1 000 000" /></label>
              <label className="block lg:col-span-3"><span className="label block mb-1">Notes</span><input name="notes" className="input h-9" placeholder="Hypothèses, contexte, lancements prévus…" /></label>
              <div className="flex items-end"><button className="btn-primary h-9 w-full" type="submit">Créer le plan</button></div>
            </form>
          </Card>
        </Section>
      )}
    </>
  );
}
