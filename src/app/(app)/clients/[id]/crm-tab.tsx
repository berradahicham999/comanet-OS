import Link from "next/link";
import { canDo } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { fmtDate, fmtMAD, iso, today } from "@/lib/format";
import { listBrands } from "@/lib/users";
import { Card, Badge, Section, Facts } from "@/components/ui";
import { crmViewer, canSeePositions } from "@/lib/crm/access";
import { clientCrmSummary, assignableUsers } from "@/lib/crm/portfolio";
import { clientObjectives, headlineObjective } from "@/lib/crm/objectives";
import { missingAssortment, clientReceivables } from "@/lib/crm/intelligence";
import { clientTimeline, TIMELINE_KIND_LABELS, type TimelineKind } from "@/lib/crm/timeline";
import { monthOf, monthLabel, OBJECTIVE_VERDICT_LABELS } from "@/lib/crm/portfolio-shared";
import { orderHref } from "@/lib/crm/visits-shared";
import { saveFrequencyAction, assignManagerAction, saveObjectiveAction, deleteObjectiveAction } from "../crm-actions";
import { planVisitAction } from "../tournee/actions";

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
/** Classes écrites en entier : Tailwind ne génère pas une classe composée à l'exécution. */
const DOT: Record<string, string> = { green: "bg-green", orange: "bg-orange", red: "bg-red", blue: "bg-blue", gray: "bg-faint", accent: "bg-accent", purple: "bg-purple" };

/**
 * Onglet « Suivi commercial » de la fiche client : commercial attitré, fréquence et visites du mois, objectifs
 * (CA HT sell-in), encours, assortiment manquant et chronologie de toutes les interactions.
 */
