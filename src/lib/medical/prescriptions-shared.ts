/**
 * Médical v2 — analyses des ordonnances (pur, sans base). Explicables : chaque résultat porte son
 * nombre d'observations et des motifs en clair. Seules définitions de : potentiel automatique A/B/C
 * (`doctorPotential`), segment d'un médecin (`doctorSegment`), produits à présenter (`recommendProducts`)
 * et impact des visites (`visitImpact`). Une donnée insuffisante donne « non calculé », jamais une estimation.
 * Les seuils viennent de `settings.medicalField`.
 */
import type { MedicalFieldSettings } from "@/lib/settings";

export type Potential = "A" | "B" | "C";

/* ------------------------------------------------------------------ */
/* Potentiel automatique                                               */
/* ------------------------------------------------------------------ */

export type PrescriberStats = {
  doctorId: string;
  /** Spécialité (clé) : le classement se fait entre médecins de la même spécialité. */
  specialty: string | null;
  /** Lignes d'ordonnance de nos produits sur la fenêtre d'observation. */
  lines: number;
  /** Lignes sur les `trendMonths` derniers mois, et sur les `trendMonths` précédents. */
  recent: number;
  previous: number;
  /** Marques COMANET distinctes prescrites sur la fenêtre. */
  brands: number;
};

export type PotentialResult = {
  level: Potential | null;
  observations: number;
  reasons: string[];
};

const LEVELS: Potential[] = ["C", "B", "A"];
const shift = (p: Potential, d: number): Potential => LEVELS[Math.max(0, Math.min(2, LEVELS.indexOf(p) + d))];

/** Rang percentile (0-100, 100 = meilleur) d'une valeur dans une liste. */
export function percentileRank(value: number, all: number[]): number {
  if (!all.length) return 0;
  const below = all.filter((v) => v < value).length;
  const equal = all.filter((v) => v === value).length;
  return Math.round(((below + equal / 2) / all.length) * 100);
}

/** Tendance en % (récent vs précédent), null si la période précédente est vide. */
export function trendPct(recent: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((recent - previous) / previous) * 100);
}

type PotentialSettings = Pick<MedicalFieldSettings, "potentialTopAPct" | "potentialTopBPct" | "potentialMinPrescriptions" | "trendPct" | "trendMonths" | "potentialMonths">;

/**
 * Potentiel A/B/C d'un médecin : rang parmi les prescripteurs de sa spécialité (meilleurs X % = A,
 * suivants jusqu'à Y % = B, reste = C), puis un cran de plus si la tendance monte nettement ou s'il
 * prescrit au moins 3 de nos marques, un cran de moins si elle baisse nettement.
 */
export function doctorPotential(me: PrescriberStats, peers: PrescriberStats[], s: PotentialSettings): PotentialResult {
  if (me.lines < s.potentialMinPrescriptions) {
    return { level: null, observations: me.lines, reasons: [`${me.lines} ligne(s) d'ordonnance sur ${s.potentialMonths} mois, sous le minimum de ${s.potentialMinPrescriptions} : potentiel non calculé.`] };
  }
  const group = peers.filter((p) => p.specialty === me.specialty && p.lines > 0);
  // Rang depuis le haut : le meilleur de 10 est « dans les 10 % premiers », le deuxième dans les 20 %.
  const above = group.filter((p) => p.lines > me.lines).length;
  const n = Math.max(1, group.length);
  const top = Math.round(((above + 1) / n) * 100);
  let level: Potential = top <= s.potentialTopAPct ? "A" : top <= s.potentialTopBPct ? "B" : "C";
  const reasons = [
    `${me.lines} ligne(s) d'ordonnance de nos produits sur ${s.potentialMonths} mois : ${above === 0 ? "1er" : `${above + 1}e`}${group.filter((p) => p.lines === me.lines).length > 1 ? " ex æquo" : ""} sur ${group.length} prescripteur(s) de sa spécialité (${top} % premiers) → ${level}.`,
  ];
  const t = trendPct(me.recent, me.previous);
  if (t !== null && t >= s.trendPct) {
    level = shift(level, 1);
    reasons.push(`En hausse de ${t} % (${s.trendMonths} derniers mois vs ${s.trendMonths} précédents : ${me.recent} contre ${me.previous}) → un cran de plus.`);
  } else if (t !== null && t <= -s.trendPct) {
    level = shift(level, -1);
    reasons.push(`En baisse de ${Math.abs(t)} % (${me.recent} contre ${me.previous}) → un cran de moins.`);
  } else if (t === null && me.recent > 0) {
    reasons.push(`Nouveau prescripteur sur les ${s.trendMonths} derniers mois : tendance pas encore comparable.`);
  }
  if (me.brands >= 3) {
    level = shift(level, 1);
    reasons.push(`Prescrit ${me.brands} de nos marques → un cran de plus.`);
  }
  return { level, observations: me.lines, reasons };
}

