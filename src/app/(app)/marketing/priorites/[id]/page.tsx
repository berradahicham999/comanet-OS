import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, brandInScope, canDo } from "@/lib/access";
import { listUsers } from "@/lib/users";
import { getAction } from "@/lib/marketing-plan/actions";
import type { ActionProposal } from "@/lib/action-generator/types";
import { ProposalSheet } from "@/components/action-proposal";
import { axisOptions, listPlans } from "@/lib/marketing-plan/plan";
import { ACTION_SOURCE_LABELS, actionLateDays, isOpenStatus } from "@/lib/marketing-plan/shared";
import { decisionsByAction } from "@/lib/decisions/store";
import { DECISION_STATUS, DOMAIN_LABELS, type DecisionDomain } from "@/lib/decisions/types";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import { PageHeader, Card, Badge, BrandDot, Section, Kpi, PriorityBadge, StatusBadge, Facts } from "@/components/ui";
import { fmtMAD, fmtDateShort, fmtMonth, iso, today } from "@/lib/format";
import { updateActionAction, setActionStatusAction, attachExpenseAction } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "Action marketing" };
  const r = await db.execute<{ title: string }>(sql`select title from marketing_actions where id = ${id}::uuid`);
  return { title: r.rows[0]?.title ?? "Action marketing" };
}

const STATUS_LABEL = { PLANNED: "Prévu", COMMITTED: "Engagé", SPENT: "Dépensé" } as const;

