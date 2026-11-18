import { requireAccessContext } from "@/lib/access";
import { canPurchase, type PurchaseType } from "@/lib/gestion/purchases-shared";
import { getPurchase } from "@/lib/gestion/purchases";
import { storedPurchasePdf } from "@/lib/gestion/purchase-pdf";

/** PDF d'une commande (à envoyer au fournisseur), d'une réception ou d'un retour. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireAccessContext();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Introuvable", { status: 404 });
  const d = await getPurchase(id);
  if (!d || d.type === "FACTURE") return new Response("Introuvable", { status: 404 });
  if (!canPurchase(a, d.type as PurchaseType)) return new Response("Accès refusé", { status: 403 });
  const pdf = await storedPurchasePdf(id, a.user.id);
  if (!pdf) return new Response("Introuvable", { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  return new Response(new Uint8Array(pdf.data), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${pdf.name}"`, "Cache-Control": "private, no-store" },
  });
}
