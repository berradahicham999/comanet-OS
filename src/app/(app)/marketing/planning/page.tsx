import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, brandFilter, canDo } from "@/lib/access";
import { listBrands, listUsers } from "@/lib/users";
import { PageHeader } from "@/components/ui";
import { ContentCalendar, type CalendarView, type CalendarMode } from "@/components/content-calendar";
import { contentRefs, listBriefTemplates } from "@/lib/content/refs";
import { listContents, indicators } from "@/lib/content/queries";
import { iso, startOfMonth, addMonths, mondayOf, addDays, today } from "@/lib/format";
import { moveContent, quickCreateContent, duplicateContent } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Planning éditorial" };

type SP = { view?: string; mode?: string; d?: string; brand?: string; platform?: string; format?: string; status?: string; responsible?: string };

export default async function PlanningPage(props: { searchParams: Promise<SP> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const now = today(); const todayIso = iso(now);
  const anchor = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : todayIso;
  const view: CalendarView | null = sp.view === "month" || sp.view === "week" || sp.view === "list" ? sp.view : null;
  const mode: CalendarMode = sp.mode === "brand" || sp.mode === "platform" ? sp.mode : "date";
  const a = new Date(anchor + "T12:00:00Z");
  // Période chargée : la semaine en vue semaine, le mois sinon (la liste suit le mois).
  const start = view === "week" ? iso(mondayOf(a)) : iso(startOfMonth(a));
  const end = view === "week" ? iso(addDays(mondayOf(a), 7)) : iso(addMonths(startOfMonth(a), 1));

  const [refs, scope, brands, users, templates, productRows, canCreate, canEdit] = await Promise.all([
    contentRefs(), brandFilter(), listBrands(), listUsers(), listBriefTemplates(),
    db.execute<{ id: string; name: string; brandId: string | null }>(sql`select id, name, brand_id as "brandId" from products where active order by name`),
    canDo("marketing", "create"), canDo("marketing", "edit"),
  ]);
  const visibleBrands = brands.filter((b) => !scope || scope.includes(b.id));
  const cards = await listContents({ start, end, brandIds: scope, brand: sp.brand, platform: sp.platform, format: sp.format, status: sp.status, responsible: sp.responsible, includeArchived: !!sp.status && refs.statuses.some((s) => s.key === sp.status && s.isArchived) }, refs, todayIso);
  const ind = indicators(cards, refs, visibleBrands.map((b) => ({ id: b.id, name: b.name, color: b.color, active: b.active })), todayIso);

  return (
    <>
      <PageHeader eyebrow="Marketing" title="Planning éditorial" subtitle="Qui publie quoi, où et quand — les trous et les jours surchargés en un coup d'œil."
        actions={<>
          <Link href="/marketing/planning/validation" className="btn-secondary btn-sm">File de validation{ind.awaiting ? ` · ${ind.awaiting}` : ""}</Link>
          <Link href="/marketing/planning/modeles" className="btn-ghost btn-sm">Modèles de briefs</Link>
        </>} />
      <ContentCalendar
        cards={cards} refs={refs} brands={visibleBrands.map((b) => ({ id: b.id, name: b.name, color: b.color, active: b.active }))}
        users={users.map((u) => ({ id: u.id, name: u.name }))} products={productRows.rows}
        templates={templates.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, brandId: t.brandId, platformKey: t.platformKey, formatKey: t.formatKey }))}
        view={view} mode={mode} anchor={anchor} start={start} end={end} todayIso={todayIso}
        indicators={ind} canCreate={canCreate} canEdit={canEdit}
        actions={{ move: moveContent, quickCreate: quickCreateContent, duplicate: duplicateContent }}
      />
    </>
  );
}
