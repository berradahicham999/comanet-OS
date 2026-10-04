/**
 * CRM commercial — définitions pures (sans base, importables côté client et dans les tests).
 *
 * Seule définition de : mois de suivi (`monthBounds`, `monthElapsedPct`), visites attendues et comptées
 * d'un client (`expectedVisits`, `countedVisits`), progression d'un portefeuille avec plafonnement par
 * client (`visitProgress`), verdict de rythme (`paceVerdict`) et priorité de tournée (`tourPriority`,
 * `suggestTour`). Une fréquence non définie n'est jamais estimée : le client sort de la progression.
 */

export type Month = string; // « AAAA-MM »

const pad = (n: number) => String(n).padStart(2, "0");

/** Mois (« AAAA-MM ») d'un jour « AAAA-MM-JJ ». */
export function monthOf(day: string): Month {
  return day.slice(0, 7);
}

/** Lit un mois saisi (« AAAA-MM ») ; sinon le mois de repli. */
export function parseMonth(v: unknown, fallback: Month): Month {
  const s = String(v ?? "");
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return fallback;
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? s : fallback;
}

export function shiftMonth(month: Month, delta: number): Month {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Bornes d'un mois : premier jour, lendemain du dernier jour (exclu), nombre de jours. */
export function monthBounds(month: Month): { start: string; end: string; last: string; days: number; year: number; month: number } {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const next = new Date(Date.UTC(y, m, 1));
  return {
    start: `${y}-${pad(m)}-01`,
    end: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`,
    last: `${y}-${pad(m)}-${pad(days)}`,
    days,
    year: y,
    month: m,
  };
}

/** Libellé « octobre 2026 ». */
export function monthLabel(month: Month): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Part du mois écoulée (0 à 100), aujourd'hui compris : le 1er = 1 jour sur 31. Un mois passé vaut 100,
 * un mois futur 0.
 */
export function monthElapsedPct(month: Month, today: string): number {
  const b = monthBounds(month);
  if (today >= b.end) return 100;
  if (today < b.start) return 0;
  const day = Number(today.slice(8, 10));
  return (day / b.days) * 100;
}

/** Visites attendues d'un client sur le mois : sa fréquence ; non définie = 0 (hors progression). */
export function expectedVisits(frequency: number | null | undefined): number {
  return frequency && frequency > 0 ? Math.round(frequency) : 0;
}

/** Visites comptées dans la progression : plafonnées à la fréquence (cinq passages ne compensent pas quatre oublis). */
export function countedVisits(frequency: number | null | undefined, done: number): number {
  return Math.min(expectedVisits(frequency), Math.max(0, done));
}

/** Visites restant à faire ce mois chez un client. */
export function remainingVisits(frequency: number | null | undefined, done: number): number {
  return Math.max(0, expectedVisits(frequency) - Math.max(0, done));
}

export type ProgressItem = { frequency: number | null | undefined; done: number };

export type VisitProgress = {
  /** Somme des fréquences des clients suivis. */
  expected: number;
  /** Visites comptées (plafonnées par client). */
  counted: number;
  /** Visites effectuées, sans plafond (information). */
  done: number;
  /** counted ÷ expected en %, null si rien n'est attendu. */
  pct: number | null;
  /** Clients dont la fréquence est définie et supérieure à zéro. */
  followed: number;
  /** Clients suivis dont toutes les visites du mois sont faites. */
  complete: number;
  /** Clients suivis sans aucune visite ce mois. */
  notVisited: number;
  /** Clients sans fréquence définie (hors progression). */
  undefinedFrequency: number;
};

export function visitProgress(items: ProgressItem[]): VisitProgress {
  let expected = 0, counted = 0, done = 0, followed = 0, complete = 0, notVisited = 0, undefinedFrequency = 0;
  for (const it of items) {
    done += Math.max(0, it.done);
    if (it.frequency === null || it.frequency === undefined) { undefinedFrequency++; continue; }
    const e = expectedVisits(it.frequency);
    if (!e) continue;
    followed++;
    expected += e;
    const c = countedVisits(it.frequency, it.done);
    counted += c;
    if (c >= e) complete++;
    if (it.done <= 0) notVisited++;
  }
  return { expected, counted, done, pct: expected ? (counted / expected) * 100 : null, followed, complete, notVisited, undefinedFrequency };
}

export type PaceKind = "ATTEINT" | "DANS_LE_RYTHME" | "EN_RETARD" | "NON_MESURABLE";
export type PaceVerdict = { kind: PaceKind; label: string; behind: number; expectedToDate: number };

/**
 * Rythme d'un portefeuille : comparé à l'avancement du mois. En retard quand la progression est
 * inférieure de plus de `gapPts` points à la part du mois écoulée.
 */
export function paceVerdict(p: Pick<VisitProgress, "expected" | "counted" | "pct">, elapsedPct: number, gapPts: number): PaceVerdict {
  if (!p.expected || p.pct === null) return { kind: "NON_MESURABLE", label: "Aucune fréquence de visite définie", behind: 0, expectedToDate: 0 };
  const expectedToDate = (p.expected * elapsedPct) / 100;
  const behind = Math.max(0, Math.ceil(expectedToDate - p.counted - 1e-9));
  if (p.counted >= p.expected) return { kind: "ATTEINT", label: "Toutes les visites du mois sont faites", behind: 0, expectedToDate };
  if (p.pct < elapsedPct - gapPts) return { kind: "EN_RETARD", label: `En retard de ${behind} visite${behind > 1 ? "s" : ""}`, behind, expectedToDate };
  return { kind: "DANS_LE_RYTHME", label: behind ? `Dans le rythme (${behind} visite${behind > 1 ? "s" : ""} à rattraper)` : "Dans le rythme", behind, expectedToDate };
}

/* ------------------------------------------------------------------ */
/* Objectif client                                                     */
/* ------------------------------------------------------------------ */

export type ObjectiveRow = { clientId: string; brandId: string | null; year: number; month: number | null; amount: number };

/** Objectif d'un mois : la ligne mensuelle si elle existe, sinon l'annuel ÷ 12 (même convention que les objectifs de marque). */
export function monthlyTarget(rows: ObjectiveRow[], year: number, month: number): { amount: number; source: "MENSUEL" | "ANNUEL" } | null {
  const monthly = rows.find((r) => r.year === year && r.month === month);
  if (monthly) return { amount: monthly.amount, source: "MENSUEL" };
  const annual = rows.find((r) => r.year === year && r.month === null);
  if (annual) return { amount: annual.amount / 12, source: "ANNUEL" };
  return null;
}

export type ObjectiveVerdict = "AUCUN_OBJECTIF" | "ATTEINT" | "DANS_LE_RYTHME" | "EN_RETARD" | "PAS_ENCORE_COMPARABLE";

/**
 * Avancement d'un objectif client. Réalisé = sell-in HT mesuré. Avant `checkFromDay`, un écart n'est
 * pas encore comparable ; ensuite, en retard si réalisé < objectif × avancement du mois × `lateRatio`.
 */
export function objectiveProgress(
  target: number | null,
  realized: number,
  o: { elapsedPct: number; dayOfMonth: number; lateRatio: number; checkFromDay: number; monthOver: boolean },
): { pct: number | null; expectedToDate: number | null; verdict: ObjectiveVerdict } {
  if (target === null || !(target > 0)) return { pct: null, expectedToDate: null, verdict: "AUCUN_OBJECTIF" };
  const pct = (realized / target) * 100;
  const expectedToDate = (target * o.elapsedPct) / 100;
  if (realized >= target) return { pct, expectedToDate, verdict: "ATTEINT" };
  if (!o.monthOver && o.dayOfMonth < o.checkFromDay) return { pct, expectedToDate, verdict: "PAS_ENCORE_COMPARABLE" };
  if (o.monthOver) return { pct, expectedToDate, verdict: "EN_RETARD" };
  return { pct, expectedToDate, verdict: realized < expectedToDate * o.lateRatio ? "EN_RETARD" : "DANS_LE_RYTHME" };
}

export const OBJECTIVE_VERDICT_LABELS: Record<ObjectiveVerdict, string> = {
  AUCUN_OBJECTIF: "Aucun objectif défini",
  ATTEINT: "Atteint",
  DANS_LE_RYTHME: "Dans le rythme",
  EN_RETARD: "En retard",
  PAS_ENCORE_COMPARABLE: "Pas encore comparable",
};

export type ObjectiveLine = { brandId: string | null; brandName: string | null; target: number; source: "MENSUEL" | "ANNUEL"; realized: number; pct: number | null; verdict: ObjectiveVerdict };
export type ClientObjectiveStatus = {
  /** Objectif tous produits (ligne sans marque), s'il est défini. */
  global: ObjectiveLine | null;
  /** Objectifs par marque. */
  brands: ObjectiveLine[];
  /** Sell-in HT du mois, toutes marques. */
  realized: number;
};

/** Ligne principale d'un client : l'objectif global, sinon la somme de ses objectifs par marque. */
export function headlineObjective(st: ClientObjectiveStatus | undefined | null): { target: number; realized: number; pct: number | null; verdict: ObjectiveVerdict } | null {
  if (!st) return null;
  if (st.global) return st.global;
  if (!st.brands.length) return null;
  const target = st.brands.reduce((a, l) => a + l.target, 0);
  const realized = st.brands.reduce((a, l) => a + l.realized, 0);
  const verdict: ObjectiveVerdict = st.brands.every((l) => l.verdict === "ATTEINT") ? "ATTEINT"
    : st.brands.some((l) => l.verdict === "EN_RETARD") ? "EN_RETARD"
    : st.brands.some((l) => l.verdict === "PAS_ENCORE_COMPARABLE") ? "PAS_ENCORE_COMPARABLE" : "DANS_LE_RYTHME";
  return { target, realized, pct: target > 0 ? (realized / target) * 100 : null, verdict };
}

/* ------------------------------------------------------------------ */
/* Ma tournée : qui voir en priorité                                   */
/* ------------------------------------------------------------------ */

export type TourCandidate = {
  clientId: string;
  name: string;
  city: string | null;
  frequency: number | null;
  doneThisMonth: number;
  /** Dernière visite effectuée (« AAAA-MM-JJ »), tous mois confondus. */
  lastVisit: string | null;
  plannedToday: boolean;
  /** Commande théorique (rythme habituel, `clientIntel()`) : jours restants, négatif = en retard. */
  daysUntilNextOrder: number | null;
  objectiveLate: { pct: number; elapsedPct: number } | null;
  /** Dernier relevé de stock en rayon « à refaire » (`agingOf()`). */
  stockStale: boolean;
};

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/**
 * Priorité d'un client pour la journée, avec ses raisons (toutes mesurées : planning, fréquence,
 * rythme de commande, objectif saisi, ancienneté du relevé). Un client à ne pas visiter (fréquence 0)
 * n'est proposé que s'il est planifié.
 */
export function tourPriority(c: TourCandidate, today: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (c.plannedToday) { score += 100; reasons.push("visite planifiée aujourd'hui"); }
  if (c.frequency === 0 && !c.plannedToday) return { score: 0, reasons: [] };
  const remaining = remainingVisits(c.frequency, c.doneThisMonth);
  if (remaining > 0) { score += 30 + remaining * 5; reasons.push(`encore ${remaining} visite${remaining > 1 ? "s" : ""} à faire ce mois`); }
  if (c.daysUntilNextOrder !== null && c.daysUntilNextOrder < 0) {
    score += 25 + Math.min(30, -c.daysUntilNextOrder);
    reasons.push(`commande attendue depuis ${-c.daysUntilNextOrder} j (rythme habituel)`);
  }
  if (c.objectiveLate) { score += 20; reasons.push(`objectif du mois à ${Math.round(c.objectiveLate.pct)} % pour ${Math.round(c.objectiveLate.elapsedPct)} % du mois écoulé`); }
  if (c.stockStale) { score += 8; reasons.push("relevé de stock en rayon à refaire"); }
  if (c.lastVisit === null) {
    if (c.frequency) { score += 15; reasons.push("jamais visité"); }
  } else {
    const ago = daysBetween(c.lastVisit, today);
    if (ago >= 30) { score += Math.min(20, 10 + Math.floor(ago / 10)); reasons.push(`dernière visite il y a ${ago} j`); }
  }
  return { score, reasons };
}

/** Les N clients à voir en priorité aujourd'hui (score positif seulement). */
export function suggestTour(candidates: TourCandidate[], today: string, n: number): (TourCandidate & { score: number; reasons: string[] })[] {
  return candidates
    .map((c) => ({ ...c, ...tourPriority(c, today) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, n));
}

/* ------------------------------------------------------------------ */
/* Assortiment manquant                                                */
/* ------------------------------------------------------------------ */

export type PeerProduct = { productId: string; name: string; brand: string | null; buyers: number };

/**
 * Produits que des clients comparables achètent et que ce client n'achète pas : part des pairs acheteurs
 * au moins `minShare`, au moins `minPeers` pairs, les `topN` plus répandus. Corrélation observée chez les
 * pairs, jamais une prévision de vente.
 */
export function rankMissingAssortment(
  rows: PeerProduct[],
  peers: number,
  owned: Set<string>,
  o: { minPeers: number; minShare: number; topN: number },
): (PeerProduct & { share: number })[] {
  if (peers < o.minPeers) return [];
  return rows
    .filter((r) => !owned.has(r.productId))
    .map((r) => ({ ...r, share: r.buyers / peers }))
    .filter((r) => r.share >= o.minShare)
    .sort((a, b) => b.share - a.share || b.buyers - a.buyers || a.name.localeCompare(b.name))
    .slice(0, o.topN);
}
