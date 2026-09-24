/**
 * Fiche client de la gestion commerciale — règles pures (partagé client / serveur, sans base).
 *
 * Deux questions : ce client est-il prêt à être facturé (identité légale complète) ? et ce
 * client que l'on crée n'existe-t-il pas déjà (doublon par ICE, nom, téléphone) ?
 */
import { normKey, tokens } from "@/lib/import/normalize";

/** ICE : 15 chiffres. On ne garde que les chiffres saisis (espaces, points, tirets tolérés). */
export function normalizeIce(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d ? d : null;
}
export const isValidIce = (v: string | null | undefined) => /^\d{15}$/.test(normalizeIce(v) ?? "");

/** Téléphone réduit à ses 9 derniers chiffres : « +212 522 12 34 56 » et « 0522 123456 » se rejoignent. */
export function phoneKey(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : null;
}

export type BillingFields = {
  legalName: string | null;
  ice: string | null;
  billingAddress: string | null;
  city: string | null;
  accountCode: string | null;
  paymentDays: number | null;
  paymentModeKey: string | null;
};

/**
 * Prêt à facturer ? `missing` bloque une facture (mentions obligatoires : raison sociale, ICE,
 * adresse, ville) ; `recommended` ne bloque rien mais évite une saisie à chaque pièce.
 */
export function billingReadiness(c: BillingFields): { ready: boolean; missing: string[]; recommended: string[] } {
  const missing: string[] = [];
  if (!c.legalName?.trim()) missing.push("Raison sociale");
  if (!c.ice?.trim()) missing.push("ICE");
  else if (!isValidIce(c.ice)) missing.push("ICE (15 chiffres)");
  if (!c.billingAddress?.trim()) missing.push("Adresse de facturation");
  if (!c.city?.trim()) missing.push("Ville");
  const recommended: string[] = [];
  if (!c.accountCode?.trim()) recommended.push("Code client Sage");
  if (c.paymentDays === null || c.paymentDays === undefined) recommended.push("Délai de paiement");
  if (!c.paymentModeKey) recommended.push("Mode de paiement");
  return { ready: missing.length === 0, missing, recommended };
}

export type ExistingClient = {
  id: string;
  name: string;
  legalName: string | null;
  ice: string | null;
  phone: string | null;
  city: string | null;
  active: boolean;
  aliases?: string[];
};

export type DuplicateCandidate = { id: string; name: string; active: boolean; reasons: string[]; score: number };

/** Similarité de deux libellés : part des mots du plus court présents dans le plus long. */
function overlap(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let n = 0;
  for (const t of small) if (big.has(t)) n++;
  return n / small.size;
}

/**
 * Clients existants qui ressemblent à celui qu'on s'apprête à créer. Même ICE : doublon certain.
 * Même nom (normalisé) ou même libellé brut : doublon quasi certain. Nom proche dans la même
 * ville ou même téléphone : à vérifier. Triés du plus probable au moins probable.
 */
export function duplicateCandidates(
  input: { name: string; legalName?: string | null; ice?: string | null; phone?: string | null; city?: string | null },
  existing: ExistingClient[],
  excludeId?: string,
): DuplicateCandidate[] {
  const ice = normalizeIce(input.ice);
  const names = [input.name, input.legalName].filter((x): x is string => !!x && !!x.trim()).map(normKey);
  const phone = phoneKey(input.phone);
  const city = normKey(input.city);
  const out: DuplicateCandidate[] = [];
  for (const c of existing) {
    if (c.id === excludeId) continue;
    const reasons: string[] = [];
    let score = 0;
    if (ice && normalizeIce(c.ice) === ice) { reasons.push("Même ICE"); score += 100; }
    const theirs = [c.name, c.legalName, ...(c.aliases ?? [])].filter((x): x is string => !!x).map(normKey);
    if (names.some((n) => theirs.includes(n))) { reasons.push("Même nom"); score += 80; }
    else if (city && normKey(c.city) === city && names.some((n) => theirs.some((t) => overlap(n, t) >= 0.75))) { reasons.push("Nom proche, même ville"); score += 40; }
    if (phone && phoneKey(c.phone) === phone) { reasons.push("Même téléphone"); score += 50; }
    if (score > 0) out.push({ id: c.id, name: c.name, active: c.active, reasons, score });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
