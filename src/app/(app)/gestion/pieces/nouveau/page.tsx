import Link from "next/link";
import { redirect } from "next/navigation";
import { canDo, clientFilter, requireAccessContext } from "@/lib/access";
import { editorData } from "@/lib/gestion/editor";
import { moduleOfType } from "@/lib/gestion/documents-shared";
import { listCreditReasons } from "@/lib/gestion/refs";
import { iso, today } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { DocumentEditor } from "@/components/gestion/document-editor";
import { saveDocumentAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouvelle pièce" };

export default async function NewDocumentPage(props: { searchParams: Promise<{ type?: string; client?: string; error?: string }> }) {
  const a = await requireAccessContext();
  const sp = await props.searchParams;
  // Un avoir naît d'une facture ; une facture d'articles naît de ses BL ; un BL naît souvent d'une commande.
  const type = sp.type === "FACTURE" ? "FACTURE" : sp.type === "AVOIR" ? "AVOIR" : sp.type === "COMMANDE" ? "COMMANDE" : "BL";
  const permModule = moduleOfType(type);
  if (!(await canDo(permModule, "create"))) redirect(a.home);
  const data = await editorData({ clientIds: await clientFilter() });
  const reasons = type === "AVOIR" ? (await listCreditReasons()).filter((r) => r.active && !r.withReturn).map((r) => ({ key: r.key, label: r.label, withReturn: r.withReturn })) : [];
  const clientId = sp.client && data.clients.some((c) => c.id === sp.client) ? sp.client : "";

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/gestion/pieces?type=${type}`} className="hover:underline">Pièces de vente</Link>}
        title={type === "COMMANDE" ? "Nouvelle commande client" : type === "BL" ? "Nouveau bon de livraison" : type === "AVOIR" ? "Nouvel avoir financier" : "Nouvelle facture de services"}
        subtitle={type === "COMMANDE"
          ? "Ce que le client commande, saisi sur place : produits et quantités au PPH, stock disponible affiché, sans remise. Confirmer donne un numéro BC ; le BL se prépare ensuite en un clic, avec la remise du client posée automatiquement, et reste modifiable."
          : type === "BL"
          ? "Prix de base = PPH ÷ (1 + TVA), remise par défaut du client sur la marque. Le stock sort à la validation, lot au plus proche de la péremption."
          : type === "AVOIR"
            ? "Remise accordée hors facture (objectifs atteints, geste commercial) : une ligne par marque avec son montant HT. Sans effet sur le stock ; le montant devient un crédit client à imputer sur ses factures."
            : "Facture directe : services, frais, prestations. Les articles stockés se facturent depuis leurs bons de livraison."}
      />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      <DocumentEditor
        type={type}
        data={data}
        action={saveDocumentAction}
        canValidate={await canDo(permModule, "validate")}
        creditReasons={reasons}
        initial={{
          id: null, clientId, legalEntityId: null, date: iso(today()), site: data.sites[0], salesRepId: null, paymentModeKey: null,
          globalDiscountPct: "0", notes: "", reasonKey: type === "AVOIR" ? (reasons.find((r) => r.key === "REMISE_OBJECTIFS")?.key ?? null) : null, originDocumentId: null, lines: [],
        }}
      />
    </>
  );
}
