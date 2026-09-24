import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { canDo, clientFilter, requireAccessContext } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { pgArray } from "@/lib/sql-array";
import { invoiceableBLs } from "@/lib/gestion/documents";
import { fmtDate } from "@/lib/format";
import { fmtMoney } from "@/lib/gestion/money";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { GestionTabs } from "@/components/gestion/gestion-nav";
import { invoiceBLsAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Facturer des BL" };

/**
 * Facturation des bons de livraison : un client, ses BL facturables (reste à facturer), une facture
 * qui les regroupe. Les BL de simulation et les BL réels ne se mélangent pas.
 */
export default async function InvoiceBLsPage(props: { searchParams: Promise<{ client?: string; error?: string }> }) {
  const a = await requireAccessContext();
  if (!(await canDo("facturation", "create"))) redirect(a.home);
  const sp = await props.searchParams;
  const g = (await getSettings()).gestion;
  const scope = await clientFilter();
  const statuses = g.requireDelivered ? ["LIVRE", "FACTURE_PARTIEL"] : ["VALIDE", "LIVRE", "FACTURE_PARTIEL"];
  const clients = (await db.execute<{ id: string; name: string; city: string | null; bls: number; oldest: string; ttc: string }>(sql`
    select c.id, c.name, c.city, count(distinct d.id)::int as bls, min(d.date)::text as oldest, sum(d.ttc)::text as ttc
    from sales_documents d join clients c on c.id = d.client_id
    where d.type = 'BL' and d.status = any(${pgArray(statuses, "text")})
      and exists (select 1 from sales_document_lines l where l.document_id = d.id and l.invoiced_qty < l.quantity)
      ${scope ? (scope.length ? sql`and c.id = any(${pgArray(scope)})` : sql`and false`) : sql``}
    group by c.id order by min(d.date)`)).rows;
  const clientId = sp.client && clients.some((c) => c.id === sp.client) ? sp.client : null;
  const bls = clientId ? await invoiceableBLs(clientId, g.requireDelivered) : [];

  return (
    <>
      <PageHeader
        eyebrow="Gestion commerciale"
        title="Facturer des bons de livraison"
        subtitle={`Une facture regroupe le reste à facturer d'un ou plusieurs BL du même client${g.requireDelivered ? " (BL livrés uniquement)" : ""}. Elle est créée en brouillon : quantités ajustables avant validation.`}
      >
        <GestionTabs current="/gestion/pieces/facturer" />
      </PageHeader>
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}

      {clients.length === 0 ? (
        <Empty title="Aucun BL à facturer" hint="Les bons de livraison validés et non encore (entièrement) facturés apparaissent ici, regroupés par client." action={<Link href="/gestion/pieces?type=BL" className="btn-secondary btn-sm">Voir les BL</Link>} />
      ) : (
        <div className="grid lg:grid-cols-[320px_1fr] gap-4">
          <Card title="Clients à facturer" pad={false}>
            <ul className="divide-y divide-line text-[13px]">
              {clients.map((c) => (
                <li key={c.id}>
                  <Link href={`/gestion/pieces/facturer?client=${c.id}`} className={`block px-4 py-2.5 hover:bg-surface-2 ${c.id === clientId ? "bg-surface-2" : ""}`}>
                    <div className="font-medium">{c.name}{c.city && <span className="text-faint font-normal"> · {c.city}</span>}</div>
                    <div className="text-[12px] text-muted">{c.bls} BL · depuis le {fmtDate(c.oldest)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {clientId ? (
            <Card title={`BL facturables — ${clients.find((c) => c.id === clientId)?.name}`}>
              <form action={invoiceBLsAction} className="space-y-3 text-[13px]">
                <input type="hidden" name="client" value={clientId} />
                <ul className="divide-y divide-line">
                  {bls.map((b) => (
                    <li key={b.id} className="py-2 flex items-center gap-3">
                      <input type="checkbox" name="blIds" value={b.id} defaultChecked className="h-4 w-4" />
                      <Link href={`/gestion/pieces/${b.id}`} className="font-mono hover:underline">{b.number}</Link>
                      <span className="text-muted">{fmtDate(b.date)}</span>
                      {b.status === "FACTURE_PARTIEL" && <Badge tone="orange">facturé en partie</Badge>}
                      {b.is_simulation && <Badge tone="purple">simulation</Badge>}
                      {Number(b.global_discount_pct) > 0 && <Badge tone="gray">remise {Number(b.global_discount_pct).toLocaleString("fr-FR")} %</Badge>}
                      <span className="ml-auto tabular-nums">{fmtMoney(b.ttc)} MAD</span>
                    </li>
                  ))}
                </ul>
                <button type="submit" className="btn-primary btn-sm">Créer la facture (brouillon)</button>
              </form>
            </Card>
          ) : (
            <Card><p className="text-[13px] text-muted">Choisissez un client à gauche.</p></Card>
          )}
        </div>
      )}
    </>
  );
}
