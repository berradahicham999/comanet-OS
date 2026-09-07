import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, hasFlag } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { ensureRegulatoryTasks } from "@/lib/automations";
import { PageHeader, Card, Badge, Tabs, BrandDot, Progress, Empty } from "@/components/ui";
import {
  AT_RISK, CERTIFICATE_STATUS, SITUATIONS, formatDays, packagingLabel, situationOf, variantLabel,
  type Situation,
} from "@/lib/regulatory";
import { fmtDate, today } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Réglementaire" };

type Row = {
  id: string; dossier: string; reference: string | null; variant_type: string; size: string | null; packaging: string | null;
  status: string; certificate_status: string; document_type: string; blocked: boolean; blocked_reason: string | null;
  expiry_date: string | null; filing_date: string | null; authorization_number: string | null; missing_documents: string | null;
  physical_product: boolean | null; product_name: string | null; brand_name: string | null; brand_color: string | null;
  brand_id: string | null; responsible: string | null; open_tasks: number; events: number;
};

export default async function ReglementairePage(props: { searchParams: Promise<{ view?: string; brand?: string; type?: string; q?: string }> }) {
  await requireAccess("reglementaire");
  const canExport = await hasFlag("exportData");
  const sp = await props.searchParams;
  const s = await getSettings();
  const created = await ensureRegulatoryTasks();
  const t = today();

  const rows = (await db.execute(sql`
    select rf.id, rf.dossier, rf.reference, rf.variant_type, rf.size, rf.packaging, rf.status::text as status,
      rf.certificate_status, rf.document_type, rf.blocked, rf.blocked_reason, rf.expiry_date::text as expiry_date,
      rf.filing_date::text as filing_date, rf.authorization_number, rf.missing_documents, rf.physical_product,
      p.name as product_name, b.name as brand_name, b.color as brand_color, b.id as brand_id, u.name as responsible,
      (select count(*) from tasks tk where tk.entity_id = rf.id and tk.status in ('TODO','IN_PROGRESS'))::int as open_tasks,
      (select count(*) from regulatory_events e where e.file_id = rf.id)::int as events
    from regulatory_files rf
    left join products p on p.id = rf.product_id
    left join brands b on b.id = rf.brand_id
    left join users u on u.id = rf.responsible_id
    order by rf.expiry_date asc nulls last, b.name, rf.reference`)).rows as Row[];

  const list = rows.map((r) => ({ ...r, ...situationOf({ status: r.status, blocked: r.blocked, expiryDate: r.expiry_date }, t, s.regulatoryRenewalDays) }));

  const count = (sit: Situation) => list.filter((r) => r.situation === sit).length;
  const atRisk = list.filter((r) => AT_RISK.includes(r.situation)).length;
  const ceTodo = list.filter((r) => r.certificate_status === "A_DEMANDER" || r.certificate_status === "DOCS_LABO").length;
  const ceOpen = list.filter((r) => ["A_DEMANDER", "DOCS_LABO", "EN_ATTENTE"].includes(r.certificate_status)).length;

  // Couverture par marque : part des dossiers dont la validité est couverte.
  const byBrand = new Map<string, { name: string; color: string; total: number; ok: number; risk: number; noDate: number }>();
  for (const r of list) {
    const k = r.brand_id ?? "—";
    const e = byBrand.get(k) ?? { name: r.brand_name ?? "Société / sans marque", color: r.brand_color ?? "#9ca3af", total: 0, ok: 0, risk: 0, noDate: 0 };
    e.total++;
    if (r.situation === "VALIDE" || r.situation === "A_RENOUVELER") e.ok++;
    if (AT_RISK.includes(r.situation)) e.risk++;
    if (r.situation === "SANS_DATE") e.noDate++;
    byBrand.set(k, e);
  }
  const brandStats = [...byBrand.entries()].sort((a, b) => b[1].risk - a[1].risk || b[1].total - a[1].total);

  const view = sp.view ?? "all";
  const q = (sp.q ?? "").trim().toLowerCase();
  let filtered = list;
  if (sp.brand) filtered = filtered.filter((r) => (r.brand_id ?? "—") === sp.brand);
  if (sp.type) filtered = filtered.filter((r) => r.variant_type === sp.type);
  if (q) filtered = filtered.filter((r) => `${r.reference ?? ""} ${r.product_name ?? ""} ${r.dossier}`.toLowerCase().includes(q));
  if (view === "risk") filtered = filtered.filter((r) => AT_RISK.includes(r.situation));
  else if (view === "renew") filtered = filtered.filter((r) => r.situation === "A_RENOUVELER" || r.situation === "CRITIQUE" || r.situation === "EXPIRE");
  else if (view === "ce") filtered = filtered.filter((r) => r.certificate_status === "A_DEMANDER" || r.certificate_status === "DOCS_LABO" || r.certificate_status === "EN_ATTENTE");
  else if (view === "nodate") filtered = filtered.filter((r) => r.situation === "SANS_DATE");
  else if (view === "blocked") filtered = filtered.filter((r) => r.situation === "BLOQUE" || r.situation === "NON_DEPOSE");

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { view: sp.view, brand: sp.brand, type: sp.type, q: sp.q, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const str = p.toString();
    return `/reglementaire${str ? `?${str}` : ""}`;
  };

  const kpis: { key: string; label: string; value: number; tone: string; href: string }[] = [
    { key: "expired", label: "Expirés", value: count("EXPIRE"), tone: "text-red", href: qs({ view: "renew" }) },
    { key: "critical", label: "≤ 30 jours", value: count("CRITIQUE"), tone: "text-red", href: qs({ view: "renew" }) },
    { key: "renew", label: `À redéposer (≤ ${s.regulatoryRenewalDays} j)`, value: count("A_RENOUVELER"), tone: "text-orange", href: qs({ view: "renew" }) },
    { key: "nodate", label: "Date à retrouver", value: count("SANS_DATE"), tone: "text-yellow", href: qs({ view: "nodate" }) },
    { key: "ce", label: "CE à obtenir", value: ceTodo, tone: "text-blue", href: qs({ view: "ce" }) },
    { key: "blocked", label: "Non déposés / bloqués", value: count("NON_DEPOSE") + count("BLOQUE"), tone: "text-ink", href: qs({ view: "blocked" }) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Conformité"
        title="Réglementaire"
        subtitle={`${list.length} dossiers DMP suivis par variante déposée. L'écart et la situation sont recalculés à chaque ouverture — jamais figés. Redépôt à lancer à J-${s.regulatoryRenewalDays}.${created ? ` ${created} tâche(s) créée(s) à l'instant.` : ""}`}
        actions={<>
          {canExport && <Link href="/reglementaire/export" prefetch={false} className="btn-secondary btn-sm">Exporter Excel</Link>}
          <Link href="/imports?type=REGULATORY" className="btn-secondary btn-sm">Importer</Link>
          <Link href="/reglementaire/nouveau" className="btn-primary btn-sm">+ Dossier</Link>
        </>}
      >
        {atRisk > 0 && (
          <div className="mb-3 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">
            <b>{atRisk} dossier(s) ne couvrent pas la commercialisation aujourd&apos;hui</b> — expirés, critiques, non déposés ou bloqués.{" "}
            <Link href={qs({ view: "risk" })} className="underline font-medium">Voir la liste</Link>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
          {kpis.map((k) => (
            <Link key={k.key} href={k.href} className="card px-3 py-2.5 hover:border-line-2">
              <div className="text-[11px] text-muted leading-tight">{k.label}</div>
              <div className={`text-[20px] font-semibold ${k.value ? k.tone : "text-faint"}`}>{k.value}</div>
            </Link>
          ))}
        </div>
        <Tabs current={qs({})} tabs={[
          { href: qs({ view: undefined }), label: "Tous", count: list.length },
          { href: qs({ view: "risk" }), label: "À risque", count: atRisk },
          { href: qs({ view: "renew" }), label: "Échéances", count: count("EXPIRE") + count("CRITIQUE") + count("A_RENOUVELER") },
          { href: qs({ view: "ce" }), label: "Certificats (CE)", count: ceOpen },
          { href: qs({ view: "nodate" }), label: "Dates à retrouver", count: count("SANS_DATE") },
          { href: qs({ view: "blocked" }), label: "Non déposés / bloqués", count: count("NON_DEPOSE") + count("BLOQUE") },
        ]} />
      </PageHeader>

      <div className="grid lg:grid-cols-[1fr_300px] gap-4 items-start">
        <div>
          <form action="/reglementaire" method="get" className="flex flex-wrap gap-2 mb-3 text-[13px]">
            {sp.view && <input type="hidden" name="view" value={sp.view} />}
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Rechercher une référence…" className="input h-9 w-auto flex-1 min-w-[180px]" />
            <select name="brand" defaultValue={sp.brand ?? ""} className="select h-9 w-auto">
              <option value="">Toutes les marques</option>
              {brandStats.map(([id, b]) => <option key={id} value={id}>{b.name}</option>)}
            </select>
            <select name="type" defaultValue={sp.type ?? ""} className="select h-9 w-auto">
              <option value="">Tous les types</option>
              {["MODELE_VENTE", "ECHANTILLON", "MINIDOSE", "TRAVEL_SIZE", "DECLARATION", "TRANSFERT"].map((k) => <option key={k} value={k}>{variantLabel(k)}</option>)}
            </select>
            <button className="btn-secondary h-9" type="submit">Filtrer</button>
          </form>

          {filtered.length === 0 ? (
            <Empty title="Aucun dossier dans cette vue" hint={<>Chargez votre fichier depuis <Link href="/imports?type=REGULATORY" className="text-accent font-medium">Imports → Dossiers réglementaires</Link>, ou créez un dossier manuellement.</>} action={<Link href="/reglementaire/nouveau" className="btn-primary btn-sm">+ Dossier</Link>} />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr>
                  <th>Référence</th><th>Marque</th><th>Type · contenance</th><th>Dépôt</th><th>Validité</th><th>Écart</th><th>Situation</th><th>CE</th><th>Éch.</th><th></th>
                </tr></thead>
                <tbody>
                  {filtered.map((r) => {
                    const sit = SITUATIONS[r.situation];
                    const ce = CERTIFICATE_STATUS[r.certificate_status] ?? CERTIFICATE_STATUS.A_DEMANDER;
                    return (
                      <tr key={r.id}>
                        <td className="max-w-[260px]">
                          <Link href={`/reglementaire/${r.id}`} className="font-medium hover:underline">{r.reference ?? r.product_name ?? r.dossier}</Link>
                          {r.blocked && r.blocked_reason && <div className="text-[11px] text-red truncate" title={r.blocked_reason}>{r.blocked_reason}</div>}
                          {!r.blocked && r.missing_documents && <div className="text-[11px] text-orange truncate" title={r.missing_documents}>Manque : {r.missing_documents}</div>}
                        </td>
                        <td className="whitespace-nowrap">{r.brand_name ? <span className="flex items-center gap-1.5 text-muted"><BrandDot color={r.brand_color ?? "#999"} />{r.brand_name}</span> : <span className="text-faint">Société</span>}</td>
                        <td className="text-muted whitespace-nowrap text-[12px]">{variantLabel(r.variant_type)}{r.size ? ` · ${r.size}` : ""}{r.packaging ? ` · ${packagingLabel(r.packaging)}` : ""}</td>
                        <td className="whitespace-nowrap text-muted">{fmtDate(r.filing_date)}</td>
                        <td className="whitespace-nowrap">{fmtDate(r.expiry_date)}</td>
                        <td className="whitespace-nowrap tabular-nums">{r.days === null ? <span className="text-faint">—</span> : <span className={r.days < 0 ? "text-red font-medium" : r.days <= 30 ? "text-red" : r.days <= s.regulatoryRenewalDays ? "text-orange" : "text-muted"}>{formatDays(r.days)}</span>}</td>
                        <td><Badge tone={sit.tone}>{sit.label}</Badge></td>
                        <td><Badge tone={ce.tone}>{ce.short}</Badge></td>
                        <td className="text-center text-[12px]">{r.physical_product === null ? <span className="text-faint">?</span> : r.physical_product ? "✓" : "—"}</td>
                        <td className="whitespace-nowrap">{r.open_tasks > 0 && <Badge tone="green">tâche</Badge>}{r.events > 0 && <span className="text-[11px] text-faint ml-1">{r.events} hist.</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Couverture par marque">
            <div className="space-y-3">
              {brandStats.map(([id, b]) => {
                const pct = b.total ? Math.round((b.ok / b.total) * 100) : 0;
                return (
                  <Link key={id} href={qs({ brand: id })} className="block group">
                    <div className="flex items-center gap-2 text-[13px]">
                      <BrandDot color={b.color} />
                      <span className="font-medium group-hover:underline">{b.name}</span>
                      <span className="ml-auto tabular-nums text-muted">{b.ok}/{b.total}</span>
                    </div>
                    <Progress value={pct} tone={pct >= 90 ? "green" : pct >= 60 ? "yellow" : "red"} className="mt-1.5" />
                    <div className="text-[11px] text-muted mt-1">
                      {b.risk > 0 && <span className="text-red">{b.risk} à risque</span>}
                      {b.risk > 0 && b.noDate > 0 && " · "}
                      {b.noDate > 0 && <span className="text-yellow">{b.noDate} sans date</span>}
                      {b.risk === 0 && b.noDate === 0 && <span className="text-green">tout est couvert</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>

          <Card title="Répartition">
            <div className="space-y-1.5 text-[13px]">
              {(Object.keys(SITUATIONS) as Situation[]).map((k) => {
                const n = count(k);
                if (!n) return null;
                return (
                  <div key={k} className="flex items-center gap-2">
                    <Badge tone={SITUATIONS[k].tone}>{SITUATIONS[k].label}</Badge>
                    <span className="ml-auto tabular-nums font-medium">{n}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Comment ça marche">
            <p className="text-[12.5px] text-ink-2 leading-relaxed">
              Un dossier = <b>une variante déposée</b> (référence × type × contenance). Le parcours est : dépôt DMP →
              <b> ATD</b> (validité limitée) → demande de <b>CE</b> → certificat obtenu. À J-{s.regulatoryRenewalDays} de la fin de validité,
              une tâche de redépôt est créée automatiquement pour le responsable et remonte dans l&apos;Action Center.
              Chaque redépôt archive l&apos;ATD précédent dans l&apos;historique du dossier.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
