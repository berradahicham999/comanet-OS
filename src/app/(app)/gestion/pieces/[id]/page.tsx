import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { pgArray } from "@/lib/sql-array";
import { requireAccessContext, can, clientFilter, clientInScope, hasFlag } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { auditTrail } from "@/lib/audit";
import { documentIssues, getDocument } from "@/lib/gestion/documents";
import { allowedActions, DOC_TYPE_LABELS, STATUS_META, statusLabel, waPhone, type DocStatus, type DocType } from "@/lib/gestion/documents-shared";
import { editorData } from "@/lib/gestion/editor";
import { listCreditReasons, listWarehouses } from "@/lib/gestion/refs";
import { shareToken } from "@/lib/gestion/share";
import { globalDiscountAmount } from "@/lib/gestion/pdf-model";
import { invoiceSettlement, openCredits, openInvoices } from "@/lib/gestion/payments";
import { allocateCreditAction } from "../../reglements/actions";
import { SCALE, parseDecimal } from "@/lib/gestion/money";
import { fmtDate, fmtNum } from "@/lib/format";
import { fmtMoney } from "@/lib/gestion/money";
import { PageHeader, Card, Badge, Facts } from "@/components/ui";
import { DocumentEditor } from "@/components/gestion/document-editor";
import { AuditTrail } from "@/components/gestion/audit-trail";
import {
  renameClientAction, cancelBLAction, creditNoteAction, deleteDraftAction, deliverAction, requestApprovalAction, saveDocumentAction, validateDocumentAction,
} from "../actions";

export const dynamic = "force-dynamic";

const Banner = ({ tone, children }: { tone: "red" | "green" | "orange"; children: React.ReactNode }) => (
  <div className={`mb-4 rounded-2xl px-4 py-3 text-[13px] border ${tone === "red" ? "bg-red-soft border-red/30 text-red" : tone === "green" ? "bg-green-soft border-green/30 text-green" : "bg-orange-soft border-orange/30 text-orange"}`}>{children}</div>
);

