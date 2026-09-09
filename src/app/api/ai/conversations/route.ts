/** Historique des conversations du copilote de la personne connectée : liste (`GET`), détail (`GET ?id=`), suppression (`DELETE ?id=`). */
import { getAccess } from "@/lib/permissions";
import { deleteConversation, getConversation, listConversations } from "@/lib/ai/conversations";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await getAccess();
  if (!a) return Response.json({ error: "Non connecté." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const c = await getConversation(a.user.id, id);
    return c ? Response.json(c) : Response.json({ error: "Introuvable." }, { status: 404 });
  }
  return Response.json({ conversations: await listConversations(a.user.id) });
}

export async function DELETE(req: Request) {
  const a = await getAccess();
  if (!a) return Response.json({ error: "Non connecté." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Identifiant manquant." }, { status: 400 });
  await deleteConversation(a.user.id, id);
  return Response.json({ ok: true });
}
