import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, canDo } from "@/lib/access";
import { listBrands } from "@/lib/users";
import { auditTrail } from "@/lib/audit";
import { listPaymentModes } from "@/lib/gestion/refs";
import { getSupplier, SUPPLIER_NATURES } from "@/lib/gestion/suppliers";
import { PageHeader, Card, Badge } from "@/components/ui";
import { SupplierForm } from "@/components/gestion/supplier-form";
import { AuditTrail } from "@/components/gestion/audit-trail";
import { updateSupplierAction, archiveSupplierAction, deleteSupplierAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SupplierPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  await requireAccess("achats");
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [s, brands, modes, history, canEdit, canValidate] = await Promise.all([
    getSupplier(id), listBrands(), listPaymentModes(), auditTrail("supplier", id), canDo("achats", "edit"), canDo("achats", "validate"),
  ]);
  if (!s) notFound();

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/gestion/fournisseurs" className="hover:underline">Fournisseurs</Link>}
        title={<span className="flex items-center gap-2 flex-wrap">{s.legalName}{!s.active && <Badge tone="gray">archivé</Badge>}</span>}
        subtitle={[SUPPLIER_NATURES[s.nature as keyof typeof SUPPLIER_NATURES], s.code, s.ice ? `ICE ${s.ice}` : null, `${s.country} · ${s.currency}`].filter(Boolean).join(" · ")}
      />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">Fiche enregistrée.</div>}

      <div className="grid lg:grid-cols-[1fr_340px] gap-4">
        <Card title="Fiche fournisseur">
          <SupplierForm action={updateSupplierAction} supplier={s} brands={brands} paymentModes={modes} readOnly={!canEdit} />
        </Card>
        <div className="space-y-4">
          <Card title="Achats">
            <p className="text-[13px] text-muted">Commandes, réceptions et factures de ce fournisseur apparaîtront ici avec le lot 3 (achats).</p>
          </Card>
          {canValidate && (
            <Card title="Archivage">
              <form action={archiveSupplierAction} className="text-[13px] space-y-2">
                <input type="hidden" name="id" value={s.id} /><input type="hidden" name="archive" value={s.active ? "1" : "0"} />
                <p className="text-muted">{s.active ? "Un fournisseur archivé disparaît des listes et des sélecteurs ; son historique reste." : "Ce fournisseur est archivé."}</p>
                <button className="btn-secondary btn-sm" type="submit">{s.active ? "Archiver" : "Restaurer"}</button>
              </form>
              <form action={deleteSupplierAction} className="text-[13px] space-y-2 mt-4 pt-4 border-t border-line">
                <input type="hidden" name="id" value={s.id} />
                <p className="text-muted">Suppression définitive, possible tant qu&apos;aucune pièce d&apos;achat n&apos;existe. Tapez <b>SUPPRIMER</b> pour confirmer.</p>
                <input name="confirm" className="input h-9" placeholder="SUPPRIMER" autoComplete="off" />
                <button className="btn-secondary btn-sm text-red" type="submit">Supprimer définitivement</button>
              </form>
            </Card>
          )}
          <Card title="Historique"><AuditTrail rows={history} /></Card>
        </div>
      </div>
    </>
  );
}