/* ------------------------------------------------------------------ */
/* Segments (P1)                                                       */
/* ------------------------------------------------------------------ */

export type Segment = "FIDELE" | "CROISSANCE" | "BAISSE" | "JAMAIS_VISITE" | "VISITE_SANS_PRESCRIPTION" | "POTENTIEL_NON_COUVERT" | "AUTRE";

export const SEGMENT_LABELS: Record<Segment, string> = {
  FIDELE: "Prescripteur fidèle",
  CROISSANCE: "En croissance",
  BAISSE: "En baisse",
  JAMAIS_VISITE: "Prescripteur jamais visité",
  VISITE_SANS_PRESCRIPTION: "Visité mais ne prescrit pas",
  POTENTIEL_NON_COUVERT: "Fort potentiel non couvert",
  AUTRE: "Sans segment",
};

export function doctorSegment(
  x: { lines: number; recent: number; previous: number; visits: number; visitsRecent: number; potential: Potential | null; overdue: boolean },
  s: Pick<MedicalFieldSettings, "trendPct">,
): Segment {
  const t = trendPct(x.recent, x.previous);
  if (x.lines > 0 && x.visits === 0) return "JAMAIS_VISITE";
  if (x.potential === "A" && (x.overdue || x.visitsRecent === 0)) return "POTENTIEL_NON_COUVERT";
  if (x.visits > 0 && x.lines === 0) return "VISITE_SANS_PRESCRIPTION";
  if (t !== null && t >= s.trendPct) return "CROISSANCE";
  if (t !== null && t <= -s.trendPct) return "BAISSE";
  if (x.recent > 0 && x.previous > 0) return "FIDELE";
  return "AUTRE";
}

/* ------------------------------------------------------------------ */
/* Le bon produit au bon médecin                                       */
/* ------------------------------------------------------------------ */

/** Désignation au pluriel des médecins d'une spécialité (« dermatologues »), pour des phrases lisibles. */
export function specialtyPeople(name: string | null | undefined): string {
  const n = (name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!n) return "médecins";
  if (n.includes("dermato")) return "dermatologues";
  if (n.includes("general") || n === "mg" || n === "mge" || n.includes("generaliste")) return "généralistes";
  if (n.includes("plasti")) return "chirurgiens plasticiens";
  if (n.includes("pediatr")) return "pédiatres";
  if (n.includes("gyneco")) return "gynécologues";
  if (n.includes("endocrino")) return "endocrinologues";
  if (n.includes("nutri")) return "nutritionnistes";
  return `médecins (${name})`;
}

/** Ville en clair (« CASABLANCA » → « Casablanca »). */
export function cityTitle(c: string | null | undefined): string | null {
  if (!c) return null;
  return c.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
}

export type PrescriberProducts = { doctorId: string; specialty: string | null; city: string | null; products: Set<string> };

export type Recommendation = {
  productId: string;
  score: number;
  /** Médecins pairs derrière la recommandation (numérateur / dénominateur). */
  support: number;
  base: number;
  why: string;
};

export type RecommendationResult = {
  peerScope: "VILLE" | "NATIONAL" | null;
  peers: number;
  items: Recommendation[];
  note: string | null;
};

/**
 * Top N des produits à présenter à un médecin, déduit de ce que prescrivent ses pairs (même spécialité,
 * même ville ; repli sur la même spécialité dans tout le pays si la ville compte trop peu de pairs).
 * - S'il prescrit déjà des produits X : associations « qui prescrit X prescrit aussi Y ».
 * - Sinon : produits les plus prescrits par ses pairs.
 * Les produits qu'il prescrit déjà ne sont jamais recommandés.
 */
