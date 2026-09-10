/**
 * Mémoire marketing : phrases apprises des données publicitaires, avec preuves et confiance.
 * Calculées par les moteurs (motifs, allocation, produits, saisonnalité), jamais saisies à la
 * main, jamais énoncées sans un volume minimal derrière. Persistées dans `ad_memory` pour le
 * copilote ; recalculées à chaque passage.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { adMemory } from "@/db/schema";
import { RESULT_LABELS } from "@/lib/ads";
import type { AdsIntelSettings } from "@/lib/settings";
import type { MonthRow } from "./data";
import { dailyResults } from "./metrics";
import type { BrandAllocation, ContentPattern, EntityPerf, MemoryItem, PushRecommendation } from "./types";

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function memoryOf(input: {
  patterns: ContentPattern[];
  allocation: BrandAllocation[];
  push: PushRecommendation[];
  productsAll: EntityPerf[];
  historyByBrand: Map<string, MonthRow[]>;
  brandNames: Map<string, string>;
  s: AdsIntelSettings;
  now: Date;
}): MemoryItem[] {
  const out: MemoryItem[] = [];
  const at = input.now.toISOString();
  const add = (key: string, scope: string, brandId: string | null, productName: string | null, statement: string, evidence: Record<string, unknown>, confidence: number) =>
    out.push({ key, scope, brandId, brandName: brandId ? input.brandNames.get(brandId) ?? null : null, productName, statement, evidence, confidence: Math.round(confidence), computedAt: at });

  // Motifs par marque : angle / format nettement meilleurs que la moyenne de la marque.
  for (const p of input.patterns) {
    if (!p.brandId || p.vsBrandPct === null || p.creatives < 2 || p.spend < input.s.winnerMinSpend * 2) continue;
    if (p.vsBrandPct <= -20 && (p.dimension === "angle" || p.dimension === "format" || p.dimension === "contentType")) {
      const what = p.dimension === "format" ? `Le format « ${p.value} »` : `Les créatives « ${p.value} »`;
      add(`pattern:${p.key}`, p.dimension === "format" ? "FORMAT" : "ANGLE", p.brandId, null,
        `${what} obtiennent un ${RESULT_LABELS[p.resultKind].cost} ${Math.abs(Math.round(p.vsBrandPct))} % plus bas que la moyenne ${p.brandName} (${p.creatives} créatives, ${Math.round(p.spend).toLocaleString("fr-FR")} MAD).`,
        { spend: p.spend, creatives: p.creatives, costPerResult: p.costPerResult, vsBrandPct: p.vsBrandPct, lastDay: p.lastDay }, Math.min(95, 50 + p.creatives * 8 + Math.min(20, p.spend / 200)));
    }
    if (p.vsBrandPct >= 40 && p.dimension === "angle") {
      add(`pattern-weak:${p.key}`, "ANGLE", p.brandId, null,
        `Les créatives « ${p.value} » coûtent ${Math.round(p.vsBrandPct)} % de plus par résultat que la moyenne ${p.brandName} : à éviter sans nouvel angle.`,
        { spend: p.spend, creatives: p.creatives, vsBrandPct: p.vsBrandPct }, Math.min(90, 45 + p.creatives * 8));
    }
  }
  // Motifs transversaux.
  const byValue = new Map<string, ContentPattern[]>();
  for (const p of input.patterns.filter((x) => x.brandId && x.dimension === "angle" && (x.vsBrandPct ?? 0) <= -15)) byValue.set(p.value, [...(byValue.get(p.value) ?? []), p]);
  for (const [value, ps] of byValue) {
    if (ps.length < 2) continue;
    add(`cross:${value}`, "CROSS_BRAND", null, null,
      `L'angle « ${value} » fonctionne sur plusieurs marques (${ps.map((p) => p.brandName).join(", ")}) : un apprentissage transférable.`,
      { brands: ps.map((p) => ({ brand: p.brandName, vsBrandPct: p.vsBrandPct, spend: p.spend })) }, Math.min(90, 55 + ps.length * 10));
  }
  // Produits stars / sous-exploités.
  for (const p of input.push) {
    if (p.decision === "PUSH_MORE" && p.productId) {
      add(`product-star:${p.productId}`, "PRODUCT", p.brandId, p.productName,
        `${p.productName} est le produit ${p.brandName ?? ""} le plus efficace en publicité (${RESULT_LABELS[p.resultKind].cost} ${p.costPerResult !== null ? p.costPerResult.toFixed(2) + " MAD" : "—"}, ${p.winners} créative(s) performante(s)).`,
        { spend: p.spend, results: p.results, costPerResult: p.costPerResult, winners: p.winners }, p.score);
    }
    if (p.decision === "DONT_PUSH" && p.productId && p.spend >= input.s.winnerMinSpend * 2) {
      add(`product-weak:${p.productId}`, "PRODUCT", p.brandId, p.productName,
        `${p.productName} convertit mal en publicité malgré ${Math.round(p.spend).toLocaleString("fr-FR")} MAD investis : ${p.why[0] ?? "coût par résultat élevé"}.`,
        { spend: p.spend, results: p.results, costPerResult: p.costPerResult }, Math.min(85, 40 + p.spend / 100));
    }
  }
  // Saisonnalité observée : mois où une marque a eu son meilleur coût, si au moins 6 mois d'historique.
  for (const [brandId, hist] of input.historyByBrand) {
    const withSpend = hist.filter((m) => m.spend >= input.s.winnerMinSpend);
    if (withSpend.length < 6) continue;
    const kind = input.allocation.find((a) => a.brandId === brandId)?.resultKind ?? "click";
    const scored = withSpend.map((m) => ({ m, cost: (() => { const r = dailyResults({ ...m, date: m.month }, kind); return r > 0 ? m.spend / r : null; })() })).filter((x) => x.cost !== null) as { m: MonthRow; cost: number }[];
    if (scored.length < 6) continue;
    const best = scored.reduce((a, b) => (b.cost < a.cost ? b : a));
    const avg = scored.reduce((a, x) => a + x.cost, 0) / scored.length;
    if (best.cost <= avg * 0.7) {
      const [y, mo] = best.m.month.split("-");
      add(`season:${brandId}:${best.m.month}`, "SEASON", brandId, null,
        `Le meilleur mois publicitaire de ${input.brandNames.get(brandId) ?? "la marque"} a été ${MONTHS[Number(mo) - 1]} ${y} (${RESULT_LABELS[kind].cost} ${Math.round((1 - best.cost / avg) * 100)} % sous sa moyenne). Observation, pas prévision.`,
        { month: best.m.month, cost: best.cost, average: avg, months: scored.length }, Math.min(80, 40 + scored.length * 3));
    }
  }
  return out;
}

/** Remplace la mémoire calculée (clé unique) ; les clés absentes du nouveau calcul sont supprimées. */
export async function persistMemory(items: MemoryItem[]): Promise<void> {
  try {
    if (items.length) {
      for (let i = 0; i < items.length; i += 200) {
        await db.insert(adMemory).values(items.slice(i, i + 200).map((m) => ({
          key: m.key, scope: m.scope, brandId: m.brandId, productId: null, statement: m.statement, evidence: m.evidence, confidence: m.confidence, computedAt: new Date(m.computedAt),
        }))).onConflictDoUpdate({
          target: adMemory.key,
          set: { statement: sql`excluded.statement`, evidence: sql`excluded.evidence`, confidence: sql`excluded.confidence`, computedAt: sql`excluded.computed_at`, brandId: sql`excluded.brand_id` },
        });
      }
      await db.execute(sql`delete from ad_memory where key not in (${sql.join(items.map((m) => sql`${m.key}`), sql`, `)})`);
    }
  } catch {
    // La mémoire est un confort : son écriture ne doit jamais casser l'écran.
  }
}

export async function loadMemory(brandId?: string | null): Promise<MemoryItem[]> {
  try {
    const res = await db.execute(sql`
      select m.key, m.scope, m.brand_id, b.name as brand_name, p.name as product_name, m.statement, m.evidence, m.confidence, m.computed_at::text as computed_at
      from ad_memory m left join brands b on b.id = m.brand_id left join products p on p.id = m.product_id
      ${brandId ? sql`where m.brand_id = ${brandId}::uuid or m.brand_id is null` : sql``}
      order by m.confidence desc, m.computed_at desc limit 40`);
    return (res.rows as Record<string, unknown>[]).map((r) => ({
      key: String(r.key), scope: String(r.scope), brandId: r.brand_id ? String(r.brand_id) : null, brandName: r.brand_name ? String(r.brand_name) : null,
      productName: r.product_name ? String(r.product_name) : null, statement: String(r.statement), evidence: (r.evidence ?? {}) as Record<string, unknown>,
      confidence: Number(r.confidence), computedAt: String(r.computed_at),
    }));
  } catch {
    return [];
  }
}
