/**
 * Pièces de vente — règles pures (partagé client / serveur, sans base) : types, statuts,
 * transitions, blocages commerciaux, échéance, projection vers les ventes, pagination PDF.
 * L'écriture vit dans `documents.ts` (seul module qui change un statut) et `projection.ts`.
 */
import { SCALE, formatScaled, parseDecimal, rescale, roundDiv } from "./money";

export const DOC_TYPES = ["BL", "FACTURE", "AVOIR"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_TYPE_LABELS: Record<DocType, { one: string; many: string; series: string; simSeries: string }> = {
  BL: { one: "Bon de livraison", many: "Bons de livraison", series: "BL", simSeries: "SIMBL" },
  FACTURE: { one: "Facture", many: "Factures", series: "FA", simSeries: "SIMFA" },
  AVOIR: { one: "Avoir", many: "Avoirs", series: "AV", simSeries: "SIMAV" },
};

export const DOC_STATUSES = ["BROUILLON", "VALIDE", "LIVRE", "FACTURE_PARTIEL", "FACTURE", "ANNULE"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];
export const STATUS_META: Record<DocStatus, { label: string; tone: "gray" | "blue" | "accent" | "orange" | "green" | "red" }> = {
  BROUILLON: { label: "Brouillon", tone: "gray" },
  VALIDE: { label: "Validé", tone: "blue" },
  LIVRE: { label: "Livré", tone: "accent" },
  FACTURE_PARTIEL: { label: "Facturé en partie", tone: "orange" },
  FACTURE: { label: "Facturé", tone: "green" },
  ANNULE: { label: "Annulé", tone: "red" },
};
/** Libellé du statut selon le type (une facture « validée », un BL « validé »). */
export function statusLabel(type: DocType, status: DocStatus): string {
  if (type !== "BL" && status === "VALIDE") return type === "FACTURE" ? "Validée" : "Validé";
  return STATUS_META[status].label;
}

/** Actions possibles sur une pièce, selon son type et son statut. */
export function allowedActions(type: DocType, status: DocStatus, opts: { anyInvoiced?: boolean; requireDelivered?: boolean } = {}) {
  const draft = status === "BROUILLON";
  return {
    edit: draft,
    delete: draft,
    validate: draft,
    deliver: type === "BL" && status === "VALIDE",
    cancel: type === "BL" && (status === "VALIDE" || status === "LIVRE") && !opts.anyInvoiced,
    invoice: type === "BL" && invoiceable(status, !!opts.requireDelivered),
    credit: type === "FACTURE" && status === "VALIDE",
  };
}

/** Un BL peut être facturé s'il est validé (ou livré, si l'étape « Livré » est exigée) et pas entièrement facturé. */
export function invoiceable(status: DocStatus, requireDelivered: boolean): boolean {
  return requireDelivered ? status === "LIVRE" || status === "FACTURE_PARTIEL" : status === "VALIDE" || status === "LIVRE" || status === "FACTURE_PARTIEL";
}

/** Statut d'un BL d'après ses lignes facturées : aucune → inchangé, toutes → FACTURE, sinon FACTURE_PARTIEL. */
export function blStatusAfterInvoicing(current: DocStatus, lines: { quantity: string; invoicedQty: string }[]): DocStatus {
  let any = false, all = true;
  for (const l of lines) {
    const qn = parseDecimal(l.quantity, SCALE.qty) ?? 0n, inv = parseDecimal(l.invoicedQty, SCALE.qty) ?? 0n;
    if (inv > 0n) any = true;
    if (inv < qn) all = false;
  }
  if (!any) return current;
  return all ? "FACTURE" : "FACTURE_PARTIEL";
}

/** Quantité restant à facturer (ou à créditer) sur une ligne. */
export function remainingQty(quantity: string, done: string): string {
  const r = (parseDecimal(quantity, SCALE.qty) ?? 0n) - (parseDecimal(done, SCALE.qty) ?? 0n);
  return formatScaled(r > 0n ? r : 0n, SCALE.qty);
}

/* ------------------------------------------------------------------ */
/* Remises et blocages commerciaux                                     */
/* ------------------------------------------------------------------ */

/** Remise par défaut d'une ligne : remise du client sur la marque, sinon remise par défaut du client, sinon 0. */
export function defaultDiscount(clientDefaultPct: string | null, brandPct: string | null): string {
  return brandPct ?? clientDefaultPct ?? "0";
}

/** Montant lisible dans un message : arrondi au centime, virgule décimale (« 126,25 »). */
const frAmount = (v: bigint, scale: number) => formatScaled(rescale(v, scale, 2), 2).replace(".", ",");

export type IssueCode = "CLIENT_BLOQUE" | "REMISE" | "ENCOURS" | "VENTE_A_PERTE" | "IDENTITE";
export type CommercialIssue = { code: IssueCode; label: string };

/**
 * Dépassements qui demandent la levée d'un blocage (interrupteur « Lever un blocage commercial ») :
 * client bloqué, remise au-delà de sa remise autorisée + tolérance, encours au-delà du plafond,
 * prix net sous le coût de revient. Pure : les chiffres arrivent déjà calculés.
 */
export function commercialIssues(input: {
  clientBlocked: boolean;
  blockedReason: string | null;
  creditLimit: string | null;
  /** Encours TTC du client avant cette pièce. */
  outstanding: string;
  /** TTC de cette pièce. */
  documentTtc: string;
  tolerancePct: number;
  lines: { designation: string; discountPct: string; allowedDiscountPct: string; netUnitHt: string; cmup: string | null }[];
  globalDiscountPct: string;
}): CommercialIssue[] {
  const out: CommercialIssue[] = [];
  if (input.clientBlocked) out.push({ code: "CLIENT_BLOQUE", label: `Client bloqué${input.blockedReason ? ` : ${input.blockedReason}` : ""}.` });
  const tol = BigInt(Math.round(input.tolerancePct * 100));
  const g = parseDecimal(input.globalDiscountPct, SCALE.pct) ?? 0n;
  for (const l of input.lines) {
    const d = parseDecimal(l.discountPct, SCALE.pct) ?? 0n;
    const allowed = parseDecimal(l.allowedDiscountPct, SCALE.pct) ?? 0n;
    // Remise effective (cascade) comparée à la remise autorisée : 1 − (1 − d)(1 − g).
    const effective = 10000n - roundDiv((10000n - d) * (10000n - g), 10000n);
    if (effective > allowed + tol) {
      out.push({ code: "REMISE", label: `${l.designation} : remise ${formatScaled(effective, 2).replace(/\.?0+$/, "")} % au-delà de la remise autorisée (${formatScaled(allowed, 2).replace(/\.?0+$/, "")} %).` });
    }
    if (l.cmup !== null) {
      const net = parseDecimal(l.netUnitHt, SCALE.cost) ?? 0n, cost = parseDecimal(l.cmup, SCALE.cost) ?? 0n;
      if (net < cost) out.push({ code: "VENTE_A_PERTE", label: `${l.designation} : prix net ${frAmount(net, SCALE.cost)} MAD sous le coût de revient (${frAmount(cost, SCALE.cost)} MAD).` });
    }
  }
  if (input.creditLimit !== null) {
    const limit = parseDecimal(input.creditLimit, SCALE.money) ?? 0n;
    const after = (parseDecimal(input.outstanding, SCALE.money) ?? 0n) + (parseDecimal(input.documentTtc, SCALE.money) ?? 0n);
    if (after > limit) out.push({ code: "ENCOURS", label: `Encours après cette pièce : ${frAmount(after, SCALE.money)} MAD, au-delà du plafond de ${frAmount(limit, SCALE.money)} MAD.` });
  }
  return out;
}

/** Échéance : date + délai du client (ou délai par défaut), plafonné par le délai maximal réglé. */
export function dueDateOf(dateIso: string, paymentDays: number | null, defaultDays: number, maxDays: number): { days: number; dueDate: string } {
  const days = Math.min(Math.max(0, paymentDays ?? defaultDays), maxDays);
  const d = new Date(`${dateIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return { days, dueDate: d.toISOString().slice(0, 10) };
}

/* ------------------------------------------------------------------ */
/* Projection vers les ventes (sell-in)                                */
/* ------------------------------------------------------------------ */

export type CutoverLike = { mode: "OFF" | "PARALLELE" | "ACTIF"; date: string | null; sites: string[] };

/**
 * Une pièce alimente `sales` seulement si COMANET OS émet réellement les pièces (mode ACTIF), que
 * la pièce n'est pas une simulation, qu'elle date d'après la bascule et que son site bascule.
 * Avant cela, Sage fait foi : projeter compterait deux fois les mêmes ventes.
 */
export function shouldProject(c: CutoverLike, doc: { isSimulation: boolean; date: string; site: string }): boolean {
  return c.mode === "ACTIF" && !doc.isSimulation && !!c.date && doc.date >= c.date && c.sites.map((s) => s.toUpperCase()).includes(doc.site.toUpperCase());
}

export type ProjectionDoc = { type: DocType; number: string; date: string; clientId: string; site: string; salesRepName: string | null; legalName: string | null };
export type ProjectionLine = { id: string; productId: string | null; designation: string; quantity: string; freeQuantity: string; netHt: string };

/**
 * Lignes de vente d'une pièce projetée : un BL donne des ventes positives (date du BL), un avoir
 * des ventes négatives. Les services (sans article) ne sont pas du sell-in produit. Clé stable
 * `COS:<ligne>` : reprojeter ne duplique rien.
 */
export function projectionRows(doc: ProjectionDoc, lines: ProjectionLine[]) {
  const sign = doc.type === "AVOIR" ? -1n : 1n;
  return lines.filter((l) => l.productId).map((l) => {
    const qty = (parseDecimal(l.quantity, SCALE.qty) ?? 0n) * sign;
    const free = (parseDecimal(l.freeQuantity, SCALE.qty) ?? 0n) * sign;
    const amount = (parseDecimal(l.netHt, SCALE.money) ?? 0n) * sign;
    // Prix unitaire net (échelle 4) = montant (centimes) ÷ quantité (millièmes).
    const unit = qty === 0n ? null : formatScaled(roundDiv(amount * 10n ** 5n, qty), 4);
    return {
      date: doc.date, clientId: doc.clientId, productId: l.productId!, quantity: formatScaled(rescale(qty, SCALE.qty, 2), 2),
      amount: formatScaled(amount, 2), invoiceRef: null as string | null, lvcRef: doc.number, site: doc.site.toUpperCase(),
      salesRep: doc.salesRepName, unitPrice: unit, rawClient: doc.legalName, rawProduct: l.designation, lineHash: `COS:${l.id}`,
      source: "COMANET_OS", documentLineId: l.id, freeQuantity: free === 0n ? null : formatScaled(free, SCALE.qty),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Pagination des PDF (report des totaux exact et testable)            */
/* ------------------------------------------------------------------ */

/**
 * Découpe N lignes en pages : `first` lignes sur la première page (en-tête complet), `next` sur les
 * suivantes, et la dernière page doit laisser la place au bloc des totaux (`lastMax`).
 */
export function paginate(count: number, first = 20, next = 28, lastMax = 18): { from: number; to: number }[] {
  if (count <= 0) return [{ from: 0, to: 0 }];
  const pages: { from: number; to: number }[] = [];
  let i = 0;
  let cap = first;
  while (i < count) {
    const left = count - i;
    if (left <= Math.min(cap, lastMax)) { pages.push({ from: i, to: count }); break; }
    // Les lignes restantes tiennent sur la page mais pas avec les totaux : on en garde une pour la dernière page.
    const take = Math.min(cap, left) === left ? left - 1 : Math.min(cap, left);
    pages.push({ from: i, to: i + take });
    i += take;
    cap = next;
  }
  return pages;
}

/* ------------------------------------------------------------------ */
/* Envoi                                                               */
/* ------------------------------------------------------------------ */

/** Numéro WhatsApp international d'un téléphone marocain (06… → 2126…), ou null s'il est illisible. */
export function waPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `212${d.slice(1)}`;
  return /^\d{10,15}$/.test(d) ? d : null;
}
