import { requireAccessContext, can, clientInScope } from "@/lib/access";
import { getDocument } from "@/lib/gestion/documents";
import { storedPdf } from "@/lib/gestion/pdf";

/**
 * PDF d'une pièce. Brouillon : rendu à la volée (mention « Provisoire »). Pièce validée : le PDF
 * figé stocké à la validation, identique à chaque ouverture.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireAccessContext();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Introuvable", { status: 404 });
  const doc = await getDocument(id);
  if (!doc) return new Response("Introuvable", { status: 404 });
  const permModule = doc.type === "BL" ? "livraisons" : "facturation";
  if (!can(a.perms, permModule, "view") || !(await clientInScope(doc.clientId))) return new Response("Accès refusé", { status: 403 });
  const pdf = await storedPdf(id, a.user.id);
  if (!pdf) return new Response("Introuvable", { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  return new Response(new Uint8Array(pdf.data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${pdf.name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
