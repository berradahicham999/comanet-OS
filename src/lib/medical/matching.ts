/**
 * Médical v2 — rapprochement d'un nom de médecin écrit à la main (ordonnances) avec le fichier `doctors`.
 * Pur, sans base. Seule définition de la normalisation d'un nom de médecin et de son score de similarité.
 *
 * Normalisation : titres retirés (Dr, Docteur, Pr, Professeur…), accents et ponctuation enlevés, mots
 * triés (l'ordre prénom / nom n'importe pas). Score : chaque mot d'un côté est rapproché du mot le plus
 * proche de l'autre (Jaro-Winkler, qui tolère une faute de frappe ; une initiale vaut le mot qui commence
 * par elle), moyenne pondérée par la longueur, dans les deux sens. Deux villes connues et différentes
 * abaissent le score. Un rapprochement n'est automatique qu'au-dessus du seuil ET nettement devant le
 * second candidat (homonymes) ; sinon il part en file de résolution, avec les meilleures suggestions.
 */
import { normKey } from "@/lib/import/normalize";
import { cityKey } from "@/lib/animations-shared";

const TITLES = new Set(["dr", "dre", "docteur", "doctoresse", "doc", "pr", "prof", "professeur", "professeure", "mr", "mme", "mlle", "m"]);

/** Mots significatifs d'un nom de médecin, triés. */
export function doctorNameTokens(raw: string | null | undefined): string[] {
  return normKey(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !TITLES.has(t))
    .sort();
}

/** Clé d'alias d'un libellé médecin : nom normalisé + ville normalisée (les homonymes de villes différentes restent distincts). */
export function doctorAliasKey(raw: string, city: string | null | undefined): string {
  const name = doctorNameTokens(raw).join(" ");
  const c = city ? cityKey(city).toLowerCase() : "";
  return c ? `${name}|${c}` : name;
}

/** Similarité de Jaro-Winkler (0-1). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function tokenSim(t: string, u: string): number {
  if (t === u) return 1;
  // Une initiale (« A. Bennani ») vaut le prénom qui commence par elle, sans en être la preuve.
  if (t.length === 1 || u.length === 1) return t[0] === u[0] ? 0.9 : 0;
  return jaroWinkler(t, u);
}

function directional(from: string[], to: string[]): number {
  let num = 0;
  let den = 0;
  for (const t of from) {
    const w = Math.max(2, t.length);
    let best = 0;
    for (const u of to) best = Math.max(best, tokenSim(t, u));
    num += best * w;
    den += w;
  }
  return den ? num / den : 0;
}

/** Score de similarité de deux noms de médecin (0-1), ville comprise si connue des deux côtés. */
export function doctorNameScore(a: string[], b: string[], cityA?: string | null, cityB?: string | null): number {
  if (!a.length || !b.length) return 0;
  let s = (directional(a, b) + directional(b, a)) / 2;
  const ca = cityA ? cityKey(cityA) : "";
  const cb = cityB ? cityKey(cityB) : "";
  if (ca && cb && ca !== cb) s *= 0.85;
  return Math.round(s * 1000) / 1000;
}

export type DoctorCandidate = { id: string; tokens: string[]; city: string | null; label: string };

export type DoctorMatch =
  | { kind: "ALIAS"; doctorId: string; score: 1 }
  | { kind: "AUTO"; doctorId: string; score: number }
  | { kind: "NONE"; suggestions: { doctorId: string; label: string; score: number }[] };

/**
 * Rapproche un libellé brut : 1) alias connu (avec ville, puis sans) ; 2) meilleur score si au-dessus
 * de `autoScore` et à au moins `margin` du second ; 3) sinon file de résolution avec les suggestions
 * au-dessus de `suggestScore`.
 */
export function matchDoctor(
  raw: string,
  city: string | null,
  candidates: DoctorCandidate[],
  aliases: Map<string, string>,
  opts: { autoScore: number; suggestScore: number; margin?: number; maxSuggestions?: number },
): DoctorMatch {
  const viaAlias = aliases.get(doctorAliasKey(raw, city)) ?? aliases.get(doctorAliasKey(raw, null));
  if (viaAlias) return { kind: "ALIAS", doctorId: viaAlias, score: 1 };
  const toks = doctorNameTokens(raw);
  if (!toks.length || toks.join("").length < 3) return { kind: "NONE", suggestions: [] };
  const scored = candidates
    .map((c) => ({ c, score: doctorNameScore(toks, c.tokens, city, c.city) }))
    .filter((x) => x.score >= opts.suggestScore)
    .sort((x, y) => y.score - x.score);
  const [first, second] = scored;
  const margin = opts.margin ?? 0.03;
  // Un nom identique l'emporte sur un nom voisin (Karima ≠ Karim) ; sinon il faut une avance nette.
  const clear = !second || first.score - second.score >= margin || (first.score === 1 && second.score < 1);
  if (first && first.score >= opts.autoScore && clear) {
    return { kind: "AUTO", doctorId: first.c.id, score: first.score };
  }
  return { kind: "NONE", suggestions: scored.slice(0, opts.maxSuggestions ?? 3).map((x) => ({ doctorId: x.c.id, label: x.c.label, score: x.score })) };
}

/** Prépare un candidat depuis une fiche médecin. */
export function doctorCandidate(d: { id: string; firstName: string; lastName: string; city: string | null }): DoctorCandidate {
  return { id: d.id, tokens: doctorNameTokens(`${d.firstName} ${d.lastName}`), city: d.city, label: `Dr ${d.firstName} ${d.lastName}${d.city ? ` — ${d.city}` : ""}` };
}
