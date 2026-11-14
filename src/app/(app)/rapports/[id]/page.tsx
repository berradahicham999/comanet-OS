import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, getUserPermissions, brandInScope } from "@/lib/access";
import { can, isAdmin } from "@/lib/permissions-shared";
import { getReport, REPORT_STATUS_LABEL, reportTypeLabel } from "@/lib/ai/reports";
import { PageHeader, Card, Badge } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { MarkdownLite } from "@/components/ai/answer-blocks";
import { fmtDateLong, fmtDateShort } from "@/lib/format";
import { archiveReportAction, validateReportAction } from "../actions";
import { decisionStates } from "@/lib/ai/report-decisions-shared";
import { fmtDate, fmtMAD } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RapportPage(props: { params: Promise<{ id: string }> }) {
  await requireAccess("rapports");
  const { id } = await props.params;
  const r = await getReport(id);
  if (!r || !(await brandInScope(r.brandId))) notFound();
  const perms = await getUserPermissions();
  const canValidate = can(perms, "rapports", "validate") || isAdmin(perms);
  const canEdit = can(perms, "rapports", "edit") || isAdmin(perms);
  const tone = { DRAFT: "yellow", VALIDATED: "green", ARCHIVED: "gray" } as const;
  const sources = (Array.isArray(r.sources) ? r.sources : []) as { tool: string; ok: boolean; summary: string }[];
  // Décisions proposées par l'agent (`sources.decisions[]`) et ce que la direction en a fait (`sources.outcomes`).
  const proposed = decisionStates(r.sources);
  const open = proposed.decisions.filter((d) => !d.outcome).length;
  return (
    <>
      <PageHeader eyebrow={<Link href="/rapports" className="hover:underline">Rapports</Link>} title={r.title}
        subtitle={<>{reportTypeLabel(r.type)} · période du {fmtDateLong(r.periodStart)} au {fmtDateLong(new Date(new Date(r.periodEnd + "T12:00:00Z").getTime() - 86_400_000))} · généré le {fmtDateShort(r.createdAt)}{r.model ? ` · ${r.model}` : ""}</>}
        actions={<div className="flex flex-wrap items-center gap-2 print:hidden">
          <Badge tone={tone[r.status]}>{REPORT_STATUS_LABEL[r.status]}</Badge>
          <a href={`/rapports/${r.id}/export`} className="btn-secondary btn-sm">Exporter (.md)</a>
          <PrintButton />
          {r.status === "DRAFT" && canValidate && open > 0 && <Link href="/a-decider" className="btn-primary btn-sm">Trancher {open} décision{open > 1 ? "s" : ""}</Link>}
          {r.status === "DRAFT" && canValidate && open === 0 && <form action={validateReportAction}><input type="hidden" name="id" value={r.id} /><button type="submit" className="btn-primary btn-sm">Valider</button></form>}
          {r.status !== "ARCHIVED" && canEdit && <form action={archiveReportAction}><input type="hidden" name="id" value={r.id} /><button type="submit" className="btn-ghost btn-sm">Archiver</button></form>}
        </div>} />
      {r.status === "DRAFT" && <div className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3 print:hidden">Brouillon rédigé par {sources.length > 0 ? "le copilote IA" : "un agent"} : à relire avant validation.{sources.length > 0 ? " Les chiffres proviennent des outils de lecture listés en bas de page." : ""}</div>}
      {(proposed.decisions.length > 0 || proposed.ignored > 0) && (
        <Card className="max-w-4xl mb-3 print:hidden" title={`Décisions proposées (${proposed.decisions.length})`} action={open > 0 && canValidate ? <Link href="/a-decider" className="text-[12px] text-accent font-medium">Trancher dans « À décider » →</Link> : undefined}>
          {open > 0 && <p className="text-[12.5px] text-muted mb-2">Le rapport passera « Validé » quand chaque décision aura été validée ou refusée.</p>}
          <ul className="divide-y divide-line text-[13px]">
            {proposed.decisions.map((d) => (
              <li key={d.id} className="py-2 flex flex-wrap items-start gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1 basis-[280px]">
                  <div className="font-medium">{d.title}</div>
                  <div className="text-muted">{d.why}</div>
                  <div className="text-[12px] text-muted mt-0.5">Responsable proposé : {d.ownerRole} · échéance {fmtDate(d.dueDate)} · revue {fmtDate(d.reviewDate)} · résultat attendu : {d.expectedKpi}</div>
                  {d.outcome?.reason && <div className="text-[12px] text-ink-2 mt-0.5">Motif : {d.outcome.reason}</div>}
                </div>
                <div className="tabular-nums font-medium w-[110px] text-right">{d.amountMad === null ? <span className="text-faint">—</span> : fmtMAD(d.amountMad)}</div>
                <div className="w-[190px] text-right">
                  {!d.outcome ? <Badge tone="yellow">À trancher</Badge> : (
                    <>
                      <Badge tone={d.outcome.status === "APPROVED" ? "green" : "red"}>{d.outcome.status === "APPROVED" ? "Validée" : "Refusée"}</Badge>
                      <div className="text-[12px] text-muted mt-0.5">{d.outcome.byName}{d.outcome.at ? ` · ${fmtDate(d.outcome.at)}` : ""}</div>
                      {d.outcome.taskId && <Link href={`/taches/${d.outcome.taskId}`} className="text-[12px] text-accent font-medium">Voir la tâche →</Link>}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {proposed.ignored > 0 && <p className="mt-2 text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">{proposed.ignored} ligne{proposed.ignored > 1 ? "s" : ""} de <code>sources.decisions</code> ignorée{proposed.ignored > 1 ? "s" : ""} : le contrat n&apos;est pas respecté (champ manquant, date ou montant illisible, identifiant répété). Voir docs/contrat-decisions-agents.md.</p>}
        </Card>
      )}
      <Card className="max-w-4xl">
        <MarkdownLite text={r.contentMd} />
      </Card>
      {sources.length > 0 && (
        <Card className="max-w-4xl mt-3 print:hidden" title="Sources lues par le copilote">
          <ul className="text-[12.5px] space-y-1">
            {sources.map((s, i) => <li key={i} className={s.ok ? "" : "text-muted"}><span className="font-medium">{s.tool}</span> — {s.summary}</li>)}
          </ul>
        </Card>
      )}
    </>
  );
}
