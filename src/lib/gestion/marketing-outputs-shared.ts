/**
 * SORTIES MARKETING PAR BL — règles pures (testées sans base). Écriture : `marketing-outputs.ts`.
 *
 * Un BL sur un client INTERNE (`clients.is_internal` : échantillons animation, médical, digital, commercial) ne
 * produit jamais de CA. Décisions d'Hicham (12/10/2026) :
 *  · ligne PRODUIT d'un client interne → charge marketing « échantillons » = (quantité + UG) × coût de revient de la
 *    fiche produit FIGÉ à la validation, de la nature du client, rattachée à la marque du produit ; simulation comprise
 *    (la marchandise est physiquement sortie) ;
 *  · ligne MATÉRIEL (goodie, PLV, print), sur un client interne ou sur un vrai client (cadeau à une pharmacie) → AUCUNE
 *    charge : le matériel est passé en charge à l'achat. La sortie reste tracée (stock, client, nature, valeur figée) ;
 *  · coût à 0 ou inconnu → pas de charge, alerte (jamais estimé) ; produit sans marque → validation refusée.
 */
import { SCALE, formatScaled, parseDecimal, valueOf } from "./money";

/** Nature d'une sortie de matériel offerte à un vrai client (point de vente). */
export const TRADE_NATURE = "COMMERCIAL";

export type OutputLineLike = {
  id: string;
  productId: string | null;
  inventoryItemId: string | null;
  brandId: string | null;
  designation: string;
  quantity: string;
  freeQuantity: string;
  /** Coût unitaire figé (numeric, 2 décimales) ; null = inconnu. */
  unitCost: string | null;
};

export type OutputClientLike = { isInternal: boolean; outputNatureKey: string | null };

export type OutputCharge = {
  documentLineId: string;
  productId: string;
  brandId: string;
  /** Montant HT (numeric, 2 décimales). */
  amount: string;
  label: string;
  nature: string;
};

export type CostIssue = { lineId: string; designation: string; kind: "PRODUIT" | "MATERIEL"; reason: "COUT_ZERO" | "COUT_INCONNU" };

const outQty = (l: OutputLineLike) => (parseDecimal(l.quantity, SCALE.qty) ?? 0n) + (parseDecimal(l.freeQuantity || "0", SCALE.qty) ?? 0n);

/** Lignes dont le coût figé est à surveiller : ligne produit d'un client interne, ou ligne de matériel. */
export function costIssues(client: OutputClientLike, lines: OutputLineLike[]): CostIssue[] {
  const out: CostIssue[] = [];
  for (const l of lines) {
    const watched = l.inventoryItemId !== null || (client.isInternal && l.productId !== null);
    if (!watched) continue;
    const c = l.unitCost === null ? null : parseDecimal(l.unitCost, SCALE.cost);
    if (c === null) out.push({ lineId: l.id, designation: l.designation, kind: l.inventoryItemId ? "MATERIEL" : "PRODUIT", reason: "COUT_INCONNU" });
    else if (c === 0n) out.push({ lineId: l.id, designation: l.designation, kind: l.inventoryItemId ? "MATERIEL" : "PRODUIT", reason: "COUT_ZERO" });
  }
  return out;
}

/** Libellé lisible d'une alerte de coût. */
export function costIssueLabel(i: CostIssue): string {
  return `${i.designation} : ${i.reason === "COUT_ZERO" ? "coût à 0" : "coût de revient inconnu"} — la sortie n'est pas valorisée.`;
}

/**
 * Charges marketing d'un BL validé. `errors` non vide = validation refusée (produit sans marque sur un client
 * interne, client interne sans nature).
 */
export function outputCharges(client: OutputClientLike, lines: OutputLineLike[], docLabel: string): { charges: OutputCharge[]; errors: string[] } {
  if (!client.isInternal) return { charges: [], errors: [] };
  const errors: string[] = [];
  if (!client.outputNatureKey) errors.push("Ce client interne n'a pas de nature de sortie (animation, médical, digital, commercial) : complétez sa fiche.");
  const charges: OutputCharge[] = [];
  for (const l of lines) {
    if (!l.productId) continue; // matériel : charge à l'achat ; ligne libre : rien
    if (!l.brandId) { errors.push(`${l.designation} : produit sans marque, la charge d'échantillon ne peut pas être rattachée.`); continue; }
    const cost = l.unitCost === null ? null : parseDecimal(l.unitCost, SCALE.cost);
    if (cost === null || cost === 0n) continue; // signalé par costIssues(), jamais estimé
    const amount = valueOf(outQty(l), cost);
    if (amount <= 0n) continue;
    charges.push({
      documentLineId: l.id, productId: l.productId, brandId: l.brandId, amount: formatScaled(amount, SCALE.money),
      label: `Échantillons — ${l.designation} (${docLabel})`, nature: client.outputNatureKey ?? "",
    });
  }
  return { charges, errors };
}
