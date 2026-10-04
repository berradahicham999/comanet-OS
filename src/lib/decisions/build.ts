/**
 * Assemblage des décisions unifiées (serveur) : règles Action Center + intelligence Ads + intelligence
 * marketing, traduites par `adapters.ts`, croisées avec le statut humain (`store.ts`), triées et limitées.
 * Aucune donnée n'est recalculée : chaque moteur est appelé tel quel, avec les droits et la portée de la
 * personne. Une marque à la fois, ou toutes celles du périmètre (une lecture par marque, en parallèle).
 */
import "server-only";
import { getRecommendations } from "@/lib/rules";
import { CATEGORY_MODULES } from "@/lib/rules/types";
import { buildCommandCenter, resolveAdsPeriod } from "@/lib/ads-intel/command-center";
import { buildRecommendations, type MarketingPeriodKey, type PerformanceResult } from "@/lib/marketing-intel/build";
import type { IntelContext, SalesTargets } from "@/lib/marketing-intel/types";
import type { PermissionSet } from "@/lib/permissions-shared";
import { can } from "@/lib/permissions-shared";
import { iso } from "@/lib/format";
import { fromAdsIntel, fromMarketingIntel, fromRule, sortDecisions } from "./adapters";
import { decisionStates, effectiveStatus, persistEffectiveStatuses } from "./store";
import type { UnifiedDecision } from "./types";

export type DecisionScope = {
  ctx: IntelContext;
  perms: PermissionSet;
  /** Marques lues (identifiant → nom) ; une seule pour un cockpit de marque. */
  brands: { id: string; name: string }[];
  period?: MarketingPeriodKey;
  /** Inclure les décisions déjà refusées / exécutées (page Priorités, historique). */
  includeDecided?: boolean;
  /** Lectures déjà faites par l'appelant (Command Center) : évite de relire la même donnée. */
  precomputed?: Map<string, { performance: PerformanceResult; targets: SalesTargets }>;
};

export type DecisionSet = {
  /** À décider, triées : priorité puis score. */
  proposed: UnifiedDecision[];
  /** « Ne pas pousser » (rupture, diagnostic) : rangées à part, jamais dans les actions à lancer. */
  doNotPush: UnifiedDecision[];
  /** Déjà décidées (approuvées, refusées, exécutées, mesurées, expirées), si demandé. */
  decided: UnifiedDecision[];
  notes: string[];
  computedAt: string;
};

export async function buildUnifiedDecisions(scope: DecisionScope): Promise<DecisionSet> {
  const { ctx, perms } = scope;
  const now = ctx.now;
  const reviewDays = ctx.settings.marketingPlan.reviewDays;
  const brandIds = new Set(scope.brands.map((b) => b.id));
  const notes: string[] = [];
  const period = resolveAdsPeriod(scope.period === "7d" ? "7d" : scope.period === "90d" ? "90d" : "30d", undefined, now);
  const periodInfo = { start: period.start, end: period.end, label: period.label };

  const [rules, intel, ads] = await Promise.all([
    // Règles : catégories marketing et budget, dans la portée de la personne (mêmes modules que /actions).
    getRecommendations().then((recs) => recs.filter((r) => (r.category === "MARKETING" || r.category === "BUDGET") && (CATEGORY_MODULES[r.category] ?? []).some((m) => perms[m].view) && (!r.brandId || brandIds.has(r.brandId))).map((r) => fromRule(r, now, reviewDays))).catch((e) => { console.error("Décisions : règles illisibles", e); notes.push("Règles de l'Action Center indisponibles."); return [] as UnifiedDecision[]; }),
    Promise.all(scope.brands.map(async (b) => {
      try {
        const pre = scope.precomputed?.get(b.id);
        const r = await buildRecommendations(ctx, { brandId: b.id, brandName: b.name, period: scope.period ?? "30d", performance: pre?.performance, targets: pre?.targets });
        const p = { start: r.period.start, end: r.period.end, label: r.period.label };
        return [...r.set.decisions, ...r.set.doNotPush].map((d) => fromMarketingIntel(d, b.id, p, now, reviewDays));
      } catch (e) { console.error(`Décisions : intelligence marketing ${b.name}`, e); notes.push(`Intelligence marketing indisponible pour ${b.name}.`); return [] as UnifiedDecision[]; }
    })).then((x) => x.flat()),
    can(perms, "marketing", "view")
      ? buildCommandCenter({ periodKey: period.key, brandId: scope.brands.length === 1 ? scope.brands[0].id : null, now, persist: false })
          .then((cc) => cc.actions.filter((a) => a.decision !== "DO_NOTHING" && (!a.brandId || brandIds.has(a.brandId))).map((a) => fromAdsIntel(a, periodInfo, now, reviewDays)))
          .catch((e) => { console.error("Décisions : intelligence Ads", e); notes.push("Intelligence Ads indisponible (connexion Meta ou données absentes)."); return [] as UnifiedDecision[]; })
      : Promise.resolve([] as UnifiedDecision[]),
  ]);
  const brandName = new Map(scope.brands.map((b) => [b.id, b.name]));
  const all = [...rules, ...intel, ...ads].map((d) => ({ ...d, brandName: d.brandName ?? (d.brandId ? brandName.get(d.brandId) ?? null : null) }));

  const todayIso = iso(now);
  const states = await decisionStates(all.map((d) => d.id));
  await persistEffectiveStatuses(states, todayIso).catch((e) => console.error("Décisions : statuts non persistés", e));
  const withState = all.map((d) => { const s = states.get(d.id) ?? null; return { ...d, state: s, status: s ? effectiveStatus(s, todayIso) : "PROPOSED" } as UnifiedDecision; });
  const proposed = sortDecisions(withState.filter((d) => d.status === "PROPOSED" && !d.doNotPush));
  const doNotPush = sortDecisions(withState.filter((d) => d.status === "PROPOSED" && d.doNotPush));
  const decided = scope.includeDecided ? sortDecisions(withState.filter((d) => d.status !== "PROPOSED")) : [];
  return { proposed, doNotPush, decided, notes, computedAt: now.toISOString() };
}

/** Retrouve une décision vivante par sa clé (pour approuver / refuser depuis une action serveur). */
export async function findDecision(scope: DecisionScope, key: string): Promise<UnifiedDecision | null> {
  const set = await buildUnifiedDecisions({ ...scope, includeDecided: true });
  return [...set.proposed, ...set.doNotPush, ...set.decided].find((d) => d.id === key) ?? null;
}
