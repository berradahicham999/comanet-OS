/**
 * Contrôle Internet des positions (pur, sans base, importable côté client) : cabinets médicaux et points de vente.
 *
 * Seule définition de : la requête envoyée à Google Maps pour une fiche (`buildQuery`), la ressemblance entre le nom
 * de la fiche et celui d'un lieu trouvé (`placeNameScore`), le choix du lieu retenu (`pickPlace` : TROUVE, AMBIGU
 * ou INTROUVABLE), le verdict d'une position contre Internet (`compareWithWeb` : concorde, écart…) et la décision
 * automatique sur une position (`webPositionAction` : proposer la position Google, ou valider une position « à
 * valider » quand deux sources indépendantes concordent). Les seuils viennent de `settings.webPlaces`.
 *
 * Google n'est jamais une preuve de présence : une position venue d'Internet seule reste « à valider » ; elle ne
 * devient validée que confirmée par une seconde source (position relevée au premier « Démarrer » ou historique).
 */
import { normKey } from "@/lib/import/normalize";
import { cityKey } from "@/lib/animations-shared";
import { doctorNameTokens, jaroWinkler } from "@/lib/medical/matching";
import { haversineM, type Point } from "@/lib/medical/gps-shared";
import type { WebPlacesSettings } from "@/lib/settings";

export type PlaceKind = "doctor" | "client";
export type WebStatus = "TROUVE" | "AMBIGU" | "INTROUVABLE" | "ERREUR";
export type GpsSource = "PREMIERE_VISITE" | "MANUELLE" | "ADRESSE" | "HISTORIQUE" | "INTERNET";

export type WebPlace = { placeId: string; name: string; address: string; lat: number; lng: number };
export type ScoredPlace = WebPlace & { score: number; cityOk: boolean };
export type PickResult = { status: Exclude<WebStatus, "ERREUR">; place: ScoredPlace | null; candidates: ScoredPlace[]; reason: string };

/** Fiche à rechercher : nom (médecin : prénom + nom ; client : nom du point de vente), adresse et ville connues. */
export type PlaceSubject =
  | { kind: "doctor"; firstName: string; lastName: string; specialty?: string | null; address?: string | null; city?: string | null }
  | { kind: "client"; name: string; address?: string | null; city?: string | null };

/** Mots qui ne distinguent pas un lieu d'un autre (type d'établissement, articles, forme juridique). */
const GENERIC = new Set([
  "pharmacie", "pharmacy", "parapharmacie", "para", "pharma", "pharmaceutique", "officine", "cabinet", "centre", "center", "clinique", "polyclinique",
  "medical", "medicale", "medicaux", "dentaire", "dr", "dre", "docteur", "doctoresse", "pr", "professeur", "de", "du", "des", "la", "le", "les", "l", "d",
  "el", "al", "et", "ste", "societe", "sarl", "sa", "sarlau", "store", "shop", "beauty", "maroc", "morocco",
]);

/** Spécialités et mots de métier qu'un nom de lieu ajoute au nom du médecin (« Dr Benali - Dermatologue »). */
const TRADE = /^(dermato|gyneco|pediat|generaliste|medecin|cardio|endocrino|nutrition|ophtalmo|orl|rhumato|psychiat|neuro|urolog|gastro|pneumo|chirurg|allergo|radiolog|onco|specialiste|esthetique|laser)/;

