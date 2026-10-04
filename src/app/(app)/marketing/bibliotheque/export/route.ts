import * as XLSX from "xlsx";
import { requireAccess } from "@/lib/access";
import { listLibrary } from "@/lib/action-generator/library";
import { TEMPLATE_COLUMNS, templateToFields } from "@/lib/action-generator/library-shared";

export const dynamic = "force-dynamic";

/** Export Excel de la bibliothèque d'actions : mêmes colonnes que l'import (exporter, compléter, réimporter). */
export async function GET() {
  await requireAccess("marketing");
  const entries = await listLibrary();
  const rows = entries.map((e) => { const f = templateToFields(e.template, e.active); return Object.fromEntries(TEMPLATE_COLUMNS.map((c) => [c.label, f[c.key]])); });
  const ws = XLSX.utils.json_to_sheet(rows, { header: TEMPLATE_COLUMNS.map((c) => c.label) });
  ws["!cols"] = TEMPLATE_COLUMNS.map((c) => ({ wch: ["concept", "postes", "etapes", "contenus"].includes(c.key) ? 60 : c.key === "nom" ? 40 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Bibliothèque");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="bibliotheque-actions.xlsx"` } });
}
