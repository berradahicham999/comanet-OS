import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { pgArray } from "@/lib/sql-array";
import { requireAccessContext, can } from "@/lib/access";
import { auditTrail } from "@/lib/audit";
import { listAssets } from "@/lib/content/assets";
import { getPurchase } from "@/lib/gestion/purchases";
import { purchaseEditorData } from "@/lib/gestion/purchase-editor";
import { PURCHASE_STATUS_META, PURCHASE_TYPE_LABELS, purchaseActions, purchaseStatusLabel, type PurchaseStatus, type PurchaseType } from "@/lib/gestion/purchases-shared";
import { SCALE, fmtMoney, formatScaled, parseDecimal } from "@/lib/gestion/money";
import { fmtDate, fmtNum } from "@/lib/format";
import { PageHeader, Card, Badge, Facts } from "@/components/ui";
import { PurchaseEditor } from "@/components/gestion/purchase-editor";
import { AuditTrail } from "@/components/gestion/audit-trail";
import {
  attachSupplierFileAction, cancelOrderAction, closeOrderAction, deletePurchaseAction, receiveOrderAction, returnReceptionAction, savePurchaseAction, validatePurchaseAction,
} from "../actions";

export const dynamic = "force-dynamic";

const Banner = ({ tone, children }: { tone: "red" | "green" | "orange"; children: React.ReactNode }) => (
  <div className={`mb-4 rounded-2xl px-4 py-3 text-[13px] border ${tone === "red" ? "bg-red-soft border-red/30 text-red" : tone === "green" ? "bg-green-soft border-green/30 text-green" : "bg-orange-soft border-orange/30 text-orange"}`}>{children}</div>
);
const add = (a: string, b: string) => formatScaled((parseDecimal(a, SCALE.money) ?? 0n) + (parseDecimal(b, SCALE.money) ?? 0n), SCALE.money);

