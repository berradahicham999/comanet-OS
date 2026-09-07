import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { TaskPriority, TaskStatus } from "@/db/schema";

export type TaskRow = {
  id: string; title: string; status: TaskStatus; priority: TaskPriority; dueDate: string | null; source: string;
  assigneeId: string | null; assignee: string | null; brand: string | null; brandColor: string | null; entityType: string | null; entityId: string | null; comments: number; createdAt: string;
};

export const SOURCE_LABEL: Record<string, string> = { MANUAL: "Manuelle", ACTION_CENTER: "Action Center", REGLEMENTAIRE: "Réglementaire", STOCK: "Stock", MARKETING: "Marketing", TERRAIN: "Terrain", COMMERCIAL: "Commercial" };

export function entityHref(type: string | null, id: string | null) {
  if (!type || !id) return null;
  const map: Record<string, string> = { product: "/produits/", client: "/clients/", brand: "/marques/", regulatory: "/reglementaire/", campaign: "/marketing/campagnes/", animation: "/terrain/", content: "/marketing/planning/" };
  return map[type] ? map[type] + id : null;
}

export async function listTasks(opts: { assigneeId?: string; brandId?: string; brandIds?: string[] | null; overdue?: boolean; includeDone?: boolean; source?: string } = {}): Promise<TaskRow[]> {
  const r = await db.execute(sql`
    select t.id, t.title, t.status::text as status, t.priority::text as priority, t.due_date::text as due_date, t.source::text as source,
      t.assignee_id, u.name as assignee, b.name as brand, b.color as brand_color, t.entity_type, t.entity_id::text as entity_id, t.created_at::text as created_at,
      (select count(*) from task_comments c where c.task_id = t.id)::int as comments
    from tasks t left join users u on u.id = t.assignee_id left join brands b on b.id = t.brand_id
    where true
      ${opts.assigneeId ? sql`and t.assignee_id = ${opts.assigneeId}::uuid` : sql``}
      ${opts.brandId ? sql`and t.brand_id = ${opts.brandId}::uuid` : sql``}
      ${opts.brandIds ? sql`and (t.brand_id is null or t.brand_id = any(${opts.brandIds}::uuid[]) or t.assignee_id = ${opts.assigneeId ?? "00000000-0000-0000-0000-000000000000"}::uuid)` : sql``}
      ${opts.source ? sql`and t.source = ${opts.source}::task_source` : sql``}
      ${opts.overdue ? sql`and t.due_date < current_date and t.status in ('TODO','IN_PROGRESS')` : sql``}
      ${opts.includeDone ? sql`` : sql`and (t.status in ('TODO','IN_PROGRESS') or t.completed_at > now() - interval '14 days')`}
    order by case t.status when 'IN_PROGRESS' then 0 when 'TODO' then 1 else 2 end, case t.priority when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end, t.due_date nulls last`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), title: String(x.title), status: x.status as TaskStatus, priority: x.priority as TaskPriority, dueDate: x.due_date ? String(x.due_date) : null, source: String(x.source),
    assigneeId: x.assignee_id ? String(x.assignee_id) : null, assignee: x.assignee ? String(x.assignee) : null, brand: x.brand ? String(x.brand) : null, brandColor: x.brand_color ? String(x.brand_color) : null,
    entityType: x.entity_type ? String(x.entity_type) : null, entityId: x.entity_id ? String(x.entity_id) : null, comments: Number(x.comments), createdAt: String(x.created_at),
  }));
}
