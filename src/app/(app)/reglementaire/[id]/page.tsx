import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, eq, and } from "drizzle-orm";
import { db } from "@/db";
import { regulatoryFiles, documents as documentsTable, tasks as tasksTable } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { listBrands, listUsers } from "@/lib/users";
import { PageHeader, Card, Badge, PriorityBadge, StatusBadge } from "@/components/ui";
import { RegulatoryForm, REG_STATUS } from "@/components/regulatory-form";
import { addDocument, deleteRegulatoryFile } from "../actions";
import { fmtDate, today } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RegulatoryDetailPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("reglementaire");
  const { id } = await props.params;
  const file = await db.query.regulatoryFiles.findFirst({ where: eq(regulatoryFiles.id, id), with: { product: true, brand: true, responsible: true } });
  if (!file) notFound();
  const [products, brands, users, docs, tasks] = await Promise.all([
    db.execute(sql`select id, name, brand_id from products where active order by name`), listBrands(), listUsers(),
    db.select().from(documentsTable).where(and(eq(documentsTable.entityType, "regulatory_file"), eq(documentsTable.entityId, id))),
    db.select().from(tasksTable).where(eq(tasksTable.entityId, id)),
  ]);
  const days = file.expiryDate ? Math.round((new Date(file.expiryDate + "T12:00:00Z").getTime() - today().getTime()) / 86400000) : null;
  return (
    <>
      <PageHeader eyebrow={<Link href="/reglementaire" className="hover:underline">Réglementaire</Link>} title={file.product?.name ?? file.dossier} subtitle={[file.dossier, file.brand?.name, file.authorizationNumber ? `N° ${file.authorizationNumber}` : null].filter(Boolean).join(" · ")}
        actions={<><Badge tone={REG_STATUS[file.status].tone}>{REG_STATUS[file.status].label}</Badge>{days !== null && <Badge tone={days < 0 ? "red" : days <= 30 ? "red" : days <= 90 ? "orange" : "green"}>{days < 0 ? `Expiré depuis ${-days} j` : `J-${days}`}</Badge>}<Link href={`/taches/nouvelle?entityType=regulatory&entityId=${id}&title=${encodeURIComponent("Renouvellement " + file.dossier + (file.product ? " — " + file.product.name : ""))}`} className="btn-primary btn-sm">+ Tâche</Link></>} />
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Dossier"><RegulatoryForm file={file} products={(products.rows as { id: string; name: string; brand_id: string | null }[]).map((p) => ({ id: p.id, name: p.name, brandId: p.brand_id }))} brands={brands} users={users} /></Card>
        <div className="space-y-4">
          <Card title="Documents">
            {docs.length === 0 ? <div className="text-sm text-muted mb-3">Aucun document lié.</div> : <ul className="text-[13px] space-y-1.5 mb-3">{docs.map((d) => <li key={d.id}><a href={d.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{d.name}</a> <span className="text-faint text-[11px]">{fmtDate(d.createdAt)}</span></li>)}</ul>}
            <form action={addDocument} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input type="hidden" name="entityType" value="regulatory_file" /><input type="hidden" name="entityId" value={id} /><input type="hidden" name="path" value={`/reglementaire/${id}`} />
              <input name="name" placeholder="Nom du document" className="input h-9" required /><input name="url" placeholder="Lien (Drive, SharePoint…)" className="input h-9" required /><button className="btn-secondary btn-sm h-9" type="submit">Ajouter</button>
            </form>
          </Card>
          <Card title="Tâches liées">
            {tasks.length === 0 ? <div className="text-sm text-muted">Aucune tâche. Une tâche de renouvellement sera créée automatiquement à l&apos;approche de l&apos;échéance.</div> : (
              <div className="space-y-2">{tasks.map((t) => <Link key={t.id} href={`/taches/${t.id}`} className="card px-4 py-3 flex items-center gap-3 hover:border-line-2"><div className="flex-1 min-w-0"><div className="font-medium truncate">{t.title}</div><div className="text-[12px] text-muted">Échéance {fmtDate(t.dueDate)}</div></div><PriorityBadge priority={t.priority} /><StatusBadge status={t.status} /></Link>)}</div>
            )}
          </Card>
          {user.role === "ADMIN" && <form action={deleteRegulatoryFile}><input type="hidden" name="id" value={id} /><button className="btn-ghost btn-sm text-red" type="submit">Supprimer le dossier</button></form>}
        </div>
      </div>
    </>
  );
}
