import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { imports as importsTable } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { PageHeader, Card, Badge } from "@/components/ui";
import { IMPORT_TYPES, FIELDS } from "@/lib/import/fields";
import { rollbackImport } from "../actions";
import { fmtDate, fmtNum, fmtMAD } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ImportDetailPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("imports");
  const { id } = await props.params;
  const imp = await db.query.imports.findFirst({ where: eq(importsTable.id, id) });
  if (!imp) notFound();
  const stats = (await db.execute(sql`select count(*)::int as n, coalesce(sum(amount),0)::float8 as amount, min(date)::text as min_date, max(date)::text as max_date from sales where import_id = ${id}::uuid`)).rows[0] as { n: number; amount: number; min_date: string | null; max_date: string | null };
  const typeDef = IMPORT_TYPES.find((t) => t.key === imp.type);
  const fuzzy = imp.warnings.filter((w) => w.startsWith("≈"));
  const other = imp.warnings.filter((w) => !w.startsWith("≈"));
  return (
    <>
      <PageHeader eyebrow={<Link href="/imports" className="hover:underline">Imports</Link>} title={typeDef?.label ?? imp.type} subtitle={`${imp.fileName} · ${fmtDate(imp.createdAt)}`} actions={<Badge tone={imp.status === "DONE" ? "green" : imp.status === "FAILED" ? "red" : "yellow"}>{imp.status}</Badge>} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Card><div className="label">Lignes lues</div><div className="kpi mt-2">{fmtNum(imp.totalRows)}</div></Card>
        <Card><div className="label">Insérées</div><div className="kpi mt-2 text-green">{fmtNum(imp.insertedRows)}</div></Card>
        <Card><div className="label">Mises à jour</div><div className="kpi mt-2">{fmtNum(imp.updatedRows)}</div></Card>
        <Card><div className="label">Doublons ignorés</div><div className="kpi mt-2">{fmtNum(imp.duplicateRows)}</div></Card>
        <Card><div className="label">Erreurs</div><div className={`kpi mt-2 ${imp.errorRows ? "text-red" : ""}`}>{fmtNum(imp.errorRows)}</div></Card>
      </div>
      {imp.type === "SALES" && stats.n > 0 && <Card className="mb-4"><div className="label mb-1">Ventes rattachées à cet import</div><div className="text-[14px]">{fmtNum(stats.n)} lignes · {fmtMAD(stats.amount)} HT · du {fmtDate(stats.min_date)} au {fmtDate(stats.max_date)}</div></Card>}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Rapport">
          {other.length === 0 && imp.errors.length === 0 ? <div className="text-sm text-muted">Aucune remarque.</div> : null}
          <ul className="text-[13px] space-y-1.5">{other.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>
          {imp.errors.length > 0 && (<><div className="label mt-3 mb-1">Erreurs (200 premières)</div><ul className="text-[12px] text-red space-y-0.5 max-h-72 overflow-auto">{imp.errors.map((e, i) => <li key={i}>Ligne {e.row} : {e.message}</li>)}</ul></>)}
          <div className="label mt-4 mb-1">Mapping utilisé</div>
          <ul className="text-[12px] text-muted">{Object.entries(imp.mapping).map(([k, v]) => <li key={k}><b className="text-ink-2">{FIELDS[imp.type].find((f) => f.key === k)?.label ?? k}</b> ← {v}</li>)}</ul>
        </Card>
        <Card title={`Rapprochements automatiques (${fuzzy.length})`}>
          {fuzzy.length === 0 ? <div className="text-sm text-muted">Aucune désignation n&apos;a nécessité de rapprochement approximatif.</div> : <ul className="text-[12.5px] space-y-1 max-h-[480px] overflow-auto">{fuzzy.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <p className="text-[11.5px] text-faint mt-3">Un rapprochement erroné se corrige depuis la fiche produit (« Fusionner ») ou en modifiant la désignation.</p>
        </Card>
      </div>
      {user.role === "ADMIN" && imp.status === "DONE" && (imp.type === "SALES" || imp.type === "STOCK") && (
        <form action={rollbackImport} className="mt-4"><input type="hidden" name="id" value={id} /><button className="btn-ghost btn-sm text-red" type="submit">Annuler cet import (supprime les {imp.type === "SALES" ? "ventes" : "photos de stock"} importées)</button></form>
      )}
    </>
  );
}
