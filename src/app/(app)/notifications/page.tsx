import { requireAnyModule } from "@/lib/access";
import { PageHeader, Card, Empty, Badge } from "@/components/ui";
import { listNotifications } from "@/lib/content/notify";
import { fmtAgo } from "@/lib/format";
import { markAllRead, openNotification } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

const TYPE_LABEL: Record<string, { label: string; tone: "gray" | "blue" | "yellow" | "orange" | "green" | "red" | "purple" }> = {
  BRIEF_ASSIGNED: { label: "Brief assigné", tone: "blue" }, DELIVERABLE_UPLOADED: { label: "Livrable déposé", tone: "purple" },
  VALIDATION_REQUESTED: { label: "À valider", tone: "yellow" }, CORRECTIONS_REQUESTED: { label: "Corrections", tone: "orange" },
  CONTENT_VALIDATED: { label: "Validé", tone: "green" }, DEADLINE_PASSED: { label: "Retard", tone: "red" }, COMMENT: { label: "Commentaire", tone: "gray" },
};

export default async function NotificationsPage() {
  const user = await requireAnyModule();
  const items = await listNotifications(user.id, 60);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <>
      <PageHeader eyebrow="Vous" title="Notifications" subtitle={unread ? `${unread} non lue${unread > 1 ? "s" : ""}` : "Tout est lu."}
        actions={unread > 0 ? <form action={markAllRead}><button className="btn-secondary btn-sm" type="submit">Tout marquer lu</button></form> : undefined} />
      {items.length === 0 ? <Empty title="Aucune notification" hint="Vous serez prévenu ici quand un brief vous est assigné, qu'un livrable est déposé, qu'une validation est demandée ou qu'un contenu prend du retard." /> : (
        <Card pad={false}>
          <ul className="divide-y divide-line">
            {items.map((n) => {
              const t = TYPE_LABEL[n.type] ?? { label: n.type, tone: "gray" as const };
              return (
                <li key={n.id} className={n.readAt ? "" : "bg-accent-soft/40"}>
                  <form action={openNotification}>
                    <input type="hidden" name="id" value={n.id} /><input type="hidden" name="href" value={n.href ?? ""} />
                    <button type="submit" className="w-full text-left px-4 py-3 flex gap-3 items-start hover:bg-surface-2">
                      <Badge tone={t.tone} className="shrink-0 mt-0.5">{t.label}</Badge>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13.5px] ${n.readAt ? "" : "font-semibold"}`}>{n.title}</span>
                        {n.body && <span className="block text-[12.5px] text-ink-2 mt-0.5">{n.body}</span>}
                      </span>
                      <span className="text-[11px] text-muted whitespace-nowrap">{fmtAgo(n.createdAt)}</span>
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
