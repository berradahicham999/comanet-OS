import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { CERTIFICATE_STATUS, DOCUMENT_TYPES, SITUATIONS, packagingLabel, situationOf, variantLabel } from "@/lib/regulatory";
import { today } from "@/lib/format";

export const dynamic = "force-dynamic";

type Row = {
  reference: string | null; dossier: string; brand_name: string | null; variant_type: string; size: string | null;
  packaging: string | null; status: string; document_type: string; certificate_status: string; blocked: boolean;
  blocked_reason: string | null; filing_date: string | null; expiry_date: string | null; authorization_number: string | null;
  certificate_number: string | null; physical_product: boolean | null; missing_documents: string | null;
  notes: string | null; responsible: string | null; product_name: string | null;
};

/** Export Excel de l'état réglementaire, avec l'écart recalculé au jour de l'export. */
export async function GET() {
  await requireAccess("reglementaire");
  const s = await getSettings();
  const t = today();
  const rows = (await db.execute(sql`
    select rf.reference, rf.dossier, b.name as brand_name, rf.variant_type, rf.size, rf.packaging, rf.status::text as status,
      rf.document_type, rf.certificate_status, rf.blocked, rf.blocked_reason, rf.filing_date::text as filing_date,
      rf.expiry_date::text as expiry_date, rf.authorization_number, rf.certificate_number, rf.physical_product,
      rf.missing_documents, rf.notes, u.name as responsible, p.name as product_name
    from regulatory_files rf
    left join brands b on b.id = rf.brand_id
    left join users u on u.id = rf.responsible_id
    left join products p on p.id = rf.product_id
    order by b.name nulls first, rf.reference, rf.variant_type, rf.size`)).rows as Row[];

  const data = rows.map((r) => {
    const { situation, days } = situationOf({ status: r.status, blocked: r.blocked, expiryDate: r.expiry_date }, t, s.regulatoryRenewalDays);
    return {
      Marque: r.brand_name ?? "Société",
      Référence: r.reference ?? r.dossier,
      "Produit référentiel": r.product_name ?? "",
      Type: variantLabel(r.variant_type),
      Contenance: r.size ?? "",
      Format: r.packaging ? packagingLabel(r.packaging) : "",
      Document: DOCUMENT_TYPES[r.document_type as keyof typeof DOCUMENT_TYPES] ?? r.document_type,
      "N° ATD": r.authorization_number ?? "",
      "Date dépôt DMP": r.filing_date ?? "",
      Validité: r.expiry_date ?? "",
      "Écart (jours)": days ?? "",
      Situation: SITUATIONS[situation].label,
      "Étape CE": (CERTIFICATE_STATUS[r.certificate_status] ?? CERTIFICATE_STATUS.A_DEMANDER).label,
      "N° CE": r.certificate_number ?? "",
      "Produit physique": r.physical_product === null ? "" : r.physical_product ? "oui" : "non",
      "Documents manquants": r.missing_documents ?? "",
      Blocage: r.blocked ? r.blocked_reason ?? "oui" : "",
      Responsable: r.responsible ?? "",
      Observation: r.notes ?? "",
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{ wch: 14 }, { wch: 38 }, { wch: 28 }, { wch: 16 }, { wch: 11 }, { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 26 }, { wch: 26 }, { wch: 14 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, ws, "Enregistrements");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const name = `COMANET-reglementaire-${t.toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