export default async function DocumentPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string; blocked?: string; validated?: string; requested?: string }> }) {
  const a = await requireAccessContext();
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const doc = await getDocument(id);
  if (!doc) notFound();
  const type = doc.type as DocType;
  const status = doc.status as DocStatus;
  const permModule = type === "BL" ? "livraisons" : "facturation";
  if (!can(a.perms, permModule, "view") || !(await clientInScope(doc.clientId))) redirect(a.home);
  const canEdit = can(a.perms, permModule, "edit");
  const canValidate = can(a.perms, permModule, "validate");
  const settings = await getSettings();
  const g = settings.gestion;
  const draft = status === "BROUILLON";
  const anyInvoiced = doc.lines.some((l) => (parseDecimal(l.invoicedQty, SCALE.qty) ?? 0n) > 0n);
  const actions = allowedActions(type, status, { anyInvoiced, requireDelivered: g.requireDelivered });
  const label = DOC_TYPE_LABELS[type].one;
  const [issues, history, canOverride] = await Promise.all([draft ? documentIssues(doc) : Promise.resolve([]), auditTrail("sales_document", id), hasFlag("overrideCommercial")]);

  const banners = (
    <>
      {sp.error && <Banner tone="red">{sp.error}</Banner>}
      {sp.done && <Banner tone="green">Enregistré.</Banner>}
      {sp.validated && <Banner tone="green">{label} validé{type === "FACTURE" ? "e" : ""} : {doc.number}{doc.isSimulation ? " (simulation)" : ""}.</Banner>}
      {sp.requested && <Banner tone="green">Demande de déblocage envoyée aux personnes habilitées.</Banner>}
    </>
  );

  const issuesCard = draft && issues.length > 0 && (
    <Card title="Blocages à lever avant validation">
      <ul className="text-[13px] space-y-1 mb-3">{issues.map((i, k) => <li key={k} className="text-orange">• {i.label}</li>)}</ul>
      {canOverride && canValidate ? (
        <form action={validateDocumentAction} className="space-y-2">
          <input type="hidden" name="id" value={id} /><input type="hidden" name="override" value="1" />
          <p className="text-[12px] text-muted">Vous avez le droit de lever ces blocages : la levée est tracée sur la pièce (qui, quand, quoi).</p>
          <button className="btn-primary btn-sm" type="submit">Lever les blocages et valider</button>
        </form>
      ) : doc.approvalRequestedAt ? (
        <p className="text-[12.5px] text-muted">Déblocage demandé le {fmtDate(doc.approvalRequestedAt)} : en attente d&apos;une personne habilitée.</p>
      ) : canEdit ? (
        <form action={requestApprovalAction}><input type="hidden" name="id" value={id} /><button className="btn-secondary btn-sm" type="submit">Demander le déblocage</button></form>
      ) : null}
    </Card>
  );

  /* ---------------- Brouillon : saisie ---------------- */
  if (draft && canEdit) {
    const data = await editorData({ clientIds: await clientFilter() });
    const [reasons, whs] = type === "AVOIR" ? await Promise.all([listCreditReasons(), listWarehouses()]) : [[], []];
    const sourceIds = doc.lines.map((l) => l.sourceLineId).filter((x): x is string => !!x);
    const sources = sourceIds.length ? new Map((await db.execute<{ id: string; left: string }>(sql`
      select id, (quantity - ${type === "AVOIR" ? sql`credited_qty` : sql`invoiced_qty`})::text as left from sales_document_lines where id = any(${pgArray(sourceIds)})`)).rows.map((r) => [r.id, r.left])) : new Map<string, string>();
    return (
      <>
        <PageHeader
          eyebrow={<Link href={`/gestion/pieces?type=${type}`} className="hover:underline">Pièces de vente</Link>}
          title={<span className="flex items-center gap-2 flex-wrap">{label} — brouillon<Badge tone="gray">Brouillon</Badge></span>}
          subtitle={doc.origin ? `Sur la facture ${doc.origin.number}` : doc.sources.length ? `Depuis ${doc.sources.map((s) => s.number).join(", ")}` : undefined}
          actions={<a href={`/gestion/pieces/${id}/pdf`} target="_blank" className="btn-secondary btn-sm">Aperçu PDF</a>}
        />
        {banners}
        {sp.blocked && <Banner tone="orange">Brouillon enregistré, mais la validation est bloquée : voir ci-dessous.</Banner>}
        <div className="space-y-4">
          {issuesCard}
          <DocumentEditor
            type={type}
            data={data}
            action={saveDocumentAction}
            canValidate={canValidate}
            creditReasons={reasons.filter((r) => r.active).map((r) => ({ key: r.key, label: r.label, withReturn: r.withReturn }))}
            warehouses={whs.filter((w) => w.active && w.kind === "INTERNE").map((w) => ({ key: w.key, label: w.label }))}
            initial={{
              id, clientId: doc.clientId, date: doc.date, site: doc.site, salesRepId: doc.salesRepId, paymentModeKey: doc.paymentModeKey,
              globalDiscountPct: doc.globalDiscountPct, notes: doc.notes ?? "", reasonKey: doc.reasonKey, originDocumentId: doc.originDocumentId,
              lines: doc.lines.map((l) => ({
                key: l.id, productId: l.productId, designation: l.designation, ref: l.ref, quantity: String(Number(l.quantity)), freeQuantity: String(Number(l.freeQuantity)),
                unitPriceHt: l.unitPriceHt, discountPct: String(Number(l.discountPct)), taxRate: l.taxRate, sourceLineId: l.sourceLineId, sourceNumber: l.sourceNumber,
                returnWarehouseKey: l.returnWarehouseKey, maxQty: l.sourceLineId ? sources.get(l.sourceLineId) ?? null : null,
              })),
            }}
          />
          <form action={deleteDraftAction} className="flex justify-end">
            <input type="hidden" name="id" value={id} />
            <button className="btn-ghost btn-sm text-red" type="submit">Supprimer ce brouillon</button>
          </form>
        </div>
      </>
    );
  }

  /* ---------------- Pièce validée (ou brouillon en lecture) ---------------- */
  const client = (doc.clientSnapshot ?? {}) as Record<string, string | null>;
  const contact = (await db.execute<{ phone: string | null; email: string | null }>(sql`select phone, email from clients where id = ${doc.clientId}::uuid`)).rows[0];
  let shareUrl: string | null = null;
  if (!draft) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    shareUrl = `${proto}://${host}/d/${await shareToken(id, g.shareLinkDays)}`;
  }
  const message = `${label} ${doc.number} — ${g.company.legalName || "COMANET"}\nMontant TTC : ${fmtMoney(doc.ttc)} MAD\n${shareUrl ?? ""}`;
  const wa = waPhone(contact?.phone);
  const approvals = (doc.approvals ?? []) as { label: string; by: string; at: string }[];
  // Règlements : solde et imputations d'une facture ; crédit restant d'un avoir.
  const settlement = type === "FACTURE" && !draft ? await invoiceSettlement(id) : null;
  const credit = type === "AVOIR" && !draft ? (await openCredits(doc.clientId)).find((x) => x.id === id) ?? null : null;
  const creditTargets = credit ? await openInvoices({ clientId: doc.clientId, simulation: doc.isSimulation }) : [];

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/gestion/pieces?type=${type}`} className="hover:underline">Pièces de vente</Link>}
        title={<span className="flex items-center gap-2 flex-wrap"><span className="font-mono">{doc.number ?? "Brouillon"}</span><Badge tone={STATUS_META[status].tone}>{statusLabel(type, status)}</Badge>{doc.isSimulation && !draft && <Badge tone="purple">simulation</Badge>}</span>}
        subtitle={`${label} du ${fmtDate(doc.date)} · ${doc.client.name}${doc.client.city ? ` · ${doc.client.city}` : ""}`}
        actions={
          <span className="flex gap-2 flex-wrap">
            <a href={`/gestion/pieces/${id}/pdf`} target="_blank" className="btn-secondary btn-sm">Voir le PDF</a>
            <a href={`/gestion/pieces/${id}/pdf?download=1`} className="btn-secondary btn-sm">Télécharger</a>
          </span>
        }
      />
      {banners}
      {sp.blocked && <Banner tone="orange">Validation bloquée : voir ci-dessous.</Banner>}
      {doc.isSimulation && !draft && <Banner tone="orange">Pièce de simulation (période parallèle) : numéro hors série légale, aucun effet sur les ventes. Le stock, lui, a bougé comme pour une vraie pièce.</Banner>}

      <div className="grid lg:grid-cols-[1fr_340px] gap-4">
        <div className="space-y-4">
          {issuesCard}
          <Card title="Client et conditions">
            <Facts cols={3} items={[
              { label: "Client", value: <Link href={`/clients/${doc.clientId}?tab=infos`} className="hover:underline">{client.legalName ?? doc.client.legalName ?? doc.client.name}</Link> },
              { label: "ICE", value: client.ice ?? "—" },
              { label: "Code client", value: client.accountCode ?? doc.client.accountCode ?? "—" },
              { label: "Site", value: doc.site },
              { label: "Commercial", value: doc.salesRepName ?? "—" },
              ...(type === "FACTURE" ? [{ label: "Échéance", value: doc.dueDate ? `${fmtDate(doc.dueDate)} (${doc.paymentDays} j)` : "—" }] : []),
              ...(type === "AVOIR" && doc.origin ? [{ label: "Facture d'origine", value: <Link href={`/gestion/pieces/${doc.origin.id}`} className="font-mono hover:underline">{doc.origin.number}</Link> }] : []),
            ]} />
          </Card>

          <Card title="Lignes" pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-faint border-b border-line">
                  <th className="px-3 py-2 font-medium">Article</th><th className="px-3 py-2 font-medium text-right">Qté</th><th className="px-3 py-2 font-medium text-right">UG</th>
                  <th className="px-3 py-2 font-medium text-right">P.U. HT</th><th className="px-3 py-2 font-medium text-right">Remise</th><th className="px-3 py-2 font-medium text-right">Net HT</th>
                  {type === "BL" && <th className="px-3 py-2 font-medium text-right">Facturé</th>}
                </tr></thead>
                <tbody>
                  {doc.lines.map((l) => (
                    <tr key={l.id} className="border-b border-line last:border-0 align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">{l.designation}</div>
                        <div className="text-faint text-[11px]">{[l.ref, l.sourceNumber ? `BL ${l.sourceNumber}` : null, ...(l.lotAllocations ?? []).map((x) => `lot ${x.lotNumber}${x.expiryDate ? ` (${fmtDate(x.expiryDate)})` : ""} × ${fmtNum(Number(x.qty))}`)].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(Number(l.quantity), 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{Number(l.freeQuantity) ? fmtNum(Number(l.freeQuantity)) : ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.unitPriceHt)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{Number(l.discountPct) ? `${Number(l.discountPct).toLocaleString("fr-FR")} %` : ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtMoney(l.netHt)}</td>
                      {type === "BL" && <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtNum(Number(l.invoicedQty))} / {fmtNum(Number(l.quantity))}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line px-4 py-3 text-[13px] tabular-nums space-y-0.5 ml-auto max-w-xs">
              <div className="flex justify-between"><span className="text-muted">Total HT</span><span>{fmtMoney(doc.grossHt)}</span></div>
              {Number(doc.globalDiscountPct) > 0 && <div className="flex justify-between"><span className="text-muted">Remise {Number(doc.globalDiscountPct).toLocaleString("fr-FR")} %</span><span>-{globalDiscountAmount(doc.grossHt, doc.netHt)}</span></div>}
              <div className="flex justify-between font-medium"><span>Net HT</span><span>{fmtMoney(doc.netHt)}</span></div>
              {doc.vatBreakdown.map((v) => <div key={v.rate} className="flex justify-between"><span className="text-muted">TVA {Number(v.rate).toLocaleString("fr-FR")} %</span><span>{fmtMoney(v.vat)}</span></div>)}
              <div className="flex justify-between font-semibold text-[15px] pt-1 border-t border-line"><span>Total TTC</span><span>{fmtMoney(doc.ttc)} MAD</span></div>
              {doc.amountInWords && <div className="text-[11.5px] text-muted pt-1">{doc.amountInWords}</div>}
            </div>
          </Card>
          {doc.notes && <Card title="Note"><p className="text-[13px] whitespace-pre-wrap">{doc.notes}</p></Card>}
        </div>

        <div className="space-y-4">
          {!draft && can(a.perms, type === "BL" ? "livraisons" : "facturation", "validate") && (
            <Card title="Nom du client imprimé">
              <form action={renameClientAction} className="space-y-2 text-[13px]">
                <input type="hidden" name="id" value={id} />
                <input name="name" defaultValue={client.legalName ?? doc.client.legalName ?? doc.client.name} className="input h-9" required />
                <input name="reason" className="input h-9" placeholder="Motif de la correction *" required />
                <button className="btn-secondary btn-sm" type="submit">Corriger le nom</button>
                <p className="text-[11.5px] text-faint">Seul le nom imprimé change : client, ICE, montants et numéro restent. Le PDF est régénéré ; l&apos;ancien reste archivé et la correction figure dans l&apos;historique.</p>
              </form>
            </Card>
          )}
          {!draft && status !== "ANNULE" && (
            <Card title="Envoyer au client">
              <div className="space-y-2 text-[13px]">
                <div className="flex gap-2 flex-wrap">
                  <a className="btn-primary btn-sm" target="_blank" rel="noreferrer" href={`https://wa.me/${wa ?? ""}?text=${encodeURIComponent(message)}`}>WhatsApp{wa ? "" : " (choisir le contact)"}</a>
                  <a className="btn-secondary btn-sm" href={`mailto:${contact?.email ?? ""}?subject=${encodeURIComponent(`${label} ${doc.number}`)}&body=${encodeURIComponent(message)}`}>E-mail</a>
                </div>
                <label className="block"><span className="label block mb-1">Lien public (valable {g.shareLinkDays} jours)</span><input readOnly className="input h-9 text-[12px]" value={shareUrl ?? ""} /></label>
                <p className="text-[11.5px] text-faint">Le lien ouvre le PDF figé de cette pièce, sans compte. Il ne donne accès à rien d&apos;autre.</p>
              </div>
            </Card>
          )}

          {(actions.deliver || actions.invoice || actions.credit || actions.cancel || (draft && canValidate)) && (
            <Card title="Actions">
              <div className="space-y-3 text-[13px]">
                {draft && canValidate && issues.length === 0 && (
                  <form action={validateDocumentAction}><input type="hidden" name="id" value={id} /><button className="btn-primary btn-sm" type="submit">Valider</button></form>
                )}
                {actions.deliver && can(a.perms, "livraisons", "edit") && (
                  <form action={deliverAction}><input type="hidden" name="id" value={id} /><button className="btn-secondary btn-sm" type="submit">Marquer livré</button></form>
                )}
                {actions.invoice && can(a.perms, "facturation", "create") && (
                  <Link href={`/gestion/pieces/facturer?client=${doc.clientId}`} className="btn-primary btn-sm inline-flex">Facturer ce client</Link>
                )}
                {actions.credit && can(a.perms, "facturation", "create") && (
                  <form action={creditNoteAction}><input type="hidden" name="id" value={id} /><button className="btn-secondary btn-sm" type="submit">Faire un avoir</button></form>
                )}
                {actions.cancel && can(a.perms, "livraisons", "validate") && (
                  <form action={cancelBLAction} className="space-y-2 pt-3 border-t border-line">
                    <input type="hidden" name="id" value={id} />
                    <p className="text-muted">Annuler ce BL remet le stock en place par des mouvements inverses ; le numéro reste pris et visible.</p>
                    <input name="reason" className="input h-9" placeholder="Motif de l'annulation *" required />
                    <button className="btn-secondary btn-sm text-red" type="submit">Annuler le BL</button>
                  </form>
                )}
              </div>
            </Card>
          )}

          {settlement && (
            <Card title="Règlement">
              <div className="text-[13px] space-y-2">
                <div className="flex justify-between"><span className="text-muted">Solde</span><span className={`font-semibold tabular-nums ${Number(settlement.balance) > 0 ? "" : "text-green"}`}>{Number(settlement.balance) > 0 ? `${fmtMoney(settlement.balance)} MAD` : "Soldée"}</span></div>
                {Number(settlement.reprisePaid) > 0 && <div className="flex justify-between text-muted"><span>Déjà réglé dans Sage</span><span className="tabular-nums">{fmtMoney(settlement.reprisePaid)}</span></div>}
                {settlement.allocations.length > 0 && (
                  <ul className="divide-y divide-line">
                    {settlement.allocations.map((al) => (
                      <li key={al.id} className="py-1.5 flex gap-2 items-center">
                        {al.payment_id ? <Link href={`/gestion/reglements/${al.payment_id}`} className="font-mono hover:underline">{al.payment_number}</Link> : <Link href={`/gestion/pieces/${al.credit_id}`} className="font-mono hover:underline">{al.credit_number}</Link>}
                        <span className="text-faint text-[12px]">{al.mode ?? "avoir"}{al.payment_status && al.payment_status !== "ENCAISSE" ? ` · ${al.payment_status === "IMPAYE" ? "impayé" : al.payment_status === "ANNULE" ? "annulé" : "pas encore encaissé"}` : ""}</span>
                        <span className={`ml-auto tabular-nums ${al.payment_status === "IMPAYE" || al.payment_status === "ANNULE" ? "line-through text-faint" : ""}`}>{fmtMoney(al.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {Number(settlement.balance) > 0 && can(a.perms, "facturation", "create") && <Link href={`/gestion/reglements/nouveau?client=${doc.clientId}`} className="btn-secondary btn-sm inline-flex">Encaisser</Link>}
              </div>
            </Card>
          )}
          {credit && Number(credit.left) > 0 && (
            <Card title="Crédit client restant">
              <div className="text-[13px] space-y-2">
                <p><b className="tabular-nums">{fmtMoney(credit.left)} MAD</b> de cet avoir ne sont imputés sur aucune facture.</p>
                {creditTargets.length > 0 && can(a.perms, "facturation", "edit") ? (
                  <form action={allocateCreditAction} className="space-y-2">
                    <input type="hidden" name="creditId" value={id} />
                    <select name="invoiceId" className="select h-9">{creditTargets.map((i) => <option key={i.id} value={i.id}>{i.number} — solde {fmtMoney(i.balance)} MAD</option>)}</select>
                    <div className="flex gap-2"><input name="amount" defaultValue={credit.left} className="input h-9 text-right" inputMode="decimal" /><button className="btn-secondary btn-sm" type="submit">Imputer</button></div>
                  </form>
                ) : <p className="text-muted text-[12px]">Aucune autre facture ouverte de ce client : le crédit reste disponible (remboursement ou prochaine facture).</p>}
              </div>
            </Card>
          )}
          {(doc.children.length > 0 || doc.sources.length > 0) && (
            <Card title="Pièces liées">
              <ul className="text-[13px] space-y-1">
                {doc.sources.map((s) => <li key={s.id}><Link href={`/gestion/pieces/${s.id}`} className="font-mono hover:underline">{s.number}</Link> <span className="text-faint">· BL du {fmtDate(s.date)}</span></li>)}
                {doc.children.map((c) => <li key={c.id}><Link href={`/gestion/pieces/${c.id}`} className="font-mono hover:underline">{c.number ?? "Brouillon"}</Link> <span className="text-faint">· {DOC_TYPE_LABELS[c.type as DocType]?.one} · {fmtMoney(c.ttc)} MAD</span></li>)}
              </ul>
            </Card>
          )}

          {approvals.length > 0 && (
            <Card title="Blocages levés">
              <ul className="text-[12.5px] space-y-1">{approvals.map((x, k) => <li key={k}>{x.label} <span className="text-faint">— {x.by}, {fmtDate(x.at)}</span></li>)}</ul>
            </Card>
          )}
          {status === "ANNULE" && doc.cancelReason && <Card title="Annulation"><p className="text-[13px]">{doc.cancelReason}</p><p className="text-[12px] text-faint">{fmtDate(doc.cancelledAt)}</p></Card>}
          <Card title="Historique"><AuditTrail rows={history} /></Card>
        </div>
      </div>
    </>
  );
}
