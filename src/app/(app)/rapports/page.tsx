import Link from "next/link";
import { requireAccess, getUserPermissions, brandFilter } from "@/lib/access";
import { can } from "@/lib/permissions-shared";
import { listBrands } from "@/lib/users";
import { listReports, reportPeriods, REPORT_STATUS_LABEL, reportTypeLabel } from "@/lib/ai/reports";
import { isAiConfigured } from "@/lib/ai/client";
import { PageHeader, Card, Badge, Empty, Tabs } from "@/components/ui";
import { fmtDateShort, today } from "@/lib/format";
import { ReportForm } from "./report-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rapports" };

const TABS = [
  { key: "a-lire", label: "À lire", status: "DRAFT" },
  { key: "valides", label: "Validés", status: "VALIDATED" },
  { key: "archives", label: "Archivés", status: "ARCHIVED" },
  { key: "tous", label: "Tous", status: null },
] as const;
const hrefOf = (key: string) => (key === "a-lire" ? "/rapports" : `/rapports?statut=${key}`);

export default async function RapportsPage(props: { searchParams: Promise<{ statut?: string }> }) {
  await requireAccess("rapports");
  const sp = await props.searchParams;
  const [perms, scope, brands] = await Promise.all([getUserPermissions(), brandFilter(), listBrands()]);
  const all = await listReports({ brandIds: scope });
  const tab = TABS.find((t) => t.key === sp.statut) ?? TABS[0];
  const reports = tab.status ? all.filter((r) => r.status === tab.status) : all;
  const countOf = (st: string | null) => (st ? all.filter((r) => r.status === st).length : all.length);
  const periods = reportPeriods(today());
  const canCreate = can(perms, "rapports", "create");
  const configured = isAiConfigured();
  const tone = { DRAFT: "yellow", VALIDATED: "green", ARCHIVED: "gray" } as const;

  return (
    <>
      <PageHeader eyebrow="Copilote IA" title="Rapports" subtitle="COMANET WEEKLY et MONTHLY BRAND REVIEW, rédigés par le copilote à partir des outils de lecture, validés par la direction. Chaque section indique sa source et sa période." />
      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-2">
          <Tabs current={hrefOf(tab.key)} tabs={TABS.map((t) => ({ href: hrefOf(t.key), label: t.label, count: countOf(t.status) }))} />
          {reports.length === 0 && all.length > 0 && <Empty title={`Aucun rapport « ${tab.label.toLowerCase()} »`} hint="Les nouveaux rapports arrivent dans « À lire » ; vous êtes notifié à chaque arrivée." />}
          {all.length === 0 && <Empty title="Aucun rapport" hint={canCreate ? "Générer un premier COMANET WEEKLY ou une revue mensuelle de marque depuis le formulaire." : "Aucun rapport n'a encore été généré."} />}
          {reports.map((r) => (
            <Link key={r.id} href={`/rapports/${r.id}`} className="card px-4 py-3 flex items-center gap-3 hover:border-line-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{r.title}</div>
                <div className="text-[12px] text-muted">{reportTypeLabel(r.type)}{r.brandName ? ` · ${r.brandName}` : ""} · généré le {fmtDateShort(r.createdAt)}{r.validatedAt ? ` · validé le ${fmtDateShort(r.validatedAt)}` : ""}</div>
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
