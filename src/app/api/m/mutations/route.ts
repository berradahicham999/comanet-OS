import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { dispatchEvent } from "@/lib/events/dispatch";
import { refreshAfterWrite } from "@/lib/analytics-marketing/refresh";
import { applyMutation } from "@/lib/mobile/mutations";
import type { MutationResult, WireEvent } from "@/lib/mobile/outbox-shared";

export const dynamic = "force-dynamic";

/**
 * Saisies de la file hors connexion, rejouées dans l'ordre. Route plutôt que server action : la file se rejoue par un
 * simple `fetch`, et l'identifiant d'une server action change à chaque déploiement. Droits vérifiés sur chaque saisie.
 */
export async function POST(req: Request) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  if (access.preview) return Response.json({ error: "Prévisualisation : lecture seule." }, { status: 403 });

  let body: { events?: WireEvent[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requête illisible." }, { status: 400 });
  }
  const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];

  const results: MutationResult[] = [];
  const eventIds: string[] = [];
  for (const e of events) {
    const { result, eventId } = await applyMutation(access, e);
    results.push(result);
    if (eventId) eventIds.push(eventId);
  }

  // Les saisies sont validées : à partir d'ici, plus rien ne peut les défaire (même ordre que la saisie du bureau).
  const wrote = results.some((r) => r.ok && !r.replayed);
  if (wrote) {
    for (const id of eventIds) await dispatchEvent(id);
    await refreshAfterWrite(["ANIMATION"]);
    for (const path of ["/terrain", "/terrain/animatrices", "/terrain/rapports", "/clients/stock", "/"]) revalidatePath(path);
  }
  return Response.json({ results, serverTime: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
