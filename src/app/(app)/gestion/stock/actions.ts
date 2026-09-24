"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { audit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { recordStockMovements } from "@/lib/gestion/ledger";
import { MANUAL_TYPES, MOVEMENT_META, type MovementType } from "@/lib/gestion/ledger-shared";
import { SCALE, formatScaled, parseDecimal } from "@/lib/gestion/money";
import { errorParam, isUuid, str } from "@/lib/gestion/form";

/**
 * Mouvement saisi à la main : casse / périmé, ou transfert entre dépôts. Les autres mouvements
 * naissent d'une pièce (BL, réception, avoir, inventaire). Motif obligatoire, trace d'audit.
 */
export async function manualMovementAction(fd: FormData) {
  const user = await requirePermission("stock", "validate");
  const back = (q: string) => redirect(`/gestion/stock?view=journal&${q}`);
  try {
    const type = str(fd, "type") as MovementType | null;
    if (!type || !MANUAL_TYPES.includes(type)) throw new Error("Type de mouvement non autorisé en saisie manuelle.");
    const productId = str(fd, "productId");
    if (!isUuid(productId)) throw new Error("Choisissez un article.");
    const qty = parseDecimal(str(fd, "quantity"), SCALE.qty);
    if (qty === null || qty <= 0n) throw new Error("Quantité : nombre positif attendu (le sens est donné par le type).");
    const reason = str(fd, "comment");
    if (!reason) throw new Error("Le motif est obligatoire.");
    const date = str(fd, "date") ?? new Date().toISOString().slice(0, 10);
    const warehouseKey = str(fd, "warehouseKey") ?? "PRINCIPAL";
    const counterpart = type === "TRANSFERT" ? str(fd, "counterpartWarehouseKey") : null;
    const settings = await getSettings();
    await recordStockMovements([{
      productId, type, quantity: formatScaled(-qty, SCALE.qty), warehouseKey, counterpartWarehouseKey: counterpart,
      lotNumber: str(fd, "lotNumber"), date, sourceType: "MANUEL", comment: reason,
    }], { id: user.id }, { allowNegative: settings.gestion.insufficientStock === "WARN" });
    await audit({
      actor: { id: user.id, name: user.name }, action: "MOVEMENT", module: "stock", entity: "product", entityId: productId,
      label: MOVEMENT_META[type].label, after: { type, quantity: formatScaled(qty, SCALE.qty), warehouseKey, counterpart, lot: str(fd, "lotNumber"), date, reason },
    });
  } catch (e) {
    back(`error=${errorParam(e)}`);
  }
  revalidatePath("/gestion/stock");
  revalidatePath("/gestion");
  back("done=1");
}
