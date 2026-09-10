/**
 * Content Opportunity Engine — « quoi publier ensuite ».
 *
 * Les créatives sont étiquetées (format, angle, accroche, offre, type de contenu). On mesure
 * chaque motif (marque × angle, marque × format, produit × angle, motif transversal) sur tout
 * l'historique et on en tire des idées de contenu notées /100 : performance historique du
 * motif, adéquation produit, récence sans fatigue, volume de preuve, saison observée.
 * Aucune idée n'est produite sans motif mesuré derrière.
 */
import { RESULT_LABELS } from "@/lib/ads";
import type { AdsIntelSettings } from "@/lib/settings";
import { clamp, pct } from "./metrics";
import type { ContentOpportunity, ContentPattern, EntityPerf, PushRecommendation } from "./types";

type Dim = ContentPattern["dimension"];
const DIMS: Dim[] = ["angle", "format", "hook", "contentType", "offer"];

/** Agrège les créatives (historique complet) par motif, avec l'écart au coût moyen de la marque. */
export function patternsOf(creatives: EntityPerf[], s: AdsIntelSettings): ContentPattern[] {
  const brandRef = new Map<string, { spend: number; results: number; kind: string }>();
  for (const c of creatives) {
    const k = `${c.brandId ?? "none"}|${c.resultKind}`;
    const r = brandRef.get(k) ?? { spend: 0, results: 0, kind: c.resultKind };
    r.spend += c.spend; r.results += c.resultKind === "reach" ? c.results / 1000 : c.results;
    brandRef.set(k, r);
  }
  const groups = new Map<string, { dim: Dim; value: string; brandId: string | null; brandName: string | null; rows: EntityPerf[] }>();
  for (const c of creatives) {
    for (const dim of DIMS) {
      const v = c.tags?.[dim];
      if (!v) continue;
      // Les accroches ne sont comparables qu'à l'identique ; les autres motifs se regroupent par marque et en transversal.
      const scopes: (string | null)[] = dim === "hook" ? [c.brandId] : [c.brandId, null];
      for (const scope of scopes) {
        const key = `${dim}|${scope ?? "*"}|${v}`;
        const g = groups.get(key) ?? { dim, value: v, brandId: scope, brandName: scope ? c.brandName : null, rows: [] };
        g.rows.push(c);
        groups.set(key, g);
      }
    }
  }
  const out: ContentPattern[] = [];
  for (const [key, g] of groups) {
    const kinds = new Map<string, number>();
    for (const r of g.rows) kinds.set(r.resultKind, (kinds.get(r.resultKind) ?? 0) + r.spend);
    const kind = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0][0] as EntityPerf["resultKind"];
    const same = g.rows.filter((r) => r.resultKind === kind);
    const spend = same.reduce((a, r) => a + r.spend, 0);
    if (spend < s.winnerMinSpend) continue;
    const results = same.reduce((a, r) => a + (kind === "reach" ? r.results / 1000 : r.results), 0);
    const imp = same.reduce((a, r) => a + r.impressions, 0);
    const clicks = same.reduce((a, r) => a + (r.linkClicks || r.clicks), 0);
    const cost = results > 0 ? spend / results : null;
    const ref = g.brandId ? brandRef.get(`${g.brandId}|${kind}`) : null;
    const refCost = ref && ref.results > 0 ? ref.spend / ref.results : null;
    out.push({
      key, dimension: g.dim, value: g.value, brandId: g.brandId, brandName: g.brandName,
      spend, results: Math.round(results), resultKind: kind, costPerResult: cost,
      ctr: imp > 0 ? (clicks / imp) * 100 : null, creatives: new Set(same.map((r) => r.key)).size,
      lastDay: same.reduce<string | null>((m, r) => (r.lastDay && (!m || r.lastDay > m) ? r.lastDay : m), null),
      vsBrandPct: pct(cost, refCost),
    });
  }
  return out.sort((a, b) => (a.vsBrandPct ?? 0) - (b.vsBrandPct ?? 0));
}

const IDEA_BY_ANGLE: Record<string, (p: string) => string> = {
  "Avant / après": (p) => `Vidéo avant / après pour ${p}`,
  "Témoignage": (p) => `Témoignage client pour ${p}`,
  "Problème → solution": (p) => `Vidéo problème → solution pour ${p}`,
  "FAQ / éducatif": (p) => `Contenu éducatif : les questions qu'on se pose sur ${p}`,
  "Démonstration": (p) => `Démonstration de ${p} (texture, application, routine)`,
  "Promo / offre": (p) => `Offre limitée sur ${p}`,
  "Événement / point de vente": (p) => `Rendez-vous en point de vente autour de ${p}`,
  "Nouveauté / lancement": (p) => `Nouveauté : ${p}`,
};

/** Mois de l'année (1–12) où le motif a le mieux fonctionné, s'il a été observé plusieurs années. */
function seasonNote(_pattern: ContentPattern, now: Date): string | null {
  const m = now.getMonth() + 1;
  const label = m === 9 ? "rentrée" : m === 12 || m === 1 ? "fêtes / hiver" : m >= 6 && m <= 8 ? "été" : null;
  return label ? `Période observée : ${label}` : null;
}

