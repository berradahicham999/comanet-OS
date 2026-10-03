import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireAccessContext } from "@/lib/access";
import { purchaseEditorData } from "@/lib/gestion/purchase-editor";
import { type PurchaseType } from "@/lib/gestion/purchases-shared";
import { fmtDate, iso, today } from "@/lib/format";
import { parseOrderPrefill } from "@/lib/forecast-shared";
import type { PurchaseEditorLine } from "@/components/gestion/purchase-editor";
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

export default async function NewPurchasePage(props: { searchParams: Promise<{ type?: string; supplier?: string; error?: string; lines?: string }> }) {
  const a = await requireAccessContext();
  const sp = await props.searchParams;
  const type: PurchaseType = sp.type === "RECEPTION" ? "RECEPTION" : sp.type === "FACTURE" ? "FACTURE" : "COMMANDE";
  const modules = type === "RECEPTION" ? (["achats", "stock"] as const) : (["achats"] as const);
  if (!modules.some((m) => can(a.perms, m, "create"))) redirect(a.home);
  const data = await purchaseEditorData();
  const supplier = data.suppliers.find((s) => s.id === sp.supplier) ?? null;
  // Lien « Commander » de la prévision saisonnière : lignes pré-remplies (quantité conseillée, dernier prix payé à ce
  // fournisseur dans sa devise, sinon prix Exwork EUR de la fiche si le fournisseur facture en euros, sinon à saisir).
  const prefill = type === "COMMANDE" && supplier ? parseOrderPrefill(sp.lines) : [];
  const currency = supplier?.currency ?? "MAD";
  const prefilled: PurchaseEditorLine[] = prefill.flatMap((l, i) => {
    const p = data.products.find((x) => x.id === l.productId && x.kind === "PRODUIT");
    if (!p) return [];
    const last = data.lastPrices[`${supplier!.id}|${currency}|${p.id}`];
    const unitPrice = last ?? (currency === "EUR" && p.exwPriceEur ? p.exwPriceEur : "");
    return [{ key: `pf${i}`, productId: p.id, inventoryItemId: null, designation: p.name, ref: p.ref, quantity: String(l.qty), unitPrice, discountPct: "0", taxRate: p.taxRate, lotNumber: "", expiryDate: "", trackLots: p.trackLots, sourceLineId: null, maxQty: null }];
  });
  const missingPrice = prefilled.filter((l) => !l.unitPrice).length;

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/gestion/achats?type=${type}`} className="hover:underline">Achats</Link>}
        title={`Nouvelle ${type === "RECEPTION" ? "réception" : type === "FACTURE" ? "facture fournisseur" : "commande fournisseur"}`}
        subtitle={SUBTITLE[type]}
      />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {prefilled.length > 0 && (
        <div className="mb-4 rounded-2xl bg-accent-soft border border-accent/30 px-4 py-3 text-[13px]">
          Commande pré-remplie depuis la <Link href="/stock/prevision" className="underline">prévision saisonnière</Link> : {prefilled.length} ligne{prefilled.length > 1 ? "s" : ""} aux quantités conseillées (modélisées), au dernier prix payé à ce fournisseur.
          {missingPrice > 0 && <> <b>{missingPrice} ligne{missingPrice > 1 ? "s" : ""} sans prix connu</b> : à saisir avant d&apos;enregistrer.</>} Ajustez quantités, prix et date de livraison attendue, puis enregistrez.
        </div>
      )}
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
            exchangeRate: supplier?.currency && supplier.currency !== "MAD" ? "" : "1", warehouseKey: "PRINCIPAL", originDocumentId: null,
            notes: prefilled.length ? `Pré-remplie depuis la prévision saisonnière du ${fmtDate(today())} (quantités conseillées, modélisées).` : "", lines: prefilled, landedCosts: [],
          }}
        />
      )}
    </>
  );
}
