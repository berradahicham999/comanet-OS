/**
 * Empreinte créative et fatigue (logique PURE).
 *
 * `creativeFingerprint()` résume un concept en cinq traits (territoire, mécanique, tension, type d'accroche, produit) ;
 * `similarity()` mesure la proximité de deux empreintes ; `nearestRecent()` retrouve le contenu récent le plus proche ;
 * `territoryUsage()` compte ce qui a déjà été produit (contenus du planning, créatives Meta étiquetées, concepts générés)
 * pour recommander un angle inexploré plutôt qu'un territoire saturé.
 */
import { MECHANIC_BY_KEY, mechanicsForAngleTag, territoryForAngleTag } from "./territories";
import type { CreativePerformance, HookType, PerformanceSource, RecentConcept, TerritoryKey, TerritoryUsage } from "./types";

export type FingerprintParts = { territory: TerritoryKey; mechanic: string; tensionKey: string; hookType: HookType; productId: string | null };

export function creativeFingerprint(p: FingerprintParts): string {
  return [p.territory, p.mechanic, p.tensionKey, p.hookType, p.productId ?? "marque"].join("|");
}

export function parseFingerprint(fp: string): FingerprintParts | null {
  const [territory, mechanic, tensionKey, hookType, product] = fp.split("|");
  if (!territory || !mechanic || !tensionKey || !hookType) return null;
  return { territory: territory as TerritoryKey, mechanic, tensionKey, hookType: hookType as HookType, productId: product === "marque" || !product ? null : product };
}

/** Poids des traits : la mécanique et la tension font le concept, le territoire et l'accroche le colorent. */
const W = { mechanic: 0.35, tension: 0.3, territory: 0.15, hook: 0.1, product: 0.1 };

export function similarity(a: FingerprintParts, b: FingerprintParts): number {
  let s = 0;
  if (a.mechanic === b.mechanic) s += W.mechanic;
  if (a.tensionKey === b.tensionKey) s += W.tension;
  if (a.territory === b.territory) s += W.territory;
  if (a.hookType === b.hookType) s += W.hook;
  if ((a.productId ?? null) === (b.productId ?? null)) s += W.product;
  return Math.round(s * 100) / 100;
}

/** Contenu récent le plus proche d'une empreinte (concepts générés ou produits), avec sa proximité. */
export function nearestRecent(fp: FingerprintParts, recent: RecentConcept[]): { score: number; to: RecentConcept | null } {
  let best: { score: number; to: RecentConcept | null } = { score: 0, to: null };
  for (const r of recent) {
    const parts = parseFingerprint(r.fingerprint);
    if (!parts) continue;
    const s = similarity(fp, parts);
    if (s > best.score) best = { score: s, to: r };
  }
  return best;
}

/** Pénalité de répétition (points sur 100) : doublon au-delà du seuil, dégressive en dessous. */
export function repetitionPenalty(score: number, threshold: number): number {
  if (score >= threshold) return 25;
  if (score >= threshold - 0.25) return Math.round(((score - (threshold - 0.25)) / 0.25) * 12);
  return 0;
}

type UsageInput = { performances: CreativePerformance[]; recentConcepts: RecentConcept[]; since: string };

/** Mécanique la plus probable d'une performance étiquetée : la sienne si connue, sinon la première du territoire de l'angle Meta. */
function mechanicOfPerf(p: CreativePerformance): { territory: TerritoryKey; mechanic: string | null } | null {
  if (p.territory && p.mechanic) return { territory: p.territory, mechanic: p.mechanic };
  if (p.mechanic && MECHANIC_BY_KEY.has(p.mechanic)) return { territory: MECHANIC_BY_KEY.get(p.mechanic)!.territory, mechanic: p.mechanic };
  if (p.territory) return { territory: p.territory, mechanic: null };
  return null;
}

/** Usage récent par territoire et par mécanique (contenus diffusés + concepts générés depuis `since`). */
export function territoryUsage(i: UsageInput): TerritoryUsage[] {
  const map = new Map<string, TerritoryUsage>();
  const add = (territory: TerritoryKey, mechanic: string | null, date: string | null, source: PerformanceSource | "CONCEPT") => {
    for (const key of [`${territory}|*`, ...(mechanic ? [`${territory}|${mechanic}`] : [])]) {
      const cur = map.get(key) ?? { territory, mechanic: key.endsWith("|*") ? null : mechanic, count: 0, lastDate: null, sources: [] };
      cur.count += 1;
      if (date && (!cur.lastDate || date > cur.lastDate)) cur.lastDate = date;
      if (!(cur.sources as string[]).includes(source)) (cur.sources as string[]).push(source);
      map.set(key, cur);
    }
  };
  for (const p of i.performances) {
    if (p.publishedAt && p.publishedAt < i.since) continue;
    const m = mechanicOfPerf(p);
    if (m) add(m.territory, m.mechanic, p.publishedAt, p.source);
  }
  for (const c of i.recentConcepts) {
    if (c.date < i.since || c.status === "REJECTED") continue;
    add(c.territory, c.mechanic, c.date, "CONCEPT");
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Territoires saturés : au moins `minCount` contenus récents et plus que la médiane des territoires utilisés. */
export function saturatedTerritories(usage: TerritoryUsage[], minCount: number): TerritoryKey[] {
  const byT = usage.filter((u) => u.mechanic === null);
  if (!byT.length) return [];
  const counts = byT.map((u) => u.count).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)];
  return byT.filter((u) => u.count >= minCount && u.count >= median && byT.length > 1).map((u) => u.territory);
}

/** Facteur de fatigue d'une mécanique (0 = inexplorée, 1 = très utilisée), selon son risque propre. */
export function fatigueOf(mechanicKey: string, usage: TerritoryUsage[]): number {
  const m = MECHANIC_BY_KEY.get(mechanicKey);
  if (!m) return 0;
  const own = usage.find((u) => u.mechanic === mechanicKey)?.count ?? 0;
  const terr = usage.find((u) => u.territory === m.territory && u.mechanic === null)?.count ?? 0;
  const risk = m.fatigueRisk === "HIGH" ? 1.3 : m.fatigueRisk === "MEDIUM" ? 1 : 0.7;
  return Math.max(0, Math.min(1, (own * 0.3 + terr * 0.08) * risk));
}

/** Étiquette d'angle Meta → mécanique représentative (pour relire la mémoire publicitaire). */
export function mechanicForAngleTag(angleTag: string | null | undefined): { territory: TerritoryKey; mechanic: string } | null {
  if (!angleTag) return null;
  const m = mechanicsForAngleTag(angleTag)[0];
  if (m) return { territory: m.territory, mechanic: m.key };
  const t = territoryForAngleTag(angleTag);
  return t ? { territory: t, mechanic: "" } : null;
}
