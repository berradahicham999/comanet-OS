import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, and, asc } from "drizzle-orm";
import { db } from "@/db";
import { tasks as tasksTable, taskComments, documents as documentsTable } from "@/db/schema";
import { requireAccess, isOwnOnly, canDo } from "@/lib/access";
import { listBrands, listUsers } from "@/lib/users";
import { entityHref, SOURCE_LABEL } from "@/lib/tasks";
import { PageHeader, Card, Badge, PriorityBadge, StatusBadge } from "@/components/ui";
import { TaskForm } from "@/components/task-form";
import { setTaskStatus, addComment, deleteTask } from "../actions";
import { addDocument } from "@/app/(app)/reglementaire/actions";
import { fmtDate, initials } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TaskPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("taches");
  const { id } = await props.params;
  const task = await db.query.tasks.findFirst({ where: eq(tasksTable.id, id), with: { assignee: true, createdBy: true, brand: true } });
  if (!task) notFound();
  const [ownOnly, canValidate] = await Promise.all([isOwnOnly(), canDo("taches", "validate")]);
  if (ownOnly && task.assigneeId !== user.id && task.createdById !== user.id) notFound();
  const [comments, docs, users, brands] = await Promise.all([
    db.query.taskComments.findMany({ where: eq(taskComments.taskId, id), with: { user: true }, orderBy: [asc(taskComments.createdAt)] }),
    db.select().from(documentsTable).where(and(eq(documentsTable.entityType, "task"), eq(documentsTable.entityId, id))),
    listUsers(), listBrands(),
  ]);
  const href = entityHref(task.entityType, task.entityId);
  return (
    <>
      <PageHeader eyebrow={<Link href="/taches" className="hover:underline">Tâches</Link>} title={task.title}
        subtitle={<>{SOURCE_LABEL[task.source] ?? task.source} · créée le {fmtDate(task.createdAt)}{task.createdBy ? ` par ${task.createdBy.name}` : ""}{task.brand ? ` · ${task.brand.name}` : ""}</>}
        actions={<><StatusBadge status={task.status} /><PriorityBadge priority={task.priority} />{href && <Link href={href} className="btn-secondary btn-sm">Voir l&apos;élément lié</Link>}</>} />
      <div className="grid lg:grid-cols-[1fr_380px] gap-4">
        <div className="space-y-4">
          <Card title="Avancement">
            <form action={setTaskStatus} className="flex flex-wrap gap-2">
              <input type="hidden" name="id" value={id} />
              {(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"] as const).map((s) => (
                <button key={s} type="submit" name="status" value={s} className={task.status === s ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{{ TODO: "À faire", IN_PROGRESS: "En cours", DONE: "Terminée", CANCELLED: "Annulée" }[s]}</button>
              ))}
            </form>
            {task.description && <div className="mt-4 whitespace-pre-wrap text-[14px] text-ink-2">{task.description}</div>}
            {task.expectedImpact && <div className="mt-3 text-[13px]"><span className="label mr-2">Impact attendu</span>{task.expectedImpact}</div>}
            {task.completedAt && <div className="mt-2 text-[12px] text-muted">Terminée le {fmtDate(task.completedAt)}</div>}
          </Card>
          <Card title={`Commentaires (${comments.length})`}>
            <div className="space-y-3 mb-4">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-accent-soft text-accent-2 text-[11px] font-semibold flex items-center justify-center shrink-0">{initials(c.user?.name ?? "?")}</div>
                  <div className="min-w-0"><div className="text-[12px] text-muted">{c.user?.name ?? "—"} · {fmtDate(c.createdAt)}</div><div className="text-[14px] whitespace-pre-wrap">{c.body}</div></div>
                </div>
              ))}
              {comments.length === 0 && <div className="text-sm text-muted">Aucun commentaire.</div>}
            </div>
            <form action={addComment} className="flex gap-2">
              <input type="hidden" name="taskId" value={id} />
              <input name="body" placeholder="Écrire un commentaire… (@mention en texte libre)" className="input h-10" required />
              <button className="btn-primary btn-sm h-10" type="submit">Envoyer</button>
            </form>
          </Card>
          <Card title="Pièces jointes">
            {docs.length === 0 ? <div className="text-sm text-muted mb-3">Aucune pièce jointe.</div> : <ul className="text-[13px] space-y-1.5 mb-3">{docs.map((d) => <li key={d.id}><a href={d.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{d.name}</a></li>)}</ul>}
            <form action={addDocument} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input type="hidden" name="entityType" value="task" /><input type="hidden" name="entityId" value={id} /><input type="hidden" name="path" value={`/taches/${id}`} />
              <input name="name" placeholder="Nom" className="input h-9" required /><input name="url" placeholder="Lien" className="input h-9" required /><button className="btn-secondary btn-sm h-9" type="submit">Joindre</button>
            </form>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Détails">
            <div className="flex items-center gap-2 mb-3 text-[13px]"><span className="text-muted">Responsable</span><span className="font-medium">{task.assignee?.name ?? "Non assignée"}</span></div>
            <div className="flex items-center gap-2 mb-3 text-[13px]"><span className="text-muted">Échéance</span><span className="font-medium">{fmtDate(task.dueDate)}</span></div>
            {task.sourceKey && <div className="text-[11px] text-faint mb-3">Clé : {task.sourceKey}</div>}
            <TaskForm task={task} users={users} brands={brands} isAnimatrice={ownOnly} />
          </Card>
          {canValidate && <form action={deleteTask}><input type="hidden" name="id" value={id} /><button className="btn-ghost btn-sm text-red" type="submit">Supprimer la tâche</button></form>}
          {task.source !== "MANUAL" && <Badge tone="gray">Origine : {SOURCE_LABEL[task.source]}</Badge>}
        </div>
      </div>
    </>
  );
}
