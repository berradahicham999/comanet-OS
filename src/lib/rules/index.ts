import { cache } from "react";
import { eq, inArray, and } from "drizzle-orm";
import { db } from "@/db";
import { tasks, users } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { productStocks } from "@/lib/stock";
import { clientIntel } from "@/lib/clients";
import { getRefDate } from "@/lib/ref-date";
import { today as realToday } from "@/lib/format";
import { PRIORITY_ORDER, type RecommendationWithState, type Rule, type RuleContext } from "./types";
import { stockCoverageRule, overstockRule } from "./stock-rules";
import { regulatoryExpiryRule } from "./regulatory-rules";
import { clientRules, brandDropRule, dataQualityRule } from "./commercial-rules";
import { budgetRule, adsRule, influenceRule, campaignStockRule } from "./marketing-rules";
import { terrainRules, overdueTasksRule } from "./execution-rules";
import { animationPerformanceRule } from "./animation-rules";
import { medicalRules } from "./medical-rules";
import { medicalFieldRules } from "./medical-field-rules";
import { fieldScope, inFieldScope } from "@/lib/medical/field-access";
import { contentLateRule } from "./content-rules";
import { activationRules } from "./activation-rules";
import { analyticsRules } from "./analytics-rules";
import { clientStockRules } from "./client-stock-rules";
import { gestionRules } from "./gestion-rules";
import { planRules } from "./plan-rules";
import { dismissalsFor } from "./dismissals";
import { isDismissed } from "./dismissals-shared";

export * from "./types";

/** Registre des règles — ajouter une règle = l'ajouter ici. */
export const RULES: Rule[] = [
  stockCoverageRule,
  regulatoryExpiryRule,
  brandDropRule,
  adsRule,
  campaignStockRule,
  budgetRule,
  influenceRule,
  clientRules,
  terrainRules,
  animationPerformanceRule,
  overstockRule,
  overdueTasksRule,
  contentLateRule,
  ...activationRules,
  ...analyticsRules,
  ...clientStockRules,
  ...gestionRules,
  ...planRules,
  dataQualityRule,
  ...medicalRules,
  ...medicalFieldRules,
];

async function buildContext(): Promise<RuleContext> {
  const { ref } = await getRefDate();
  const [settings, stocks, clients] = await Promise.all([getSettings(), productStocks({}, ref), clientIntel({}, ref)]);
  return { settings, today: ref, now: realToday(), stocks, clients };
}

/**
 * Exécute toutes les règles et renvoie les recommandations triées par priorité, y compris celles écartées
 * à la main (`dismissed` renseigné). Seule la page Action Center les affiche, pour pouvoir les rétablir.
 */
export const allRecommendations = cache(async (): Promise<RecommendationWithState[]> => {
  const ctx = await buildContext();
  const results = await Promise.all(RULES.map(async (r) => {
    try { return await r.run(ctx); } catch (e) { console.error(`Règle ${r.id} en erreur`, e); return []; }
  }));
  // Alertes de contrôle terrain : seulement pour la direction et le manager de la déléguée concernée.
  const scope = await fieldScope().catch(() => ({ all: false, delegateIds: [] as string[] }));
  const recs = results.flat().filter((r) => !r.fieldDelegateId || inFieldScope(scope, r.fieldDelegateId));
  const keys = recs.map((r) => r.key);
  const [taskRows, dismissals] = await Promise.all([
    keys.length
      ? db.select({ source_key: tasks.sourceKey, id: tasks.id, status: tasks.status, assignee: users.name })
          .from(tasks).leftJoin(users, eq(users.id, tasks.assigneeId))
          .where(and(inArray(tasks.sourceKey, keys), inArray(tasks.status, ["TODO", "IN_PROGRESS", "BLOCKED"])))
      : Promise.resolve([]),
    dismissalsFor(keys),
  ]);
  const byKey = new Map(taskRows.map((t) => [t.source_key as string, t]));
  const now = new Date();
  return recs
    .map((r): RecommendationWithState => {
      const d = dismissals.get(r.key);
      return {
        ...r,
        existingTask: byKey.has(r.key) ? { id: byKey.get(r.key)!.id, status: byKey.get(r.key)!.status, assignee: byKey.get(r.key)!.assignee } : null,
        dismissed: d && isDismissed(d, r.priority, now) ? { until: d.until, by: d.by, reason: d.reason, at: d.at } : null,
      };
    })
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (b.score ?? 0) - (a.score ?? 0) || a.category.localeCompare(b.category));
});

/** Recommandations actives (sans celles écartées) : Cockpit, marques, analytics, copilote. */
export const getRecommendations = cache(async (): Promise<RecommendationWithState[]> => (await allRecommendations()).filter((r) => !r.dismissed));