const words = (raw: string | null | undefined): string[] =>
  normKey(raw ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

/** Mots significatifs d'un nom de lieu ou de point de vente. */
export function placeTokens(raw: string | null | undefined): string[] {
  return words(raw).filter((t) => !GENERIC.has(t) && !TRADE.test(t) && !/^\d+$/.test(t));
}

/** Texte envoyé à Google Maps. Le pays est toujours précisé (homonymes de villes à l'étranger). */
export function buildQuery(s: PlaceSubject): string {
  const parts = s.kind === "doctor"
    ? [`Dr ${s.firstName} ${s.lastName}`.replace(/\s+/g, " ").trim(), s.specialty ?? "", s.address ?? "", s.city ?? ""]
    : [s.name.trim(), s.address ?? "", s.city ?? ""];
  return [...parts.map((p) => p.trim()).filter(Boolean), "Maroc"].join(", ");
}

/** La fiche porte-t-elle assez de mots distinctifs pour être recherchée (« PHARMACIE » seul ne désigne rien) ? */
export function searchable(s: PlaceSubject): boolean {
  return s.kind === "doctor" ? doctorNameTokens(s.lastName).length > 0 : placeTokens(s.name).length > 0;
}

/** Part (0-1, pondérée par la longueur des mots) des mots de `need` retrouvés dans `have` (faute de frappe tolérée). */
function coverage(need: string[], have: string[]): number {
  if (!need.length) return 0;
  let total = 0;
  let found = 0;
  for (const w of need) {
    total += w.length;
    if (have.some((h) => h === w || (w.length >= 4 && h.length >= 4 && jaroWinkler(w, h) >= 0.92))) found += w.length;
  }
  return found / total;
}

/**
 * Ressemblance (0-1) entre la fiche et le nom d'un lieu Google.
 * Médecin : le nom de famille doit être retrouvé (0,85), le prénom ajoute le reste ; un lieu qui ne porte que le nom
 * de famille (« Cabinet Dr Benali ») passe donc le seuil par défaut de 0,8. Point de vente : part des mots distinctifs
 * du nom de la fiche retrouvés dans le nom du lieu.
 */
export function placeNameScore(s: PlaceSubject, placeName: string): number {
  const have = words(placeName);
  if (s.kind === "doctor") {
    const last = doctorNameTokens(s.lastName);
    const first = doctorNameTokens(s.firstName);
    if (!last.length || coverage(last, have) < 1) return 0;
    return Math.round((0.85 + 0.15 * (first.length ? coverage(first, have) : 0)) * 1000) / 1000;
  }
  return Math.round(coverage(placeTokens(s.name), have) * 1000) / 1000;
}

/** Le lieu est-il dans la ville de la fiche ? Ville inconnue = pas de contrôle. */
export function cityMatches(city: string | null | undefined, address: string): boolean {
  const c = city ? cityKey(city).toLowerCase() : "";
  if (!c) return true;
  const a = ` ${words(address).join(" ")} `;
  return a.includes(` ${c.replace(/[^a-z0-9]+/g, " ").trim()} `);
}

/**
 * Lieu retenu parmi les résultats Google. TROUVE : le meilleur lieu a un nom assez proche, est dans la bonne ville,
 * et aucun autre lieu aussi crédible n'est ailleurs (homonymes : deux « Pharmacie Al Amal » dans la même ville = AMBIGU).
 */
export function pickPlace(s: PlaceSubject, places: WebPlace[], cfg: Pick<WebPlacesSettings, "minNameScore" | "concordanceM">): PickResult {
  const candidates: ScoredPlace[] = places
    .map((p) => ({ ...p, score: placeNameScore(s, p.name), cityOk: cityMatches(s.city, p.address) }))
    .sort((a, b) => Number(b.cityOk) - Number(a.cityOk) || b.score - a.score)
    .slice(0, 5);
  if (!candidates.length) return { status: "INTROUVABLE", place: null, candidates, reason: "Aucun lieu trouvé sur Google Maps." };
  const good = candidates.filter((c) => c.cityOk && c.score >= cfg.minNameScore);
  if (!good.length) {
    const near = candidates.find((c) => c.score >= cfg.minNameScore);
    return {
      status: "INTROUVABLE", place: null, candidates,
      reason: near ? `Lieu au nom proche trouvé hors de la ville de la fiche (${near.address}).` : "Aucun lieu au nom suffisamment proche.",
    };
  }
  const [best, ...rest] = good;
  const rival = rest.find((c) => haversineM(best, c) > cfg.concordanceM);
  if (rival) return { status: "AMBIGU", place: null, candidates, reason: `Plusieurs lieux possibles : « ${best.name} » et « ${rival.name} ».` };
  return { status: "TROUVE", place: best, candidates, reason: `« ${best.name} », ${best.address}.` };
}

/* ------------------------------------------------------------------ */
/* Verdict et décision automatique                                     */
/* ------------------------------------------------------------------ */

export type FichePosition = { lat: number; lng: number; validated: boolean; source: GpsSource | null } | null;
export type WebResult = { status: WebStatus; lat: number | null; lng: number | null; name?: string | null; address?: string | null } | null;

export type WebVerdict =
  | "NON_VERIFIE" // pas encore recherché
  | "INTROUVABLE" // rien de sûr sur Google (ou appel en erreur)
  | "AMBIGU"
  | "SANS_POSITION" // Google a trouvé, la fiche n'a pas de position
  | "SOURCE_INTERNET" // la position de la fiche EST celle de Google : rien à comparer avant une visite
  | "CONCORDE"
  | "ECART";

export const WEB_VERDICT_LABELS: Record<WebVerdict, string> = {
  NON_VERIFIE: "Pas encore vérifiée",
  INTROUVABLE: "Introuvable sur Google",
  AMBIGU: "Plusieurs lieux possibles",
  SANS_POSITION: "Trouvée sur Google, aucune position sur la fiche",
  SOURCE_INTERNET: "Position Google, en attente d'une première visite",
  CONCORDE: "Concorde avec Google",
  ECART: "Écart avec Google",
};

export function webPoint(w: WebResult): Point | null {
  return w && w.status === "TROUVE" && w.lat !== null && w.lng !== null ? { lat: w.lat, lng: w.lng } : null;
}

/** Verdict d'une position de fiche contre le résultat Google, avec la distance quand elle a un sens. */
export function compareWithWeb(pos: FichePosition, web: WebResult, cfg: Pick<WebPlacesSettings, "concordanceM">): { verdict: WebVerdict; distanceM: number | null } {
  if (!web) return { verdict: "NON_VERIFIE", distanceM: null };
  if (web.status === "AMBIGU") return { verdict: "AMBIGU", distanceM: null };
  const w = webPoint(web);
  if (!w) return { verdict: "INTROUVABLE", distanceM: null };
  if (!pos) return { verdict: "SANS_POSITION", distanceM: null };
  const d = Math.round(haversineM(pos, w));
  if (pos.source === "INTERNET" && !pos.validated) return { verdict: "SOURCE_INTERNET", distanceM: d };
  return { verdict: d <= cfg.concordanceM ? "CONCORDE" : "ECART", distanceM: d };
}

export type WebPositionAction =
  | { kind: "PROPOSE"; position: Point; label: string }
  | { kind: "VALIDATE"; label: string }
  | null;

/**
 * Ce que l'application fait seule d'une position, après une recherche Google ou au démarrage d'une visite :
 * - fiche sans position + lieu Google trouvé → la position Google est proposée (« à valider », origine INTERNET) ;
 * - position « à valider » qui concorde avec une seconde source indépendante → validée :
 *   origine INTERNET : le démarrage précis d'une visite est à moins de `concordanceM` ;
 *   autre origine (premier démarrage, historique, saisie) : le lieu Google est à moins de `concordanceM`.
 * Une position déjà validée n'est jamais modifiée ; un écart n'est jamais corrigé automatiquement.
 */
export function webPositionAction(
  pos: FichePosition,
  web: WebResult,
  cfg: Pick<WebPlacesSettings, "concordanceM" | "autoValidate">,
  startPoint: Point | null = null,
): WebPositionAction {
  const w = webPoint(web);
  if (!pos) return w ? { kind: "PROPOSE", position: w, label: "Position proposée depuis Google Maps" } : null;
  if (pos.validated || !cfg.autoValidate) return null;
  if (pos.source === "INTERNET") {
    if (!startPoint) return null;
    const d = Math.round(haversineM(pos, startPoint));
    return d <= cfg.concordanceM ? { kind: "VALIDATE", label: `Validée automatiquement : démarrage de visite à ${d} m de la position Google` } : null;
  }
  if (!w) return null;
  const d = Math.round(haversineM(pos, w));
  return d <= cfg.concordanceM ? { kind: "VALIDATE", label: `Validée automatiquement : Google Maps à ${d} m de la position relevée` } : null;
}

/**
 * La position prouve-t-elle une absence ? Hors du rayon d'une position validée, même en retirant l'incertitude
 * annoncée par le téléphone (une position à ± 800 m ne prouve rien : la visite reste seulement « à vérifier »).
 */
export function isOutOfZone(p: { validated: boolean; distanceM: number | null; accuracyM: number | null; radiusM: number }): boolean {
  if (!p.validated || p.distanceM === null) return false;
  return p.distanceM > p.radiusM && p.distanceM - (p.accuracyM ?? 0) > p.radiusM;
}

/** Distance lisible (m / km), pour les notifications et les écrans. */
export function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(m)} m`;
}
