import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { BudgetCategory } from "@/db/schema";
import { requireAccess, brandInScope, canDo } from "@/lib/access";
import { requireAccessContext } from "@/lib/permissions";
import { isAdmin } from "@/lib/permissions-shared";
import { getRefDate } from "@/lib/ref-date";
import { getPlan, proposedAllocation } from "@/lib/marketing-plan/plan";
import { OBJECTIVE_UNITS, PLAN_OBJECTIVE_KINDS, PLAN_OBJECTIVE_KEYS, PLAN_STATUS, isOpenStatus, type ObjectiveUnit } from "@/lib/marketing-plan/shared";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import { AD_SPEND_SOURCE_LABEL } from "@/lib/budget";
import { PageHeader, Card, Kpi, Badge, BrandDot, Section, Progress, StatusBadge, PriorityBadge, Empty, type Tone } from "@/components/ui";
import { fmtMAD, fmtPct, fmtDateShort, fmtMonth, fmtNum } from "@/lib/format";
import { savePlanAction, setPlanStatusAction, saveAllocationAction, saveObjectiveAction, deleteObjectiveAction, saveAxisAction, deleteAxisAction, saveMonthAction, generateMonthActionsAction } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "Plan marketing" };
  const r = await db.execute<{ name: string }>(sql`select name from marketing_plans where id = ${id}::uuid`);
  return { title: r.rows[0]?.name ?? "Plan marketing" };
}

const VERDICT_TONE: Record<string, Tone> = { SCALE: "green", MAINTAIN: "blue", OPTIMIZE: "orange", STOP: "red", WATCH: "gray" };
const money = (v: number | null) => (v === null ? "—" : fmtMAD(v, { compact: true }));

