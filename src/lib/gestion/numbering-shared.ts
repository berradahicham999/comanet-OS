/**
 * Numérotation des pièces — règles pures (partagé client / serveur, sans base).
 *
 * Un format de série combine du texte et trois jetons : {AAAA} (année sur 4 chiffres), {AA}
 * (sur 2), {MM} (mois) et {N:k} (compteur sur k chiffres). `FA{AAAA}{N:5}` donne FA202600198,
 * le format actuel des factures Sage de COMANET. Le compteur repart à 1 chaque année : le format
 * doit donc contenir l'année, sinon deux exercices produiraient le même numéro.
 */

const TOKEN = /\{(AAAA|AA|MM|N:(\d))\}/g;

/** Pourquoi un format est refusé, ou null s'il est valide. */
export function patternError(pattern: string): string | null {
  const p = pattern.trim();
  if (!p) return "Le format est vide.";
  const counters = [...p.matchAll(/\{N:(\d)\}/g)];
  if (counters.length !== 1) return "Le format doit contenir exactement un compteur {N:k} (k = nombre de chiffres, de 1 à 9).";
  const width = Number(counters[0][1]);
  if (width < 1 || width > 9) return "Le compteur {N:k} accepte de 1 à 9 chiffres.";
  if (!/\{AAAA\}|\{AA\}/.test(p)) return "Le format doit contenir l'année ({AAAA} ou {AA}) : le compteur repart à 1 chaque année.";
  const rest = p.replace(TOKEN, "");
  if (/[{}]/.test(rest)) return "Jeton inconnu : seuls {AAAA}, {AA}, {MM} et {N:k} sont reconnus.";
  if (/\s/.test(p)) return "Le format ne doit pas contenir d'espace.";
  return null;
}

/** Numéro d'une pièce. Refuse un compteur qui déborde de sa largeur plutôt que d'allonger le numéro en silence. */
export function formatNumber(pattern: string, parts: { year: number; month: number; seq: number }): string {
  const err = patternError(pattern);
  if (err) throw new Error(err);
  if (!Number.isInteger(parts.seq) || parts.seq < 1) throw new Error("Le compteur commence à 1.");
  return pattern.trim().replace(TOKEN, (_m, token: string, width?: string) => {
    if (token === "AAAA") return String(parts.year).padStart(4, "0");
    if (token === "AA") return String(parts.year % 100).padStart(2, "0");
    if (token === "MM") return String(parts.month).padStart(2, "0");
    const w = Number(width);
    const s = String(parts.seq);
    if (s.length > w) throw new Error(`Le compteur ${parts.seq} dépasse les ${w} chiffres prévus par le format ${pattern} : élargissez {N:${w}}.`);
    return s.padStart(w, "0");
  });
}

/**
 * Peut-on régler le prochain numéro d'une série pour une année ? Seulement tant qu'aucune pièce
 * n'y a été numérotée : c'est le cas de la reprise de la séquence Sage à la bascule. Ensuite,
 * avancer créerait un trou et reculer un doublon.
 */
export function nextNumberError(issuedMax: number, requestedNext: number): string | null {
  if (!Number.isInteger(requestedNext) || requestedNext < 1) return "Le prochain numéro doit être un entier supérieur ou égal à 1.";
  if (issuedMax > 0) return `Des pièces ont déjà été numérotées cette année (jusqu'au n° ${issuedMax}) : le prochain numéro ne se règle plus, la série doit rester continue.`;
  return null;
}

/** Aperçu du prochain numéro d'une série, sans rien réserver. */
export function previewNext(pattern: string, year: number, lastValue: number, month = 1): string | null {
  return patternError(pattern) ? null : formatNumber(pattern, { year, month, seq: lastValue + 1 });
}
