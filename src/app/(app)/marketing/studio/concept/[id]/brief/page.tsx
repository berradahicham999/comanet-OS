import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { decisionScopeFor } from "@/lib/decisions/server";
import { getConcept } from "@/lib/creative/store";
import { buildBrief } from "@/lib/creative/brief";
import { AXIS_OF_TERRITORY } from "@/lib/creative/scoring";
import { OBJECTIVES } from "@/lib/action-generator/catalog";
import { PrintButton } from "@/components/print-button";
import { conceptHref } from "@/components/creative-studio";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Brief de production" };

export default async function BriefPage(props: { params: Promise<{ id: string }> }) {
  await requireAccess("marketing");
  const { id } = await props.params;
  const c = await getConcept(id);
  if (!c) notFound();
  const scope = await decisionScopeFor(c.brandId);
  if (!scope.allBrands.some((b) => b.id === c.brandId)) notFound();
  if (!c.package) redirect(conceptHref(id));
  const brief = buildBrief(c.concept, c.package, { brandName: c.brandName, productName: c.productName, audience: c.package.strategy.audience, objective: OBJECTIVES[c.objective], generatedAt: fmtDate(new Date()), budgetAxisLabel: AXIS_OF_TERRITORY[c.concept.creativeTerritory].toLowerCase() });
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4 print:hidden">
        <Link href={conceptHref(id, "production")} className="text-[13px] text-accent hover:underline">← Content Studio</Link>
        <PrintButton />
      </div>
      <article className="card card-pad print:border-0 print:shadow-none">
        <header className="mb-5 border-b border-line pb-4">
          <div className="label">Brief de production · {c.brandName}</div>
          <h1 className="text-[22px] font-semibold tracking-tight leading-tight mt-1">{brief.title}</h1>
          <p className="text-[13px] text-muted mt-1">{brief.subtitle}</p>
        </header>
        <div className="space-y-5">
          {brief.sections.map((s) => (
            <section key={s.key} className="break-inside-avoid">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted mb-1.5">{s.title}</h2>
              <ul className="text-[13px] leading-relaxed space-y-0.5">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </section>
          ))}
        </div>
        <footer className="mt-6 pt-3 border-t border-line text-[11px] text-muted">COMANET OS · Studio créatif · les résultats attendus sont des repères, jamais des mesures · relecture réglementaire obligatoire avant diffusion.</footer>
      </article>
    </div>
  );
}
