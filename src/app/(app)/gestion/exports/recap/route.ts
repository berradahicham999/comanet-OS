import { can, hasFlag, requireAccessContext } from "@/lib/access";
import { recapWorkbook } from "@/lib/gestion/exports";

/** Récapitulatif Excel du mois pour le comptable. */
export async function GET(req: Request) {
  const a = await requireAccessContext();
  if (!can(a.perms, "facturation", "view") || !((await hasFlag("exportData")) || can(a.perms, "administration", "validate"))) return new Response("Accès refusé", { status: 403 });
  const u = new URL(req.url);
  const month = u.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response("Mois invalide", { status: 400 });
  const sim = u.searchParams.get("sim") === "1";
  const buf = await recapWorkbook(month, sim);
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="recapitulatif-${month}${sim ? "-simulation" : ""}.xlsx"`, "Cache-Control": "private, no-store" } });
}
