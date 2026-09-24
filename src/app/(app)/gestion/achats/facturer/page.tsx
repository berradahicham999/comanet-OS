import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { canDo, requireAccessContext } from "@/lib/access";
import { invoiceableReceptions } from "@/lib/gestion/purchases";
import { PURCHASE_STATUS_META, purchaseStatusLabel } from "@/lib/gestion/purchases-shared";
import { fmtMoney } from "@/lib/gestion/money";
import { fmtDate } from "@/lib/format";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { GestionTabs } from "@/components/gestion/gestion-nav";
import { invoiceReceptionsAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Facturer des réceptions" };

/** Enregistrement d'une facture fournisseur : un fournisseur, ses réceptions encore à facturer. */
export default async function InvoiceReceptionsPage(props: { searchParams: Promise<{ supplier?: string; error?: string }> }) {
  const a = await requireAccessContext();
  if (!(await canDo("achats", "create"))) redirect(a.home);
  const sp = await props.searchParams;
  const suppliers = (await db.execute<{ id: string; name: string; n: number; oldest: string }>(sql`
    select s.id, s.legal_name as name, count(distinct d.id)::int as n, min(d.date)::text as oldest
    from purchase_documents d join suppliers s on s.id = d.supplier_id
    where d.type = 'RECEPTION' and d.status in ('VALIDE', 'FACTUREE_PARTIEL')
      and exists (select 1 from purchase_document_lines l where l.document_id = d.id and l.invoiced_qty < l.quantity)
    group by s.id order by min(d.date)`)).rows;
  const supplierId = sp.supplier && suppliers.some((s) => s.id === sp.supplier) ? sp.supplier : null;
  const receptions = supplierId ? await invoiceableReceptions(supplierId) : [];

  return (
    <>
      <PageHeader eyebrow="Gestion commerciale" title="Facturer des réceptions" subtitle="La facture reprend le reste à facturer des réceptions choisies ; ajustez prix et quantités à ceux de la facture reçue : les écarts seront signalés à la validation.">
        <GestionTabs current="/gestion/achats" />
      </PageHeader>
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {suppliers.length === 0 ? (
        <Empty title="Aucune réception à facturer" hint="Les réceptions validées dont la facture du fournisseur n'est pas encore enregistrée apparaissent ici, par fournisseur." action={<Link href="/gestion/achats?type=RECEPTION" className="btn-secondary btn-sm">Voir les réceptions</Link>} />
      ) : (
        <div className="grid lg:grid-cols-[320px_1fr] gap-4">
          <Card title="Fournisseurs" pad={false}>
            <ul className="divide-y divide-line text-[13px]">
              {suppliers.map((s) => (
                <li key={s.id}><Link href={`/gestion/achats/facturer?supplier=${s.id}`} className={`block px-4 py-2.5 hover:bg-surface-2 ${s.id === supplierId ? "bg-surface-2" : ""}`}>
                  <div className="font-medium">{s.name}</div><div className="text-[12px] text-muted">{s.n} réception{s.n > 1 ? "s" : ""} · depuis le {fmtDate(s.oldest)}</div>
                </Link></li>
              ))}
            </ul>
          </Card>
          {supplierId ? (
            <Card title={`Réceptions à facturer — ${suppliers.find((s) => s.id === supplierId)?.name}`}>
              <form action={invoiceReceptionsAction} className="space-y-3 text-[13px]">
                <input type="hidden" name="supplier" value={supplierId} />
                <ul className="divide-y divide-line">
                  {receptions.map((r) => (
                    <li key={r.id} className="py-2 flex items-center gap-3 flex-wrap">
                      <input type="checkbox" name="receptionIds" value={r.id} defaultChecked className="h-4 w-4" />
                      <Link href={`/gestion/achats/${r.id}`} className="font-mono hover:underline">{r.number}</Link>
                      <span className="text-muted">{fmtDate(r.date)}</span>
                      <Badge tone={PURCHASE_STATUS_META[r.status as keyof typeof PURCHASE_STATUS_META].tone}>{purchaseStatusLabel("RECEPTION", r.status as keyof typeof PURCHASE_STATUS_META)}</Badge>
                      <span className="ml-auto tabular-nums">{fmtMoney(r.net_ht_currency)} {r.currency} HT</span>
                    </li>
                  ))}
                </ul>
                <button type="submit" className="btn-primary btn-sm">Créer la facture (brouillon)</button>
              </form>
            </Card>
          ) : <Card><p className="text-[13px] text-muted">Choisissez un fournisseur à gauche.</p></Card>}
        </div>
      )}
    </>
  );
}
