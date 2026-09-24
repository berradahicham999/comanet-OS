/**
 * Nombres décimaux exacts pour la gestion commerciale (partagé client / serveur, sans base).
 *
 * Aucun montant, prix, quantité ou coût n'est calculé en virgule flottante : chaque valeur est
 * un entier (BigInt) à une échelle fixe — « 165.83 » à l'échelle 2 vaut 16583n, « 6.000 » à
 * l'échelle 3 vaut 6000n. Un seul arrondi par résultat : au plus proche, le demi s'éloignant de
 * zéro (746,235 → 746,24 ; −746,235 → −746,24), si bien qu'un avoir annule sa facture au centime.
 *
 * Échelles utilisées : montants 2, quantités 3, coûts unitaires et CMUP 4, pourcentages 2.
 */

export const SCALE = { money: 2, qty: 3, cost: 4, pct: 2 } as const;

const TEN = (n: number) => 10n ** BigInt(n);

/** Division entière arrondie au plus proche, le demi s'éloignant de zéro. */
export function roundDiv(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("Division par zéro.");
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return neg ? -q : q;
}

/** Change l'échelle d'une valeur, avec arrondi si l'on perd des décimales. */
export function rescale(v: bigint, from: number, to: number): bigint {
  if (to === from) return v;
  return to > from ? v * TEN(to - from) : roundDiv(v, TEN(from - to));
}

/**
 * Lit un nombre saisi ou stocké : « 165.83 », « 165,83 », « 1 234,56 », « 1.234,56 », « -3 ».
 * Quand virgule et point coexistent, le dernier est le séparateur décimal. Renvoie null pour
 * une saisie vide ou illisible — jamais 0 par défaut.
 */
export function parseDecimal(value: string | number | null | undefined, scale: number): bigint | null {
  if (value === null || value === undefined) return null;
  let s: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    s = value.toFixed(Math.min(20, scale + 6));
  } else {
    s = value.replace(/[\s  ]/g, "");
  }
  if (s === "") return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    if (s.indexOf(",") !== lastComma) return null;
    s = s.replace(",", ".");
  }
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
  const neg = m[1] === "-";
  const int = m[2] || "0";
  const frac = m[3] ?? "";
  const digits = BigInt(int + frac);
  const v = rescale(digits, frac.length, scale);
  return neg ? -v : v;
}

/** Valeur au format base de données (« 165.83 », « -6.000 ») : point décimal, pas de séparateur de milliers. */
export function formatScaled(v: bigint, scale: number): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = a.toString().padStart(scale + 1, "0");
  const int = scale ? s.slice(0, -scale) : s;
  const frac = scale ? s.slice(-scale) : "";
  return `${neg ? "-" : ""}${int}${scale ? "." + frac : ""}`;
}

/** Relit une valeur `numeric` renvoyée par Postgres (chaîne) à l'échelle voulue ; null si vide. */
export function fromDb(value: string | null | undefined, scale: number): bigint | null {
  return value === null || value === undefined ? null : parseDecimal(value, scale);
}

/** Pour l'affichage uniquement (graphiques, formats) : jamais pour un calcul. */
export function toDisplayNumber(v: bigint, scale: number): number {
  return Number(formatScaled(v, scale));
}

/**
 * Affichage français d'une valeur exacte : « 1 790,98 ». `decimals` fixe le nombre de décimales
 * affichées (arrondi au plus proche), sans jamais repasser par un float pour arrondir.
 */
export function fmtDecimal(v: bigint, scale: number, decimals = scale): string {
  const r = rescale(v, scale, decimals);
  const s = formatScaled(r, decimals);
  const [int, frac] = s.replace("-", "").split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${r < 0n ? "−" : ""}${grouped}${frac ? "," + frac : ""}`;
}

/**
 * Coût moyen unitaire pondéré après une entrée (CMUP) : (stock × CMUP + qté × coût) ÷ (stock + qté).
 * Quantités à l'échelle 3, coûts à l'échelle 4. Un stock nul ou négatif, ou un CMUP inconnu,
 * repart du coût de l'entrée : on ne pondère pas avec une quantité qui n'existe pas.
 */
export function nextCmup(stockQty: bigint, cmup: bigint | null, inQty: bigint, inCost: bigint): bigint {
  if (inQty <= 0n) throw new Error("Le CMUP ne se recalcule que sur une entrée.");
  if (cmup === null || stockQty <= 0n) return inCost;
  return roundDiv(stockQty * cmup + inQty * inCost, stockQty + inQty);
}

/** Valeur d'une quantité à un coût unitaire, en centimes : qté (éch. 3) × coût (éch. 4) → montant (éch. 2). */
export function valueOf(qty: bigint, unitCost: bigint): bigint {
  return roundDiv(qty * unitCost, TEN(SCALE.qty + SCALE.cost - SCALE.money));
}

/** Quantité lisible : « 12 », « 12,5 », « −6 » (sans décimales inutiles). Null → « — ». */
export function fmtQty(value: string | null | undefined): string {
  const v = value === null || value === undefined ? null : parseDecimal(value, SCALE.qty);
  if (v === null) return "—";
  const decimals = v % 1000n === 0n ? 0 : v % 100n === 0n ? 1 : v % 10n === 0n ? 2 : 3;
  return fmtDecimal(v, SCALE.qty, decimals);
}

/** Montant lisible à 2 décimales (« 1 790,98 »), depuis une valeur `numeric` ; null → « — ». */
export function fmtMoney(value: string | null | undefined, decimals = 2): string {
  const v = value === null || value === undefined ? null : parseDecimal(value, 4);
  return v === null ? "—" : fmtDecimal(v, 4, decimals);
}
