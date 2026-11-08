/**
 * Formats des écrans mobiles. Volontairement sans `@/lib/format` : ce module tire `date-fns`, trop lourd pour la coquille.
 */
const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export const fmtInt = (n: number) => int.format(n);
export const fmtMad = (n: number) => `${int.format(n)} MAD`;
