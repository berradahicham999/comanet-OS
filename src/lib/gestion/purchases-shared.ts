/**
 * Achats — règles pures (partagé client / serveur, sans base) : types, statuts, actions permises,
 * montants en devise et en dirhams, répartition des frais d'approche, coût de revient unitaire,
 * statuts après réception / facturation, rapprochement facture ↔ réception, retard de commande.
 * L'écriture vit dans `purchases.ts` (seul module qui crée ou valide une pièce d'achat).
 *
 * Échelles : quantités 3, prix d'achat 4 (en devise), montants 2, taux de change 6, coût de revient 4.
 */
import { SCALE, formatScaled, parseDecimal, rescale, roundDiv } from "./money";

export const PURCHASE_TYPES = ["COMMANDE", "RECEPTION", "FACTURE", "RETOUR"] as const;
export type PurchaseType = (typeof PURCHASE_TYPES)[number];
export const PURCHASE_TYPE_LABELS: Record<PurchaseType, { one: string; many: string; series: string }> = {
  COMMANDE: { one: "Commande fournisseur", many: "Commandes", series: "CF" },
  RECEPTION: { one: "Bon de réception", many: "Réceptions", series: "BR" },
  FACTURE: { one: "Facture fournisseur", many: "Factures fournisseurs", series: "FF" },
  RETOUR: { one: "Retour fournisseur", many: "Retours", series: "RF" },
};

