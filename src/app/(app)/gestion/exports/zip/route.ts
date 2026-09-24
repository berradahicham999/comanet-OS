import { can, hasFlag, requireAccessContext } from "@/lib/access";
import { PIECES_PER_ZIP, exportPieces, zipPieces } from "@/lib/gestion/exports";

/** ZIP d'un lot de PDF de factures et avoirs du mois (pièces figées, sans UG). */
export async function GET(req: Request) {
  const a = await requireAccessContext();
  if (!can(a.perms, "facturation", "view") || !((await hasFlag("exportData")) || can(a.perms, "administration", "validate"))) return new Response("Accès refusé", { status: 403 });
  const u = new URL(req.url);
  const month = u.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response("Mois invalide", { status: 400 });
  const part = Math.max(1, Number(u.searchParams.get("part") ?? 1));
  const sim = u.searchParams.get("sim") === "1";
  const pieces = (await exportPieces(month, sim)).slice((part - 1) * PIECES_PER_ZIP, part * PIECES_PER_ZIP);
  if (!pieces.length) return new Response("Aucune pièce", { status: 404 });
  const zip = await zipPieces(pieces.map((p) => p.id), a.user.id);
  return new Response(new Uint8Array(zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="pieces-${month}${sim ? "-simulation" : ""}-${part}.zip"`, "Cache-Control": "private, no-store" } });
}
