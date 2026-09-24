/**
 * Contenu d'un PDF de pièce — pur (partagé, testable) : lignes à imprimer (y compris les
 * en-têtes de BL d'une facture regroupée et les lignes d'UG), formats Sage, pages et reports.
 * Le rendu graphique vit dans `pdf.tsx`.
 */
import { SCALE, formatScaled, parseDecimal, rescale, roundDiv } from "./money";
import { paginate, type DocType } from "./documents-shared";

/** Format des montants Sage : « 1.790,98 » (point des milliers, virgule décimale). */
export function fmtSage(value: string | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "";
  const v = parseDecimal(value, 4);
  if (v === null) return "";
  const r = rescale(v, 4, decimals);
  const s = formatScaled(r < 0n ? -r : r, decimals);
  const [int, frac] = s.split(".");
  return `${r < 0n ? "-" : ""}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${frac ? "," + frac : ""}`;
}

export const fmtDateFr = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

export type PdfLine = {
  ref: string | null; designation: string; quantity: string; freeQuantity: string; unitPriceHt: string; publicPriceTtc: string | null;
  discountPct: string; grossHt: string; netHt: string; vatAmount: string; ttc: string; sourceNumber: string | null; sourceDate: string | null;
  lotAllocations: { lotNumber: string; expiryDate: string | null; qty: string }[];
};

export type PdfRow =
  | { kind: "group"; label: string }
  | { kind: "line"; ref: string; designation: string; lot: string; quantity: string; free: string; unitPriceHt: string; publicPriceTtc: string; discount: string; netHt: string; netUnit: string; vat: string; ttc: string; amount: bigint; amountTtc: bigint }
  | { kind: "free"; ref: string; designation: string; quantity: string };

/** Lignes imprimées : en-tête « BL n° … du … » quand la facture regroupe des BL, une ligne d'UG sous l'article. */
export function pdfRows(type: DocType, lines: PdfLine[]): PdfRow[] {
  const rows: PdfRow[] = [];
  const grouped = type === "FACTURE" && new Set(lines.map((l) => l.sourceNumber).filter(Boolean)).size > 0;
  let lastSource: string | null = null;
  for (const l of lines) {
    if (grouped && l.sourceNumber && l.sourceNumber !== lastSource) {
      rows.push({ kind: "group", label: `BL n° ${l.sourceNumber} du ${fmtDateFr(l.sourceDate)}` });
      lastSource = l.sourceNumber;
    }
    // Montant HT de la ligne : après remise ligne, avant remise globale (le pied fait Total HT − remise = Net HT, comme Sage).
    const qty = parseDecimal(l.quantity, SCALE.qty) ?? 0n, gross = parseDecimal(l.grossHt, SCALE.money) ?? 0n;
    const lot = l.lotAllocations.map((a) => `${a.lotNumber}${a.expiryDate ? ` (${fmtDateFr(a.expiryDate)})` : ""}`).join(", ");
    rows.push({
      kind: "line", ref: l.ref ?? "", designation: l.designation, lot, quantity: fmtSage(l.quantity), free: parseDecimal(l.freeQuantity, SCALE.qty) ? fmtSage(l.freeQuantity) : "",
      unitPriceHt: fmtSage(l.unitPriceHt), publicPriceTtc: fmtSage(l.publicPriceTtc), discount: parseDecimal(l.discountPct, SCALE.pct) ? fmtSage(l.discountPct) : "",
      netHt: fmtSage(l.grossHt), netUnit: qty ? fmtSage(formatScaled(roundDiv(gross * 1000n, qty), 2)) : "", vat: fmtSage(l.vatAmount), ttc: fmtSage(l.ttc), amount: gross, amountTtc: parseDecimal(l.ttc, 2) ?? 0n,
    });
    if (type !== "BL" && (parseDecimal(l.freeQuantity, SCALE.qty) ?? 0n) > 0n) rows.push({ kind: "free", ref: l.ref ?? "", designation: `${l.designation} (UG)`, quantity: fmtSage(l.freeQuantity) });
  }
  return rows;
}

/** Remise globale du pied : Total HT − Net HT. */
export function globalDiscountAmount(grossHt: string, netHt: string): string {
  return fmtSage(formatScaled((parseDecimal(grossHt, SCALE.money) ?? 0n) - (parseDecimal(netHt, SCALE.money) ?? 0n), 2));
}

/** Pages et reports : montant HT et TTC cumulés à reporter en bas de chaque page non finale. */
export function pdfPages(rows: PdfRow[]) {
  const pages = paginate(rows.length, 32, 38, 20);
  let carryHt = 0n, carryTtc = 0n;
  return pages.map((p, i) => {
    const slice = rows.slice(p.from, p.to);
    const reportHt = carryHt, reportTtc = carryTtc;
    for (const r of slice) if (r.kind === "line") { carryHt += r.amount; carryTtc += r.amountTtc; }
    return {
      index: i + 1, count: pages.length, rows: slice,
      report: i > 0 ? { ht: fmtSage(formatScaled(reportHt, 2)), ttc: fmtSage(formatScaled(reportTtc, 2)) } : null,
      toCarry: i < pages.length - 1 ? { ht: fmtSage(formatScaled(carryHt, 2)), ttc: fmtSage(formatScaled(carryTtc, 2)) } : null,
    };
  });
}