export default async function MarketingActionPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ ajout?: string; avant?: string; apres?: string; plan?: string }> }) {
  await requireAccess("marketing");
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const a = await getAction(id);
  if (!a || !(await brandInScope(a.brandId))) notFound();
  const year = (a.month ?? a.dueDate ?? iso(today())).slice(0, 4);
  const [users, canEdit, canBudget, plans, axes, products, campaigns, expenses, candidates, decisionMap, stepRows, contentRows] = await Promise.all([
    listUsers(), canDo("marketing", "edit"), canDo("budgets", "edit"), listPlans([a.brandId]), axisOptions(a.brandId),
    db.execute<{ id: string; name: string }>(sql`select id, name from products where active and brand_id = ${a.brandId}::uuid order by name`),
    db.execute<{ id: string; name: string }>(sql`select id, name from campaigns where brand_id = ${a.brandId}::uuid and status not in ('DONE','ANALYZED') order by name`),
    db.execute<{ id: string; label: string; date: string; amount: number; status: "PLANNED" | "COMMITTED" | "SPENT"; category: string }>(sql`select id, label, date::text as date, amount::float8 as amount, status::text as status, category::text as category from marketing_expenses where action_id = ${id}::uuid ${a.activationId ? sql`or (activation_id = ${a.activationId}::uuid and action_id is null)` : sql``} order by date desc`),
    db.execute<{ id: string; label: string; date: string; amount: number; status: string }>(sql`select id, label, date::text as date, amount::float8 as amount, status::text as status from marketing_expenses where brand_id = ${a.brandId}::uuid and action_id is null and extract(year from date) = ${Number(year)} order by date desc limit 100`),
    decisionsByAction([id]),
    // Tâches du rétroplanning (action générée) : clé `marketing-action:<id>:etape:<n>`.
    db.execute<{ id: string; status: string; source_key: string; assignee: string | null }>(sql`select t.id, t.status::text as status, t.source_key, u.name as assignee from tasks t left join users u on u.id = t.assignee_id where t.entity_type = 'marketing_action' and t.entity_id = ${id}::uuid and t.source_key like ${`marketing-action:${id}:etape:%`}`),
    db.execute<{ id: string; title: string; date: string }>(sql`select id, title, date::text as date from content_items where archived_at is null and ((${a.activationId}::uuid is not null and activation_id = ${a.activationId}::uuid) or (${a.campaignId}::uuid is not null and campaign_id = ${a.campaignId}::uuid)) order by date limit 20`),
  ]);
  const spec = a.spec as ActionProposal | null;
  const taskStatus = new Map(stepRows.rows.map((r) => [Number(r.source_key.split(":etape:")[1]), { id: r.id, status: r.status, assignee: r.assignee }]));
  const execHref = a.activationId ? `/marketing/activations/${a.activationId}` : a.campaignId ? `/marketing/campagnes/${a.campaignId}` : null;
  const decision = decisionMap.get(id) ?? null;
  const todayIso = iso(today());
  const late = actionLateDays(a, todayIso);
  const remaining = a.budgetPlanned - a.committed;

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/priorites" className="hover:underline">Priorités & actions</Link>} title={a.title}
        subtitle={<span className="inline-flex items-center gap-2"><BrandDot color={a.brandColor} />{a.brandName}{a.productName ? ` · ${a.productName}` : ""}{a.planName ? ` · plan ${a.planName}` : ""}{a.axisName ? ` · axe ${a.axisName}` : ""}{a.month ? ` · ${fmtMonth(a.month)}` : ""} · source {ACTION_SOURCE_LABELS[a.source]}</span>}
        actions={<><StatusBadge status={a.status} /><PriorityBadge priority={a.priority} /><Link href={`/taches/${a.taskId}`} className="btn-secondary btn-sm">Ouvrir la tâche</Link></>}>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Kpi label="Budget prévu" value={fmtMAD(a.budgetPlanned, { compact: true })} sub={a.category ? BUDGET_CATEGORY_LABELS[a.category] : "canal non précisé"} />
          <Kpi label="Engagé + dépensé" value={fmtMAD(a.committed, { compact: true })} sub={`${a.expenses} dépense(s) rattachée(s)`} tone={a.budgetPlanned > 0 && a.committed > a.budgetPlanned ? "red" : undefined} />
          <Kpi label="Reste" value={fmtMAD(remaining, { compact: true })} tone={remaining < 0 ? "red" : "green"} sub="prévu − engagé" />
          <Kpi label="Responsable" value={a.assigneeName ?? "—"} sub={a.dueDate ? `échéance ${fmtDateShort(a.dueDate)}${late ? ` · retard ${late} j` : ""}` : "sans échéance"} tone={late ? "red" : undefined} />
          <Kpi label="Décision d'origine" value={decision ? DECISION_STATUS[decision.status].label : a.decisionKey ? "liée" : "—"} sub={decision ? DOMAIN_LABELS[decision.domain as DecisionDomain] ?? decision.domain : "créée à la main ou par le plan"} />
        </div>
      </PageHeader>

      {sp.ajout && (
        <div className="rounded-xl border border-green/30 bg-green/5 px-4 py-3 mb-4 text-[13px]">
          <b>Action ajoutée au plan{sp.plan === "cree" ? " (plan de l'année créé en brouillon)" : ""}.</b>{" "}
          {sp.avant && sp.apres && <>Budget disponible du levier : <b>{fmtMAD(Number(sp.avant))} → {fmtMAD(Number(sp.apres))}</b>. </>}
          {spec && <>{spec.steps.length} tâches datées, {spec.contents.length} contenu(s) au planning{execHref ? <>, <Link href={execHref} className="underline">{a.activationId ? "activation" : "campagne"} créée</Link></> : null}.</>}
        </div>
      )}
      {spec && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2 mb-3 text-[12.5px]">
            <span className="label">Exécution</span>
            {execHref && <Link href={execHref} className="btn-secondary btn-sm">{a.activationId ? "Activation (budget par poste)" : "Campagne"}</Link>}
            {contentRows.rows.length > 0 && <Link href={`/marketing/planning?brand=${a.brandId}`} className="btn-ghost btn-sm">{contentRows.rows.length} contenu(s) au planning</Link>}
            <Link href={`/taches?brand=${a.brandId}`} className="btn-ghost btn-sm">{a.stepsDone}/{a.stepsTotal} tâches faites</Link>
          </div>
          <ProposalSheet p={spec} taskStatus={taskStatus} />
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_380px] gap-4 items-start">
        <div className="space-y-4">
          <Card title="Avancement">
            {canEdit ? (
              <form action={setActionStatusAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="id" value={a.id} />
                {(["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"] as const).map((s) => (
                  <button key={s} type="submit" name="status" value={s} className={a.status === s ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{{ TODO: "À faire", IN_PROGRESS: "En cours", BLOCKED: "Bloquée", DONE: "Terminée", CANCELLED: "Annulée" }[s]}</button>
                ))}
              </form>
            ) : <StatusBadge status={a.status} />}
            <p className="text-[12px] text-muted mt-2">Le statut est celui de la tâche : il est le même dans Tâches, l&apos;Action Center et le plan.{a.completedAt ? ` Terminée le ${fmtDateShort(a.completedAt)}.` : ""}</p>
          </Card>

          <Card title="Fiche de l'action">
            {canEdit ? (
              <form action={updateActionAction} className="grid sm:grid-cols-2 gap-2 text-[13px]">
                <input type="hidden" name="id" value={a.id} />
                <label className="block sm:col-span-2"><span className="label block mb-1">Action *</span><input name="title" defaultValue={a.title} className="input h-9" required /></label>
                <label className="block sm:col-span-2"><span className="label block mb-1">Objectif</span><input name="objective" defaultValue={a.objective ?? ""} className="input h-9" /></label>
                <label className="block sm:col-span-2"><span className="label block mb-1">Pourquoi (justification, données)</span><textarea name="why" defaultValue={a.why ?? ""} className="input min-h-16 py-2" /></label>
                <label className="block sm:col-span-2"><span className="label block mb-1">Résultat attendu</span><input name="expectedResult" defaultValue={a.expectedResult ?? ""} className="input h-9" /></label>
                <label className="block"><span className="label block mb-1">Budget prévu (MAD)</span><input name="budgetPlanned" defaultValue={a.budgetPlanned || ""} className="input h-9" /></label>
                <label className="block"><span className="label block mb-1">Canal</span><select name="category" defaultValue={a.category ?? ""} className="select h-9"><option value="">—</option>{BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{BUDGET_CATEGORY_LABELS[c]}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Responsable</span><select name="assigneeId" defaultValue={a.assigneeId ?? ""} className="select h-9"><option value="">Non assigné</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Deadline</span><input type="date" name="dueDate" defaultValue={a.dueDate ?? ""} className="input h-9" /></label>
                <label className="block"><span className="label block mb-1">Priorité</span><select name="priority" defaultValue={a.priority} className="select h-9"><option value="LOW">Basse</option><option value="MEDIUM">Moyenne</option><option value="HIGH">Haute</option><option value="CRITICAL">Critique</option></select></label>
                <label className="block"><span className="label block mb-1">Produit</span><select name="productId" defaultValue={a.productId ?? ""} className="select h-9"><option value="">—</option>{products.rows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Campagne</span><select name="campaignId" defaultValue={a.campaignId ?? ""} className="select h-9"><option value="">—</option>{campaigns.rows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Plan</span><select name="planId" defaultValue={a.planId ?? ""} className="select h-9"><option value="">—</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Axe</span><select name="axisId" defaultValue={a.axisId ?? ""} className="select h-9"><option value="">—</option>{axes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Mois du plan</span><input type="date" name="month" defaultValue={a.month ?? ""} className="input h-9" placeholder="premier jour du mois" /></label>
                <div className="sm:col-span-2 flex justify-end"><button className="btn-primary btn-sm" type="submit">Enregistrer</button></div>
              </form>
            ) : (
              <Facts cols={2} items={[{ label: "Objectif", value: a.objective ?? "—" }, { label: "Pourquoi", value: a.why ?? "—" }, { label: "Résultat attendu", value: a.expectedResult ?? "—" }, { label: "Campagne", value: a.campaignName ?? "—" }]} />
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card title={`Dépenses rattachées (${expenses.rows.length})`}>
            {expenses.rows.length === 0 ? <p className="text-[12.5px] text-muted">Aucune dépense. Une dépense saisie dans Budget & dépenses se rattache ici ; seules les dépenses engagées ou dépensées comptent dans l&apos;engagé.</p> : (
              <table className="tbl text-[12px]"><thead><tr><th>Date</th><th>Dépense</th><th>Statut</th><th className="num">MAD</th><th></th></tr></thead>
                <tbody>{expenses.rows.map((e) => <tr key={e.id}><td className="whitespace-nowrap">{fmtDateShort(e.date)}</td><td>{e.label}<div className="text-[10.5px] text-muted">{BUDGET_CATEGORY_LABELS[e.category as keyof typeof BUDGET_CATEGORY_LABELS] ?? e.category}</div></td><td><Badge tone={e.status === "SPENT" ? "green" : e.status === "COMMITTED" ? "blue" : "gray"}>{STATUS_LABEL[e.status]}</Badge></td><td className="num font-medium">{fmtMAD(e.amount, { suffix: false })}</td><td>{canBudget && <form action={attachExpenseAction}><input type="hidden" name="expenseId" value={e.id} /><input type="hidden" name="actionId" value="" /><input type="hidden" name="back" value={`/marketing/priorites/${a.id}`} /><button className="text-faint hover:text-red" type="submit" title="Détacher">×</button></form>}</td></tr>)}</tbody>
              </table>
            )}
            {canBudget && candidates.rows.length > 0 && (
              <form action={attachExpenseAction} className="mt-3 flex gap-1.5 text-[12px]">
                <input type="hidden" name="actionId" value={a.id} /><input type="hidden" name="back" value={`/marketing/priorites/${a.id}`} />
                <select name="expenseId" className="select h-8 flex-1 min-w-0" required><option value="">Rattacher une dépense {year} de la marque…</option>{candidates.rows.map((e) => <option key={e.id} value={e.id}>{fmtDateShort(e.date)} · {e.label} · {fmtMAD(e.amount, { suffix: false })}</option>)}</select>
                <button className="btn-secondary btn-sm" type="submit">Rattacher</button>
              </form>
            )}
            <Link href={`/marketing/budgets?brand=${a.brandId}`} className="btn-ghost btn-sm mt-2">Budget & dépenses</Link>
          </Card>
          {(decision || a.decisionKey) && (
            <Card title="Décision d'origine">
              <p className="text-[12.5px] text-ink-2">{decision ? <>Décision <b>{DECISION_STATUS[decision.status].label.toLowerCase()}</b> issue de « {DOMAIN_LABELS[decision.domain as DecisionDomain] ?? decision.domain} ».</> : "Décision liée."}</p>
              <p className="text-[11.5px] text-faint mt-1 break-all">{a.decisionKey}</p>
              <Link href="/marketing/priorites" className="btn-ghost btn-sm mt-2">Historique des décisions</Link>
            </Card>
          )}
          {!isOpenStatus(a.status) && <Section className="mb-0" title=""><p className="text-[12px] text-muted">Action close. La réouvrir : « À faire » ou « En cours » ci-contre.</p></Section>}
        </aside>
      </div>
    </>
  );
}
