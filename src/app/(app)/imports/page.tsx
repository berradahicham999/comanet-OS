import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { imports as importsTable } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { PageHeader, Card, Badge } from "@/components/ui";
import { IMPORT_TYPES } from "@/lib/import/fields";
import { ImportUploadForm } from "./upload-form";
import { fmtDate, fmtNum } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Imports Sage" };

export default async function ImportsPage(props: { searchParams: Promise<{ type?: string; error?: string; annule?: string }> }) {
  await requireAccess("imports");
  const sp = await props.searchParams;
  const history = await db.query.imports.findMany({ orderBy: [desc(importsTable.createdAt)], limit: 50, with: { } });
  const typeLabel = Object.fromEntries(IMPORT_TYPES.map((t) => [t.key, t.label]));
  return (
    <>
      <PageHeader eyebrow="Données" title="Imports Sage" subtitle="Excel ou CSV exporté de Sage (ou vos fichiers de compilation). Sage reste la source de vérité : COMANET OS ne modifie jamais vos données d'origine." />
      {sp.annule && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">Import annulé : {sp.annule} enregistrement(s) supprimé(s).</div>}
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error === "fichier" ? "Aucun fichier reçu." : sp.error === "taille" ? "Fichier trop volumineux (max 25 Mo)." : sp.error === "expire" ? "Fichier expiré, recommencez le téléversement." : sp.error}</div>}
      <div className="grid lg:grid-cols-[380px_1fr] gap-4">
        <Card title="Nouvel import">
          <ImportUploadForm types={IMPORT_TYPES.map((t) => ({ key: t.key, label: t.label }))} defaultType={sp.type ?? "SALES"} />
          <ul className="mt-4 space-y-1.5 text-[12px] text-muted">{IMPORT_TYPES.map((t) => <li key={t.key}><b className="text-ink-2">{t.label}</b> — {t.description}</li>)}</ul>
        </Card>
        <div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Type</th><th>Fichier</th><th className="num">Lignes</th><th className="num">Insérées</th><th className="num">MAJ</th><th className="num">Doublons</th><th className="num">Erreurs</th><th>Statut</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap"><Link href={`/imports/${h.id}`} className="font-medium hover:underline">{fmtDate(h.createdAt)}</Link></td>
                    <td><Badge tone="gray">{typeLabel[h.type] ?? h.type}</Badge></td>
                    <td className="max-w-[260px] truncate text-muted" title={h.fileName}>{h.fileName}</td>
                    <td className="num">{fmtNum(h.totalRows)}</td><td className="num font-medium">{fmtNum(h.insertedRows)}</td><td className="num">{fmtNum(h.updatedRows)}</td><td className="num">{fmtNum(h.duplicateRows)}</td><td className={`num ${h.errorRows ? "text-red" : ""}`}>{fmtNum(h.errorRows)}</td>
                    <td><Badge tone={h.status === "DONE" ? "green" : h.status === "FAILED" ? "red" : "yellow"}>{h.status === "DONE" ? "OK" : h.status === "FAILED" ? "Annulé / échec" : "En cours"}</Badge></td>
                  </tr>
                ))}
                {history.length === 0 && <tr><td colSpan={9} className="text-center text-muted py-8">Aucun import.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
