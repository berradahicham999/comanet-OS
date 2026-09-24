/**
 * Journal de stock — règles pures (partagé client / serveur, sans base).
 *
 * Le stock d'un article est la somme de ses mouvements ; ce fichier dit quels mouvements sont
 * permis (types, signes, dépôts, lots), comment on sort un lot (au plus proche de la péremption)
 * et comment on qualifie une date de péremption. L'écriture vit dans `ledger.ts`, seul module
 * autorisé à insérer dans `stock_movements`.
 */
import { SCALE, parseDecimal } from "./money";

export const MOVEMENT_TYPES = [
  "STOCK_INITIAL",
  "ENTREE_ACHAT",
  "SORTIE_BL",
  "RETOUR_CLIENT",
  "RETOUR_FOURNISSEUR",
  "AJUSTEMENT_INVENTAIRE",
  "CASSE_PERIME",
  "ECHANTILLON_MARKETING",
  "TRANSFERT",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Sens attendu d'un mouvement normal (un contre-mouvement d'annulation porte le sens inverse). */
export const MOVEMENT_META: Record<MovementType, { label: string; sign: "+" | "-" | "±"; tone: "green" | "red" | "blue" | "orange" | "gray" | "purple" }> = {
  STOCK_INITIAL: { label: "Stock initial", sign: "+", tone: "blue" },
  ENTREE_ACHAT: { label: "Entrée achat", sign: "+", tone: "green" },
  SORTIE_BL: { label: "Sortie BL", sign: "-", tone: "gray" },
  RETOUR_CLIENT: { label: "Retour client", sign: "+", tone: "green" },
  RETOUR_FOURNISSEUR: { label: "Retour fournisseur", sign: "-", tone: "orange" },
  AJUSTEMENT_INVENTAIRE: { label: "Ajustement d'inventaire", sign: "±", tone: "purple" },
  CASSE_PERIME: { label: "Casse / périmé", sign: "-", tone: "red" },
  ECHANTILLON_MARKETING: { label: "Échantillon marketing", sign: "-", tone: "orange" },
  TRANSFERT: { label: "Transfert", sign: "±", tone: "blue" },
};