export async function ClientCrmTab({ clientId, sp }: { clientId: string; sp: { kinds?: string; error?: string; done?: string } }) {
  const settings = await getSettings();
  const t = iso(today());
  const month = monthOf(t);
  const year = Number(t.slice(0, 4));
  const viewer = await crmViewer();
  const [summary, objectives, canEdit, canAssign, canCreate, money, brands] = await Promise.all([
    clientCrmSummary(clientId, month, t, settings),
    clientObjectives(clientId),
    canDo("clients", "edit"),
    canDo("clients", "validate"),
    canDo("clients", "create"),
    Promise.all([canDo("reglements", "view"), canDo("facturation", "view")]).then(([a, b]) => a || b),
    listBrands(),
  ]);
  const kinds = (sp.kinds ?? "").split(",").filter((k): k is TimelineKind => k in TIMELINE_KIND_LABELS);
  const [users, receivables, missing, timeline] = await Promise.all([
    canAssign ? assignableUsers() : Promise.resolve([]),
    money ? clientReceivables(clientId) : Promise.resolve(null),
    missingAssortment(clientId, settings),
    clientTimeline(clientId, { kinds, showVerification: !!viewer && !!summary && canSeePositions(viewer, summary.managerId) }),
  ]);
  const h = headlineObjective(summary?.objective);
  const st = summary?.objective;

  return (
    <>
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">Enregistré.</div>}

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Card title={`Visites — ${monthLabel(month)}`}>
          {summary ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="kpi">{summary.doneThisMonth}{summary.frequency ? <span className="text-[16px] text-muted"> / {summary.frequency}</span> : null}</span>
                {summary.frequency === null ? <Badge tone="gray">fréquence non définie</Badge> : summary.frequency === 0 ? <Badge tone="gray">pas de visite prévue</Badge> : summary.remaining === 0 ? <Badge tone="green">fait</Badge> : <Badge tone="blue">{summary.remaining} à faire</Badge>}
              </div>
              <Facts items={[
                { label: "Commercial attitré", value: summary.managerName ?? "—" },
                { label: "Dernière visite", value: summary.lastVisit ? fmtDate(summary.lastVisit) : "jamais" },
                { label: "Prochaine visite", value: summary.nextPlanned ? fmtDate(summary.nextPlanned) : "—" },
                { label: "Appels / messages du mois", value: String(summary.contactsThisMonth) },
              ]} />
            </>
          ) : <div className="text-[13px] text-muted">Client archivé : plus de suivi de visites.</div>}
          {canCreate && summary && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/clients/tournee?client=${clientId}`} className="btn-primary btn-sm">Démarrer une visite</Link>
              <Link href={`/clients/tournee/contact?client=${clientId}`} className="btn-secondary btn-sm">Noter un appel</Link>
              <Link href={orderHref(clientId)} className="btn-secondary btn-sm">Commande</Link>
            </div>
          )}
        </Card>

        <Card title="Objectif du mois (CA HT sell-in)">
          {st && h ? (
            <>
              <div className="kpi">{fmtMAD(h.realized, { compact: true })} <span className="text-[16px] text-muted">/ {fmtMAD(h.target, { compact: true })}</span></div>
              <div className="mt-1 flex items-center gap-2"><Badge tone={h.verdict === "ATTEINT" ? "green" : h.verdict === "EN_RETARD" ? "red" : "gray"}>{OBJECTIVE_VERDICT_LABELS[h.verdict]}</Badge>{h.pct !== null && <span className="text-[12px] text-muted">{Math.round(h.pct)} %</span>}</div>
              {st.brands.length > 0 && (
                <ul className="mt-2 text-[12.5px] space-y-0.5">
                  {st.brands.map((b) => <li key={b.brandId} className="flex justify-between gap-2"><span>{b.brandName}</span><span className="text-muted">{fmtMAD(b.realized, { compact: true })} / {fmtMAD(b.target, { compact: true })} · {OBJECTIVE_VERDICT_LABELS[b.verdict]}</span></li>)}
                </ul>
              )}
              {(st.global?.source === "ANNUEL" || st.brands.some((b) => b.source === "ANNUEL")) && <div className="mt-1 text-[11.5px] text-faint">Objectif annuel ramené au mois (÷ 12).</div>}
            </>
          ) : <div className="text-[13px] text-muted">Aucun objectif défini pour ce mois.{canEdit ? " Saisissez-en un ci-dessous." : ""}</div>}
        </Card>

        <Card title="Encours et règlements">
          {receivables ? (
            Number(receivables.outstanding) > 0 ? (
              <>
                <div className="kpi">{fmtMAD(Number(receivables.outstanding), { compact: true })}</div>
                <div className="mt-1 text-[12.5px]">{Number(receivables.overdue) > 0 ? <span className="text-red">dont {fmtMAD(Number(receivables.overdue))} échu{receivables.oldestDaysLate ? ` (jusqu'à ${receivables.oldestDaysLate} j de retard)` : ""}</span> : <span className="text-green">rien d&apos;échu</span>} · {receivables.invoices} facture(s) ouverte(s)</div>
                {receivables.lastPayment && <div className="mt-1 text-[12px] text-muted">Dernier règlement : {fmtDate(receivables.lastPayment.date)} · {fmtMAD(receivables.lastPayment.amount)} · {receivables.lastPayment.mode}</div>}
              </>
            ) : <div className="text-[13px] text-muted">Aucune facture ouverte.{receivables.lastPayment ? ` Dernier règlement le ${fmtDate(receivables.lastPayment.date)}.` : ""}</div>
          ) : <div className="text-[13px] text-muted">Réservé à qui voit les règlements ou les factures.</div>}
          <div className="mt-2 text-[11.5px] text-faint">Factures COMANET OS réelles validées (hors simulation) ; même solde que le module Règlements.</div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Card title="Suivi">
          <div className="space-y-3 text-[13px]">
            {canAssign ? (
              <form action={assignManagerAction} className="flex items-end gap-2">
                <input type="hidden" name="clientId" value={clientId} />
                <label className="block flex-1"><span className="label block mb-1">Commercial attitré</span>
                  <select name="userId" defaultValue={summary?.managerId ?? ""} className="select h-9"><option value="">— aucun —</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                </label>
                <button className="btn-secondary btn-sm h-9">Enregistrer</button>
              </form>
            ) : <div><span className="label">Commercial attitré</span> {summary?.managerName ?? "—"}</div>}
            {canEdit ? (
              <form action={saveFrequencyAction} className="flex items-end gap-2">
                <input type="hidden" name="clientId" value={clientId} />
                <label className="block flex-1"><span className="label block mb-1">Fréquence de visite (par mois)</span><input name="frequency" type="number" min={0} max={31} defaultValue={summary?.frequency ?? ""} placeholder="non définie" className="input h-9" /></label>
                <button className="btn-secondary btn-sm h-9">Enregistrer</button>
              </form>
            ) : <div><span className="label">Fréquence</span> {summary?.frequency ?? "non définie"}</div>}
            <p className="text-[11.5px] text-faint">Vide = non définie (hors barre de progression). 0 = ne pas visiter. Affectation en masse : <Link href="/clients/portefeuilles" className="text-accent">Portefeuilles</Link>.</p>
            {canCreate && summary && (
              <form action={planVisitAction} className="flex flex-wrap items-end gap-2 pt-1 border-t border-line">
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="back" value={`/clients/${clientId}?tab=crm`} />
                <label className="block"><span className="label block mb-1">Planifier une visite le</span><input type="date" name="date" min={t} defaultValue={t} required className="input h-9" /></label>
                {canAssign && <label className="block"><span className="label block mb-1">Pour</span><select name="userId" defaultValue={summary.managerId ?? ""} className="select h-9 w-40"><option value="">moi</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
                <input name="objective" placeholder="Objectif (facultatif)" className="input h-9 w-48" />
                <button className="btn-secondary btn-sm h-9">Planifier</button>
              </form>
            )}
          </div>
        </Card>

        <Card title="Objectifs du client">
          {objectives.length ? (
            <div className="table-wrap -mx-1">
              <table className="tbl">
                <thead><tr><th>Période</th><th>Marque</th><th className="num">CA HT</th><th className="num">Unités</th>{canEdit && <th />}</tr></thead>
                <tbody>
                  {objectives.map((o) => (
                    <tr key={o.id}>
                      <td>{o.month ? `${MONTHS[o.month - 1]} ${o.year}` : `${o.year} (annuel)`}</td>
                      <td className="text-muted">{o.brandName ?? "toutes"}</td>
                      <td className="num">{fmtMAD(o.amount)}</td>
                      <td className="num">{o.units ?? "—"}</td>
                      {canEdit && <td><form action={deleteObjectiveAction}><input type="hidden" name="clientId" value={clientId} /><input type="hidden" name="objectiveId" value={o.id} /><button className="text-[12px] text-red">Supprimer</button></form></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="text-[13px] text-muted">Aucun objectif défini pour ce client.</div>}
          {canEdit && (
            <form action={saveObjectiveAction} className="mt-3 grid grid-cols-2 gap-2 text-[13px] items-end">
              <input type="hidden" name="clientId" value={clientId} />
              <label className="block"><span className="label block mb-1">Année</span><input name="year" type="number" defaultValue={year} min={2020} max={2100} className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">Mois</span><select name="month" defaultValue={String(Number(t.slice(5, 7)))} className="select h-9"><option value="">Annuel</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
              <label className="block"><span className="label block mb-1">Marque</span><select name="brandId" defaultValue="" className="select h-9"><option value="">Toutes</option>{brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label className="block"><span className="label block mb-1">CA HT (MAD)</span><input name="amount" required inputMode="decimal" className="input h-9" /></label>
              <button className="btn-secondary btn-sm h-9 col-span-2">Enregistrer l&apos;objectif</button>
            </form>
          )}
          <p className="mt-2 text-[11.5px] text-faint">Réalisé = sell-in HT du client (toutes sources), la même mesure que le module Ventes. Un objectif annuel compte pour un douzième chaque mois.</p>
        </Card>
      </div>

      <Section title="Assortiment manquant" description={missing.items.length ? `Produits achetés par des clients comparables et pas par celui-ci sur 12 mois — corrélation observée (${missing.basis}).` : "Produits achetés par des clients comparables et pas par celui-ci sur 12 mois — corrélation observée."}>
        {missing.items.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Produit</th><th>Marque</th><th className="num">Pairs acheteurs</th><th className="num">Part</th></tr></thead>
              <tbody>{missing.items.map((m) => <tr key={m.productId}><td><Link href={`/produits/${m.productId}`} className="font-medium hover:underline">{m.name}</Link></td><td className="text-muted">{m.brand ?? "—"}</td><td className="num">{m.buyers} / {missing.peers}</td><td className="num">{Math.round(m.share * 100)} %</td></tr>)}</tbody>
            </table>
          </div>
        ) : <Card><div className="text-[13px] text-muted">Rien à proposer : {missing.peers < settings.crm.assortmentMinPeers ? `trop peu de clients comparables pour conclure (${missing.peers} trouvé(s), minimum ${settings.crm.assortmentMinPeers} — même type, même ville ou secteur, CA 12 mois de la moitié au double).` : "ce client achète déjà ce que ses pairs achètent le plus."}</div></Card>}
      </Section>

      <Section title="Chronologie" description="Visites, appels, commandes et pièces, ventes importées, règlements, relevés, animations, tâches."
        action={
          <form className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <input type="hidden" name="tab" value="crm" />
            <select name="kinds" defaultValue={sp.kinds ?? ""} className="select h-8"><option value="">Tout</option>{Object.entries(TIMELINE_KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <button className="btn-secondary btn-sm h-8">Filtrer</button>
          </form>
        }>
        {timeline.length ? (
          <ol className="relative border-l border-line ml-2 space-y-3">
            {timeline.map((it, i) => (
              <li key={i} className="ml-4">
                <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${DOT[it.tone]}`} />
                <div className="text-[12px] text-muted">{fmtDate(it.date)}{it.who ? ` · ${it.who}` : ""} · {TIMELINE_KIND_LABELS[it.kind]}</div>
                <div className="text-[13.5px] font-medium">{it.href ? <Link href={it.href} className="hover:underline">{it.title}</Link> : it.title}</div>
                {it.detail && <div className="text-[13px] text-ink-2">{it.detail}</div>}
              </li>
            ))}
          </ol>
        ) : <Card><div className="text-[13px] text-muted">Aucune interaction enregistrée.</div></Card>}
      </Section>
    </>
  );
}
