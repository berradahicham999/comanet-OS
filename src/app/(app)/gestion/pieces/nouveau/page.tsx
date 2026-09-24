import Link from "next/link";
import { redirect } from "next/navigation";
import { canDo, clientFilter, requireAccessContext } from "@/lib/access";
import { editorData } from "@/lib/gestion/editor";
import { iso, today } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { DocumentEditor } from "@/components/gestion/document-editor";
import { saveDocumentAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouvelle pièce" };

export default async function NewDocumentPage(props: { searchParams: Promise<{ type?: string; client?: string; error?: string }> }) {
  const a = await requireAccessContext();
  const sp = await props.searchParams;
  // Un avoir naît d'une facture ; une facture d'articles naît de ses BL.
  const type = sp.type === "FACTURE" ? "FACTURE" : "BL";
  const permModule = type === "BL" ? "livraisons" : "facturation";
  if (!(await canDo(permModule, "create"))) redirect(a.home);
  const data = await editorData({ clientIds: await clientFilter() });
  const clientId = sp.client && data.clients.some((c) => c.id === sp.client) ? sp.client : "";

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/gestion/pieces?type=${type}`} className="hover:underline">Pièces de vente</Link>}
        title={type === "BL" ? "Nouveau bon de livraison" : "Nouvelle facture de services"}
        subtitle={type === "BL"
          ? "Prix de base = PPH ÷ (1 + TVA), remise par défaut du client sur la marque. Le stock sort à la validation, lot au plus proche de la péremption."
          : "Facture directe : services, frais, prestations. Les articles stockés se facturent depuis leurs bons de livraison."}
      />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      <DocumentEditor
        type={type}
        data={data}
        action={saveDocumentAction}
        canValidate={await canDo(permModule, "validate")}
        initial={{
          id: null, clientId, date: iso(today()), site: data.sites[0], salesRepId: null, paymentModeKey: null,
          globalDiscountPct: "0", notes: "", reasonKey: null, originDocumentId: null, lines: [],
        }}
      />
    </>
  );
}
