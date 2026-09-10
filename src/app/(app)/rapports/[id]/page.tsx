import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, getUserPermissions, brandInScope } from "@/lib/access";
import { can, isAdmin } from "@/lib/permissions-shared";
import { getReport, REPORT_STATUS_LABEL, REPORT_TYPE_LABEL } from "@/lib/ai/reports";
import { PageHeader, Card, Badge } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { MarkdownLite } from "@/components/ai/answer-blocks";
import { fmtDateLong, fmtDateShort } from "@/lib/format";
import { archiveReportAction, validateReportAction } from "../actions";

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
  return (
    <>
      <PageHeader eyebrow={<Link href="/rapports" className="hover:underline">Rapports</Link>} title={r.title}
        subtitle={<>{REPORT_TYPE_LABEL[r.type]} · période du {fmtDateLong(r.periodStart)} au {fmtDateLong(new Date(new Date(r.periodEnd + "T12:00:00Z").getTime() - 86_400_000))} · généré le {fmtDateShort(r.createdAt)}{r.model ? ` · ${r.model}` : ""}</>}
        actions={<div className="flex flex-wrap items-center gap-2 print:hidden">
          <Badge tone={tone[r.status]}>{REPORT_STATUS_LABEL[r.status]}</Badge>
          <a href={`/rapports/${r.id}/export`} className="btn-secondary btn-sm">Exporter (.md)</a>
          <PrintButton />
          {r.status === "DRAFT" && canValidate && <form action={validateReportAction}><input type="hidden" name="id" value={r.id} /><button type="submit" className="btn-primary btn-sm">Valider</button></form>}
          {r.status !== "ARCHIVED" && canEdit && <form action={archiveReportAction}><input type="hidden" name="id" value={r.id} /><button type="submit" className="btn-ghost btn-sm">Archiver</button></form>}
        </div>} />
      {r.status === "DRAFT" && <div className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3 print:hidden">Brouillon rédigé par le copilote IA : à relire avant validation. Les chiffres proviennent des outils de lecture listés en bas de page.</div>}
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
