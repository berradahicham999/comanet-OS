import Link from "next/link";
import clsx from "clsx";
import { MessageSquare, ArrowRight, Check, Play, RotateCcw } from "lucide-react";
import { requireAccess } from "@/lib/access";
import { listTasks, SOURCE_LABEL, type TaskRow } from "@/lib/tasks";
import { listUsers, listBrands } from "@/lib/users";
import { PageHeader, Badge, PriorityBadge, BrandDot, Tabs, Card } from "@/components/ui";
import { setTaskStatus } from "./actions";
import { fmtDateShort, today, iso, initials } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tâches" };

function TaskCard({ t, me }: { t: TaskRow; me: string }) {
  const overdue = t.dueDate && t.dueDate < iso(today()) && t.status !== "DONE" && t.status !== "CANCELLED";
  const next = t.status === "TODO" ? "IN_PROGRESS" : t.status === "IN_PROGRESS" ? "DONE" : null;
  return (
    <div className={clsx("card p-3", t.status === "DONE" && "opacity-70")}>
      <div className="flex items-start gap-2">
        <Link href={`/taches/${t.id}`} className="font-medium text-[13.5px] leading-snug hover:underline flex-1 min-w-0">{t.title}</Link>
        <PriorityBadge priority={t.priority} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
        {t.brand && <span className="flex items-center gap-1"><BrandDot color={t.brandColor ?? "#999"} />{t.brand}</span>}
        <Badge tone="gray">{SOURCE_LABEL[t.source] ?? t.source}</Badge>
        {t.dueDate && <span className={clsx(overdue && "text-red font-medium")}>{overdue ? "Retard · " : ""}{fmtDateShort(t.dueDate)}</span>}
        {t.comments > 0 && <span className="flex items-center gap-0.5"><MessageSquare size={12} />{t.comments}</span>}
        <span className="ml-auto flex items-center gap-1">
          {t.assignee ? <span className={clsx("h-6 w-6 rounded-full text-[10px] font-semibold flex items-center justify-center", t.assigneeId === me ? "bg-accent text-white" : "bg-accent-soft text-accent-2")} title={t.assignee}>{initials(t.assignee)}</span> : <span className="text-faint">non assignée</span>}
        </span>
      </div>
      {next && (
        <form action={setTaskStatus} className="mt-2 flex gap-1">
          <input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value={next} /><input type="hidden" name="redirectTo" value="/taches" />
          <button className="btn-ghost btn-sm text-[12px]" type="submit">{next === "IN_PROGRESS" ? <><Play size={12} /> Démarrer</> : <><Check size={12} /> Terminer</>}</button>
          {t.status === "IN_PROGRESS" && <button className="btn-ghost btn-sm text-[12px]" type="submit" name="status" value="TODO"><RotateCcw size={12} /></button>}
        </form>
      )}
    </div>
  );
}

export default async function TachesPage(props: { searchParams: Promise<{ assignee?: string; brand?: string; overdue?: string; view?: string; source?: string }> }) {
  const user = await requireAccess("taches");
  const sp = await props.searchParams;
  const mine = sp.view === "mine" || user.role === "ANIMATRICE";
  const [tasks, users, brands] = await Promise.all([
    listTasks({ assigneeId: mine ? user.id : sp.assignee || undefined, brandId: sp.brand || undefined, overdue: !!sp.overdue, source: sp.source || undefined }),
    listUsers(), listBrands(),
  ]);
  const cols: { key: TaskRow["status"]; label: string }[] = [{ key: "TODO", label: "À faire" }, { key: "IN_PROGRESS", label: "En cours" }, { key: "DONE", label: "Terminées (14 j)" }];
  const overdueCount = tasks.filter((t) => t.dueDate && t.dueDate < iso(today()) && (t.status === "TODO" || t.status === "IN_PROGRESS")).length;
  const qs = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, v); const s = p.toString(); return `/taches${s ? "?" + s : ""}`; };

  return (
    <>
      <PageHeader eyebrow="Exécution" title={mine ? "Mes tâches" : "Tâches"} subtitle={`${tasks.filter((t) => t.status !== "DONE" && t.status !== "CANCELLED").length} ouvertes · ${overdueCount} en retard`}
        actions={<Link href="/taches/nouvelle" className="btn-primary btn-sm">+ Tâche</Link>}>
        <div className="flex flex-wrap items-center gap-2">
          {user.role !== "ANIMATRICE" && <Tabs current={qs({ view: sp.view })} tabs={[{ href: qs({ view: "" }), label: "Toutes" }, { href: qs({ view: "mine" }), label: "Mes tâches" }]} />}
          {user.role !== "ANIMATRICE" && (
            <form action="/taches" method="get" className="flex flex-wrap gap-2 ml-auto">
              {sp.view && <input type="hidden" name="view" value={sp.view} />}
              <select name="assignee" defaultValue={sp.assignee ?? ""} className="select h-8 text-[12px] w-auto"><option value="">Tous les responsables</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              <select name="brand" defaultValue={sp.brand ?? ""} className="select h-8 text-[12px] w-auto"><option value="">Toutes les marques</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              <select name="source" defaultValue={sp.source ?? ""} className="select h-8 text-[12px] w-auto"><option value="">Toutes origines</option>{Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" name="overdue" value="1" defaultChecked={!!sp.overdue} /> En retard</label>
              <button className="btn-secondary btn-sm" type="submit">Filtrer</button>
            </form>
          )}
        </div>
      </PageHeader>
      <div className="grid md:grid-cols-3 gap-3 items-start">
        {cols.map((c) => {
          const list = tasks.filter((t) => t.status === c.key || (c.key === "DONE" && t.status === "CANCELLED"));
          return (
            <div key={c.key} className="rounded-2xl bg-black/[0.03] p-2 min-h-[200px]">
              <div className="flex items-center justify-between px-2 py-1.5 mb-1"><span className="label">{c.label}</span><span className="text-[11px] text-muted">{list.length}</span></div>
              <div className="space-y-2">{list.map((t) => <TaskCard key={t.id} t={t} me={user.id} />)}{list.length === 0 && <div className="text-[12px] text-faint text-center py-6">—</div>}</div>
            </div>
          );
        })}
      </div>
      {tasks.length === 0 && <Card className="mt-4"><div className="text-sm text-muted flex items-center gap-2">Aucune tâche. Les recommandations de l&apos;<Link href="/actions" className="text-accent font-medium">Action Center</Link> se transforment en tâches en un clic <ArrowRight size={14} /></div></Card>}
    </>
  );
}