export const PURCHASE_STATUSES = ["BROUILLON", "VALIDE", "PARTIELLE", "RECUE", "CLOTUREE", "FACTUREE_PARTIEL", "FACTUREE", "ANNULE"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export const PURCHASE_STATUS_META: Record<PurchaseStatus, { label: string; tone: "gray" | "blue" | "accent" | "orange" | "green" | "red" | "purple" }> = {
  BROUILLON: { label: "Brouillon", tone: "gray" },
  VALIDE: { label: "Validé", tone: "blue" },
  PARTIELLE: { label: "Reçue en partie", tone: "orange" },
  RECUE: { label: "Reçue", tone: "green" },
  CLOTUREE: { label: "Soldée", tone: "purple" },
  FACTUREE_PARTIEL: { label: "Facturée en partie", tone: "orange" },
  FACTUREE: { label: "Facturée", tone: "green" },
  ANNULE: { label: "Annulée", tone: "red" },
};
export function purchaseStatusLabel(type: PurchaseType, status: PurchaseStatus): string {
  if (status === "VALIDE") return type === "COMMANDE" ? "Envoyée" : type === "RECEPTION" ? "Entrée en stock" : type === "FACTURE" ? "Enregistrée" : "Validé";
  if (status === "FACTUREE_PARTIEL") return "Facturée en partie";
  return PURCHASE_STATUS_META[status].label;
}

/** Actions permises selon le type et le statut. */
export function purchaseActions(type: PurchaseType, status: PurchaseStatus, opts: { anyReceived?: boolean } = {}) {
  const draft = status === "BROUILLON";
  return {
    edit: draft,
    delete: draft,
    validate: draft,
    receive: type === "COMMANDE" && (status === "VALIDE" || status === "PARTIELLE"),
    close: type === "COMMANDE" && status === "PARTIELLE",
    cancel: type === "COMMANDE" && status === "VALIDE" && !opts.anyReceived,
    invoice: type === "RECEPTION" && (status === "VALIDE" || status === "FACTUREE_PARTIEL"),
    return: type === "RECEPTION" && status !== "BROUILLON",
  };
}

/* ------------------------------------------------------------------ */
/* Devise                                                              */
/* ------------------------------------------------------------------ */

export const RATE_SCALE = 6;
export const PRICE_SCALE = 4;

/** Taux de change saisi : 1 en dirhams, strictement positif sinon. Jamais deviné. */
export function rateError(currency: string, rate: string | null | undefined): string | null {
  const r = parseDecimal(rate ?? null, RATE_SCALE);
  if (currency.toUpperCase() === "MAD") return r === null || r === 10n ** BigInt(RATE_SCALE) ? null : "Une pièce en dirhams a un taux de 1.";
  if (r === null || r <= 0n) return `Saisissez le taux du jour : combien de dirhams pour 1 ${currency.toUpperCase()} ?`;
  if (r === 10n ** BigInt(RATE_SCALE)) return `Un taux de 1 pour 1 ${currency.toUpperCase()} n'est pas un taux réel : saisissez celui du jour.`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Montants                                                            */
/* ------------------------------------------------------------------ */

const BP = 10000n; // 100,00 %
const q = (v: string) => parseDecimal(v, SCALE.qty) ?? 0n;
const pct = (v: string) => parseDecimal(v, SCALE.pct) ?? 0n;

export type PurchaseLineInput = { quantity: string; unitPrice: string; discountPct: string; taxRate: string };
export type PurchaseLineAmounts = { netHtCurrency: string; netHtMad: string; vatMad: string };

function lineRaw(l: PurchaseLineInput, rate: bigint) {
  const qty = q(l.quantity), pu = parseDecimal(l.unitPrice, PRICE_SCALE) ?? 0n, d = pct(l.discountPct), tr = pct(l.taxRate);
  if (d < 0n || d >= BP) throw new Error("Remise : entre 0 et 99,99 %.");
  if (tr < 0n || tr >= BP) throw new Error("Taux de TVA invalide.");
  // qté (10³) × prix (10⁴) × (1 − remise) → montant (10²) : un seul arrondi par résultat.
  const base = qty * pu * (BP - d);
  const cur = roundDiv(base, 10n ** 5n * BP);
  const mad = roundDiv(base * rate, 10n ** 5n * BP * 10n ** BigInt(RATE_SCALE));
  const vat = roundDiv(mad * tr, BP);
  return { cur, mad, vat, tr };
}

/** Montants d'une pièce d'achat : ligne par ligne en devise et en dirhams (TVA sur le montant en dirhams). */
export function computePurchase(lines: PurchaseLineInput[], rateText: string) {
  const rate = parseDecimal(rateText, RATE_SCALE) ?? 0n;
  let cur = 0n, mad = 0n, vat = 0n;
  const byRate = new Map<string, { base: bigint; vat: bigint }>();
  const out: PurchaseLineAmounts[] = [];
  for (const l of lines) {
    const a = lineRaw(l, rate);
    cur += a.cur; mad += a.mad; vat += a.vat;
    const k = formatScaled(a.tr, 2);
    const r = byRate.get(k) ?? { base: 0n, vat: 0n };
    r.base += a.mad; r.vat += a.vat;
    byRate.set(k, r);
    out.push({ netHtCurrency: formatScaled(a.cur, 2), netHtMad: formatScaled(a.mad, 2), vatMad: formatScaled(a.vat, 2) });
  }
  return {
    lines: out,
    netHtCurrency: formatScaled(cur, 2),
    netHtMad: formatScaled(mad, 2),
    vatMad: formatScaled(vat, 2),
    ttcMad: formatScaled(mad + vat, 2),
    vatBreakdown: [...byRate.entries()].sort((a, b) => (Number(a[0]) < Number(b[0]) ? 1 : -1)).map(([rate, v]) => ({ rate, base: formatScaled(v.base, 2), vat: formatScaled(v.vat, 2) })),
  };
}

/* ------------------------------------------------------------------ */
/* Frais d'approche et coût de revient                                 */
/* ------------------------------------------------------------------ */

export type LandedCostInput = { amountMad: string; allocation: "VALEUR" | "QUANTITE" };

/**
 * Répartit chaque frais sur les lignes, à la valeur (montant HT en dirhams) ou à la quantité. La
 * somme répartie est exactement le montant du frais : parts arrondies vers le bas, puis les centimes
 * restants vont aux plus grands restes (à égalité, dans l'ordre des lignes). Une clé nulle partout
 * (valeur 0) retombe sur la quantité.
 */
export function allocateLandedCosts(lines: { netHtMad: string; quantity: string }[], costs: LandedCostInput[]): string[] {
  const alloc = lines.map(() => 0n);
  for (const c of costs) {
    const amount = parseDecimal(c.amountMad, SCALE.money) ?? 0n;
    if (amount <= 0n || !lines.length) continue;
    let weights = lines.map((l) => (c.allocation === "VALEUR" ? parseDecimal(l.netHtMad, SCALE.money) ?? 0n : q(l.quantity)));
    if (weights.every((w) => w <= 0n)) weights = lines.map((l) => q(l.quantity));
    const total = weights.reduce((a, w) => a + (w > 0n ? w : 0n), 0n);
    if (total <= 0n) continue;
    const parts = weights.map((w) => (w > 0n ? (amount * w) / total : 0n));
    const rests = weights.map((w, i) => ({ i, r: w > 0n ? (amount * w) % total : -1n }));
    let left = amount - parts.reduce((a, p) => a + p, 0n);
    rests.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
    for (const x of rests) { if (left <= 0n) break; if (x.r < 0n) continue; parts[x.i] += 1n; left -= 1n; }
    parts.forEach((p, i) => { alloc[i] += p; });
  }
  return alloc.map((a) => formatScaled(a, 2));
}

/** Coût de revient unitaire (MAD HT, échelle 4) = (montant HT en dirhams + frais répartis) ÷ quantité. */
export function unitCostMad(netHtMad: string, landedMad: string, quantity: string): string {
  const qty = q(quantity);
  if (qty <= 0n) throw new Error("Quantité nulle.");
  const total = (parseDecimal(netHtMad, SCALE.money) ?? 0n) + (parseDecimal(landedMad, SCALE.money) ?? 0n);
  // montant (10²) → coût (10⁴) : × 10² ; ÷ quantité (10³) : × 10³.
  return formatScaled(roundDiv(total * 100n * 1000n, qty), SCALE.cost);
}

/* ------------------------------------------------------------------ */
/* Statuts                                                             */
/* ------------------------------------------------------------------ */

function progress(lines: { quantity: string; done: string }[]): "NONE" | "PART" | "ALL" {
  let any = false, all = true;
  for (const l of lines) {
    const d = q(l.done);
    if (d > 0n) any = true;
    if (d < q(l.quantity)) all = false;
  }
  return !any ? "NONE" : all ? "ALL" : "PART";
}

/** Commande après une réception : rien reçu → Envoyée, tout reçu → Reçue, sinon Reçue en partie. */
export function orderStatusAfterReceipt(lines: { quantity: string; receivedQty: string }[]): PurchaseStatus {
  const p = progress(lines.map((l) => ({ quantity: l.quantity, done: l.receivedQty })));
  return p === "NONE" ? "VALIDE" : p === "ALL" ? "RECUE" : "PARTIELLE";
}

/** Réception après facturation (lignes d'articles seulement). */
export function receptionStatusAfterInvoice(lines: { quantity: string; invoicedQty: string }[]): PurchaseStatus {
  const p = progress(lines.map((l) => ({ quantity: l.quantity, done: l.invoicedQty })));
  return p === "NONE" ? "VALIDE" : p === "ALL" ? "FACTUREE" : "FACTUREE_PARTIEL";
}

export function remaining(quantity: string, done: string): string {
  const r = q(quantity) - q(done);
  return formatScaled(r > 0n ? r : 0n, SCALE.qty);
}

/* ------------------------------------------------------------------ */
/* Rapprochement facture ↔ réception                                   */
/* ------------------------------------------------------------------ */

export type InvoiceGap = { kind: "PRIX" | "QUANTITE" | "HORS_RECEPTION"; label: string };

/**
 * Écarts d'une facture fournisseur avec ses réceptions : prix unitaire net (en devise) au-delà de la
 * tolérance, quantité facturée différente du reste à facturer, ligne d'article sans réception.
 * Un écart se signale, il ne bloque pas : c'est la facture du fournisseur, on l'enregistre telle quelle.
 */
export function invoiceGaps(
  lines: { designation: string; productId: string | null; quantity: string; unitPrice: string; discountPct: string; source: { quantityLeft: string; unitPrice: string; discountPct: string; number: string | null } | null }[],
  tolerancePct: number,
): InvoiceGap[] {
  const gaps: InvoiceGap[] = [];
  const tol = BigInt(Math.round(tolerancePct * 100));
  const net = (pu: string, d: string) => roundDiv((parseDecimal(pu, PRICE_SCALE) ?? 0n) * (BP - pct(d)), BP);
  const fmt = (v: bigint) => formatScaled(rescale(v, PRICE_SCALE, 2), 2).replace(".", ",");
  for (const l of lines) {
    if (!l.source) {
      if (l.productId) gaps.push({ kind: "HORS_RECEPTION", label: `${l.designation} : article facturé sans réception rattachée.` });
      continue;
    }
    const a = net(l.unitPrice, l.discountPct), b = net(l.source.unitPrice, l.source.discountPct);
    if (b !== 0n) {
      const diff = a > b ? a - b : b - a;
      if (diff * BP > tol * b) gaps.push({ kind: "PRIX", label: `${l.designation} : prix net facturé ${fmt(a)} contre ${fmt(b)} à la réception ${l.source.number ?? ""}.`.replace(" .", ".") });
    } else if (a !== 0n) {
      gaps.push({ kind: "PRIX", label: `${l.designation} : facturé ${fmt(a)} alors que la réception était à 0.` });
    }
    if (q(l.quantity) !== q(l.source.quantityLeft)) {
      gaps.push({ kind: "QUANTITE", label: `${l.designation} : ${formatScaled(q(l.quantity), 3).replace(/\.?0+$/, "")} facturé(s) pour ${formatScaled(q(l.source.quantityLeft), 3).replace(/\.?0+$/, "")} reçu(s) non encore facturé(s).` });
    }
  }
  return gaps;
}

/** Commande en retard : livraison attendue dépassée de plus de `graceDays` et pas entièrement reçue. */
export function isLateOrder(expectedDate: string | null, status: PurchaseStatus, todayIso: string, graceDays: number): boolean {
  if (!expectedDate || (status !== "VALIDE" && status !== "PARTIELLE")) return false;
  const d = new Date(`${expectedDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + graceDays);
  return d.toISOString().slice(0, 10) < todayIso;
}
