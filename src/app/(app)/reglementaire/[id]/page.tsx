import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { regulatoryFiles, regulatoryEvents, documents as documentsTable, tasks as tasksTable } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { listBrands, listUsers } from "@/lib/users";
import { PageHeader, Card, Badge, PriorityBadge, StatusBadge, Facts } from "@/components/ui";
import { RegulatoryForm } from "@/components/regulatory-form";
import { CERTIFICATE_STATUS, DOCUMENT_TYPES, EVENT_KINDS, SITUATIONS, formatDays, packagingLabel, situationOf, variantLabel } from "@/lib/regulatory";
import { addDocument, addRegulatoryNote, deleteRegulatoryFile, registerRenewal } from "../actions";
import { fmtDate, iso, today, addDays } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RegulatoryDetailPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("reglementaire");
  const { id } = await props.params;
  const file = await db.query.regulatoryFiles.findFirst({ where: eq(regulatoryFiles.id, id), with: { product: true, brand: true, responsible: true } });
  if (!file) notFound();
  const s = await getSettings();
  const [products, brands, users, docs, tasks, events] = await Promise.all([
    db.execute(sql`select id, name, brand_id from products where active order by name`),
    listBrands(), listUsers(),
    db.select().from(documentsTable).where(and(eq(documentsTable.entityType, "regulatory_file"), eq(documentsTable.entityId, id))),
    db.select().from(tasksTable).where(eq(tasksTable.entityId, id)),
    db.select().from(regulatoryEvents).where(eq(regulatoryEvents.fileId, id)).orderBy(desc(regulatoryEvents.date), desc(regulatoryEvents.createdAt)),
  ]);
  const t = today();
  const { situation, days } = situationOf({ status: file.status, blocked: file.blocked, expiryDate: file.expiryDate }, t, s.regulatoryRenewalDays);
  const sit = SITUATIONS[situation];
  const ce = CERTIFICATE_STATUS[file.certificateStatus] ?? CERTIFICATE_STATUS.A_DEMANDER;
  const title = file.reference ?? file.product?.name ?? file.dossier;
  const formKey = `${file.id}-${file.updatedAt.getTime()}`;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/reglementaire" className="hover:underline">Réglementaire</Link>}
        title={title}
        subtitle={[file.brand?.name, variantLabel(file.variantType), file.size, packagingLabel(file.packaging)].filter((x) => x && x !== "—").join(" · ")}
        actions={<>
          <Badge tone={sit.tone}>{sit.label}</Badge>
          {days !== null && <Badge tone={days < 0 ? "red" : days <= 30 ? "red" : days <= s.regulatoryRenewalDays ? "orange" : "green"}>{formatDays(days)}</Badge>}
          <Badge tone={ce.tone}>{ce.label}</Badge>
          <Link href={`/taches/nouvelle?entityType=regulatory&entityId=${id}&title=${encodeURIComponent("Redépôt " + title)}`} className="btn-secondary btn-sm">+ Tâche</Link>
        </>}
      />

      <div className="mb-4 card card-pad">
        <Facts cols={4} items={[
          { label: "Situation", value: <span className={sit.tone === "red" ? "text-red" : sit.tone === "orange" ? "text-orange" : ""}>{sit.label}</span> },
          { label: "Dépôt DMP", value: fmtDate(file.filingDate) },
          { label: "Fin de validité", value: fmtDate(file.expiryDate) },
          { label: "Écart", value: formatDays(days) },
          { label: "Pièce", value: DOCUMENT_TYPES[file.documentType as keyof typeof DOCUMENT_TYPES] ?? file.documentType },
          { label: "N° ATD", value: file.authorizationNumber ?? "—" },
          { label: "Certificat (CE)", value: file.certificateNumber ? `${file.certificateNumber} · ${fmtDate(file.certificateDate)}` : ce.short },
          { label: "Échantillon physique", value: file.physicalProduct === null ? "Inconnu" : file.physicalProduct ? "Oui" : "Non" },
        ]} />
        <p className="text-[12px] text-faint mt-3">{sit.help}</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title="Dossier">
          {/* La clé force le remontage après une mise à jour : sans elle, les champs non contrôlés
              garderaient les valeurs affichées avant l'action serveur. */}
          <RegulatoryForm key={formKey} file={file} products={(products.rows as { id: string; name: string; brand_id: string | null }[]).map((p) => ({ id: p.id, name: p.name, brandId: p.brand_id }))} brands={brands} users={users} />
        </Card>

        <div className="space-y-4">
          <Card title="Enregistrer un redépôt">
            <p className="text-[12.5px] text-muted mb-3">Le dépôt actuel ({fmtDate(file.filingDate)} → {fmtDate(file.expiryDate)}) est archivé dans l&apos;historique, puis remplacé par les nouvelles dates.</p>
            <form key={formKey} action={registerRenewal} className="grid grid-cols-2 gap-2 text-[13px]">
              <input type="hidden" name="id" value={id} />
              <label className="block"><span className="label block mb-1">Nouvelle date de dépôt</span><input type="date" name="newFilingDate" defaultValue={iso(t)} className="input h-9" required /></label>
              <label className="block"><span className="label block mb-1">Nouvelle validité</span><input type="date" name="newExpiryDate" defaultValue={iso(addDays(t, 365 * 3))} className="input h-9" /></label>
              <label className="block col-span-2"><span className="label block mb-1">N° ATD</span><input name="newAuthorizationNumber" className="input h-9" placeholder={file.authorizationNumber ?? ""} /></label>
              <label className="block col-span-2"><span className="label block mb-1">Note</span><input name="renewalNotes" className="input h-9" placeholder="ex : dossier envoyé au centre anti-poison" /></label>
              <button className="btn-primary btn-sm col-span-2" type="submit">Enregistrer le redépôt</button>
            </form>
          </Card>

          <Card title={`Historique (${events.length})`}>
            {events.length === 0 ? (
              <div className="text-sm text-muted">Aucun évènement. Les dépôts, redépôts et certificats s&apos;ajoutent ici automatiquement.</div>
            ) : (
              <ol className="relative border-l border-line-2 ml-2 space-y-4">
                {events.map((e) => {
                  const k = EVENT_KINDS[e.kind] ?? EVENT_KINDS.NOTE;
                  return (
                    <li key={e.id} className="ml-4">
                      <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone={k.tone}>{k.label}</Badge>
                        <span className="text-[12px] text-muted">{fmtDate(e.date)}</span>
                      </div>
                      {e.label && <div className="text-[13px] font-medium mt-0.5">{e.label}</div>}
                      <div className="text-[12px] text-muted">
                        {e.reference && <span>N° {e.reference} · </span>}
                        {e.expiryDate && <span>validité {fmtDate(e.expiryDate)}</span>}
                      </div>
                      {e.notes && <div className="text-[12px] text-ink-2 mt-0.5">{e.notes}</div>}
                    </li>
                  );
                })}
              </ol>
            )}
            <form action={addRegulatoryNote} className="flex gap-2 mt-4">
              <input type="hidden" name="id" value={id} />
              <input name="note" placeholder="Ajouter une note datée…" className="input h-9" required />
              <button className="btn-secondary btn-sm h-9" type="submit">Ajouter</button>
            </form>
          </Card>

          <Card title="Documents">
            {docs.length === 0 ? <div className="text-sm text-muted mb-3">Aucun document lié.</div> : <ul className="text-[13px] space-y-1.5 mb-3">{docs.map((d) => <li key={d.id}><a href={d.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{d.name}</a> <span className="text-faint text-[11px]">{fmtDate(d.createdAt)}</span></li>)}</ul>}
            <form action={addDocument} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input type="hidden" name="entityType" value="regulatory_file" /><input type="hidden" name="entityId" value={id} /><input type="hidden" name="path" value={`/reglementaire/${id}`} />
              <input name="name" placeholder="Nom du document" className="input h-9" required /><input name="url" placeholder="Lien (Drive, SharePoint…)" className="input h-9" required /><button className="btn-secondary btn-sm h-9" type="submit">Ajouter</button>
            </form>
          </Card>

          <Card title="Tâches liées">
            {tasks.length === 0 ? <div className="text-sm text-muted">Aucune tâche. Une tâche de redépôt est créée automatiquement à J-{s.regulatoryRenewalDays}.</div> : (
              <div className="space-y-2">{tasks.map((tk) => <Link key={tk.id} href={`/taches/${tk.id}`} className="card px-4 py-3 flex items-center gap-3 hover:border-line-2"><div className="flex-1 min-w-0"><div className="font-medium truncate">{tk.title}</div><div className="text-[12px] text-muted">Échéance {fmtDate(tk.dueDate)}</div></div><PriorityBadge priority={tk.priority} /><StatusBadge status={tk.status} /></Link>)}</div>
            )}
          </Card>

          {user.role === "ADMIN" && <form action={deleteRegulatoryFile}><input type="hidden" name="id" value={id} /><button className="btn-ghost btn-sm text-red" type="submit">Supprimer le dossier</button></form>}
        </div>
      </div>
    </>
  );
}