export function recommendProducts(
  me: { doctorId: string; specialty: string | null; city: string | null; products: Set<string> },
  all: PrescriberProducts[],
  names: Map<string, string>,
  labels: { specialty: string; city: string | null },
  s: Pick<MedicalFieldSettings, "recoMinPeers" | "recoMinSupport" | "recoTopN">,
): RecommendationResult {
  if (!me.specialty) return { peerScope: null, peers: 0, items: [], note: "Spécialité du médecin inconnue : pas de pairs comparables." };
  const sameSpec = all.filter((p) => p.doctorId !== me.doctorId && p.specialty === me.specialty && p.products.size > 0);
  const cityPeers = me.city ? sameSpec.filter((p) => p.city === me.city) : [];
  let peers = cityPeers;
  let scope: "VILLE" | "NATIONAL" = "VILLE";
  if (peers.length < s.recoMinPeers) {
    peers = sameSpec;
    scope = "NATIONAL";
  }
  if (peers.length < s.recoMinPeers) {
    return { peerScope: null, peers: peers.length, items: [], note: `Seulement ${peers.length} ${specialtyPeople(labels.specialty)} prescripteur(s) observé(s) : pas assez d'observations (minimum ${s.recoMinPeers}).` };
  }
  const people = specialtyPeople(labels.specialty);
  const group = scope === "VILLE" && labels.city ? `${people} de ${cityTitle(labels.city)}` : `${people} (tout le pays)`;
  const name = (id: string) => names.get(id) ?? "ce produit";
  const pct = (a: number, b: number) => Math.round((a / b) * 100);

  const candidates = new Set<string>();
  for (const p of peers) for (const id of p.products) if (!me.products.has(id)) candidates.add(id);
  const items: Recommendation[] = [];
  for (const y of candidates) {
    if (me.products.size) {
      let best: Recommendation | null = null;
      for (const x of me.products) {
        const withX = peers.filter((p) => p.products.has(x));
        if (withX.length < s.recoMinSupport) continue;
        const both = withX.filter((p) => p.products.has(y)).length;
        if (both < s.recoMinSupport) continue;
        const score = both / withX.length;
        if (!best || score > best.score || (score === best.score && both > best.support)) {
          best = { productId: y, score, support: both, base: withX.length, why: `${pct(both, withX.length)} % des ${group} qui prescrivent ${name(x)} prescrivent aussi ${name(y)} (${both} sur ${withX.length}).` };
        }
      }
      if (best) items.push(best);
    } else {
      const withY = peers.filter((p) => p.products.has(y)).length;
      if (withY < s.recoMinSupport) continue;
      items.push({ productId: y, score: withY / peers.length, support: withY, base: peers.length, why: `Prescrit par ${pct(withY, peers.length)} % des ${group} (${withY} sur ${peers.length}).` });
    }
  }
  items.sort((a, b) => b.score - a.score || b.support - a.support || name(a.productId).localeCompare(name(b.productId)));
  return {
    peerScope: scope,
    peers: peers.length,
    items: items.slice(0, s.recoTopN),
    note: items.length ? null : `Aucune association assez fréquente chez les ${group} (au moins ${s.recoMinSupport} médecins).`,
  };
}

/* ------------------------------------------------------------------ */
/* Impact des visites (P1) — corrélation observée                      */
/* ------------------------------------------------------------------ */

export type ImpactRow = { before: number; after: number; complete: boolean };

/**
 * Ordonnances du médecin pour un produit présenté, N jours avant vs N jours après la visite. Une fenêtre
 * « après » pas encore écoulée est « pas encore comparable ». C'est une corrélation observée, jamais
 * une preuve que la visite a causé les prescriptions.
 */
export function visitImpact(
  visitDate: string,
  prescriptionDates: string[],
  windowDays: number,
  today: string,
): ImpactRow {
  const v = Date.parse(visitDate + "T00:00:00Z");
  const d = 86_400_000;
  let before = 0;
  let after = 0;
  for (const p of prescriptionDates) {
    const t = Date.parse(p + "T00:00:00Z");
    if (t >= v - windowDays * d && t < v) before++;
    else if (t > v && t <= v + windowDays * d) after++;
  }
  return { before, after, complete: Date.parse(today + "T00:00:00Z") >= v + windowDays * d };
}

/* ------------------------------------------------------------------ */
/* Tournée suggérée (P1)                                               */
/* ------------------------------------------------------------------ */

export type TourInput = {
  potential: Potential | null;
  /** Jours depuis la dernière visite réalisée (ou depuis la création si jamais visité). */
  daysSince: number | null;
  frequencyDays: number;
  neverVisited: boolean;
  /** Produits recommandés trouvés pour ce médecin (0 à recoTopN). */
  recommended: number;
};

/**
 * Priorité d'un médecin dans la tournée : poids du potentiel × retard sur la fréquence de visite ×
 * opportunité produit. Retard = jours écoulés ÷ fréquence (2 pour un médecin jamais visité) ;
 * opportunité = 1 + part des produits recommandés trouvés. Renvoie le score et ses facteurs en clair.
 */
export function tourPriority(x: TourInput, s: Pick<MedicalFieldSettings, "tourWeights" | "recoTopN">): { score: number; reasons: string[] } {
  const w = x.potential ? s.tourWeights[x.potential] : s.tourWeights.none;
  const lateness = x.neverVisited ? 2 : x.daysSince === null ? 1 : Math.max(0, x.daysSince / Math.max(1, x.frequencyDays));
  const opportunity = 1 + Math.min(x.recommended, s.recoTopN) / Math.max(1, s.recoTopN);
  const score = Math.round(w * lateness * opportunity * 100) / 100;
  return {
    score,
    reasons: [
      `potentiel ${x.potential ?? "non classé"} (×${w})`,
      x.neverVisited ? "jamais visité (×2)" : `${x.daysSince ?? "?"} j depuis la dernière visite pour une fréquence de ${x.frequencyDays} j (×${Math.round(lateness * 10) / 10})`,
      x.recommended ? `${x.recommended} produit(s) à présenter (×${Math.round(opportunity * 100) / 100})` : "aucun produit recommandé (×1)",
    ],
  };
}
