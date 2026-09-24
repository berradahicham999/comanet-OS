/**
 * Lecture des formulaires de la gestion commerciale (server actions). Les nombres décimaux
 * passent par `money.ts` : « 25,5 » et « 25.5 » donnent la même valeur exacte, jamais un float.
 */
import { formatScaled, parseDecimal } from "./money";

export const str = (fd: FormData, k: string): string | null => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};

export const bool = (fd: FormData, k: string): boolean => fd.get(k) !== null && fd.get(k) !== "off";

export const isUuid = (v: string | null | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);

/** Entier facultatif ; lève une erreur lisible si la saisie n'est pas un entier dans les bornes. */
export function intOrNull(fd: FormData, k: string, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  const v = str(fd, k);
  if (v === null) return null;
  const n = Number(v.replace(/\s/g, ""));
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} : nombre entier entre ${min} et ${max} attendu.`);
  return n;
}

/** Décimal facultatif, rendu au format base de données à l'échelle voulue. */
export function decimalOrNull(fd: FormData, k: string, label: string, scale: number, opts: { min?: number; maxExclusive?: number } = {}): string | null {
  const v = str(fd, k);
  if (v === null) return null;
  const d = parseDecimal(v, scale);
  if (d === null) throw new Error(`${label} : nombre illisible (« ${v} »).`);
  const s = formatScaled(d, scale);
  if (opts.min !== undefined && Number(s) < opts.min) throw new Error(`${label} : minimum ${opts.min}.`);
  if (opts.maxExclusive !== undefined && Number(s) >= opts.maxExclusive) throw new Error(`${label} : doit rester sous ${opts.maxExclusive}.`);
  return s;
}

/** Message d'une erreur pour un paramètre d'URL `?error=`. */
export const errorParam = (e: unknown) => encodeURIComponent((e as Error)?.message ?? String(e));
