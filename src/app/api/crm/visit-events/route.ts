import { getAccess, can } from "@/lib/access";
import { recordClientVisitAction, autoCloseStaleClientVisitsQuietly, type CrmActionInput, type CrmActionResult } from "@/lib/crm/visits";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Actions de visite commerciale (Démarrer, Terminer, non effectuée), envoyées en direct ou rejouées
 * depuis la file hors connexion du téléphone. Route plutôt que server action : la file se rejoue par un
 * simple `fetch`, dans l'ordre, et chaque action est idempotente (`clientEventId`).
 */
export async function POST(req: Request) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  if (access.preview) return Response.json({ error: "Prévisualisation : lecture seule." }, { status: 403 });
  if (!can(access.perms, "clients", "create")) return Response.json({ error: "Accès refusé." }, { status: 403 });

  let body: { events?: CrmActionInput[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requête illisible." }, { status: 400 });
  }
  const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
  const userAgent = req.headers.get("user-agent");
  const settings = (await getSettings()).crm;
  const scopeClientIds = access.scope === "ALL" ? null : access.clientIds;
  await autoCloseStaleClientVisitsQuietly();

  const results: (CrmActionResult & { clientEventId: string })[] = [];
  for (const e of events) {
    const type = e?.type;
    if (type !== "START" && type !== "STOP" && type !== "NON_EFFECTUEE") {
      results.push({ clientEventId: String(e?.clientEventId ?? ""), ok: false, code: "INVALID", message: "Action inconnue." });
      continue;
    }
    const r = await recordClientVisitAction(
      { id: access.user.id, name: access.user.name },
      { ...e, reason: typeof e.reason === "string" ? e.reason.slice(0, 500) : null, userAgent },
      { scopeClientIds, settings },
    );
    results.push({ clientEventId: e.clientEventId, ...r });
  }
  return Response.json({ results, serverTime: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
