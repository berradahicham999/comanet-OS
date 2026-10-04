import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, canDo } from "@/lib/access";
import { decisionScopeFor } from "@/lib/decisions/server";
import { AXES, OBJECTIVES } from "@/lib/action-generator/catalog";
import { libraryTemplate } from "@/lib/action-generator/library";
import { LEVEL_LABELS } from "@/lib/action-generator/engine";
import { generatorQuery, parseGeneratorParams, type GeneratorParams } from "@/lib/action-generator/params";
import { defaultMonth, runGenerator } from "@/lib/action-generator/server";
import { axisOptions } from "@/lib/marketing-plan/plan";
import { PageHeader, Card, Kpi, Badge } from "@/components/ui";
import { AddToPlanForm, ProposalSheet } from "@/components/action-proposal";
import { fmtMAD, fmtMonth } from "@/lib/format";
import { COMPLEXITY_LABELS } from "@/lib/action-generator/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Action proposée" };

export default async function ProposalPage(props: { params: Promise<{ template: string }>; searchParams: Promise<GeneratorParams> }) {
  await requireAccess("marketing");
  const { template } = await props.params;
  const sp = await props.searchParams;
  const entry = await libraryTemplate(template);
  if (!entry) notFound();
  const t = entry.template;
  const scope = await decisionScopeFor(sp.brand ?? null);
  const input = parseGeneratorParams(sp, { month: defaultMonth(scope.ctx.now) });
  const brand = input ? scope.allBrands.find((b) => b.id === input.brandId) : null;
  if (!input || !brand) notFound();
  const forTemplate = { ...input, axis: input.axis ?? t.axis };
  const [{ result, data }, canAdd, axes] = await Promise.all([runGenerator(scope.ctx, forTemplate, brand.name, { maxOptions: 100 }), canDo("marketing", "create"), axisOptions(brand.id, { year: Number(input.month.slice(0, 4)) })]);
  const p = result.options.find((o) => o.templateKey === template) ?? null;
  const reason = p ? null : result.blocked ?? result.excluded.find((e) => e.templateKey === template)?.reason ?? "modèle non compatible avec l'objectif choisi";
  const back = `/marketing/priorites/generer?${generatorQuery(input)}`;
  const available = data.budgets[t.axis].available;

  return (
    <>
      <PageHeader eyebrow={<Link href={back} className="hover:underline">Générer une action</Link>} title={p?.name ?? t.family}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone="accent">{AXES[t.axis].label}</Badge><Badge tone="gray">{t.family}</Badge>{brand.name}{data.product ? ` · ${data.product.name}` : ""} · {OBJECTIVES[input.objective]} · {fmtMonth(input.month)}</span>}
        actions={p && canAdd ? <AddToPlanForm input={{ ...forTemplate, budget: forTemplate.budget ?? p.budget }} templateKey={p.templateKey} axes={axes.map((a) => ({ id: a.id, label: a.label }))} /> : undefined}>
        {p && (
          <>
          <p className="text-[15px] font-medium mb-3"><span className="label mr-2">Objectif</span>{p.objectiveText}</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Budget" value={fmtMAD(p.budget, { compact: true })} sub={available === null ? "disponible non défini" : `disponible ${fmtMAD(available, { compact: true })} → ${fmtMAD(available - p.budget, { compact: true })} après ajout`} tone={available !== null && available - p.budget < 0 ? "red" : undefined} />
            <Kpi label="Impact" value={LEVEL_LABELS[p.impact]} sub={`${p.estimate.buyers.toLocaleString("fr-FR")} ventes (hypothèse)`} />
            <Kpi label="ROI potentiel" value={p.estimate.roi === null ? "—" : `${p.estimate.roi.toFixed(1)}×`} sub={LEVEL_LABELS[p.roiLevel]} />
            <Kpi label="Pertinence" value={`${p.score}/100`} sub={`complexité ${COMPLEXITY_LABELS[p.complexity]}`} />
          </div>
          </>
        )}
      </PageHeader>

      {!p ? (
        <Card><div className="flex items-start gap-3"><Badge tone="gray">Indisponible</Badge><p className="text-[13.5px]">{reason}. <Link href={back} className="text-accent underline">Revenir aux propositions</Link></p></div></Card>
      ) : (
        <>
          <ProposalSheet p={p} />
          {canAdd && (
            <Card className="mt-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-[13px] flex-1 min-w-64"><b>Ajouter au plan</b> crée en une fois : l&apos;action et sa ligne de budget dans le plan {fmtMonth(input.month)}, {p.execution.kind === "ACTIVATION" ? "l'activation et son budget par poste" : "la campagne et ses dépenses prévues"}, {p.steps.length} tâches datées avec responsables, {p.contents.length} contenu(s) au planning éditorial.</div>
                <AddToPlanForm input={{ ...forTemplate, budget: forTemplate.budget ?? p.budget }} templateKey={p.templateKey} axes={axes.map((a) => ({ id: a.id, label: a.label }))} />
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}
