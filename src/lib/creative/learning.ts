/**
 * Apprentissage créatif (logique PURE) — la mémoire créative de COMANET relue en phrases.
 *
 * Entrée : les performances mesurées (créatives Meta étiquetées, contenus publiés du planning, collaborations
 * d'influence), chacune rattachée quand c'est possible à un territoire, une mécanique, un type d'accroche, un format.
 * Sortie : des apprentissages (« les créatives problème → solution coûtent 22 % de moins par conversation pour
 * CygneLab ») avec preuves et confiance. Toujours une **corrélation observée** ; un motif sans volume minimal ne produit
 * rien ; une métrique absente n'est jamais remplacée.
 */
import { RESULT_LABELS, type ResultKind } from "@/lib/ads";
import { TERRITORY_LABELS, MECHANIC_BY_KEY, HOOK_LABELS } from "./territories";
import type { CreativeInsight, CreativePerformance, Fact, HookType, InsightDirection, ScoreItem, TerritoryKey } from "./types";

export type LearningThresholds = { minCreatives: number; minSpendMad: number };

const mad = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} MAD`;
const pct = (v: number) => `${Math.round(Math.abs(v))} %`;

type Group = { key: string; dim: "territory" | "mechanic" | "hook" | "format"; value: string; label: string; rows: CreativePerformance[] };

function groupsOf(rows: CreativePerformance[]): Group[] {
  const map = new Map<string, Group>();
  const put = (dim: Group["dim"], value: string | null, label: string | null, r: CreativePerformance) => {
    if (!value || !label) return;
    const key = `${dim}|${value}`;
    const g = map.get(key) ?? { key, dim, value, label, rows: [] };
    g.rows.push(r);
    map.set(key, g);
  };
  for (const r of rows) {
    put("territory", r.territory, r.territory ? TERRITORY_LABELS[r.territory] : null, r);
    put("mechanic", r.mechanic, r.mechanic ? MECHANIC_BY_KEY.get(r.mechanic)?.name ?? null : null, r);
    put("hook", r.hookType, r.hookType ? HOOK_LABELS[r.hookType] : null, r);
    put("format", r.format, r.format, r);
  }
  return [...map.values()];
}

/** Coût par résultat d'un groupe de créatives payantes, sur le type de résultat dominant (en dépense). */
function paidCost(rows: CreativePerformance[]): { kind: ResultKind; spend: number; results: number; cost: number | null; n: number } | null {
  const paid = rows.filter((r) => r.source === "ADS" && r.metrics.spend !== null && r.metrics.resultKind);
  if (!paid.length) return null;
  const byKind = new Map<string, number>();
  for (const r of paid) byKind.set(r.metrics.resultKind!, (byKind.get(r.metrics.resultKind!) ?? 0) + (r.metrics.spend ?? 0));
  const kind = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0][0] as ResultKind;
  const same = paid.filter((r) => r.metrics.resultKind === kind);
  const spend = same.reduce((s, r) => s + (r.metrics.spend ?? 0), 0);
  const results = same.reduce((s, r) => s + (r.metrics.results ?? 0), 0);
  return { kind, spend, results, cost: results > 0 ? spend / results : null, n: same.length };
}

/** Taux d'engagement organique (engagement ÷ portée) d'un groupe, seulement sur les lignes qui portent les deux mesures. */
function organicRate(rows: CreativePerformance[]): { rate: number | null; n: number; reach: number } {
  const org = rows.filter((r) => r.source !== "ADS" && r.metrics.reach !== null && r.metrics.reach > 0 && r.metrics.engagement !== null);
  const reach = org.reduce((s, r) => s + (r.metrics.reach ?? 0), 0);
  const eng = org.reduce((s, r) => s + (r.metrics.engagement ?? 0), 0);
  return { rate: reach > 0 ? (eng / reach) * 100 : null, n: org.length, reach };
}

const conf = (n: number, spend: number, base: number) => Math.min(95, Math.round(base + n * 10 + Math.min(20, spend / 500)));

/** Apprentissages d'une marque à partir de sa mémoire créative. */
export function creativeLearning(perfs: CreativePerformance[], brand: { id: string; name: string }, t: LearningThresholds): CreativeInsight[] {
  const rows = perfs.filter((r) => r.brandId === brand.id);
  const out: CreativeInsight[] = [];
  const ref = paidCost(rows);
  const refOrganic = organicRate(rows);
  const groups = groupsOf(rows);

  for (const g of groups) {
    const scope = { territory: g.dim === "territory" ? (g.value as TerritoryKey) : g.dim === "mechanic" ? MECHANIC_BY_KEY.get(g.value)?.territory ?? null : null, mechanic: g.dim === "mechanic" ? g.value : null, hookType: g.dim === "hook" ? (g.value as HookType) : null, format: g.dim === "format" ? g.value : null };
    const what = g.dim === "territory" ? `Les contenus « ${g.label} »` : g.dim === "mechanic" ? `La mécanique « ${g.label} »` : g.dim === "hook" ? `Les accroches « ${g.label.toLowerCase()} »` : `Le format « ${g.label} »`;

    /* Payant : coût par résultat vs la moyenne de la marque sur le même type de résultat. */
    const pc = paidCost(g.rows);
    if (pc && ref && pc.kind === ref.kind && pc.n >= t.minCreatives && pc.spend >= t.minSpendMad && pc.cost !== null && ref.cost !== null && ref.cost > 0) {
      const vs = ((pc.cost - ref.cost) / ref.cost) * 100;
      const label = RESULT_LABELS[pc.kind].cost;
      const direction: InsightDirection = vs <= -15 ? "POSITIVE" : vs >= 30 ? "NEGATIVE" : "NEUTRAL";
      if (direction !== "NEUTRAL") {
        const evidence: Fact[] = [
          { label: "Créatives", value: String(pc.n), tag: "CONFIRMED" }, { label: "Dépense", value: mad(pc.spend), tag: "CONFIRMED" },
          { label: label, value: `${pc.cost.toFixed(1)} MAD`, tag: "CALCULATED" }, { label: `${label} moyen ${brand.name}`, value: `${ref.cost.toFixed(1)} MAD`, tag: "CALCULATED" },
        ];
        out.push({
          key: `paid:${brand.id}:${g.key}`, scope: "BRAND", brandId: brand.id, productId: null, ...scope, direction, kind: "CORRELATION",
          statement: direction === "POSITIVE"
            ? `${what} obtiennent un ${label} ${pct(vs)} plus bas que la moyenne ${brand.name} en payant (${pc.n} créatives, ${mad(pc.spend)}) — corrélation observée.`
            : `${what} coûtent ${pct(vs)} de plus par ${RESULT_LABELS[pc.kind].one} que la moyenne ${brand.name} en payant (${pc.n} créatives, ${mad(pc.spend)}) : à ne pas reconduire sans nouvel angle.`,
          evidence, confidence: conf(pc.n, pc.spend, direction === "POSITIVE" ? 45 : 40),
        });
      }
    }

    /* Organique : taux d'engagement vs la moyenne de la marque ; croisé avec le payant quand les deux existent. */
    const or = organicRate(g.rows);
    if (or.rate !== null && or.n >= t.minCreatives && refOrganic.rate !== null && refOrganic.rate > 0 && (g.dim === "territory" || g.dim === "mechanic")) {
      const vs = ((or.rate - refOrganic.rate) / refOrganic.rate) * 100;
      if (Math.abs(vs) >= 20) {
        const weakPaid = pc && ref && pc.kind === ref.kind && pc.cost !== null && ref.cost !== null && pc.cost > ref.cost * 1.3;
        const direction: InsightDirection = vs > 0 && !weakPaid ? "POSITIVE" : vs < 0 ? "NEGATIVE" : "NEUTRAL";
        const evidence: Fact[] = [{ label: "Publications", value: String(or.n), tag: "CONFIRMED" }, { label: "Portée cumulée", value: or.reach.toLocaleString("fr-FR"), tag: "CONFIRMED" }, { label: "Taux d'engagement", value: `${or.rate.toFixed(1)} %`, tag: "CALCULATED" }, { label: `Moyenne ${brand.name}`, value: `${refOrganic.rate.toFixed(1)} %`, tag: "CALCULATED" }];
        out.push({
          key: `organic:${brand.id}:${g.key}`, scope: "BRAND", brandId: brand.id, productId: null, ...scope, direction, kind: "CORRELATION",
          statement: vs > 0
            ? weakPaid
              ? `${what} génèrent un fort engagement organique (+${pct(vs)} vs la moyenne ${brand.name}) mais un coût par résultat élevé en payant : à garder en organique, pas en acquisition.`
              : `${what} génèrent ${pct(vs)} d'engagement de plus que la moyenne ${brand.name} en organique (${or.n} publications) — corrélation observée, sans mesure de conversion.`
            : `${what} engagent ${pct(vs)} de moins que la moyenne ${brand.name} en organique (${or.n} publications).`,
          evidence, confidence: Math.min(85, 35 + or.n * 10),
        });
      }
    }
  }

  /* Par produit : une mécanique nettement meilleure sur un produit précis (payant). */
  const byProduct = new Map<string, CreativePerformance[]>();
  for (const r of rows) if (r.productId && r.source === "ADS") byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);
  for (const [productId, prs] of byProduct) {
    const pref = paidCost(prs);
    if (!pref || pref.cost === null) continue;
    for (const g of groupsOf(prs).filter((x) => x.dim === "mechanic" || x.dim === "hook")) {
      const pc = paidCost(g.rows);
      if (!pc || pc.kind !== pref.kind || pc.n < t.minCreatives || pc.spend < t.minSpendMad || pc.cost === null) continue;
      const vs = ((pc.cost - pref.cost) / pref.cost) * 100;
      if (vs > -15) continue;
      const productName = prs[0].label.split(" — ")[0];
      out.push({
        key: `product:${brand.id}:${productId}:${g.key}`, scope: "PRODUCT", brandId: brand.id, productId, territory: g.dim === "mechanic" ? MECHANIC_BY_KEY.get(g.value)?.territory ?? null : null, mechanic: g.dim === "mechanic" ? g.value : null, hookType: g.dim === "hook" ? (g.value as HookType) : null, format: null,
        direction: "POSITIVE", kind: "CORRELATION",
        statement: `Pour ce produit, ${g.dim === "mechanic" ? `la mécanique « ${g.label} »` : `les accroches « ${g.label.toLowerCase()} »`} obtiennent un ${RESULT_LABELS[pc.kind].cost} ${pct(vs)} plus bas que la moyenne du produit (${pc.n} créatives, ${mad(pc.spend)}) — corrélation observée.`,
        evidence: [{ label: "Produit", value: productName, tag: "CONFIRMED" }, { label: "Créatives", value: String(pc.n), tag: "CONFIRMED" }, { label: RESULT_LABELS[pc.kind].cost, value: `${pc.cost.toFixed(1)} MAD`, tag: "CALCULATED" }],
        confidence: conf(pc.n, pc.spend, 40),
      });
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 12);
}