export default async function PurchasePage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const a = await requireAccessContext();
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await getPurchase(id);
  if (!d) notFound();
  const type = d.type as PurchaseType;
  const status = d.status as PurchaseStatus;
  const modules = type === "RECEPTION" || type === "RETOUR" ? (["achats", "stock"] as const) : (["achats"] as const);
  const allowed = (action: "view" | "create" | "edit" | "validate") => modules.some((m) => can(a.perms, m, action));
  if (!allowed("view")) redirect(a.home);
  const canAchats = (action: "view" | "create" | "edit" | "validate") => can(a.perms, "achats", action);
  const label = PURCHASE_TYPE_LABELS[type].one;
  const draft = status === "BROUILLON";
  const anyReceived = d.lines.some((l) => (parseDecimal(l.receivedQty, SCALE.qty) ?? 0n) > 0n);
  const actions = purchaseActions(type, status, { anyReceived });
  const [history, files] = await Promise.all([auditTrail("purchase_document", id), listAssets({ purchaseDocumentId: id })]);
  const supplierFiles = files.filter((f) => f.kind === "FACTURE");

  const banners = (
    <>
      {sp.error && <Banner tone="red">{sp.error}</Banner>}
      {sp.done && <Banner tone="green">Enregistré.</Banner>}
    </>
  );

  if (draft && allowed("edit")) {
    const data = await purchaseEditorData();
    const sourceIds = d.lines.map((l) => l.sourceLineId).filter((x): x is string => !!x);
    const counter = type === "RECEPTION" ? sql`received_qty` : type === "FACTURE" ? sql`invoiced_qty` : sql`returned_qty`;
    const left = sourceIds.length ? new Map((await db.execute<{ id: string; left: string }>(sql`
      select id, (quantity - ${counter})::text as left from purchase_document_lines where id = any(${pgArray(sourceIds)})`)).rows.map((r) => [r.id, r.left])) : new Map<string, string>();
    return (
      <>
        <PageHeader
          eyebrow={<Link href={`/gestion/achats?type=${type}`} className="hover:underline">Achats</Link>}
          title={<span className="flex items-center gap-2 flex-wrap">{label} — brouillon<Badge tone="gray">Brouillon</Badge></span>}
          subtitle={[d.supplier.legalName, d.origin ? `depuis ${d.origin.number}` : null, d.sources.length ? `depuis ${d.sources.map((s) => s.number).join(", ")}` : null].filter(Boolean).join(" · ")}
          actions={type !== "FACTURE" ? <a href={`/gestion/achats/${id}/pdf`} target="_blank" className="btn-secondary btn-sm">Aperçu PDF</a> : undefined}
        />
        {banners}
        <div className="space-y-4">
          <PurchaseEditor
            type={type}
            data={data}
            action={savePurchaseAction}
            canValidate={allowed("validate")}
            initial={{
              id, supplierId: d.supplierId, date: d.date, expectedDate: d.expectedDate ?? "", supplierRef: d.supplierRef ?? "", currency: d.currency,
              exchangeRate: String(Number(d.exchangeRate)), warehouseKey: d.warehouseKey, originDocumentId: d.originDocumentId, notes: d.notes ?? "",
              lines: d.lines.map((l) => ({
                key: l.id, productId: l.productId, inventoryItemId: l.inventoryItemId, designation: l.designation, ref: l.ref, quantity: String(Number(l.quantity)),
                unitPrice: String(Number(l.unitPrice)), discountPct: String(Number(l.discountPct)), taxRate: l.taxRate, lotNumber: l.lotNumber ?? "", expiryDate: l.expiryDate ?? "",
                trackLots: l.trackLots, sourceLineId: l.sourceLineId, maxQty: l.sourceLineId ? left.get(l.sourceLineId) ?? null : null,
              })),
              landedCosts: d.landed.map((c) => ({ key: c.id, label: c.label, amountMad: String(Number(c.amountMad)), allocation: c.allocation as "VALEUR" | "QUANTITE", ref: c.ref ?? "" })),
            }}
          />
          <form action={deletePurchaseAction} className="flex justify-end"><input type="hidden" name="id" value={id} /><button className="btn-ghost btn-sm text-red" type="submit">Supprimer ce brouillon</button></form>
        </div>
      </>
    );
  }

  const gaps = (d.gaps ?? []) as { kind: string; label: string }[];
  const foreign = d.currency !== "MAD";
  const mailBody = `Bonjour,\n\nVeuillez trouver ci-joint notre ${label.toLowerCase()} ${d.number}${d.expectedDate ? `, livraison souhaitée le ${fmtDate(d.expectedDate)}` : ""}.\n\nCordialement,`;

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/gestion/achats?type=${type}`} className="hover:underline">Achats</Link>}
        title={<span className="flex items-center gap-2 flex-wrap"><span className="font-mono">{d.number ?? "Brouillon"}</span><Badge tone={PURCHASE_STATUS_META[status].tone}>{purchaseStatusLabel(type, status)}</Badge></span>}
        subtitle={`${label} du ${fmtDate(d.date)} · ${d.supplier.legalName}${d.supplierRef ? ` · réf. ${d.supplierRef}` : ""}`}
        actions={type !== "FACTURE" ? (
          <span className="flex gap-2 flex-wrap">
            <a href={`/gestion/achats/${id}/pdf`} target="_blank" className="btn-secondary btn-sm">Voir le PDF</a>
            {type === "COMMANDE" && !draft && <a href={`mailto:${d.supplier.email ?? ""}?subject=${encodeURIComponent(`${label} ${d.number}`)}&body=${encodeURIComponent(mailBody)}`} className="btn-secondary btn-sm">E-mail au fournisseur</a>}
          </span>
        ) : undefined}
      />
      {banners}
      {gaps.length > 0 && (
        <Banner tone="orange">
          <div className="font-medium mb-1">Écarts avec les réceptions (facture enregistrée telle qu&apos;émise par le fournisseur) :</div>
          <ul className="space-y-0.5">{gaps.map((x, i) => <li key={i}>• {x.label}</li>)}</ul>
          <div className="mt-1 text-[12px]">Le coût de revient reste celui de la réception. Un écart se règle avec le fournisseur (avoir, complément) — il n&apos;est jamais corrigé en silence.</div>
        </Banner>
      )}

      <div className="grid lg:grid-cols-[1fr_340px] gap-4">
        <div className="space-y-4">
          <Card title="Conditions">
            <Facts cols={3} items={[
              { label: "Fournisseur", value: <Link href={`/gestion/fournisseurs/${d.supplierId}`} className="hover:underline">{d.supplier.legalName}</Link> },
              { label: "Devise", value: foreign ? `${d.currency} · 1 ${d.currency} = ${Number(d.exchangeRate).toLocaleString("fr-FR", { maximumFractionDigits: 6 })} MAD` : "MAD" },
              ...(type === "RECEPTION" ? [{ label: "Dépôt", value: d.warehouseKey }] : []),
              ...(type === "COMMANDE" ? [{ label: "Livraison attendue", value: d.expectedDate ? fmtDate(d.expectedDate) : "—" }] : []),
              ...(type === "FACTURE" ? [{ label: "Échéance", value: d.dueDate ? fmtDate(d.dueDate) : "—" }] : []),
              ...(d.origin ? [{ label: "Pièce d'origine", value: <Link href={`/gestion/achats/${d.origin.id}`} className="font-mono hover:underline">{d.origin.number}</Link> }] : []),
              ...(d.closeReason ? [{ label: status === "ANNULE" ? "Motif d'annulation" : "Motif de solde", value: d.closeReason }] : []),
            ]} />
          </Card>

          <Card title="Lignes" pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-faint border-b border-line">
                  <th className="px-3 py-2 font-medium">Article</th><th className="px-3 py-2 font-medium text-right">Qté</th>
                  {type === "COMMANDE" && <th className="px-3 py-2 font-medium text-right">Reçu</th>}
                  {type === "RECEPTION" && <th className="px-3 py-2 font-medium text-right">Facturé / retourné</th>}
                  <th className="px-3 py-2 font-medium text-right">P.U. {d.currency}</th><th className="px-3 py-2 font-medium text-right">Remise</th>
                  <th className="px-3 py-2 font-medium text-right">HT {foreign ? d.currency : "MAD"}</th>
                  {foreign && <th className="px-3 py-2 font-medium text-right">HT MAD</th>}
                  {type === "RECEPTION" && <th className="px-3 py-2 font-medium text-right">Frais</th>}
                  {type === "RECEPTION" && <th className="px-3 py-2 font-medium text-right">Revient / u</th>}
                </tr></thead>
                <tbody>
                  {d.lines.map((l) => (
                    <tr key={l.id} className="border-b border-line last:border-0 align-top">
                      <td className="px-3 py-2"><div className="font-medium">{l.designation}</div>
                        <div className="text-faint text-[11px]">{[l.ref, l.inventoryItemId ? "matériel marketing" : null, l.lotNumber ? `lot ${l.lotNumber}` : null, l.expiryDate ? `pér. ${fmtDate(l.expiryDate)}` : null].filter(Boolean).join(" · ")}</div></td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(Number(l.quantity))}</td>
                      {type === "COMMANDE" && <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtNum(Number(l.receivedQty))}</td>}
                      {type === "RECEPTION" && <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtNum(Number(l.invoicedQty))} / {fmtNum(Number(l.returnedQty))}</td>}
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.unitPrice, (parseDecimal(l.unitPrice, 4) ?? 0n) % 100n ? 4 : 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{Number(l.discountPct) ? `${Number(l.discountPct).toLocaleString("fr-FR")} %` : ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtMoney(foreign ? l.netHtCurrency : l.netHtMad)}</td>
                      {foreign && <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.netHtMad)}</td>}
                      {type === "RECEPTION" && <td className="px-3 py-2 text-right tabular-nums text-muted">{Number(l.landedMad) ? fmtMoney(l.landedMad) : ""}</td>}
                      {type === "RECEPTION" && <td className="px-3 py-2 text-right tabular-nums">{l.unitCostMad ? fmtMoney(l.unitCostMad, 4) : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line px-4 py-3 text-[13px] tabular-nums space-y-0.5 ml-auto max-w-xs">
              {foreign && <div className="flex justify-between"><span className="text-muted">Total HT {d.currency}</span><span>{fmtMoney(d.netHtCurrency)}</span></div>}
              <div className="flex justify-between font-medium"><span>Total HT MAD</span><span>{fmtMoney(d.netHtMad)}</span></div>
              {type === "RECEPTION" && Number(d.landedMad) > 0 && <div className="flex justify-between"><span className="text-muted">Frais d&apos;approche</span><span>{fmtMoney(d.landedMad)}</span></div>}
              {type === "RECEPTION" && <div className="flex justify-between font-semibold"><span>Coût de revient</span><span>{fmtMoney(add(d.netHtMad, d.landedMad))} MAD</span></div>}
              {type !== "RECEPTION" && d.vatBreakdown.map((v) => <div key={v.rate} className="flex justify-between"><span className="text-muted">TVA {Number(v.rate).toLocaleString("fr-FR")} %</span><span>{fmtMoney(v.vat)}</span></div>)}
              {type !== "RECEPTION" && <div className="flex justify-between font-semibold text-[15px] pt-1 border-t border-line"><span>Total TTC</span><span>{fmtMoney(d.ttcMad)} MAD</span></div>}
            </div>
          </Card>
          {type === "RECEPTION" && d.landed.length > 0 && (
            <Card title="Frais d'approche">
              <ul className="text-[13px] space-y-1">{d.landed.map((c) => <li key={c.id} className="flex justify-between gap-2"><span>{c.label}{c.ref ? <span className="text-faint"> · {c.ref}</span> : null} <span className="text-faint">· {c.allocation === "VALEUR" ? "à la valeur" : "à la quantité"}</span></span><span className="tabular-nums">{fmtMoney(c.amountMad)} MAD</span></li>)}</ul>
            </Card>
          )}
          {d.notes && <Card title="Note"><p className="text-[13px] whitespace-pre-wrap">{d.notes}</p></Card>}
        </div>

        <div className="space-y-4">
          {(actions.receive || actions.close || actions.cancel || actions.invoice || actions.return || (draft && allowed("validate"))) && (
            <Card title="Actions">
              <div className="space-y-3 text-[13px]">
                {draft && allowed("validate") && <form action={validatePurchaseAction}><input type="hidden" name="id" value={id} /><button className="btn-primary btn-sm" type="submit">Valider</button></form>}
                {actions.receive && (can(a.perms, "achats", "create") || can(a.perms, "stock", "create")) && (
                  <form action={receiveOrderAction}><input type="hidden" name="id" value={id} /><button className="btn-primary btn-sm" type="submit">Réceptionner</button>
                    <p className="text-[11.5px] text-faint mt-1">Crée un bon de réception brouillon avec le reste à recevoir : ajustez les quantités, saisissez lots et péremptions.</p></form>
                )}
                {actions.invoice && canAchats("create") && <Link href={`/gestion/achats/facturer?supplier=${d.supplierId}`} className="btn-primary btn-sm inline-flex">Enregistrer la facture du fournisseur</Link>}
                {actions.return && (can(a.perms, "achats", "create") || can(a.perms, "stock", "create")) && (
                  <form action={returnReceptionAction}><input type="hidden" name="id" value={id} /><button className="btn-secondary btn-sm" type="submit">Retour fournisseur</button></form>
                )}
                {(actions.close || actions.cancel) && canAchats("validate") && (
                  <form action={actions.close ? closeOrderAction : cancelOrderAction} className="space-y-2 pt-3 border-t border-line">
                    <input type="hidden" name="id" value={id} />
                    <p className="text-muted">{actions.close ? "Solder la commande : le reste non livré n'est plus attendu (il sort des « commandes en cours »)." : "Annuler la commande : rien n'a été reçu. Le numéro reste pris et visible."}</p>
                    <input name="reason" className="input h-9" placeholder="Motif *" required />
                    <button className={`btn-secondary btn-sm ${actions.cancel ? "text-red" : ""}`} type="submit">{actions.close ? "Solder la commande" : "Annuler la commande"}</button>
                  </form>
                )}
              </div>
            </Card>
          )}

          <Card title={type === "FACTURE" ? "Facture du fournisseur (fichier)" : "Pièces du fournisseur"}>
            <div className="text-[13px] space-y-2">
              {supplierFiles.length ? (
                <ul className="space-y-1">{supplierFiles.map((f) => <li key={f.id}><a href={`/gestion/achats/fichier/${f.id}`} target="_blank" className="text-accent hover:underline">{f.name}</a> <span className="text-faint text-[11.5px]">· {fmtDate(f.createdAt)}</span></li>)}</ul>
              ) : <p className="text-muted">{type === "FACTURE" ? "Joignez le PDF de la facture reçue : il restera rattaché à cet enregistrement." : "BL ou facture du fournisseur, scan ou PDF."}</p>}
              {allowed("edit") && (
                <form action={attachSupplierFileAction} className="space-y-2">
                  <input type="hidden" name="id" value={id} />
                  <input type="file" name="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="block text-[12px]" required />
                  <button className="btn-secondary btn-sm" type="submit">Joindre</button>
                </form>
              )}
            </div>
          </Card>

          {(d.children.length > 0 || d.sources.length > 0) && (
            <Card title="Pièces liées">
              <ul className="text-[13px] space-y-1">
                {d.sources.map((s) => <li key={s.id}><Link href={`/gestion/achats/${s.id}`} className="font-mono hover:underline">{s.number}</Link> <span className="text-faint">· {PURCHASE_TYPE_LABELS[s.type as PurchaseType]?.one} du {fmtDate(s.date)}</span></li>)}
                {d.children.map((c) => <li key={c.id}><Link href={`/gestion/achats/${c.id}`} className="font-mono hover:underline">{c.number ?? "Brouillon"}</Link> <span className="text-faint">· {PURCHASE_TYPE_LABELS[c.type as PurchaseType]?.one} · {fmtMoney(c.netHtMad)} MAD HT</span></li>)}
              </ul>
            </Card>
          )}
          <Card title="Historique"><AuditTrail rows={history} /></Card>
        </div>
      </div>
    </>
  );
}
