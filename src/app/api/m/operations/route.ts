import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { pgArray } from "@/lib/sql-array";
import { getAccess } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { iso, today } from "@/lib/format";
import { activationRefs } from "@/lib/activations/refs";
import { activationScope, canDoActivation, canManageGoodies, canValidateActivation } from "@/lib/activations/access";
import { holderStock, operationStockSource } from "@/lib/activations/inventory";
import { getActivation } from "@/lib/activations/queries";
import { createOperation, myOperations, reportOperation, OperationError } from "@/lib/activations/operations";

export const dynamic = "force-dynamic";

/**
 * Opérations de terrain depuis le téléphone (décision d'Hicham, 18/11/2026). En ligne : la création part aussitôt en
 * « Planifiée » ou en validation, ce qui demande le serveur. Droits : `canDoActivation()` (Terrain « Créer » suffit, portée
 * limitée à ses opérations). Toute l'écriture est dans `src/lib/activations/operations.ts`.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const uuidList = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter(isUuid))].slice(0, 30) : []);
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(String(v).replace(/\s/g, "").replace(",", ".")));

async function guard() {
  const access = await getAccess();
  if (!access) return { error: Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 }) };
  if (access.preview) return { error: Response.json({ error: "Prévisualisation : lecture seule." }, { status: 403 }) };
  if (!(await canDoActivation("create"))) return { error: Response.json({ error: "Vous n'avez pas le droit de créer une opération." }, { status: 403 }) };
  return { access };
}

/** Données du formulaire et opérations de la personne (à venir, à clôturer). */
export async function GET() {
  const g = await guard();
  if (g.error) return g.error;
  const a = g.access;
  const todayIso = iso(today());
  const brandIds = a.scope === "ALL" || !a.brandIds.length ? null : a.brandIds;
  const source = await operationStockSource(a.user.id, await canManageGoodies());
  const [refs, settings, mine, brands, products, held] = await Promise.all([
    activationRefs(), getSettings(), myOperations(a.user.id, todayIso),
    db.execute<{ id: string; name: string }>(sql`select id::text, name from brands where active and merged_into_id is null ${brandIds ? sql`and id = any(${pgArray(brandIds)})` : sql``} order by name`),
    db.execute<{ id: string; name: string; brandId: string }>(sql`select p.id::text, p.name, p.brand_id::text as "brandId" from products p join brands b on b.id = p.brand_id
      where p.active and b.active and b.merged_into_id is null ${brandIds ? sql`and p.brand_id = any(${pgArray(brandIds)})` : sql``} order by p.name`),
    holderStock(source),
  ]);
  // Goodies proposés : ceux que la personne a en main (stock central pour la direction qui n'en détient pas).
  const items = held.map((h) => ({ id: h.itemId, name: h.name, unit: h.unit, stock: h.held, brandId: h.brandId }));
  return Response.json({
    today: todayIso,
    autoApproveMax: settings.activations.autoApproveMax,
    types: refs.types.filter((t) => t.active).map((t) => ({ key: t.key, label: t.label })),
    brands: brands.rows, products: products.rows, items, stockSource: source ? "MINE" : "CENTRAL",
    ...mine,
  }, { headers: NO_STORE });
}

/** `create` : nouvelle opération ; `report` : compte rendu (et clôture). */
export async function POST(req: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const a = g.access;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ error: "Requête illisible." }, { status: 400 }); }
  const actor = { id: a.user.id, name: a.user.name };
  try {
    if (body.action === "create") {
      const brandIds = uuidList(body.brandIds);
      const res = await createOperation({
        typeKey: String(body.typeKey ?? ""), clientId: isUuid(body.clientId) ? body.clientId : null, brandIds, productIds: uuidList(body.productIds),
        date: String(body.date ?? ""), offerLabel: typeof body.offerLabel === "string" ? body.offerLabel : null, plannedMaterials: body.plannedMaterials,
        budget: numOrNull(body.budget), offerCost: numOrNull(body.offerCost), notes: typeof body.notes === "string" ? body.notes : null,
      }, actor, { isValidator: await canValidateActivation(brandIds[0] ?? null) });
      revalidatePath("/marketing/activations"); revalidatePath("/marketing"); revalidatePath("/marketing/activations/validation");
      return Response.json(res, { headers: NO_STORE });
    }
    if (body.action === "report") {
      const id = isUuid(body.id) ? body.id : null;
      if (!id) return Response.json({ error: "Opération introuvable." }, { status: 400 });
      const [refs, settings, scope] = await Promise.all([activationRefs(), getSettings(), activationScope()]);
      const op = await getActivation(id, scope, refs, settings.activations);
      if (!op) return Response.json({ error: "Opération introuvable ou hors de votre périmètre." }, { status: 404 });
      const used = Array.isArray(body.materialsUsed) ? body.materialsUsed : body.materialsUsed === null ? null : undefined;
      const res = await reportOperation(id, {
        pharmaciesReached: numOrNull(body.pharmaciesReached), ordersOnSite: numOrNull(body.ordersOnSite), ordersAmount: numOrNull(body.ordersAmount),
        remark: typeof body.remark === "string" ? body.remark : null, materialsUsed: used ?? null, close: body.close === true,
      }, actor, { isValidator: await canValidateActivation(op.brandId), date: iso(today()), stockHolder: await operationStockSource(a.user.id, await canManageGoodies()) });
      revalidatePath("/marketing/activations"); revalidatePath(`/marketing/activations/${id}`); revalidatePath("/marketing/materiel");
      return Response.json(res, { headers: NO_STORE });
    }
    return Response.json({ error: "Action inconnue." }, { status: 400 });
  } catch (e) {
    if (e instanceof OperationError) return Response.json({ error: e.message }, { status: 422 });
    const msg = e instanceof Error ? e.message : "";
    if (/Stock insuffisant/.test(msg)) return Response.json({ error: msg }, { status: 422 });
    console.error("api/m/operations", e);
    return Response.json({ error: "Erreur du serveur : réessayez." }, { status: 500 });
  }
}
