import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { can, clientInScope, requireAccessContext } from "@/lib/access";
import { auditTrail } from "@/lib/audit";
import { getPayment, openInvoices } from "@/lib/gestion/payments";
import { PAYMENT_STATUS_META, nextPaymentStatuses, type PaymentStatus } from "@/lib/gestion/receivables-shared";
import { fmtMoney } from "@/lib/gestion/money";
import { fmtDate, iso, today } from "@/lib/format";
import { PageHeader, Badge, Card, Facts } from "@/components/ui";
import { AuditTrail } from "@/components/gestion/audit-trail";
import { allocateAction, setPaymentStatusAction, unallocateAction } from "../actions";

export const dynamic = "force-dynamic";

const LABEL: Record<PaymentStatus, string> = { PORTEFEUILLE: "", REMIS: "Remis en banque", ENCAISSE: "Encaissé", IMPAYE: "Impayé", ANNULE: "Annuler" };

export default async function PaymentPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const a = await requireAccessContext();
  if (!can(a.perms, "facturation", "view")) redirect(a.home);
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = await getPayment(id);
  if (!p || !(await clientInScope(p.clientId))) notFound();
  const status = p.status as PaymentStatus;
  const canEdit = can(a.perms, "facturation", "edit"), canValidate = can(a.perms, "facturation", "validate");
  const [history, open] = await Promise.all([auditTrail("payment", id), Number(p.unallocated) > 0 && status !== "IMPAYE" && status !== "ANNULE" ? openInvoices({ clientId: p.clientId, simulation: p.isSimulation }) : Promise.resolve([])]);
  const t = iso(today());
  const back = `/gestion/reglements/${id}`;

  return (
    <>
      <PageHeader eyebrow={<Link href="/gestion/reglements" className="hover:underline">Règlements</Link>}
        title={<span className="flex items-center gap-2 flex-wrap"><span className="font-mono">{p.number}</span><Badge tone={PAYMENT_STATUS_META[status].tone}>{PAYMENT_STATUS_META[status].label}</Badge>{p.isSimulation && <Badge tone="purple">simulation</Badge>}</span>}
        subtitle={`${p.mode?.label} de ${fmtMoney(p.amount)} MAD · ${p.client?.name} · reçu le ${fmtDate(p.date)}`} />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">Enregistré.</div>}
      {status === "IMPAYE" && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">Impayé le {fmtDate(p.bouncedAt)}{p.statusReason ? ` : ${p.statusReason}` : ""}. Ses imputations ne soldent plus rien : les factures sont rouvertes.</div>}

      <div className="grid lg:grid-cols-[1fr_340px] gap-4">
        <div className="space-y-4">
          <Card title="Règlement">
            <Facts cols={3} items={[
              { label: "Client", value: <Link href={`/clients/${p.clientId}?tab=infos`} className="hover:underline">{p.client?.legal_name ?? p.client?.name}</Link> },
              { label: "Mode", value: p.mode?.label }, { label: "Référence", value: p.reference ?? "—" }, { label: "Banque", value: p.bank ?? "—" },
              { label: "Échéance", value: p.dueDate ? fmtDate(p.dueDate) : "—" }, { label: "Remis / encaissé", value: [p.depositedAt ? `remis ${fmtDate(p.depositedAt)}` : null, p.collectedAt ? `encaissé ${fmtDate(p.collectedAt)}` : null].filter(Boolean).join(" · ") || "—" },
              { label: "Imputé", value: `${fmtMoney(p.allocated)} MAD` }, { label: "Non imputé", value: `${fmtMoney(p.unallocated)} MAD` },
            ]} />
            {p.notes && <p className="text-[13px] mt-3">{p.notes}</p>}
          </Card>
          <Card title="Imputations">
            {p.allocations.length === 0 ? <p className="text-[13px] text-muted">Pas encore imputé.</p> : (
              <ul className="divide-y divide-line text-[13px]">
                {p.allocations.map((al) => (
                  <li key={al.id} className="py-2 flex items-center gap-2">
                    <Link href={`/gestion/pieces/${al.invoice_id}`} className="font-mono hover:underline">{al.number}</Link>
                    <span className="text-faint">du {fmtDate(al.date)}{al.due_date ? ` · éch. ${fmtDate(al.due_date)}` : ""}</span>
                    <span className="ml-auto tabular-nums font-medium">{fmtMoney(al.amount)} MAD</span>
                    {canEdit && <form action={unallocateAction}><input type="hidden" name="allocationId" value={al.id} /><input type="hidden" name="back" value={back} /><button className="btn-ghost btn-sm text-red" type="submit">Désimputer</button></form>}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && open.length > 0 && (
              <form action={allocateAction} className="mt-3 pt-3 border-t border-line flex gap-2 flex-wrap items-end text-[13px]">
                <input type="hidden" name="paymentId" value={id} />
                <label className="block flex-1 min-w-52"><span className="label block mb-1">Imputer sur</span>
                  <select name="invoiceId" className="select h-9">{open.map((i) => <option key={i.id} value={i.id}>{i.number} — solde {fmtMoney(i.balance)} MAD{i.dueDate ? ` — éch. ${fmtDate(i.dueDate)}` : ""}</option>)}</select></label>
                <label className="block w-36"><span className="label block mb-1">Montant</span><input name="amount" defaultValue={p.unallocated} className="input h-9 text-right" inputMode="decimal" /></label>
                <button className="btn-secondary btn-sm" type="submit">Imputer</button>
              </form>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          {nextPaymentStatuses(status).length > 0 && (canEdit || canValidate) && (
            <Card title="Suivi">
              <div className="space-y-3 text-[13px]">
                {nextPaymentStatuses(status).filter((s) => s === "REMIS" || s === "ENCAISSE").filter(() => canEdit).map((s) => (
                  <form key={s} action={setPaymentStatusAction} className="flex gap-2 items-end">
                    <input type="hidden" name="id" value={id} /><input type="hidden" name="to" value={s} />
                    <label className="block"><span className="label block mb-1">Date</span><input type="date" name="date" defaultValue={t} className="input h-9" /></label>
                    <button className="btn-secondary btn-sm" type="submit">{LABEL[s]}</button>
                  </form>
                ))}
                {canValidate && nextPaymentStatuses(status).filter((s) => s === "IMPAYE" || s === "ANNULE").map((s) => (
                  <form key={s} action={setPaymentStatusAction} className="space-y-1 pt-2 border-t border-line">
                    <input type="hidden" name="id" value={id} /><input type="hidden" name="to" value={s} /><input type="hidden" name="date" value={t} />
                    <input name="reason" className="input h-9" placeholder={s === "IMPAYE" ? "Motif du rejet (provision insuffisante…)" : "Motif de l'annulation"} required />
                    <button className="btn-ghost btn-sm text-red" type="submit">{s === "IMPAYE" ? "Déclarer impayé" : "Annuler le règlement"}</button>
                  </form>
                ))}
              </div>
            </Card>
          )}
          <Card title="Historique"><AuditTrail rows={history} /></Card>
        </div>
      </div>
    </>
  );
}
