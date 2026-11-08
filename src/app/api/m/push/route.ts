import { getAccess } from "@/lib/access";
import { currentSessionId } from "@/lib/auth";
import { pushPublicKey, removeSubscription, saveSubscription, type IncomingSubscription } from "@/lib/mobile/push";

export const dynamic = "force-dynamic";

/** Clé publique (GET), abonnement de ce navigateur (POST), désabonnement (DELETE). La clé privée ne quitte jamais le serveur. */
export async function GET() {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  return Response.json({ publicKey: pushPublicKey() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  if (access.preview) return Response.json({ error: "Prévisualisation : lecture seule." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as IncomingSubscription | null;
  const ok = !!body && (await saveSubscription(access.user.id, await currentSessionId(), body, req.headers.get("user-agent")));
  return Response.json({ ok }, { status: ok ? 200 : 400 });
}

export async function DELETE(req: Request) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint === "string") await removeSubscription(access.user.id, body.endpoint);
  return Response.json({ ok: true });
}
