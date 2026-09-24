import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireAccessContext } from "@/lib/access";
import { purchaseEditorData } from "@/lib/gestion/purchase-editor";
import { type PurchaseType } from "@/lib/gestion/purchases-shared";
import { iso, today } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PurchaseEditor } from "@/components/gestion/purchase-editor";
import { savePurchaseAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouvelle pièce d'achat" };

const SUBTITLE: Partial<Record<PurchaseType, string>> = {
  COMMANDE: "Prix dans la devise du fournisseur ; le taux se saisit sur la pièce. Le dernier prix payé à ce fournisseur est proposé.",
  RECEPTION: "Réception sans commande : les articles entrent en stock à la validation, au coût de revient (prix × taux + frais d'approche). Lot obligatoire pour un article suivi par lot.",
  FACTURE: "Facture de services ou de frais (prestataire, transitaire). Une facture de marchandises se crée depuis ses réceptions.",
};

export default async function NewPurchasePage(props: { searchParams: Promise<{ type?: string; supplier?: string; error?: string }> }) {
  const a = await requireAccessContext();
  const sp = await props.searchParams;
  const type: PurchaseType = sp.type === "RECEPTION" ? "RECEPTION" : sp.type === "FACTURE" ? "FACTURE" : "COMMANDE";
  const modules = type === "RECEPTION" ? (["achats", "stock"] as const) : (["achats"] as const);
  if (!modules.some((m) => can(a.perms, m, "create"))) redirect(a.home);
  const data = await purchaseEditorData();
  const supplier = data.suppliers.find((s) => s.id === sp.supplier) ?? null;

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/gestion/achats?type=${type}`} className="hover:underline">Achats</Link>}
        title={`Nouvelle ${type === "RECEPTION" ? "réception" : type === "FACTURE" ? "facture fournisseur" : "commande fournisseur"}`}
        subtitle={SUBTITLE[type]}
      />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {data.suppliers.length === 0 ? (
        <div className="card p-4 text-[13px]">Aucun fournisseur actif. <Link href="/gestion/fournisseurs/nouveau" className="text-accent hover:underline">Créez d&apos;abord le fournisseur</Link> (laboratoire ou prestataire).</div>
      ) : (
        <PurchaseEditor
          type={type}
          data={data}
          action={savePurchaseAction}
          canValidate={modules.some((m) => can(a.perms, m, "validate"))}
          initial={{
            id: null, supplierId: supplier?.id ?? "", date: iso(today()), expectedDate: "", supplierRef: "", currency: supplier?.currency ?? "MAD",
            exchangeRate: supplier?.currency && supplier.currency !== "MAD" ? "" : "1", warehouseKey: "PRINCIPAL", originDocumentId: null, notes: "", lines: [], landedCosts: [],
          }}
        />
      )}
    </>
  );
}
