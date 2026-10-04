import Link from "next/link";
import clsx from "clsx";
import { ArrowUpRight, Check, Pause, Play, Plus, Sparkles } from "lucide-react";
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
import { actionLateDays, isOpenStatus } from "@/lib/marketing-plan/shared";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import { brandOpportunities, type Opportunity, type OpportunityAlert } from "@/lib/action-generator/server";
import { AXES } from "@/lib/action-generator/catalog";
import { LEVEL_LABELS } from "@/lib/action-generator/engine";
import type { ActionProposal } from "@/lib/action-generator/types";
import { PageHeader, Card, Badge, BrandDot, Section, Empty, StatusBadge, Tabs, Progress } from "@/components/ui";
import { DecisionCard } from "@/components/decision-card";
import { AddToPlanForm, detailHref } from "@/components/action-proposal";
import { fmtMAD, fmtDateShort, iso, today, addDays } from "@/lib/format";
import { createActionAction, setActionStatusAction, reopenDecisionAction, measureDecisionAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Priorités & actions" };

/** Opportunité business : action concrète, objectif, budget, impact, pourquoi maintenant — lisible en 5 secondes. */
function OpportunityCard({ o, canAdd }: { o: Opportunity; canAdd: boolean }) {
  const p = o.proposal;
  const headline = `${AXES[p.axis].label.toLowerCase()} · ${p.family.toLowerCase()}${p.suggestions.city ? ` à ${p.suggestions.city}` : ""}${p.products[0] ? ` · ${p.products[0]}` : ""}`;
  return (
    <article className="card p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2 text-[12px]"><BrandDot color={o.brandColor} /><span className="font-medium">{o.brandName}</span><span className="text-faint">·</span><span className="text-muted truncate">Opportunité — {headline}</span></div>
      <div className="flex items-start gap-2">
        <Sparkles size={16} className="text-accent mt-1 shrink-0" />
        <div className="min-w-0">
          <Link href={detailHref(o.input, p.templateKey)} className="font-semibold text-[16px] leading-snug hover:underline">{p.name}</Link>
          <p className="text-[13px] text-ink-2">{p.objectiveText}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[12px]">
        <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Budget</div><div className="font-semibold">{fmtMAD(p.budget, { compact: true })}</div>{o.available !== null && <div className="text-[10.5px] text-muted">sur {fmtMAD(o.available, { compact: true })} dispo.</div>}</div>
        <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Impact</div><div className="font-medium">{LEVEL_LABELS[p.impact]}</div><div className="text-[10.5px] text-muted">{p.estimate.buyers} ventes (hyp.)</div></div>
        <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Pertinence</div><div className="font-medium">{p.score}/100</div><div className="text-[10.5px] text-muted">J = {fmtDateShort(p.eventDate)}</div></div>
      </div>
      <p className="text-[12.5px] text-ink-2"><span className="label mr-1.5">Pourquoi maintenant</span>{[o.signal, ...p.why.slice(1, 3)].filter(Boolean).join(" · ")}</p>
      <div className="flex flex-wrap items-center gap-2 mt-auto">
        <Badge tone="gray">À décider</Badge>{o.alternatives > 0 && <Link href={`/marketing/priorites/generer?brand=${o.brandId}&objectif=${o.input.objective}&produit=${o.input.productId ?? ""}`} className="text-[11.5px] text-accent hover:underline">{o.alternatives} autre(s) option(s)</Link>}
        <span className="flex-1" />
        <Link href={detailHref(o.input, p.templateKey)} className="btn-secondary btn-sm">Voir le plan <ArrowUpRight size={14} /></Link>
        {canAdd && <AddToPlanForm input={o.input} templateKey={p.templateKey} compact />}
      </div>
    </article>
  );
}

/** Une ligne d'action au plan : action, objectif, budget, impact, avancement, échéance, statut. */
function ActionLine({ a, todayIso, canEdit }: { a: ActionRow; todayIso: string; canEdit: boolean }) {
  const late = actionLateDays(a, todayIso);
  const spec = a.spec as Partial<ActionProposal> | null;
  const next = a.status === "TODO" ? "IN_PROGRESS" : a.status === "IN_PROGRESS" ? "DONE" : a.status === "BLOCKED" ? "IN_PROGRESS" : null;
  const progress = a.stepsTotal > 0 ? Math.round((a.stepsDone / a.stepsTotal) * 100) : null;
  return (
    <tr className={clsx(a.status === "DONE" && "opacity-70")}>
      <td className="min-w-56">
        <Link href={`/marketing/priorites/${a.id}`} className="font-medium hover:underline">{a.title}</Link>
        <div className="text-[11px] text-muted flex items-center gap-1"><BrandDot color={a.brandColor} />{a.brandName}{a.productName ? ` · ${a.productName}` : ""}{spec?.axis ? ` · ${AXES[spec.axis].label}` : a.category ? ` · ${BUDGET_CATEGORY_LABELS[a.category]}` : ""}</div>
      </td>
      <td className="text-[12px] text-ink-2 max-w-64">{a.objective ?? "—"}</td>
      <td className="num whitespace-nowrap"><b>{a.budgetPlanned ? fmtMAD(a.budgetPlanned, { compact: true }) : "—"}</b>{a.committed > 0 && <div className="text-[10.5px] text-muted">engagé {fmtMAD(a.committed, { compact: true })}</div>}</td>
      <td className="text-[12px]">{spec?.impact ? <>{LEVEL_LABELS[spec.impact]}<div className="text-[10.5px] text-muted">{spec.estimate?.buyers ?? "—"} ventes (hyp.)</div></> : <span className="text-faint">—</span>}</td>
      <td className="w-28">{progress === null ? <span className="text-faint text-[12px]">—</span> : <><Progress value={progress} tone={progress === 100 ? "green" : "accent"} /><div className="text-[10.5px] text-muted mt-0.5">{a.stepsDone}/{a.stepsTotal} tâches</div></>}</td>
      <td className={clsx("whitespace-nowrap text-[12px]", late && "text-red font-medium")}>{a.eventDate ? `J ${fmtDateShort(a.eventDate)}` : a.dueDate ? fmtDateShort(a.dueDate) : "—"}{late ? <div className="text-[10.5px]">retard {late} j</div> : null}</td>
      <td className="whitespace-nowrap">
        <StatusBadge status={a.status} />
        {canEdit && isOpenStatus(a.status) && (
          <form action={setActionStatusAction} className="inline-flex gap-0.5 ml-1 align-middle">
            <input type="hidden" name="id" value={a.id} />
            {next && <button className="btn-ghost btn-sm !px-1.5" type="submit" name="status" value={next} title={next === "DONE" ? "Terminer" : a.status === "BLOCKED" ? "Débloquer" : "Démarrer"}>{next === "DONE" ? <Check size={13} /> : <Play size={13} />}</button>}
            {a.status !== "BLOCKED" && <button className="btn-ghost btn-sm !px-1.5" type="submit" name="status" value="BLOCKED" title="Bloquée"><Pause size={13} /></button>}
          </form>
        )}
      </td>
    </tr>
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
  // Opportunités : la marque choisie (3 options) ou, toutes marques, une opportunité par marque (6 marques au plus).
  const oppBrands = scope.selectedBrandId ? scope.allBrands.filter((b) => b.id === scope.selectedBrandId) : scope.allBrands.slice(0, 6);
  const [actions, decisions, decided, plans, axes, campaigns, products, opps] = await Promise.all([
    listActions({ brandIds, month: sp.mois && /^\d{4}-\d{2}-01$/.test(sp.mois) ? sp.mois : null, axisId: sp.axe && /^[0-9a-f-]{36}$/i.test(sp.axe) ? sp.axe : null, assigneeId: sp.responsable && /^[0-9a-f-]{36}$/i.test(sp.responsable) ? sp.responsable : null, includeDone: showAll }),
    buildUnifiedDecisions({ ...scope, includeDecided: false }),
    decidedDecisions(brandIds, 30),
    listPlans(brandIds),
    axisOptions(scope.selectedBrandId),
    db.execute<{ id: string; name: string; brand_id: string }>(sql`select id, name, brand_id from campaigns where status in ('DRAFT','PLANNED','ACTIVE','PAUSED') ${scope.selectedBrandId ? sql`and brand_id = ${scope.selectedBrandId}::uuid` : sql``} order by name limit 200`),
    scope.selectedBrandId ? db.execute<{ id: string; name: string }>(sql`select id, name from products where active and brand_id = ${scope.selectedBrandId}::uuid order by name`) : Promise.resolve({ rows: [] as { id: string; name: string }[] }),
    Promise.all(oppBrands.map((b) => brandOpportunities(scope.ctx, b, { max: 3 }).catch((e) => { console.error(`Opportunités ${b.name}`, e); return { opportunities: [] as Opportunity[], alert: null as OpportunityAlert | null }; }))),
  ]);
  // Toutes marques : une opportunité par marque, en évitant de proposer le même modèle à deux marques (sinon la liste
  // redevient générique) ; une marque choisie : ses 3 meilleures options.
  let opportunities: Opportunity[];
  if (scope.selectedBrandId) opportunities = opps.flatMap((o) => o.opportunities);
  else {
    const used = new Set<string>();
    opportunities = [];
    for (const o of [...opps].sort((a, b) => (b.opportunities[0]?.proposal.score ?? 0) - (a.opportunities[0]?.proposal.score ?? 0))) {
      const pick = o.opportunities.find((x) => !used.has(x.proposal.templateKey)) ?? o.opportunities[0];
      if (!pick) continue;
      used.add(pick.proposal.templateKey);
      opportunities.push(pick);
    }
  }
  opportunities.sort((a, b) => b.proposal.score - a.proposal.score);
  const alerts = opps.map((o) => o.alert).filter((a): a is OpportunityAlert => !!a);
  const open = actions.filter((a) => isOpenStatus(a.status));
  const ranked = [...actions].sort((a, b) => Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status)) || actionLateDays(b, todayIso) - actionLateDays(a, todayIso) || (a.eventDate ?? a.dueDate ?? "9999").localeCompare(b.eventDate ?? b.dueDate ?? "9999"));
  const late = open.filter((a) => actionLateDays(a, todayIso) > 0);
  const week = iso(addDays(today(), 7));
  const thisWeek = open.filter((a) => a.dueDate && a.dueDate <= week);
  const q = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, v); const s = p.toString(); return `/marketing/priorites${s ? "?" + s : ""}`; };
  const back = q({});
  const maxDecisions = scope.ctx.settings.marketingPlan.maxDecisions;
  const budgetOpen = open.reduce((s, a) => s + a.budgetPlanned, 0);
  const genHref = `/marketing/priorites/generer${scope.selectedBrandId ? `?brand=${scope.selectedBrandId}` : ""}`;

  return (
    <>
      <PageHeader eyebrow="Marketing" title="Opportunités & actions" subtitle={`Ce qu'il faut lancer, avec quel budget, et ce qui est en cours. ${open.length} action(s) au plan · ${late.length} en retard · ${thisWeek.length} à échéance sous 7 jours · ${fmtMAD(budgetOpen, { compact: true })} prévus.`}
        actions={<>{canCreate && <Link href={genHref} className="btn-primary"><Plus size={16} /> Générer une action</Link>}<Link href="/marketing/plan" className="btn-secondary btn-sm">Plan marketing</Link><Link href="/actions" className="btn-ghost btn-sm">Action Center</Link></>}>
        <Tabs current={q({ brand: sp.brand })} tabs={[{ href: q({ brand: "" }), label: "Toutes les marques" }, ...scope.allBrands.map((b) => ({ href: q({ brand: b.id }), label: b.name }))]} />
      </PageHeader>

      <Section title="Opportunités du moment" description="Le produit que les données désignent, l'action la plus pertinente que le budget disponible permet de financer, et pourquoi maintenant. Voir le plan pour le détail ; Ajouter au plan crée l'action, son budget, ses tâches et ses contenus."
        action={canCreate ? <Link href={genHref} className="btn-secondary btn-sm"><Plus size={14} /> Autre demande</Link> : undefined}>
        {alerts.length > 0 && <div className="mb-3 space-y-1.5">{alerts.map((a) => <div key={a.brandId} className="rounded-xl border border-red/30 bg-red/5 px-3 py-2 text-[12.5px]"><b>{a.brandName} :</b> {a.message}</div>)}</div>}
        {opportunities.length === 0 ? (
          <Empty title="Aucune opportunité calculable" hint="Il faut un produit avec des ventes ou un produit prioritaire au plan, et un budget (enveloppe ou allocation). Le générateur reste disponible avec un budget saisi." action={canCreate ? <Link href={genHref} className="btn-primary btn-sm">Générer une action</Link> : undefined} />
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{opportunities.map((o) => <OpportunityCard key={`${o.brandId}:${o.proposal.templateKey}`} o={o} canAdd={canCreate} />)}</div>
        )}
      </Section>

      <Section title={`Actions au plan (${showAll ? actions.length : open.length})`} description="Chaque action a son objectif, son budget, ses tâches datées et son statut. Le détail ouvre la fiche complète (concept, budget par poste, rétroplanning, KPI)."
        action={
          <form action="/marketing/priorites" method="get" className="flex flex-wrap gap-2 text-[12px]">
            {sp.brand && <input type="hidden" name="brand" value={sp.brand} />}
            <select name="responsable" defaultValue={sp.responsable ?? ""} className="select h-8 w-auto"><option value="">Tous les responsables</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            <select name="axe" defaultValue={sp.axe ?? ""} className="select h-8 w-auto"><option value="">Tous les axes</option>{axes.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
            <input type="month" name="mois_m" defaultValue={sp.mois?.slice(0, 7) ?? ""} className="input h-8 w-auto" title="Mois du plan" />
            <select name="vue" defaultValue={sp.vue ?? ""} className="select h-8 w-auto"><option value="">Ouvertes</option><option value="toutes">Toutes</option></select>
            <button className="btn-secondary btn-sm" type="submit">Filtrer</button>
          </form>
        }>
        {ranked.length === 0 ? (
          <Empty title="Aucune action au plan" hint="Ajouter une opportunité ci-dessus ou générer une action : elle arrive ici avec son budget, ses tâches et ses échéances." />
        ) : (
          <Card pad={false}>
            <div className="overflow-x-auto">
              <table className="tbl text-[12.5px]">
                <thead><tr><th>Action</th><th>Objectif</th><th className="num">Budget</th><th>Impact</th><th>Avancement</th><th>Échéance</th><th>Statut</th></tr></thead>
                <tbody>{ranked.slice(0, showAll ? 300 : 60).map((a) => <ActionLine key={a.id} a={a} todayIso={todayIso} canEdit={canEdit} />)}</tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>

      <details className="card p-4 mb-4">
        <summary className="cursor-pointer font-semibold text-[14px]">Signaux des moteurs ({decisions.proposed.length + decisions.doNotPush.length}) <span className="font-normal text-[12.5px] text-muted">— recommandations des règles, de l&apos;intelligence Ads et de l&apos;intelligence marketing ; elles alimentent les opportunités ci-dessus</span></summary>
        <div className="mt-3 space-y-3">
          {decisions.notes.length > 0 && <ul className="text-[12px] text-amber-800 space-y-0.5">{decisions.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          {decisions.proposed.slice(0, maxDecisions).map((d, i) => <DecisionCard key={d.id} d={d} rank={i + 1} users={users} canDecide={canCreate} back={back} compact />)}
          {decisions.doNotPush.length > 0 && <div className="label mt-2">À ne pas pousser</div>}
          {decisions.doNotPush.slice(0, 5).map((d) => <DecisionCard key={d.id} d={d} rank={null} users={users} canDecide={canEdit} back={back} compact />)}
          {decisions.proposed.length + decisions.doNotPush.length === 0 && <p className="text-[12.5px] text-muted">Aucun signal sur la période.</p>}
        </div>
      </details>

      <div className="grid lg:grid-cols-2 gap-4">
        <details className="card p-4">
          <summary className="cursor-pointer font-semibold text-[14px]">Décisions prises ({decided.length})</summary>
          {decided.length === 0 ? <p className="text-[12.5px] text-muted mt-2">Aucune décision enregistrée.</p> : (
            <ul className="space-y-2 text-[12.5px] mt-3">
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
        </details>

        {canCreate && (
          <details className="card p-4">
            <summary className="cursor-pointer font-semibold text-[14px]">Action libre <span className="font-normal text-[12.5px] text-muted">— une action que vous avez déjà conçue</span></summary>
            <form action={createActionAction} className="grid grid-cols-2 gap-2 text-[12px] mt-3">
              <input type="hidden" name="open" value="1" />
              <label className="col-span-2"><span className="label block mb-1">Marque *</span><select name="brandId" defaultValue={scope.selectedBrandId ?? ""} className="select h-9" required><option value="">— choisir —</option>{scope.allBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label className="col-span-2"><span className="label block mb-1">Action *</span><input name="title" className="input h-9" required /></label>
              <label><span className="label block mb-1">Budget prévu (MAD)</span><input name="budgetPlanned" className="input h-9" placeholder="0" /></label>
              <label><span className="label block mb-1">Canal</span><select name="category" className="select h-9"><option value="">—</option>{BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{BUDGET_CATEGORY_LABELS[c]}</option>)}</select></label>
              <label><span className="label block mb-1">Responsable</span><select name="assigneeId" className="select h-9"><option value="">Non assigné</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
              <label><span className="label block mb-1">Deadline</span><input type="date" name="dueDate" className="input h-9" /></label>
              <label><span className="label block mb-1">Plan</span><select name="planId" className="select h-9"><option value="">—</option>{plans.filter((p) => p.status !== "CLOSED").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              {scope.selectedBrandId ? <label><span className="label block mb-1">Produit</span><select name="productId" className="select h-9"><option value="">—</option>{products.rows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : <label><span className="label block mb-1">Campagne</span><select name="campaignId" className="select h-9"><option value="">—</option>{campaigns.rows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
              <label className="col-span-2"><span className="label block mb-1">Objectif</span><input name="objective" className="input h-9" /></label>
              <button className="btn-secondary btn-sm col-span-2" type="submit">Créer l&apos;action</button>
            </form>
          </details>
        )}
      </div>
    </>
  );
}
