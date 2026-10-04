import Link from "next/link";
import clsx from "clsx";
import { Check, Pause, Play } from "lucide-react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, canDo } from "@/lib/access";
import { listUsers } from "@/lib/users";
import { decisionScopeFor } from "@/lib/decisions/server";
import { buildUnifiedDecisions } from "@/lib/decisions/build";
import { decidedDecisions } from "@/lib/decisions/store";
import { DECISION_STATUS, DOMAIN_LABELS, type DecisionDomain } from "@/lib/decisions/types";
import { listActions, type ActionRow } from "@/lib/marketing-plan/actions";
import { listPlans, axisOptions } from "@/lib/marketing-plan/plan";
import { ACTION_SOURCE_LABELS, actionLateDays, isOpenStatus } from "@/lib/marketing-plan/shared";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import { PageHeader, Card, Badge, BrandDot, Section, Empty, PriorityBadge, StatusBadge, Tabs } from "@/components/ui";
import { DecisionCard } from "@/components/decision-card";
import { fmtMAD, fmtDateShort, fmtMonth, iso, today, addDays } from "@/lib/format";
import { createActionAction, setActionStatusAction, reopenDecisionAction, measureDecisionAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Priorités & actions" };

function ActionCard({ a, rank, todayIso, canEdit }: { a: ActionRow; rank: number; todayIso: string; canEdit: boolean }) {
  const late = actionLateDays(a, todayIso);
  const next = a.status === "TODO" ? "IN_PROGRESS" : a.status === "IN_PROGRESS" ? "DONE" : a.status === "BLOCKED" ? "IN_PROGRESS" : null;
  return (
    <article className={clsx("card overflow-hidden flex", a.status === "DONE" && "opacity-70")}>
      <div className={clsx("w-1.5 shrink-0", late ? "bg-red" : a.priority === "CRITICAL" ? "bg-red" : a.priority === "HIGH" ? "bg-orange" : a.priority === "MEDIUM" ? "bg-yellow" : "bg-faint")} />
      <div className="flex-1 min-w-0 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">{rank}</span>
          <Link href={`/marketing/priorites/${a.id}`} className="font-semibold text-[14.5px] hover:underline flex-1 min-w-0 truncate">{a.title}</Link>
          <PriorityBadge priority={a.priority} /><StatusBadge status={a.status} />
        </div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-1.5 text-[12.5px]">
          <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Budget</div><div className="font-medium">{a.budgetPlanned ? fmtMAD(a.budgetPlanned, { compact: true }) : "—"}{a.committed ? <span className="text-muted font-normal"> · engagé {fmtMAD(a.committed, { compact: true })}</span> : null}</div></div>
          <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Canal</div><div className="font-medium">{a.category ? BUDGET_CATEGORY_LABELS[a.category] : "—"}</div></div>
          <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Marque / produit</div><div className="font-medium flex items-center gap-1"><BrandDot color={a.brandColor} />{a.productName ?? a.brandName}</div></div>
          <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Responsable</div><div className="font-medium">{a.assigneeName ?? <span className="text-faint">non assignée</span>}</div></div>
          <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Deadline</div><div className={clsx("font-medium", late && "text-red")}>{a.dueDate ? fmtDateShort(a.dueDate) : "—"}{late ? ` · retard ${late} j` : ""}</div></div>
          <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Source</div><div className="font-medium">{ACTION_SOURCE_LABELS[a.source]}{a.planName ? ` · ${a.planName}` : ""}{a.month ? ` · ${fmtMonth(a.month)}` : ""}</div></div>
        </div>
        {(a.objective || a.why || a.expectedResult) && (
          <div className="mt-2 text-[12.5px] space-y-0.5">
            {a.objective && <p><span className="label mr-1.5">Objectif</span>{a.objective}</p>}
            {a.why && <p className="text-ink-2"><span className="label mr-1.5">Pourquoi</span>{a.why}</p>}
            {a.expectedResult && <p className="text-ink-2"><span className="label mr-1.5">Résultat attendu</span>{a.expectedResult}</p>}
          </div>
        )}
        {canEdit && isOpenStatus(a.status) && (
          <form action={setActionStatusAction} className="mt-3 flex flex-wrap gap-1.5">
            <input type="hidden" name="id" value={a.id} />
            {next && <button className="btn-secondary btn-sm" type="submit" name="status" value={next}>{next === "DONE" ? <><Check size={13} /> Terminer</> : <><Play size={13} /> {a.status === "BLOCKED" ? "Débloquer" : "Démarrer"}</>}</button>}
            {a.status !== "BLOCKED" && <button className="btn-ghost btn-sm" type="submit" name="status" value="BLOCKED"><Pause size={13} /> Bloquée</button>}
          </form>
        )}
      </div>
    </article>
  );
}

export default async function PrioritesPage(props: { searchParams: Promise<{ brand?: string; mois?: string; mois_m?: string; axe?: string; responsable?: string; vue?: string }> }) {
  await requireAccess("marketing");
  const raw = await props.searchParams;
  // Le filtre « mois » arrive en AAAA-MM (champ type=month) ou en AAAA-MM-01 (liens du plan).
  const sp = { ...raw, mois: raw.mois ?? (raw.mois_m && /^\d{4}-\d{2}$/.test(raw.mois_m) ? `${raw.mois_m}-01` : undefined), mois_m: undefined };
  const [scope, users, canCreate, canEdit] = await Promise.all([decisionScopeFor(sp.brand ?? null), listUsers(), canDo("marketing", "create"), canDo("marketing", "edit")]);
  const brandIds = scope.brands.map((b) => b.id);
  const todayIso = iso(today());
  const showAll = sp.vue === "toutes";
  const [actions, decisions, decided, plans, axes, campaigns, products] = await Promise.all([
    listActions({ brandIds, month: sp.mois && /^\d{4}-\d{2}-01$/.test(sp.mois) ? sp.mois : null, axisId: sp.axe && /^[0-9a-f-]{36}$/i.test(sp.axe) ? sp.axe : null, assigneeId: sp.responsable && /^[0-9a-f-]{36}$/i.test(sp.responsable) ? sp.responsable : null, includeDone: showAll }),
    buildUnifiedDecisions({ ...scope, includeDecided: false }),
    decidedDecisions(brandIds, 30),
    listPlans(brandIds),
    axisOptions(scope.selectedBrandId),
    db.execute<{ id: string; name: string; brand_id: string }>(sql`select id, name, brand_id from campaigns where status in ('DRAFT','PLANNED','ACTIVE','PAUSED') ${scope.selectedBrandId ? sql`and brand_id = ${scope.selectedBrandId}::uuid` : sql``} order by name limit 200`),
    scope.selectedBrandId ? db.execute<{ id: string; name: string }>(sql`select id, name from products where active and brand_id = ${scope.selectedBrandId}::uuid order by name`) : Promise.resolve({ rows: [] as { id: string; name: string }[] }),
  ]);
  const open = actions.filter((a) => isOpenStatus(a.status));
  const ranked = [...open].sort((a, b) => actionLateDays(b, todayIso) - actionLateDays(a, todayIso) || ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(a.priority) - ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(b.priority) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const late = open.filter((a) => actionLateDays(a, todayIso) > 0);
  const week = iso(addDays(today(), 7));
  const thisWeek = open.filter((a) => a.dueDate && a.dueDate <= week);
  const q = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, v); const s = p.toString(); return `/marketing/priorites${s ? "?" + s : ""}`; };
  const back = q({});
  const maxDecisions = scope.ctx.settings.marketingPlan.maxDecisions;
  const budgetOpen = open.reduce((s, a) => s + a.budgetPlanned, 0);

  return (
    <>
      <PageHeader eyebrow="Marketing" title="Priorités & actions" subtitle={`${open.length} action(s) ouverte(s) · ${late.length} en retard · ${thisWeek.length} à échéance sous 7 jours · ${fmtMAD(budgetOpen, { compact: true })} de budget prévu ouvert. Ce que l'équipe doit faire, par qui, pour quand.`}
        actions={<><Link href="/marketing/plan" className="btn-secondary btn-sm">Plan marketing</Link><Link href="/actions" className="btn-secondary btn-sm">Action Center</Link><Link href="/taches" className="btn-ghost btn-sm">Tâches</Link></>}>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs current={q({ brand: sp.brand })} tabs={[{ href: q({ brand: "" }), label: "Toutes les marques" }, ...scope.allBrands.map((b) => ({ href: q({ brand: b.id }), label: b.name }))]} />
          <form action="/marketing/priorites" method="get" className="flex flex-wrap gap-2 ml-auto text-[12px]">
            {sp.brand && <input type="hidden" name="brand" value={sp.brand} />}
            <select name="responsable" defaultValue={sp.responsable ?? ""} className="select h-8 w-auto"><option value="">Tous les responsables</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            <select name="axe" defaultValue={sp.axe ?? ""} className="select h-8 w-auto"><option value="">Tous les axes</option>{axes.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
            <input type="month" name="mois_m" defaultValue={sp.mois?.slice(0, 7) ?? ""} className="input h-8 w-auto" title="Mois du plan" />
            <select name="vue" defaultValue={sp.vue ?? ""} className="select h-8 w-auto"><option value="">Ouvertes</option><option value="toutes">Toutes (dont terminées)</option></select>
            <button className="btn-secondary btn-sm" type="submit">Filtrer</button>
          </form>
        </div>
      </PageHeader>

      <div className="grid xl:grid-cols-[1fr_420px] gap-4 items-start">
        <div className="space-y-6">
          <Section title="Priorités de l'équipe" description="Du plus urgent au moins urgent : retards d'abord, puis priorité, puis échéance. Démarrer, terminer ou bloquer en un clic ; le détail ouvre l'action.">
            {ranked.length === 0 ? (
              <Empty title="Aucune action ouverte" hint="Approuver une décision ci-contre, générer les actions d'un mois depuis le plan, ou créer une action à la main." />
            ) : (
              <div className="space-y-3">{ranked.slice(0, showAll ? 200 : 30).map((a, i) => <ActionCard key={a.id} a={a} rank={i + 1} todayIso={todayIso} canEdit={canEdit} />)}</div>
            )}
            {showAll && actions.filter((a) => !isOpenStatus(a.status)).length > 0 && (
              <Card className="mt-3" pad={false}>
                <table className="tbl text-[12.5px]"><thead><tr><th>Action terminée / annulée</th><th>Responsable</th><th>Statut</th><th className="num">Prévu</th><th className="num">Engagé</th></tr></thead>
                  <tbody>{actions.filter((a) => !isOpenStatus(a.status)).map((a) => <tr key={a.id}><td><Link href={`/marketing/priorites/${a.id}`} className="hover:underline">{a.title}</Link></td><td>{a.assigneeName ?? "—"}</td><td><StatusBadge status={a.status} /></td><td className="num">{fmtMAD(a.budgetPlanned, { suffix: false })}</td><td className="num">{a.committed ? fmtMAD(a.committed, { suffix: false }) : "—"}</td></tr>)}</tbody>
                </table>
              </Card>
            )}
          </Section>

          <Section title={`Décisions à prendre (${decisions.proposed.length})`} description="Recommandations des moteurs (règles, intelligence Ads, intelligence marketing), structure commune. Approuver crée l'action et sa tâche ; refuser garde la raison. Rien n'est exécuté sans validation.">
            {decisions.notes.length > 0 && <ul className="text-[12px] text-amber-800 mb-2 space-y-0.5">{decisions.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            {decisions.proposed.length === 0 ? <Empty title="Aucune décision en attente" hint="Les moteurs n'ont rien à recommander sur la période, ou tout a déjà été décidé." /> : (
              <div className="space-y-3">{decisions.proposed.slice(0, maxDecisions).map((d, i) => <DecisionCard key={d.id} d={d} rank={i + 1} users={users} canDecide={canCreate} back={back} />)}</div>
            )}
            {decisions.doNotPush.length > 0 && (
              <div className="mt-4">
                <div className="label mb-2">À ne pas pousser</div>
                <div className="space-y-3">{decisions.doNotPush.slice(0, 5).map((d) => <DecisionCard key={d.id} d={d} rank={null} users={users} canDecide={canEdit} back={back} compact />)}</div>
              </div>
            )}
          </Section>
        </div>

        <aside className="space-y-4">
          {canCreate && (
            <Card title="Nouvelle action">
              <form action={createActionAction} className="grid grid-cols-2 gap-2 text-[12px]">
                <input type="hidden" name="open" value="1" />
                <label className="col-span-2"><span className="label block mb-1">Marque *</span><select name="brandId" defaultValue={scope.selectedBrandId ?? ""} className="select h-9" required><option value="">— choisir —</option>{scope.allBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                <label className="col-span-2"><span className="label block mb-1">Action *</span><input name="title" className="input h-9" placeholder="Ex : Lancer Meta Ads Beauty Boost" required /></label>
                <label><span className="label block mb-1">Budget prévu (MAD)</span><input name="budgetPlanned" className="input h-9" placeholder="0" /></label>
                <label><span className="label block mb-1">Canal</span><select name="category" className="select h-9"><option value="">—</option>{BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{BUDGET_CATEGORY_LABELS[c]}</option>)}</select></label>
                <label><span className="label block mb-1">Responsable</span><select name="assigneeId" className="select h-9"><option value="">Non assigné</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                <label><span className="label block mb-1">Deadline</span><input type="date" name="dueDate" className="input h-9" /></label>
                <label><span className="label block mb-1">Priorité</span><select name="priority" defaultValue="MEDIUM" className="select h-9"><option value="LOW">Basse</option><option value="MEDIUM">Moyenne</option><option value="HIGH">Haute</option><option value="CRITICAL">Critique</option></select></label>
                <label><span className="label block mb-1">Plan</span><select name="planId" className="select h-9"><option value="">—</option>{plans.filter((p) => p.status !== "CLOSED").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                {scope.selectedBrandId && <label><span className="label block mb-1">Produit</span><select name="productId" className="select h-9"><option value="">—</option>{products.rows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
                <label><span className="label block mb-1">Campagne</span><select name="campaignId" className="select h-9"><option value="">—</option>{campaigns.rows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label className="col-span-2"><span className="label block mb-1">Objectif</span><input name="objective" className="input h-9" placeholder="Ex : +20 % de sell-out" /></label>
                <label className="col-span-2"><span className="label block mb-1">Pourquoi</span><input name="why" className="input h-9" placeholder="Donnée à l'origine" /></label>
                <label className="col-span-2"><span className="label block mb-1">Résultat attendu</span><input name="expectedResult" className="input h-9" /></label>
                <button className="btn-primary btn-sm col-span-2" type="submit">Créer l&apos;action</button>
              </form>
            </Card>
          )}

          <Card title={`Décisions prises (${decided.length})`}>
            {decided.length === 0 ? <p className="text-[12.5px] text-muted">Aucune décision enregistrée. Approuver ou refuser une recommandation la fait apparaître ici, avec son instantané.</p> : (
              <ul className="space-y-2 text-[12.5px]">
                {decided.map((d) => {
                  const st = DECISION_STATUS[d.status];
                  return (
                    <li key={d.key} className="border-b border-line pb-2 last:border-0">
                      <div className="flex items-center gap-2"><Badge tone={st.tone}>{st.label}</Badge><span className="font-medium flex-1 min-w-0 truncate" title={d.title}>{d.title}</span></div>
                      <div className="text-[11.5px] text-muted mt-0.5">{DOMAIN_LABELS[d.domain as DecisionDomain] ?? d.domain}{d.brandName ? ` · ${d.brandName}` : ""}{d.decidedBy ? ` · ${d.decidedBy}` : ""}{d.decidedAt ? ` · ${fmtDateShort(d.decidedAt)}` : ""}{d.reason ? ` · ${d.reason}` : ""}{d.measuredNote ? ` · mesuré : ${d.measuredNote}` : ""}</div>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {d.actionId && <Link href={`/marketing/priorites/${d.actionId}`} className="btn-ghost btn-sm">Action</Link>}
                        {canEdit && d.status === "REJECTED" && <form action={reopenDecisionAction}><input type="hidden" name="key" value={d.key} /><button className="btn-ghost btn-sm" type="submit">Rouvrir</button></form>}
                        {canEdit && (d.status === "EXECUTED" || d.status === "APPROVED") && (
                          <details><summary className="btn-ghost btn-sm list-none cursor-pointer">Mesurer</summary>
                            <form action={measureDecisionAction} className="mt-1 flex gap-1"><input type="hidden" name="key" value={d.key} /><input name="note" className="input h-8 flex-1" placeholder="Résultat observé (corrélation, jamais inventé)" required /><button className="btn-secondary btn-sm" type="submit">OK</button></form>
                          </details>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
