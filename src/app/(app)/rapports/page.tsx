import Link from "next/link";
import { requireAccess, getUserPermissions, brandFilter } from "@/lib/access";
import { can } from "@/lib/permissions-shared";
import { listBrands } from "@/lib/users";
import { listReports, reportPeriods, REPORT_STATUS_LABEL, REPORT_TYPE_LABEL } from "@/lib/ai/reports";
import { isAiConfigured } from "@/lib/ai/client";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { fmtDateShort, today } from "@/lib/format";
import { ReportForm } from "./report-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rapports" };

export default async function RapportsPage() {
  await requireAccess("rapports");
  const [perms, scope, brands] = await Promise.all([getUserPermissions(), brandFilter(), listBrands()]);
  const reports = await listReports({ brandIds: scope });
  const periods = reportPeriods(today());
  const canCreate = can(perms, "rapports", "create");
  const configured = isAiConfigured();
  const tone = { DRAFT: "yellow", VALIDATED: "green", ARCHIVED: "gray" } as const;

  return (
    <>
      <PageHeader eyebrow="Copilote IA" title="Rapports" subtitle="COMANET WEEKLY et MONTHLY BRAND REVIEW, rédigés par le copilote à partir des outils de lecture, validés par la direction. Chaque section indique sa source et sa période." />
      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-2">
          {reports.length === 0 && <Empty title="Aucun rapport" hint={canCreate ? "Générer un premier COMANET WEEKLY ou une revue mensuelle de marque depuis le formulaire." : "Aucun rapport n'a encore été généré."} />}
          {reports.map((r) => (
            <Link key={r.id} href={`/rapports/${r.id}`} className="card px-4 py-3 flex items-center gap-3 hover:border-line-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{r.title}</div>
                <div className="text-[12px] text-muted">{REPORT_TYPE_LABEL[r.type]}{r.brandName ? ` · ${r.brandName}` : ""} · généré le {fmtDateShort(r.createdAt)}{r.validatedAt ? ` · validé le ${fmtDateShort(r.validatedAt)}` : ""}</div>
              </div>
              <Badge tone={tone[r.status]}>{REPORT_STATUS_LABEL[r.status]}</Badge>
            </Link>
          ))}
        </div>
        <Card title="Générer un rapport">
          {!configured ? (
            <div className="text-[13px] text-ink-2">Copilote non configuré : un administrateur doit renseigner <code className="px-1 rounded bg-black/5">ANTHROPIC_API_KEY</code> sur le serveur.</div>
          ) : !canCreate ? (
            <div className="text-[13px] text-muted">Droit « Créer » sur Rapports requis.</div>
          ) : (
            <ReportForm brands={brands.filter((b) => b.active && (!scope || scope.includes(b.id))).map((b) => ({ id: b.id, name: b.name }))} weeks={periods.weeks} months={periods.months} />
          )}
        </Card>
      </div>
    </>
  );
}
