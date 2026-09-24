/**
 * Montants d'une pièce de vente — LA définition (partagé client / serveur, sans base).
 *
 * Règles (docs/plan-gestion-commerciale.md §5) :
 *  - remise ligne puis remise globale, en CASCADE : net = qté × PU × (1 − r ligne) × (1 − r globale) ;
 *  - un seul arrondi par montant (au centime, demi s'éloignant de zéro) ;
 *  - TVA calculée ligne par ligne sur le net arrondi ; totaux = sommes des lignes ;
 *  - le « Total HT » du pied est la somme des lignes après remise ligne, avant remise globale ;
 *    la remise globale est la différence avec le « Net HT » (la paire Total HT / Net HT de Sage).
 * Tout est en entiers : quantités en millièmes, prix et montants en centimes, taux en centièmes de %.
 */
import { SCALE, formatScaled, parseDecimal, roundDiv } from "./money";

export type CalcLineInput = { quantity: string; unitPriceHt: string; discountPct: string; taxRate: string };
export type CalcLine = { grossHt: string; netHt: string; vatAmount: string; ttc: string };
export type CalcDocument = {
  lines: CalcLine[];
  grossHt: string;
  globalDiscountAmount: string;
  netHt: string;
  vatTotal: string;
  ttc: string;
  vatBreakdown: { rate: string; base: string; vat: string }[];
};

const BP = 10000n; // 100,00 % en centièmes de pourcent
const q = (v: string) => parseDecimal(v, SCALE.qty) ?? 0n;
const m = (v: string) => parseDecimal(v, SCALE.money) ?? 0n;
const pct = (v: string) => parseDecimal(v, SCALE.pct) ?? 0n;

function lineAmounts(l: CalcLineInput, globalDiscountPct: string) {
  const qty = q(l.quantity), pu = m(l.unitPriceHt), d1 = pct(l.discountPct), d2 = pct(globalDiscountPct), rate = pct(l.taxRate);
  if (d1 < 0n || d1 >= BP || d2 < 0n || d2 >= BP) throw new Error("Remise : entre 0 et 99,99 %.");
  if (rate < 0n || rate >= BP) throw new Error("Taux de TVA invalide.");
  const gross = roundDiv(qty * pu * (BP - d1), 1000n * BP);
  const net = roundDiv(qty * pu * (BP - d1) * (BP - d2), 1000n * BP * BP);
  const vat = roundDiv(net * rate, BP);
  return { gross, net, vat, rate };
}

export function computeLine(l: CalcLineInput, globalDiscountPct = "0"): CalcLine {
  const a = lineAmounts(l, globalDiscountPct);
  return { grossHt: formatScaled(a.gross, 2), netHt: formatScaled(a.net, 2), vatAmount: formatScaled(a.vat, 2), ttc: formatScaled(a.net + a.vat, 2) };
}

export function computeDocument(lines: CalcLineInput[], globalDiscountPct = "0"): CalcDocument {
  let gross = 0n, net = 0n, vat = 0n;
  const byRate = new Map<string, { base: bigint; vat: bigint }>();
  const out: CalcLine[] = [];
  for (const l of lines) {
    const a = lineAmounts(l, globalDiscountPct);
    gross += a.gross; net += a.net; vat += a.vat;
    const k = formatScaled(a.rate, 2);
    const r = byRate.get(k) ?? { base: 0n, vat: 0n };
    r.base += a.net; r.vat += a.vat;
    byRate.set(k, r);
    out.push({ grossHt: formatScaled(a.gross, 2), netHt: formatScaled(a.net, 2), vatAmount: formatScaled(a.vat, 2), ttc: formatScaled(a.net + a.vat, 2) });
  }
  return {
    lines: out,
    grossHt: formatScaled(gross, 2),
    globalDiscountAmount: formatScaled(gross - net, 2),
    netHt: formatScaled(net, 2),
    vatTotal: formatScaled(vat, 2),
    ttc: formatScaled(net + vat, 2),
    vatBreakdown: [...byRate.entries()].sort((a, b) => (Number(a[0]) < Number(b[0]) ? 1 : -1)).map(([rate, v]) => ({ rate, base: formatScaled(v.base, 2), vat: formatScaled(v.vat, 2) })),
  };
}

/** P.U. HT de base d'un article : PPH TTC ÷ (1 + TVA), arrondi au centime (199,00 à 20 % → 165,83). */
export function baseUnitPriceHt(publicPriceTtc: string | null, taxRate: string): string | null {
  if (publicPriceTtc === null) return null;
  const ttc = m(publicPriceTtc), rate = pct(taxRate);
  return formatScaled(roundDiv(ttc * BP, BP + rate), 2);
}

/** Prix net unitaire HT d'une ligne (après les deux remises), pour comparer au coût de revient. */
export function netUnitPriceHt(l: CalcLineInput, globalDiscountPct = "0"): string {
  const pu = m(l.unitPriceHt), d1 = pct(l.discountPct), d2 = pct(globalDiscountPct);
  return formatScaled(roundDiv(pu * (BP - d1) * (BP - d2), BP * BP), 2);
}

/* ------------------------------------------------------------------ */
/* Montant en toutes lettres (français)                                */
/* ------------------------------------------------------------------ */

const UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"];
const TENS: Record<number, string> = { 2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante" };

function below100(n: number): string {
  if (n <= 16) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  const t = Math.floor(n / 10), u = n % 10;
  if (t === 7 || t === 9) {
    const base = t === 7 ? "soixante" : "quatre-vingt";
    if (t === 7 && u === 1) return "soixante et onze";
    return `${base}-${below100(10 + u)}`;
  }
  if (t === 8) return u === 0 ? "quatre-vingts" : `quatre-vingt-${UNITS[u]}`;
  if (u === 0) return TENS[t];
  if (u === 1) return `${TENS[t]} et un`;
  return `${TENS[t]}-${UNITS[u]}`;
}

/** Moins de 1 000. `plural` : « cents » / « quatre-vingts » prennent le s (faux devant « mille »). */
function below1000(n: number, plural: boolean): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h === 1) parts.push("cent");
  else if (h > 1) parts.push(r === 0 && plural ? `${UNITS[h]} cents` : `${UNITS[h]} cent`);
  if (r > 0) parts.push(r === 80 && !plural ? "quatre-vingt" : below100(r));
  return parts.join(" ");
}

/** Nombre entier positif en lettres, orthographe traditionnelle (celle des factures Sage). */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error("Entier positif attendu.");
  if (n === 0) return UNITS[0];
  const parts: string[] = [];
  const billions = Math.floor(n / 1e9), millions = Math.floor((n % 1e9) / 1e6), thousands = Math.floor((n % 1e6) / 1000), rest = n % 1000;
  if (billions) parts.push(`${below1000(billions, true)} milliard${billions > 1 ? "s" : ""}`);
  if (millions) parts.push(`${below1000(millions, true)} million${millions > 1 ? "s" : ""}`);
  if (thousands) parts.push(thousands === 1 ? "mille" : `${below1000(thousands, false)} mille`);
  if (rest) parts.push(below1000(rest, true));
  return parts.join(" ");
}

/** « mille sept cent quatre-vingt-dix MAD et quatre-vingt-dix-huit cents » (libellés de devise réglables). */
export function amountInWords(amount: string, major = "MAD", minor = "cents"): string {
  const v = m(amount);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const units = Number(a / 100n), cents = Number(a % 100n);
  const s = `${numberToWords(units)} ${major}${cents ? ` et ${numberToWords(cents)} ${minor}` : ""}`;
  return neg ? `moins ${s}` : s;
}
