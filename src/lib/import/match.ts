import { FORM_TOKENS, GENERIC_TOKENS, normKey, tokens } from "./normalize";

export type ProductCandidate = { id: string; name: string; brandId: string | null; key: string; toks?: string[] };

export type MatchResult = { id: string; score: number; method: "exact" | "alias" | "fuzzy" } | null;

const NUM = /^\d+([.,]\d+)?$/;

/**
 * Rapprochement d'une désignation avec les produits existants.
 * 1) clé exacte / alias ; 2) inclusion de tokens (désignation courte ⊂ désignation canonique)
 *    en respectant les tokens numériques (100 ml ≠ 250 ml) et la marque si connue.
 */
/** Retire le nom de marque uniquement s'il est en préfixe ("GAMARDE EAU DE GAMARDE" → "EAU DE GAMARDE"). */
export function stripBrandPrefix(key: string, brandKeys: string[]) {
  for (const b of brandKeys) if (b && key.startsWith(b + " ")) return key.slice(b.length + 1);
  return key;
}

export function matchProduct(
  raw: string,
  brandId: string | null,
  candidates: ProductCandidate[],
  aliasIndex: Map<string, string>,
  brandKeys: string[],
  threshold = 0.75,
): MatchResult {
  const key = normKey(raw);
  if (!key || key.length < 3) return null;
  const viaAlias = aliasIndex.get(key);
  if (viaAlias) return { id: viaAlias, score: 1, method: "alias" };
  const exact = candidates.find((c) => c.key === key);
  if (exact) return { id: exact.id, score: 1, method: "exact" };

  const rawToks = tokens(stripBrandPrefix(key, brandKeys));
  const rawWords = rawToks.filter((t) => !NUM.test(t));
  const rawNums = rawToks.filter((t) => NUM.test(t));
  const rawForms = rawWords.filter((t) => FORM_TOKENS.has(t));
  if (rawWords.length === 0 || rawWords.join("").length < 3) return null;

  const hitTok = (t: string, set: Set<string>) =>
    set.has(t) || (t.length >= 4 && [...set].some((x) => x.length >= 4 && (x.startsWith(t) || t.startsWith(x))));

  let best: { id: string; score: number } | null = null;
  for (const c of candidates) {
    if (brandId && c.brandId && c.brandId !== brandId) continue;
    const cToks = c.toks ?? (c.toks = tokens(stripBrandPrefix(c.key, brandKeys)));
    const cSet = new Set(cToks);
    const cNums = cToks.filter((t) => NUM.test(t));
    const cWords = cToks.filter((t) => !NUM.test(t));
    if (cWords.length === 0) continue;
    // les nombres présents des deux côtés doivent coïncider (100 ml ≠ 250 ml)
    if (rawNums.length && cNums.length && !rawNums.every((n) => cNums.includes(n))) continue;
    // formes galéniques incompatibles (crème ≠ masque)
    const cForms = cWords.filter((t) => FORM_TOKENS.has(t));
    if (rawForms.length && cForms.length && !rawForms.some((f) => cForms.includes(f))) continue;
    const rawSet = new Set(rawWords);
    const hitsRaw = rawWords.filter((t) => hitTok(t, cSet));
    const hitsCand = cWords.filter((t) => hitTok(t, rawSet));
    // au moins un token commun qui ne soit pas une simple forme galénique (ou deux tokens communs)
    if (!hitsRaw.some((t) => !FORM_TOKENS.has(t)) && hitsRaw.length < 2) continue;
    // conflit : chaque côté possède un token distinctif que l'autre n'a pas (Crème Volume ≠ Crème Cou)
    const distinct = (t: string) => t.length >= 3 && !GENERIC_TOKENS.has(t);
    const rawLeft = rawWords.filter((t) => !hitsRaw.includes(t) && distinct(t));
    const candLeft = cWords.filter((t) => !hitsCand.includes(t) && distinct(t));
    if (rawLeft.length && candLeft.length) continue;
    const contRaw = hitsRaw.length / rawWords.length; // désignation importée retrouvée dans la canonique
    const contCand = hitsCand.length / cWords.length; // canonique retrouvée dans l'importée
    const cont = Math.max(contRaw, contCand);
    if (cont < threshold) continue;
    const score = cont * 0.7 + Math.min(contRaw, contCand) * 0.3;
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best ? { ...best, method: "fuzzy" } : null;
}

export type ClientCandidate = { id: string; name: string; key: string; code: string | null };

/** Rapprochement client : code exact, puis alias / clé exacte. Pas de flou (trop risqué). */
export function matchClient(
  rawName: string | null,
  code: string | null,
  candidates: ClientCandidate[],
  aliasIndex: Map<string, string>,
  codeIndex: Map<string, string>,
): MatchResult {
  if (code) {
    const byCode = codeIndex.get(code.trim().toUpperCase());
    if (byCode) return { id: byCode, score: 1, method: "exact" };
  }
  if (!rawName) return null;
  const key = normKey(rawName);
  if (!key) return null;
  const viaAlias = aliasIndex.get(key);
  if (viaAlias) return { id: viaAlias, score: 1, method: "alias" };
  const exact = candidates.find((c) => c.key === key);
  if (exact) return { id: exact.id, score: 1, method: "exact" };
  return null;
}

/** Marque : nom ou alias, ou préfixe de la désignation. */
export function matchBrand(
  value: string | null,
  brands: { id: string; name: string; aliases: string[] }[],
): string | null {
  if (!value) return null;
  const key = normKey(value);
  if (!key) return null;
  for (const b of brands) {
    const keys = [normKey(b.name), ...b.aliases.map(normKey)].filter(Boolean);
    if (keys.includes(key)) return b.id;
  }
  // préfixe (ex: "GAMARDE FLUIDE…", "Auracos PRO COLLAGENIUM")
  for (const b of brands) {
    const keys = [normKey(b.name), ...b.aliases.map(normKey)].filter(Boolean);
    if (keys.some((k) => key.startsWith(k + " "))) return b.id;
  }
  return null;
}
