/**
 * Charge du matériel marketing à l'achat (décision d'Hicham, 18/11/2026) — définition pure.
 *
 * Goodies, PLV et print sont une charge marketing au moment où COMANET paie le fournisseur : à la validation de la
 * facture fournisseur (FF), chaque ligne de matériel devient UNE dépense SPENT, HT en MAD, dans la catégorie budgétaire
 * de l'article et sur sa marque. Leur réception, leur distribution aux animatrices et leur usage en opération ne
 * créent jamais de nouvelle dépense. Seulement à partir de `settings.activations.materialChargeFrom` : avant cette date,
 * la charge était saisie à la main, rien n'est compté deux fois. Écriture : `recordMaterialPurchaseCharges()`.
 */
import { parseDecimal, SCALE } from "./money";

export type MaterialChargeLine = { id: string; inventoryItemId: string | null; designation: string; netHtMad: string };
export type MaterialChargeItem = { brandId: string | null; budgetCategory: string; name: string };
export type MaterialChargeRow = { purchaseLineId: string; brandId: string; category: string; label: string; amount: string };

export function materialChargeRows(input: {
  lines: MaterialChargeLine[]; items: Map<string, MaterialChargeItem>; from: string | null; date: string; invoiceLabel: string;
}): { rows: MaterialChargeRow[]; skipped: { designation: string; reason: string }[] } {
  const rows: MaterialChargeRow[] = [];
  const skipped: { designation: string; reason: string }[] = [];
  if (!input.from || input.date < input.from) return { rows, skipped };
  for (const l of input.lines) {
    if (!l.inventoryItemId) continue;
    const it = input.items.get(l.inventoryItemId);
    if (!it) continue;
    if ((parseDecimal(l.netHtMad, SCALE.money) ?? 0n) <= 0n) continue;
    if (!it.brandId) { skipped.push({ designation: l.designation, reason: "article sans marque : rattachez une marque pour que la charge soit passée" }); continue; }
    rows.push({ purchaseLineId: l.id, brandId: it.brandId, category: it.budgetCategory, label: `${input.invoiceLabel} — ${it.name}`, amount: l.netHtMad });
  }
  return { rows, skipped };
}
