"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { redirect } from "next/navigation";
import { requirePermission, requireAccessContext, clientInScope } from "@/lib/access";
import { audit, changedFields } from "@/lib/audit";
import { canRecordReading, parseReadingLines, recordReadings } from "@/lib/client-stock";
import { iso, today } from "@/lib/format";
import { asSector, cityToSector } from "@/lib/sectors";

/**
 * Fiche rapide de l'onglet « Vue d'ensemble ». L'archivage n'est plus une case à cocher ici :
 * il relève du droit « Valider » et se fait depuis l'onglet « Identité & conditions ».
 */
export async function updateClient(formData: FormData) {
  const user = await requirePermission("clients", "edit");
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  if (!(await clientInScope(id))) throw new Error("Ce client n'est pas dans votre portée.");
  const type = String(formData.get("type") ?? "AUTRE") as "PHARMACIE" | "PARAPHARMACIE" | "GROSSISTE" | "AUTRE";
  const city = String(formData.get("city") ?? "").trim() || null;
  // Secteur choisi à la main, sinon déduit de la ville.
  const sector = asSector(formData.get("sector")) ?? cityToSector(city);
  const name = String(formData.get("name") ?? "").trim();
  const next = {
    ...(name ? { name } : {}),
    type,
    city,
    sector,
    channel: String(formData.get("channel") ?? "").trim() || null,
    salesRep: String(formData.get("salesRep") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
  };
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(clients).where(eq(clients.id, id)).for("update");
    if (!before) return;
    await tx.update(clients).set({ ...next, needsReview: false, updatedAt: new Date() }).where(eq(clients.id, id));
    const diff = changedFields(before as unknown as Record<string, unknown>, next);
    if (diff) await audit({ actor: { id: user.id, name: user.name }, action: "UPDATE", module: "clients", entity: "client", entityId: id, label: next.name ?? before.name, before: diff.before, after: diff.after }, tx);
  });
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
}

/**
 * Relevé de stock par le commercial (canal TOURNEE_COMMERCIALE), depuis la fiche client.
 * Lecture du formulaire seulement : la validation (`parseReadingLines`), le droit par canal
 * (`canRecordReading`) et l'écriture (`recordReadings`) sont ceux partagés avec la saisie
 * terrain de l'animatrice.
 */
export async function recordClientStock(formData: FormData) {
  const user = await requirePermission("clients", "create");
  const clientId = String(formData.get("clientId") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return;
  const back: (params: Record<string, string>) => never = (params) => redirect(`/clients/${clientId}?${new URLSearchParams({ tab: "stock", ...params }).toString()}`);

  const access = await requireAccessContext();
  const allowed = canRecordReading(
    { userId: user.id, perms: access.perms, scope: access.scope, clientIds: access.clientIds },
    { channel: "TOURNEE_COMMERCIALE", clientId },
  );
  if (!allowed) back({ error: "portee" });

  const full = String(formData.get("full") ?? "") === "1";
  const raw: { productId: string; qty: string; changed: boolean }[] = [];
  for (let i = 0; i < 500; i++) {
    const productId = String(formData.get(`product_${i}`) ?? "").trim();
    if (!productId) continue;
    raw.push({ productId, qty: String(formData.get(`qty_${i}`) ?? ""), changed: true });
  }
  const parsed = parseReadingLines(raw, full);
  if (!parsed.ok) back({ error: parsed.error });

  const n = await recordReadings({
    clientId,
    userId: user.id,
    channel: "TOURNEE_COMMERCIALE",
    readAt: iso(today()),
    comment: String(formData.get("comment") ?? "").trim() || null,
    lines: parsed.lines,
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients/stock");
  revalidatePath("/actions");
  back({ done: String(n) });
}
