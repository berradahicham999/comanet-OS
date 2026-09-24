import { readShareToken } from "@/lib/gestion/share";
import { getDocument } from "@/lib/gestion/documents";
import { storedPdf } from "@/lib/gestion/pdf";

/**
 * Lien public d'une pièce validée, envoyé au client par WhatsApp ou e-mail. Pas de session : le
 * jeton signé désigne une seule pièce et expire (Paramètres → Gestion commerciale). Un brouillon
 * ne se partage jamais.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const id = await readShareToken(token);
  if (!id) return new Response("Lien invalide ou expiré. Demandez un nouveau lien à COMANET.", { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const doc = await getDocument(id);
  if (!doc || doc.status === "BROUILLON") return new Response("Pièce introuvable.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const pdf = await storedPdf(id, null);
  if (!pdf) return new Response("Pièce introuvable.", { status: 404 });
  return new Response(new Uint8Array(pdf.data), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf.name}"`, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });
}