export function opportunitiesOf(
  patterns: ContentPattern[],
  push: PushRecommendation[],
  activeCreatives: EntityPerf[],
  s: AdsIntelSettings,
  now: Date,
  max = 5,
): ContentOpportunity[] {
  const angles = patterns.filter((p) => p.dimension === "angle" && p.costPerResult !== null);
  const formats = patterns.filter((p) => p.dimension === "format" && p.costPerResult !== null);
  const crossBrandAngles = new Set(
    angles.filter((p) => p.brandId === null).filter((p) => angles.filter((q) => q.brandId && q.value === p.value && (q.vsBrandPct ?? 0) <= 0).length >= 2).map((p) => p.value),
  );
  const bestFormatByBrand = new Map<string | null, ContentPattern>();
  for (const f of formats) {
    const cur = bestFormatByBrand.get(f.brandId);
    if (!cur || (f.vsBrandPct ?? 0) < (cur.vsBrandPct ?? 0)) bestFormatByBrand.set(f.brandId, f);
  }
  const activeAngles = new Set(activeCreatives.map((c) => `${c.brandId}|${c.tags?.angle}`));
  const out: ContentOpportunity[] = [];
  const pushable = push.filter((p) => p.decision === "PUSH_MORE" || p.decision === "PUSH" || p.decision === "HOLD");

  for (const a of angles.filter((p) => p.brandId !== null)) {
    const products = pushable.filter((p) => p.brandId === a.brandId);
    const targets = products.length ? products.slice(0, 2) : [null];
    for (const prod of targets) {
      const why: string[] = [];
      const evidence: ContentOpportunity["evidence"] = [];
      // Performance historique du motif (40)
      const perf = a.vsBrandPct === null ? 15 : clamp(20 - a.vsBrandPct * 0.6, 0, 40);
      why.push(`Angle « ${a.value} » : ${RESULT_LABELS[a.resultKind].cost} ${a.vsBrandPct !== null ? `${a.vsBrandPct > 0 ? "+" : ""}${Math.round(a.vsBrandPct)} % vs moyenne ${a.brandName}` : "sans référence"}`);
      evidence.push({ label: "Dépense sur ce motif", value: `${Math.round(a.spend).toLocaleString("fr-FR")} MAD` }, { label: "Créatives", value: String(a.creatives) }, { label: RESULT_LABELS[a.resultKind].cost, value: a.costPerResult !== null ? `${a.costPerResult.toFixed(2)} MAD` : "—" });
      // Adéquation produit (20)
      let fit = 8;
      if (prod) {
        fit = prod.decision === "PUSH_MORE" ? 20 : prod.decision === "PUSH" ? 16 : 10;
        why.push(`${prod.productName} : ${prod.decision === "PUSH_MORE" ? "à pousser davantage" : prod.decision === "PUSH" ? "à pousser" : "produit établi"}${prod.stockNote ? ` (${prod.stockNote})` : ""}`);
        if (prod.stockNote?.includes("tension")) fit -= 8;
      }
      // Récence / fatigue (15) : un angle déjà en diffusion sans fatigue vaut moins qu'un angle éprouvé mais absent.
      const inUse = activeAngles.has(`${a.brandId}|${a.value}`);
      const recency = inUse ? 6 : 15;
      why.push(inUse ? "Angle déjà en diffusion : prévoir une variante" : "Angle éprouvé, absent des diffusions actuelles");
      // Volume de preuve (15)
      const proof = clamp(a.spend / (s.winnerMinSpend * 5), 0, 1) * 10 + clamp(a.creatives / 5, 0, 1) * 5;
      // Saison (10) : seulement si observée
      const season = seasonNote(a, now);
      const seasonPts = season ? 5 : 0;
      if (season) why.push(season);
      const cross = crossBrandAngles.has(a.value);
      if (cross) why.push("Motif transversal : fonctionne sur plusieurs marques");
      const fmt = bestFormatByBrand.get(a.brandId);
      const score = Math.round(clamp(perf + fit + recency + proof + seasonPts + (cross ? 5 : 0), 0, 100));
      const productLabel = prod?.productName ?? a.brandName ?? "la marque";
      out.push({
        id: `${a.key}|${prod?.productId ?? ""}`,
        title: (IDEA_BY_ANGLE[a.value] ?? ((p: string) => `${a.value} pour ${p}`))(productLabel),
        brandId: a.brandId, brandName: a.brandName, productId: prod?.productId ?? null, productName: prod?.productName ?? null,
        angle: a.value, format: fmt?.value ?? null, score, why: why.slice(0, 5), evidence, crossBrand: cross,
      });
    }
  }
  // Une idée par (marque, angle, produit) ; les meilleures d'abord, sans dépasser deux idées par marque.
  const perBrand = new Map<string | null, number>();
  const picked: ContentOpportunity[] = [];
  for (const o of out.sort((a, b) => b.score - a.score)) {
    const n = perBrand.get(o.brandId) ?? 0;
    if (n >= 2) continue;
    perBrand.set(o.brandId, n + 1);
    picked.push(o);
    if (picked.length >= max) break;
  }
  return picked;
}
