/**
 * Formats des écrans mobiles. Volontairement sans `@/lib/format` : ce module tire `date-fns`, trop lourd pour la coquille.
 */
const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export const fmtInt = (n: number) => int.format(n);
export const fmtMad = (n: number) => `${int.format(n)} MAD`;

/** « 8,1 k MAD » : un montant lu d'un coup d'œil, dans une liste. */
export function fmtMadCompact(n: number) {
  if (Math.abs(n) < 1000) return `${int.format(n)} MAD`;
  const k = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  return Math.abs(n) >= 1e6 ? `${k.format(n / 1e6)} M MAD` : `${k.format(n / 1000)} k MAD`;
}