export default async function MarketingPlanPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ proposer?: string; mois?: string }> }) {
  await requireAccess("marketing");
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getPlan(id);
  if (!detail) notFound();
  if (!(await brandInScope(detail.plan.brandId))) notFound();
  const { plan, framing, chain, consumption, objectives, allocation, axes, months, actions } = detail;
  const [access, canEdit, canValidate, canBudget, { ref }] = await Promise.all([requireAccessContext(), canDo("marketing", "edit"), canDo("marketing", "validate"), canDo("budgets", "edit"), getRefDate()]);
  const canMoney = isAdmin(access.perms) || !!access.flags.approveSpend;
  const products = (await db.execute<{ id: string; name: string }>(sql`select id, name from products where active and brand_id = ${plan.brandId}::uuid order by name`)).rows;
  const proposal = sp.proposer === "1" ? await proposedAllocation(id, ref) : null;
  const proposedBy = new Map(proposal && proposal.measurable ? proposal.lines.map((l) => [l.category, l]) : []);
  const st = PLAN_STATUS[plan.status];
  const allocatedByCat = new Map(allocation.map((a) => [a.category, a]));
  const openActions = actions.filter((a) => isOpenStatus(a.status));
  const monthFocus = sp.mois && months.some((m) => m.month === sp.mois) ? sp.mois : null;

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/plan" className="hover:underline">Plan marketing</Link>} title={plan.name}
        subtitle={<span className="inline-flex items-center gap-2"><BrandDot color={plan.brandColor} />{plan.brandName} · {fmtDateShort(plan.periodStart)} → {fmtDateShort(plan.periodEnd)} · année de rattachement {plan.year}</span>}
        actions={<>
          <Badge tone={st.tone}>{st.label}</Badge>
          {canValidate && plan.status !== "ACTIVE" && <form action={setPlanStatusAction}><input type="hidden" name="id" value={plan.id} /><input type="hidden" name="status" value="ACTIVE" /><button className="btn-primary btn-sm" type="submit">Activer le plan</button></form>}
          {canValidate && plan.status === "ACTIVE" && <form action={setPlanStatusAction}><input type="hidden" name="id" value={plan.id} /><input type="hidden" name="status" value="CLOSED" /><button className="btn-secondary btn-sm" type="submit">Clôturer</button></form>}
          <Link href={`/marketing?brand=${plan.brandId}`} className="btn-secondary btn-sm">Command Center</Link>
          <Link href={`/marketing/priorites?brand=${plan.brandId}`} className="btn-secondary btn-sm">Priorités & actions</Link>
        </>}>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Kpi label="CA objectif" value={money(framing.revenueTarget)} sub={framing.revenueTarget === null ? "non renseigné" : `objectif ${plan.year} (Paramètres → Objectifs)`} />
          <Kpi label="Budget marketing" value={money(framing.budget)} sub={framing.budget === null ? "non renseigné" : `enveloppe ${plan.year} de la marque`} />
          <Kpi label="Taux marketing" value={framing.marketingRatePct === null ? "—" : fmtPct(framing.marketingRatePct, 1)} sub="budget ÷ CA objectif" />
          <Kpi label="Alloué par canal" value={fmtMAD(framing.allocated, { compact: true })} sub={framing.unallocated === null ? "sans budget" : framing.unallocated >= 0 ? `reste à allouer ${fmtMAD(framing.unallocated, { compact: true })}` : `dépasse le budget de ${fmtMAD(-framing.unallocated, { compact: true })}`} tone={framing.unallocated !== null && framing.unallocated < 0 ? "red" : undefined} />
          <Kpi label="Engagé" value={fmtMAD(chain.committed, { compact: true })} sub={chain.committedPct === null ? "sans budget" : `${Math.round(chain.committedPct)} % du budget · dont régie ${fmtMAD(consumption.adSpend, { compact: true })} (${AD_SPEND_SOURCE_LABEL[consumption.adSource]})`} tone={chain.committedPct !== null && chain.committedPct > 100 ? "red" : undefined} />
          <Kpi label="Reste" value={money(chain.remaining)} sub={`dépensé ${fmtMAD(chain.spent, { compact: true })}`} tone={chain.remaining !== null && chain.remaining < 0 ? "red" : "green"} />
        </div>
      </PageHeader>

      {/* ------------------------------ Cadrage ------------------------------ */}
      <Section title="Cadrage" description="Période, CA objectif et budget. Modifier le budget met à jour l'enveloppe annuelle (Budget & dépenses) ; le CA objectif, l'objectif de vente annuel (Cockpit, Agent marketing).">
        <Card>
          {canEdit ? (
            <form action={savePlanAction} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[13px]">
              <input type="hidden" name="id" value={plan.id} /><input type="hidden" name="brandId" value={plan.brandId} /><input type="hidden" name="status" value={plan.status} />
              <label className="block lg:col-span-2"><span className="label block mb-1">Nom</span><input name="name" defaultValue={plan.name} className="input h-9" required /></label>
              <label className="block"><span className="label block mb-1">Début</span><input type="date" name="periodStart" defaultValue={plan.periodStart} className="input h-9" required /></label>
              <label className="block"><span className="label block mb-1">Fin</span><input type="date" name="periodEnd" defaultValue={plan.periodEnd} className="input h-9" required /></label>
              <label className="block"><span className="label block mb-1">Année de rattachement</span><input name="year" defaultValue={plan.year} className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">CA objectif (MAD HT)</span><input name="revenueTarget" defaultValue={framing.revenueTarget ?? ""} className="input h-9" disabled={!canMoney} title={canMoney ? "" : "Droit « Valider une dépense » requis"} /></label>
              <label className="block"><span className="label block mb-1">Budget marketing (MAD)</span><input name="budget" defaultValue={framing.budget ?? ""} className="input h-9" disabled={!canMoney} title={canMoney ? "" : "Droit « Valider une dépense » requis"} /></label>
              <label className="block"><span className="label block mb-1">Notes</span><input name="notes" defaultValue={plan.notes ?? ""} className="input h-9" /></label>
              <div className="lg:col-span-4 flex justify-end"><button className="btn-secondary btn-sm" type="submit">Enregistrer le cadrage</button></div>
            </form>
          ) : <p className="text-[13px] text-muted">{plan.notes ?? "Aucune note."}</p>}
        </Card>
      </Section>

      {/* ------------------------------ Objectifs ------------------------------ */}
      <Section title="Objectifs" description="Ce que le plan doit obtenir : CA, sell-out, volume, acquisition, notoriété, lancement, gamme, canal. Un objectif chiffré se mesure ; un objectif qualitatif guide les axes.">
        <Card pad={false}>
          <table className="tbl text-[12.5px]">
            <thead><tr><th>Type</th><th>Objectif</th><th className="num">Cible</th><th>Produit</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {objectives.map((o) => (
                <tr key={o.id}>
                  <td><Badge tone="purple">{PLAN_OBJECTIVE_KINDS[o.kind as keyof typeof PLAN_OBJECTIVE_KINDS]?.label ?? o.kind}</Badge></td>
                  <td className="font-medium">{o.label}</td>
                  <td className="num">{o.target === null ? <span className="text-muted">qualitatif</span> : `${fmtNum(o.target)} ${OBJECTIVE_UNITS[o.unit as ObjectiveUnit] ?? o.unit}`}</td>
                  <td>{o.productName ?? "—"}</td>
                  <td className="text-muted">{o.notes ?? ""}</td>
                  <td>{canValidate && <form action={deleteObjectiveAction}><input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="objectiveId" value={o.id} /><button className="text-faint hover:text-red" type="submit" title="Supprimer">×</button></form>}</td>
                </tr>
              ))}
              {objectives.length === 0 && <tr><td colSpan={6} className="text-muted text-center py-4">Aucun objectif. Le CA objectif du cadrage compte déjà comme objectif principal.</td></tr>}
            </tbody>
          </table>
          {canEdit && (
            <form action={saveObjectiveAction} className="grid sm:grid-cols-2 lg:grid-cols-6 gap-2 p-4 border-t border-line text-[12.5px]">
              <input type="hidden" name="planId" value={plan.id} />
              <select name="kind" className="select h-8">{PLAN_OBJECTIVE_KEYS.map((k) => <option key={k} value={k}>{PLAN_OBJECTIVE_KINDS[k].label}</option>)}</select>
              <input name="label" placeholder="Libellé (ex : +20 % de sell-out sur Sebo Control)" className="input h-8 lg:col-span-2" required />
              <input name="target" placeholder="Cible (nombre)" className="input h-8" />
              <select name="unit" className="select h-8"><option value="MAD">MAD</option><option value="UNITS">unités</option><option value="PCT">%</option><option value="COUNT">nombre</option></select>
              <select name="productId" className="select h-8"><option value="">Produit (facultatif)</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <button className="btn-secondary btn-sm lg:col-span-6 justify-self-end" type="submit">Ajouter l&apos;objectif</button>
            </form>
          )}
        </Card>
      </Section>

      {/* ------------------------------ Allocation ------------------------------ */}
      <Section title="Allocation par canal" description="Répartition du budget par poste (= lignes de budget de l'année, partagées avec Budget & dépenses). « Proposer » part de la répartition réelle de l'année précédente, ajustée par le verdict de chaque canal ; vous enregistrez ce que vous retenez."
        action={<div className="flex gap-2">{proposal ? <Link href={`/marketing/plan/${plan.id}`} className="btn-ghost btn-sm">Masquer la proposition</Link> : <Link href={`/marketing/plan/${plan.id}?proposer=1`} className="btn-secondary btn-sm">Proposer une allocation</Link>}</div>}>
        {proposal && !proposal.measurable && (
          <Card className="mb-3"><div className="flex items-start gap-3"><Badge tone="gray">NON MESURABLE</Badge><div className="text-[13px]"><div className="font-medium">Aucune allocation proposée</div><p className="text-ink-2 mt-0.5">{proposal.reason}</p><p className="text-muted mt-1 text-[12px]">Historique {proposal.historyYear} : {fmtMAD(proposal.historyTotal, { compact: true })} de dépense réelle. Saisir l&apos;allocation à la main, ou attendre un historique suffisant.</p></div></div></Card>
        )}
        {proposal && proposal.measurable && (
          <Card className="mb-3">
            <div className="text-[13px]"><b>Proposition calculée</b> sur {fmtMAD(proposal.budget, { compact: true })} : part réelle {proposal.historyYear} ({fmtMAD(proposal.historyTotal, { compact: true })} de dépense engagée, confirmé) × ajustement par verdict de canal (déduit). Les montants sont pré-remplis ci-dessous ; rien n&apos;est enregistré tant que vous ne cliquez pas « Enregistrer ».</div>
            {proposal.notes.length > 0 && <ul className="text-[12px] text-amber-800 mt-2 space-y-0.5">{proposal.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          </Card>
        )}
        <Card pad={false}>
          <form action={saveAllocationAction}>
            <input type="hidden" name="id" value={plan.id} />
            <div className="overflow-x-auto">
              <table className="tbl text-[12.5px]">
                <thead><tr><th>Canal / poste</th><th className="num">Alloué</th><th className="num">Part</th><th className="num">Engagé</th><th className="num">Dépensé</th>{proposal?.measurable && <><th className="num">Proposé</th><th>Pourquoi</th></>}</tr></thead>
                <tbody>
                  {BUDGET_CATEGORIES.map((c) => {
                    const a = allocatedByCat.get(c); const pr = proposedBy.get(c as BudgetCategory);
                    const planned = a?.planned ?? 0;
                    if (!a && !pr && !canBudget) return null;
                    const over = a && a.planned > 0 && a.committed > a.planned;
                    return (
                      <tr key={c} className={!a && !pr ? "opacity-60" : ""}>
                        <td>{BUDGET_CATEGORY_LABELS[c]}</td>
                        <td className="num">{canBudget ? <input name={`cat_${c}`} defaultValue={pr ? pr.amount : planned || ""} className="input h-8 w-28 text-right" placeholder="0" /> : fmtMAD(planned, { suffix: false })}</td>
                        <td className="num text-muted">{framing.budget && planned > 0 ? fmtPct((planned / framing.budget) * 100, 1) : "—"}</td>
                        <td className={`num ${over ? "text-red font-medium" : ""}`}>{a?.committed ? fmtMAD(a.committed, { suffix: false }) : "—"}</td>
                        <td className="num">{a?.spent ? fmtMAD(a.spent, { suffix: false }) : "—"}</td>
                        {proposal?.measurable && (
                          <>
                            <td className="num">{pr ? <span className="font-medium">{fmtMAD(pr.amount, { suffix: false })} <span className="text-muted">({fmtPct(pr.sharePct, 1)})</span></span> : "—"}</td>
                            <td className="text-[11.5px] text-muted max-w-md">{pr ? <span>{pr.verdict && <Badge tone={VERDICT_TONE[pr.verdict] ?? "gray"}>{pr.verdict}</Badge>} {pr.why}</span> : ""}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr><th>Total</th><th className="num">{fmtMAD(framing.allocated, { suffix: false })}</th><th className="num">{framing.budget ? fmtPct((framing.allocated / framing.budget) * 100, 0) : "—"}</th><th className="num">{fmtMAD(allocation.reduce((s, a) => s + a.committed, 0), { suffix: false })}</th><th className="num">{fmtMAD(allocation.reduce((s, a) => s + a.spent, 0), { suffix: false })}</th>{proposal?.measurable && <><th className="num">{fmtMAD(proposal.budget, { suffix: false })}</th><th></th></>}</tr></tfoot>
              </table>
            </div>
            {canBudget && <div className="flex items-center justify-between gap-3 p-3 border-t border-line text-[12px] text-muted"><span>Engagé et dépensé : dépenses de l&apos;année par catégorie (hors régie, portée par le total). Une ligne à 0 est retirée.</span><button className="btn-primary btn-sm" type="submit">Enregistrer l&apos;allocation</button></div>}
          </form>
        </Card>
      </Section>

      {/* ------------------------------ Axes ------------------------------ */}
      <Section title="Axes stratégiques" description="Où va l'effort : un produit ou une gamme à développer, un canal à ouvrir, la marque à faire connaître. Chaque axe porte un budget ; campagnes, contenus, collaborations et activations s'y rattachent depuis leur fiche.">
        <Card pad={false}>
          <table className="tbl text-[12.5px]">
            <thead><tr><th>Axe</th><th>Produit / gamme</th><th>Objectif</th><th>Période</th><th className="num">Budget</th><th className="num">Engagé</th><th className="num">Actions</th><th></th></tr></thead>
            <tbody>
              {axes.map((a) => (
                <tr key={a.id}>
                  <td className="font-medium">{a.name}{a.notes && <div className="text-[11px] text-muted font-normal">{a.notes}</div>}</td>
                  <td>{a.productName ?? a.productRange ?? <span className="text-muted">marque</span>}</td>
                  <td className="text-muted">{objectives.find((o) => o.id === a.objectiveId)?.label ?? "—"}</td>
                  <td className="text-muted whitespace-nowrap">{a.periodStart ? `${fmtDateShort(a.periodStart)} → ${fmtDateShort(a.periodEnd)}` : "tout le plan"}</td>
                  <td className="num font-medium">{fmtMAD(a.budget, { suffix: false })}</td>
                  <td className={`num ${a.budget > 0 && a.committed > a.budget ? "text-red font-medium" : ""}`}>{a.committed ? fmtMAD(a.committed, { suffix: false }) : "—"}</td>
                  <td className="num"><Link href={`/marketing/priorites?brand=${plan.brandId}&axe=${a.id}`} className="text-accent hover:underline">{a.actions}</Link></td>
                  <td>{canValidate && <form action={deleteAxisAction}><input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="axisId" value={a.id} /><button className="text-faint hover:text-red" type="submit" title="Supprimer l'axe (les éléments rattachés sont conservés)">×</button></form>}</td>
                </tr>
              ))}
              {axes.length === 0 && <tr><td colSpan={8} className="text-muted text-center py-4">Aucun axe. Exemple : « Développer Sebo Control », « Digital acquisition », « Sell-out / trade », « Influence / marque ».</td></tr>}
            </tbody>
            {axes.length > 0 && <tfoot><tr><th colSpan={4}>Total des axes</th><th className="num">{fmtMAD(framing.axesTotal, { suffix: false })}</th><th colSpan={3} className="text-[11.5px] font-normal text-muted">{framing.unassignedToAxes === null ? "" : framing.unassignedToAxes >= 0 ? `${fmtMAD(framing.unassignedToAxes, { compact: true })} du budget sans axe` : `axes au-delà du budget de ${fmtMAD(-framing.unassignedToAxes, { compact: true })}`}</th></tr></tfoot>}
          </table>
          {canEdit && (
            <form action={saveAxisAction} className="grid sm:grid-cols-2 lg:grid-cols-6 gap-2 p-4 border-t border-line text-[12.5px]">
              <input type="hidden" name="planId" value={plan.id} />
              <input name="name" placeholder="Nom de l'axe *" className="input h-8 lg:col-span-2" required />
              <select name="productId" className="select h-8"><option value="">Produit (facultatif)</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <input name="productRange" placeholder="ou gamme (texte)" className="input h-8" />
              <select name="objectiveId" className="select h-8"><option value="">Objectif (facultatif)</option>{objectives.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
              <input name="budget" placeholder="Budget MAD" className="input h-8" />
              <input type="date" name="periodStart" className="input h-8" /><input type="date" name="periodEnd" className="input h-8" />
              <input name="notes" placeholder="Notes" className="input h-8 lg:col-span-3" />
              <button className="btn-secondary btn-sm" type="submit">Ajouter l&apos;axe</button>
            </form>
          )}
        </Card>
      </Section>

      {/* ------------------------------ Plan mensuel ------------------------------ */}
      <Section title="Plan mensuel" description="Produit prioritaire, objectif et budget de chaque mois. « Générer les actions » crée une action par canal, au prorata de l'allocation, chacune avec sa tâche (échéance : fin du mois) ; les montants restent modifiables action par action.">
        <div className="space-y-2">
          {months.map((m) => {
            const open = m.actions.filter((a) => isOpenStatus(a.status));
            const focused = monthFocus === m.month;
            return (
              <Card key={m.month} className={focused ? "ring-2 ring-accent/40" : ""}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="font-semibold text-[14px] w-32 capitalize">{fmtMonth(m.month)}</div>
                  <div className="text-[12.5px] text-ink-2 flex-1 min-w-0">
                    {m.focusProductName ? <><span className="text-muted">Produit prioritaire : </span><b>{m.focusProductName}</b></> : <span className="text-muted">pas de produit prioritaire</span>}
                    {m.objective && <> · <span className="text-muted">Objectif : </span>{m.objective}</>}
                  </div>
                  <div className="text-[12.5px] whitespace-nowrap"><span className="text-muted">Budget </span><b>{m.budget ? fmtMAD(m.budget, { compact: true }) : "—"}</b>{m.actions.length > 0 && <span className="text-muted"> · actions {fmtMAD(m.actionsBudget, { compact: true })} ({open.length} ouverte{open.length > 1 ? "s" : ""})</span>}</div>
                  <Link href={`/marketing/plan/${plan.id}?mois=${m.month}`} className="btn-ghost btn-sm">{focused ? "Replier" : "Détail"}</Link>
                </div>
                {focused && (
                  <div className="mt-3 grid lg:grid-cols-[1fr_1fr] gap-4">
                    {canEdit && (
                      <form action={saveMonthAction} className="grid grid-cols-2 gap-2 text-[12.5px]">
                        <input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="month" value={m.month} />
                        <label className="block"><span className="label block mb-1">Produit prioritaire</span><select name="focusProductId" defaultValue={m.focusProductId ?? ""} className="select h-8"><option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                        <label className="block"><span className="label block mb-1">Budget du mois (MAD)</span><input name="budget" defaultValue={m.budget || ""} className="input h-8" /></label>
                        <label className="block col-span-2"><span className="label block mb-1">Objectif du mois</span><input name="objective" defaultValue={m.objective ?? ""} className="input h-8" placeholder="Ex : +20 % de sell-out sur Beauty Boost" /></label>
                        <label className="block col-span-2"><span className="label block mb-1">Notes</span><input name="notes" defaultValue={m.notes ?? ""} className="input h-8" /></label>
                        <div className="col-span-2 flex flex-wrap gap-2 justify-end">
                          <button className="btn-secondary btn-sm" type="submit">Enregistrer le mois</button>
                        </div>
                      </form>
                    )}
                    <div>
                      <div className="flex items-center justify-between mb-2"><div className="label">Actions du mois ({m.actions.length})</div>
                        {canEdit && m.budget > 0 && m.actions.length === 0 && <form action={generateMonthActionsAction}><input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="month" value={m.month} /><button className="btn-primary btn-sm" type="submit">Générer les actions</button></form>}
                        <Link href={`/marketing/priorites?brand=${plan.brandId}&mois=${m.month}`} className="text-[12px] text-accent hover:underline">Ouvrir dans Priorités</Link>
                      </div>
                      {m.actions.length === 0 ? <p className="text-[12.5px] text-muted">{m.budget > 0 ? "Aucune action : générer la répartition par canal ou créer une action depuis Priorités & actions." : "Renseigner le budget du mois pour générer les actions."}</p> : (
                        <ul className="space-y-1.5">
                          {m.actions.map((a) => (
                            <li key={a.id} className="flex items-center gap-2 text-[12.5px]">
                              <StatusBadge status={a.status} /><Link href={`/marketing/priorites/${a.id}`} className="font-medium hover:underline flex-1 truncate">{a.title}</Link>
                              <span className="text-muted">{a.category ? BUDGET_CATEGORY_LABELS[a.category] : ""}</span><span className="font-medium">{fmtMAD(a.budgetPlanned, { compact: true })}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
          {months.length === 0 && <Empty title="Période vide" hint="Vérifier les dates du plan." />}
        </div>
      </Section>

      {/* ------------------------------ Actions ------------------------------ */}
      <Section title={`Actions du plan (${openActions.length} ouverte${openActions.length > 1 ? "s" : ""})`} description="Chaque action a un budget prévu, un responsable, une échéance et un statut (porté par sa tâche). La dépense réelle se rattache à l'action depuis Budget & dépenses." action={<Link href={`/marketing/priorites?brand=${plan.brandId}`} className="btn-secondary btn-sm">Priorités & actions</Link>}>
        <Card pad={false}>
          <table className="tbl text-[12.5px]">
            <thead><tr><th>Action</th><th>Mois</th><th>Canal</th><th>Responsable</th><th>Échéance</th><th>Priorité</th><th>Statut</th><th className="num">Prévu</th><th className="num">Engagé</th></tr></thead>
            <tbody>
              {actions.slice(0, 40).map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/marketing/priorites/${a.id}`} className="font-medium hover:underline">{a.title}</Link>{a.productName && <div className="text-[11px] text-muted">{a.productName}</div>}</td>
                  <td className="text-muted capitalize">{a.month ? fmtMonth(a.month) : "—"}</td>
                  <td className="text-muted">{a.category ? BUDGET_CATEGORY_LABELS[a.category] : "—"}</td>
                  <td>{a.assigneeName ?? <span className="text-faint">non assignée</span>}</td>
                  <td className="whitespace-nowrap">{a.dueDate ? fmtDateShort(a.dueDate) : "—"}</td>
                  <td><PriorityBadge priority={a.priority} /></td>
                  <td><StatusBadge status={a.status} /></td>
                  <td className="num">{fmtMAD(a.budgetPlanned, { suffix: false })}</td>
                  <td className={`num ${a.budgetPlanned > 0 && a.committed > a.budgetPlanned ? "text-red font-medium" : ""}`}>{a.committed ? fmtMAD(a.committed, { suffix: false }) : "—"}</td>
                </tr>
              ))}
              {actions.length === 0 && <tr><td colSpan={9} className="text-muted text-center py-4">Aucune action rattachée à ce plan.</td></tr>}
            </tbody>
          </table>
        </Card>
        {framing.budget !== null && <Progress value={Math.min(100, chain.committedPct ?? 0)} tone={(chain.committedPct ?? 0) > 90 ? "orange" : "accent"} className="mt-3" />}
      </Section>
    </>
  );
}
