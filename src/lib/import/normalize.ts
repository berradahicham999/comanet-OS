/** Normalisation de libellés pour le rapprochement (clients, produits, marques). */

export function stripAccents(s: string) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Clé normalisée : majuscules, sans accents, alphanumérique + espaces simples. */
export function normKey(s: unknown): string {
  if (s === null || s === undefined) return "";
  return stripAccents(String(s))
    .toUpperCase()
    .replace(/(\d)([A-Z])/g, "$1 $2") // 30ML → 30 ML, 40G → 40 G
    .replace(/([A-Z])(\d)/g, "$1 $2") // SPF50 → SPF 50
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "TUBE", "BOTTLE", "PUMP", "FOAMER", "ROLL", "ON", "FLACON", "POT", "PACK", "BOITE", "BOX", "STICK", "STICKS",
  "ML", "G", "GR", "KG", "L", "CL", "MG", "PCS", "M",
  "DE", "DU", "DES", "LA", "LE", "LES", "ET", "AU", "AUX", "A", "EN", "UN", "UNE", "THE", "AND", "WITH", "FOR", "POUR", "OF",
  "SARL", "SARLAU", "SA", "STE", "SOCIETE", "SOC", "SNC", "EURL", "AU",
  "EXP", "MV", "VF",
]);

/** Synonymes FR/EN et variantes fréquentes ramenés à une forme unique. */
const SYNONYMS: Record<string, string> = {
  MASK: "MASQUE", CREAM: "CREME", FLUID: "FLUIDE", EMULSION: "EMULSION", EYE: "YEUX", EYES: "YEUX", NECK: "COU",
  MILK: "LAIT", OIL: "HUILE", CLEANSER: "NETTOYANT", CLEANSING: "NETTOYANT", PURIFYING: "PURITY", PURIFIANT: "PURITY",
  MOISTURIZING: "HYDRATANT", HYDRATING: "HYDRATANT", RICH: "RICHE", LIGHT: "LEGER", NIGHT: "NUIT", DAY: "JOUR",
  RADIANCE: "ECLAT", GLOW: "ECLAT", SOOTHING: "APAISANT", REPAIR: "REPARATEUR", REPARATRICE: "REPARATEUR",
  FIRMING: "FERMETE", FIRMNESS: "FERMETE", ANTIAGE: "ANTI AGE", SUN: "SOLAIRE", SUNSCREEN: "SOLAIRE",
  CREMES: "CREME", SERUMS: "SERUM", MASQUES: "MASQUE", GLYCERINE: "GLYCERIN", ALPHABRIGHT: "ALPHA BRIGHT",
  PROCOLLAGENIUM: "PRO COLLAGENIUM", COLLAGENIUM: "COLLAGENIUM", MUTLI: "MULTI", MULTIVIT: "MULTI VIT", MULTIVITS: "MULTI VIT",
  FOAMER: "MOUSSE", FOAM: "MOUSSE", CLARIFIANTE: "CLARIFIANT", PURIFIANTE: "PURIFIANT", HYDRATANTE: "HYDRATANT",
  APAISANTE: "APAISANT", RAFFERMISSANTE: "RAFFERMISSANT", DECOLLETAGE: "DECOLLETE", CONCENTRATE: "CONCENTRE",
};

/** Tokens de « forme galénique » : deux produits de formes différentes ne sont jamais rapprochés. */
export const FORM_TOKENS = new Set(["CREME", "SERUM", "MASQUE", "FLUIDE", "GEL", "LOTION", "HUILE", "LAIT", "EMULSION", "ELIXIR", "GOMMAGE", "NETTOYANT", "MOUSSE", "BRUME", "SPRAY", "CONCENTRE", "CONCENTRATE", "BAUME", "SAVON", "SHAMPOOING", "GLYCERIN", "PEN", "POUCH", "GUMMIES", "GELULES", "STICKS", "DEMAQUILLANT", "EAU", "PEEL"]);

/** Tokens génériques : un rapprochement doit reposer sur au moins un token non générique. */
export const GENERIC_TOKENS = new Set([...FORM_TOKENS, "ANTI", "AGE", "VISAGE", "CORPS", "BODY", "SOIN", "ACTIVE", "PLUS", "PREMIUM", "SPF", "YEUX", "CONTOUR", "PERFECTION", "FACIAL", "SKIN", "SEC", "TOUCHER"]);

export function tokens(s: unknown): string[] {
  return normKey(s)
    .split(" ")
    .flatMap((t) => (SYNONYMS[t] ?? t).split(" "))
    .filter((t) => t && !STOP.has(t));
}

/** Retire les tokens d'une marque (nom + alias) d'une liste de tokens. */
export function stripBrandTokens(toks: string[], brandTokens: Set<string>) {
  return toks.filter((t) => !brandTokens.has(t));
}

export function inferClientType(name: string): "PHARMACIE" | "PARAPHARMACIE" | "GROSSISTE" | "AUTRE" {
  const k = normKey(name);
  if (/\b(COSPHARMA|PHARMAFIRST|GROSSISTE|REPARTITEUR|DEPOSITAIRE|SOPHADIS|COOPER|LDMA|SABEM|HYPERMEDIC|ATLAS MED|ITAPHARMA|EXPERT PHARMA|EPP)\b/.test(k)) return "GROSSISTE";
  if (/\bPARA/.test(k) || /\bPARAPHARMACIE\b/.test(k) || /\bPARAPH\b/.test(k)) return "PARAPHARMACIE";
  if (/\b(PHARMACIE|PHCIE|PHARMA|PHIE|PH)\b/.test(k)) return "PHARMACIE";
  return "AUTRE";
}

/** Nettoie les cellules texte : '0', '#N/A', '-' → null. */
export function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === "0" || s === "#N/A" || s === "-" || s === "?" || s.toUpperCase() === "NULL") return null;
  return s;
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  if (!s) return null;
  // "1 234,56" → 1234.56 ; "1,234.56" → 1234.56
  const normalized = s.includes(",") && s.includes(".") ? (s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "")) : s.replace(",", ".");
  const x = Number(normalized);
  return Number.isFinite(x) ? x : null;
}

/** Date → 'YYYY-MM-DD'. Accepte Date, nombre Excel, 'DD/MM/YYYY', 'YYYY-MM-DD'. */
export function toISODate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // numéro de série Excel
    if (v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return d.toISOString().slice(0, 10);
    }
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
