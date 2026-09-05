import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { ensureRegulatoryTasks } from "@/lib/automations";
import { PageHeader, Card, Badge, Tabs, BrandDot } from "@/components/ui";
import { REG_STATUS } from "@/components/regulatory-form";
import { fmtDate, today, iso, addDays } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Réglementaire" };

export default async function ReglementairePage(props: { searchParams: Promise<{ view?: string; brand?: string }> }) {
  await requireAccess("reglementaire");
  const sp = await props.searchParams;
  const s = await getSettings();
  const created = await ensureRegulatoryTasks();
  const t = today();
  const rows = (await db.execute(sql`
    select rf.id, rf.dossier, rf.status::text as status, rf.expiry_date::text as expiry_date, rf.validation_date::text as validation_date, rf.authorization_number, rf.missing_documents,
      p.name as product_name, p.id as product_id, b.name as brand_name, b.color as brand_color, b.id as brand_id, u.name as responsible,
      (select count(*) from tasks tk where tk.source_key = 'regulatory-expiry:' || rf.id::text and tk.status in ('TODO','IN_PROGRESS'))::int as open_tasks
    from regulatory_files rf left join products p on p.id = rf.product_id left join brands b on b.id = rf.brand_id left join users u on u.id = rf.responsible_id
    order by rf.expiry_date asc nulls last`)).rows as { id: string; dossier: string; status: string; expiry_date: string | null; validation_date: string | null; authorization_number: string | null; missing_documents: string | null; product_name: string | null; product_id: string | null; brand_name: string | null; brand_color: string | null; brand_id: string | null; responsible: string | null; open_tasks: number }[];
  const daysLeft = (d: string | null) => d ? Math.round((new Date(d + "T12:00:00Z").getTime() - t.getTime()) / 86400000) : null;
  const withDays = rows.map((r) => ({ ...r, days: daysLeft(r.expiry_date) }));
  const kpi = {
    expired: withDays.filter((r) => r.days !== null && r.days < 0 || r.status === "EXPIRE").length,
    d30: withDays.filter((r) => r.days !== null && r.days >= 0 && r.days <= 30).length,
    d90: withDays.filter((r) => r.days !== null && r.days > 30 && r.days <= 90).length,
    d180: withDays.filter((r) => r.days !== null && r.days > 90 && r.days <= 180).length,
    missing: withDays.filter((r) => r.missing_documents).length,
  };
  const view = sp.view ?? "all";
  let list = withDays;
  if (sp.brand) list = list.filter((r) => r.brand_id === sp.brand);
  if (view === "critical") list = list.filter((r) => (r.days !== null && r.days <= 30) || r.status === "EXPIRE");
  else if (view === "soon") list = list.filter((r) => r.days !== null && r.days > 30 && r.days <= s.regulatoryRenewalDays);
  else if (view === "missing") list = list.filter((r) => r.missing_documents);
  else if (view === "pending") list = list.filter((r) => r.status === "EN_COURS" || r.status === "A_DEPOSER");
  const alertBadge = (d: number | null) => {
    if (d === null) return null;
    if (d < 0) return <Badge tone="red">Expiré · {-d} j</Badge>;
    const th = [...s.regulatoryAlertDays].sort((a, b) => a - b).find((x) => d <= x);
    if (!th) return <Badge tone="green">{d} j</Badge>;
    return <Badge tone={th <= 30 ? "red" : th <= 90 ? "orange" : "yellow"}>J-{d} · seuil {th}</Badge>;
  };

  return (
    <>
      <PageHeader eyebrow="Conformité" title="Réglementaire" subtitle={`Alertes à ${s.regulatoryAlertDays.join(" / ")} jours · tâche de renouvellement créée automatiquement à J-${s.regulatoryRenewalDays}.${created ? ` ${created} tâche(s) créée(s) à l'instant.` : ""}`}
        actions={<Link href="/reglementaire/nouveau" className="btn-primary btn-sm">+ Dossier</Link>}>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
          <Link href="/reglementaire?view=critical" className="card px-3 py-2.5"><div className="text-[11px] text-muted">Expirés</div><div className="text-[20px] font-semibold text-red">{kpi.expired}</div></Link>
          <Link href="/reglementaire?view=critical" className="card px-3 py-2.5"><div className="text-[11px] text-muted">≤ 30 jours</div><div className="text-[20px] font-semibold text-red">{kpi.d30}</div></Link>
          <Link href="/reglementaire?view=soon" className="card px-3 py-2.5"><div className="text-[11px] text-muted">31–90 jours</div><div className="text-[20px] font-semibold text-orange">{kpi.d90}</div></Link>
          <Link href="/reglementaire?view=soon" className="card px-3 py-2.5"><div className="text-[11px] text-muted">91–180 jours</div><div className="text-[20px] font-semibold text-yellow">{kpi.d180}</div></Link>
          <Link href="/reglementaire?view=missing" className="card px-3 py-2.5"><div className="text-[11px] text-muted">Documents manquants</div><div className="text-[20px] font-semibold">{kpi.missing}</div></Link>
        </div>
        <Tabs current={`/reglementaire${view !== "all" ? `?view=${view}` : ""}`} tabs={[{ href: "/reglementaire", label: "Tous", count: withDays.length }, { href: "/reglementaire?view=critical", label: "Critiques" }, { href: "/reglementaire?view=soon", label: "À renouveler" }, { href: "/reglementaire?view=pending", label: "En instruction" }, { href: "/reglementaire?view=missing", label: "Incomplets" }]} />
      </PageHeader>

      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Produit / dossier</th><th>Marque</th><th>N° autorisation</th><th>Validation</th><th>Expiration</th><th>Alerte</th><th>Statut</th><th>Manquant</th><th>Responsable</th><th>Tâche</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/reglementaire/${r.id}`} className="font-medium hover:underline">{r.product_name ?? r.dossier}</Link>{r.product_name && <div className="text-[11px] text-muted">{r.dossier}</div>}</td>
                <td>{r.brand_name ? <span className="flex items-center gap-1.5 text-muted"><BrandDot color={r.brand_color ?? "#999"} />{r.brand_name}</span> : "—"}</td>
                <td className="text-muted">{r.authorization_number ?? "—"}</td>
                <td>{fmtDate(r.validation_date)}</td>
                <td className="whitespace-nowrap">{fmtDate(r.expiry_date)}</td>
                <td>{alertBadge(r.days)}</td>
                <td><Badge tone={REG_STATUS[r.status]?.tone ?? "gray"}>{REG_STATUS[r.status]?.label ?? r.status}</Badge></td>
                <td className="text-muted max-w-[200px] truncate" title={r.missing_documents ?? ""}>{r.missing_documents ?? ""}</td>
                <td className="text-muted">{r.responsible ?? "—"}</td>
                <td>{r.open_tasks > 0 ? <Badge tone="green">tâche ouverte</Badge> : ""}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={10} className="text-center text-muted py-8">Aucun dossier dans cette vue. <Link href="/reglementaire/nouveau" className="text-accent font-medium">Créer un dossier</Link>.</td></tr>}
          </tbody>
        </table>
      </div>
      <Card className="mt-4"><div className="label mb-1">Rappel</div><p className="text-[13px] text-ink-2">Un dossier passe en « critique » à 30 jours de l&apos;échéance. Dès J-{s.regulatoryRenewalDays}, une tâche « Renouvellement » est créée pour le responsable et remonte dans l&apos;Action Center jusqu&apos;à validation. Modifiez les seuils dans Paramètres.</p></Card>
    </>
  );
}