/** Ce qui a créé un mouvement. Les pièces (BL, réception, avoir…) arrivent avec les lots suivants. */
export const SOURCE_TYPES = ["IMPORT", "MANUEL", "BL", "RECEPTION", "AVOIR", "RETOUR", "INVENTAIRE", "ECHANTILLON"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export const SOURCE_LABELS: Record<SourceType, string> = {
  IMPORT: "Import", MANUEL: "Saisie manuelle", BL: "Bon de livraison", RECEPTION: "Bon de réception", AVOIR: "Avoir",
  RETOUR: "Bon de retour", INVENTAIRE: "Inventaire", ECHANTILLON: "Remise d'échantillons",
};

/** Mouvements qu'un utilisateur peut saisir à la main (avec un motif) : les autres naissent d'une pièce. */
export const MANUAL_TYPES: MovementType[] = ["CASSE_PERIME", "TRANSFERT"];

/** Entrées qui portent un coût et recalculent le CMUP. */
export const COSTED_ENTRIES: MovementType[] = ["STOCK_INITIAL", "ENTREE_ACHAT"];

export type WarehouseLike = { key: string; kind: string; active: boolean };
export type ProductLike = { id: string; name: string; kind: string; trackLots: boolean };

export type MovementDraft = {
  productId: string;
  type: MovementType;
  /** Quantité signée, texte décimal (« -6 », « 12.5 »). */
  quantity: string;
  warehouseKey: string;
  counterpartWarehouseKey?: string | null;
  lotNumber?: string | null;
  unitCost?: string | null;
  /** Contre-mouvement d'annulation : le sens est l'inverse du mouvement annulé. */
  isReversal?: boolean;
};

/**
 * Pourquoi un mouvement est refusé, ou null s'il est recevable. Vérifie le type, le sens, le
 * dépôt (jamais de mouvement dans un dépôt externe, connu par photo), l'article (un service ne
 * se stocke pas), le lot et le coût des entrées.
 */
export function movementError(m: MovementDraft, product: ProductLike | undefined, warehouses: Map<string, WarehouseLike>): string | null {
  if (!product) return "Article introuvable.";
  if (!(MOVEMENT_TYPES as readonly string[]).includes(m.type)) return `Type de mouvement inconnu : ${m.type}.`;
  if (product.kind === "SERVICE") return `${product.name} est un service : il n'a pas de stock.`;
  const q = parseDecimal(m.quantity, SCALE.qty);
  if (q === null || q === 0n) return `Quantité invalide pour ${product.name}.`;
  const sign = MOVEMENT_META[m.type].sign;
  const positive = q > 0n;
  if (!m.isReversal) {
    if (sign === "+" && !positive) return `${MOVEMENT_META[m.type].label} : la quantité doit être positive.`;
    if (sign === "-" && positive) return `${MOVEMENT_META[m.type].label} : la quantité doit être négative (sortie).`;
  }
  const w = warehouses.get(m.warehouseKey);
  if (!w) return `Dépôt inconnu : ${m.warehouseKey}.`;
  if (w.kind !== "INTERNE") return `${m.warehouseKey} est un dépôt externe : son stock se met à jour par import de photo, pas par mouvement.`;
  if (!w.active && positive) return `Le dépôt ${m.warehouseKey} est désactivé.`;
  if (m.type === "TRANSFERT") {
    if (!m.counterpartWarehouseKey) return "Transfert : indiquez le dépôt d'en face.";
    if (m.counterpartWarehouseKey === m.warehouseKey) return "Transfert : le dépôt de départ et d'arrivée sont identiques.";
    if (!warehouses.get(m.counterpartWarehouseKey)) return `Dépôt inconnu : ${m.counterpartWarehouseKey}.`;
  }
  if (product.trackLots && !m.lotNumber?.trim()) return `${product.name} est suivi par lot : indiquez le numéro de lot.`;
  if (COSTED_ENTRIES.includes(m.type) && positive && !m.isReversal) {
    const c = parseDecimal(m.unitCost ?? null, SCALE.cost);
    if (c === null || c < 0n) return `${MOVEMENT_META[m.type].label} de ${product.name} : coût unitaire manquant ou négatif.`;
  }
  return null;
}

/** Clé d'un solde : article × dépôt × lot. */
export const balanceKey = (productId: string, warehouseKey: string, lotId: string | null) => `${productId}|${warehouseKey}|${lotId ?? ""}`;

/** Soldes par article × dépôt × lot à partir d'une liste de mouvements (quantités à l'échelle 3). */
export function balancesOf(movements: { productId: string; warehouseKey: string; lotId: string | null; quantity: string }[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const m of movements) {
    const k = balanceKey(m.productId, m.warehouseKey, m.lotId);
    out.set(k, (out.get(k) ?? 0n) + (parseDecimal(m.quantity, SCALE.qty) ?? 0n));
  }
  return out;
}

export type ExpiryStatus = "PERIME" | "PROCHE" | "OK";

/** Statut d'une date de péremption à une date donnée (AAAA-MM-JJ), avec l'alerte à J − `alertDays`. */
export function expiryStatus(expiry: string | null, today: string, alertDays: number): ExpiryStatus | null {
  if (!expiry) return null;
  if (expiry < today) return "PERIME";
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + alertDays);
  return expiry <= limit.toISOString().slice(0, 10) ? "PROCHE" : "OK";
}

export type LotAvailability = { lotId: string; lotNumber: string; expiryDate: string | null; available: bigint };

/**
 * Sortie au plus proche de la péremption (FEFO) : répartit `qty` (échelle 3) sur les lots
 * disponibles, du plus proche au plus lointain ; un lot sans date passe en dernier, un lot
 * périmé n'est jamais proposé. Renvoie la répartition et la quantité qui manque.
 */
export function allocateFefo(lots: LotAvailability[], qty: bigint, today: string): { allocations: { lotId: string; lotNumber: string; qty: bigint }[]; missing: bigint } {
  if (qty <= 0n) return { allocations: [], missing: 0n };
  const usable = lots
    .filter((l) => l.available > 0n && !(l.expiryDate && l.expiryDate < today))
    .sort((a, b) => {
      if (a.expiryDate === b.expiryDate) return a.lotNumber.localeCompare(b.lotNumber);
      if (!a.expiryDate) return 1;
      if (!b.expiryDate) return -1;
      return a.expiryDate < b.expiryDate ? -1 : 1;
    });
  const allocations: { lotId: string; lotNumber: string; qty: bigint }[] = [];
  let left = qty;
  for (const l of usable) {
    if (left <= 0n) break;
    const take = l.available < left ? l.available : left;
    allocations.push({ lotId: l.lotId, lotNumber: l.lotNumber, qty: take });
    left -= take;
  }
  return { allocations, missing: left };
}