/** Adéquation historique d'une mécanique (critère de score /10), lue dans les apprentissages. Sans donnée : neutre et MISSING. */
export function historicalFit(m: { key: string; territory: TerritoryKey; defaultHook: HookType }, insights: CreativeInsight[], productId: string | null): Omit<ScoreItem, "key" | "label" | "max"> {
  const forProduct = insights.find((i) => i.scope === "PRODUCT" && i.productId === productId && i.mechanic === m.key);
  if (forProduct) return { points: forProduct.direction === "POSITIVE" ? 10 : 2, why: forProduct.statement, tag: "CALCULATED" };
  const mech = insights.find((i) => i.mechanic === m.key);
  if (mech) return { points: mech.direction === "POSITIVE" ? 9 : mech.direction === "NEGATIVE" ? 1 : 5, why: mech.statement, tag: "CALCULATED" };
  const terr = insights.find((i) => i.territory === m.territory && !i.mechanic);
  if (terr) return { points: terr.direction === "POSITIVE" ? 7 : terr.direction === "NEGATIVE" ? 3 : 5, why: terr.statement, tag: "CALCULATED" };
  const hook = insights.find((i) => i.hookType === m.defaultHook);
  if (hook) return { points: hook.direction === "POSITIVE" ? 7 : hook.direction === "NEGATIVE" ? 3 : 5, why: hook.statement, tag: "CALCULATED" };
  return { points: 5, why: "aucune performance mesurée sur cette mécanique pour la marque : neutre", tag: "MISSING" };
}
