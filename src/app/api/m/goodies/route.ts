import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { iso, today } from "@/lib/format";
import { canDoActivation, canManageGoodies } from "@/lib/activations/access";
import { goodiesRecipients, holderMovements, holderStock, holdersOverview, transferMaterial } from "@/lib/activations/inventory";

export const dynamic = "force-dynamic";

/**
 * « Mes goodies » depuis le téléphone (décision d'Hicham, 18/11/2026) : ce que la personne a en main, ses derniers
 * mouvements, et le transfert (donner à une collègue, rendre au stock central). Le responsable des goodies et la
 * direction distribuent aussi depuis le stock central (`canManageGoodies()`). Écriture : `transferMaterial()` seul.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

async function guard() {
  const access = await getAccess();
  if (!access) return { error: Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 }) };
  if (!(await canDoActivation("create"))) return { error: Response.json({ error: "Vos droits ne donnent pas accès aux goodies." }, { status: 403 }) };
  return { access };
}

export async function GET() {
  const g = await guard();
  if (g.error) return g.error;
  const me = g.access.user.id;
  const manage = await canManageGoodies();
  const settings = await getSettings();
  const [mine, movements, recipients, central, team] = await Promise.all([
    holderStock(me), holderMovements(me, 30), goodiesRecipients(settings.activations.goodiesManagerId),
    manage ? holderStock(null) : Promise.resolve([]), manage ? holdersOverview() : Promise.resolve([]),
  ]);
  return Response.json({
    today: iso(today()), me, canManage: manage, mine, movements, central,
    recipients: recipients.filter((r) => r.id !== me),
    team: team.map((t) => ({ id: t.holderId, name: t.name, held: t.held, received: t.ledger.received, used: t.ledger.usedOnOperations })),
  }, { headers: NO_STORE });
}

/** Transfert : `from` = "me" ou "central" (gestion des goodies) ; `to` = une personne ou "central". */
export async function POST(req: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const a = g.access;
  if (a.preview) return Response.json({ error: "Prévisualisation : lecture seule." }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ error: "Requête illisible." }, { status: 400 }); }
  const fromCentral = body.from === "central";
  if (fromCentral && !(await canManageGoodies())) return Response.json({ error: "Seuls la direction et le responsable des goodies distribuent depuis le stock central." }, { status: 403 });
  const to = body.to === "central" ? null : isUuid(body.to) ? body.to : undefined;
  if (to === undefined) return Response.json({ error: "Choisissez à qui donner les goodies." }, { status: 400 });
  if (!isUuid(body.itemId)) return Response.json({ error: "Choisissez un goodie." }, { status: 400 });
  try {
    const res = await transferMaterial({
      itemId: body.itemId, from: fromCentral ? null : a.user.id, to, quantity: Number(body.quantity), date: iso(today()), createdById: a.user.id,
      reason: typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null,
    });
    revalidatePath("/marketing/materiel");
    return Response.json(res, { headers: NO_STORE });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Transfert impossible." }, { status: 400 });
  }
}
