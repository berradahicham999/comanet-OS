/**
 * Couche de décision unifiée — contrats.
 *
 * Quatre moteurs produisent des recommandations avec des formes différentes : les règles de l'Action Center
 * (`src/lib/rules`), l'intelligence Ads (`src/lib/ads-intel`), l'intelligence marketing (`src/lib/marketing-intel`)
 * et l'analytics marketing (réallocations, déjà portées par des règles `analytics-*`). Aucun n'est modifié :
 * `adapters.ts` les traduit en `UnifiedDecision`, `store.ts` ne persiste que le choix humain (approuvée,
 * refusée, exécutée, mesurée) et `build.ts` assemble le tout pour le Command Center, Priorités & Actions et
 * l'Agent marketing. La recommandation reste recalculée à chaque lecture ; seul son statut est écrit.
 */
import type { BudgetCategory, MarketingDecisionStatus, TaskPriority } from "@/db/schema";
import type { DataTag } from "@/lib/marketing-intel/types";

export type DecisionDomain = "RULES" | "ADS_INTEL" | "MARKETING_INTEL" | "ANALYTICS";

export const DOMAIN_LABELS: Record<DecisionDomain, string> = {
  RULES: "Règles Action Center",
  ADS_INTEL: "Intelligence Ads",
  MARKETING_INTEL: "Intelligence marketing",
  ANALYTICS: "Analytics marketing",
};

export const DECISION_STATUS: Record<MarketingDecisionStatus, { label: string; tone: "gray" | "green" | "red" | "blue" | "purple" | "orange" }> = {
  PROPOSED: { label: "Proposée", tone: "gray" },
  APPROVED: { label: "Approuvée", tone: "green" },
  REJECTED: { label: "Refusée", tone: "red" },
  EXECUTED: { label: "Exécutée", tone: "blue" },
  MEASURED: { label: "Mesurée", tone: "purple" },
  EXPIRED: { label: "Expirée", tone: "orange" },
};

export type Evidence = { label: string; value: string; tag: DataTag };

export type DecisionEntity = { type: "product" | "brand" | "campaign" | "ad" | "channel" | "client" | "content" | "activation" | "other"; id: string | null; name: string; href: string | null };

export type UnifiedDecision = {
  /** Clé stable du moteur (règle + entité, action + produit, décision Ads + objet). */
  id: string;
  domain: DecisionDomain;
  /** Identifiant du moteur ou de la règle (`ads-performance`, `decideProduct`, `recommend`…). */
  source: string;
  entity: DecisionEntity;
  brandId: string | null;
  brandName: string | null;
  productId: string | null;
  title: string;
  /** 1 à 5 raisons, chacune adossée à une donnée. */
  why: string[];
  evidence: Evidence[];
  impact: string | null;
  confidence: { level: "HIGH" | "MEDIUM" | "LOW"; pct: number | null; why: string[] };
  /** Code de l'action recommandée par le moteur (PUSH, SCALE, RESTOCK, REDUCE_BUDGET…). */
  recommendation: string;
  recommendationLabel: string;
  /** Action concrète, en français, exécutable. */
  action: string;
  period: { start: string; end: string; label: string } | null;
  expectedReviewDate: string;
  priority: TaskPriority;
  score: number;
  /** Vrai pour « ne pas pousser » (rupture, diagnostic avant dépense). */
  doNotPush: boolean;
  /** Canal suggéré pour l'action (catégorie budgétaire), si le moteur l'implique. */
  category: BudgetCategory | null;
  /** Montant impliqué par la recommandation (réallocation), sinon `null` : jamais estimé. */
  amount: number | null;
  /** Tâche proposée par le moteur (titre, délai) pour l'action à créer. */
  task: { title: string; dueInDays: number };
  status: MarketingDecisionStatus;
  state: DecisionState | null;
};

export type DecisionState = {
  status: MarketingDecisionStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  actionId: string | null;
  taskId: string | null;
  taskStatus: string | null;
  expectedReviewDate: string | null;
  measuredNote: string | null;
};

export const PRIORITY_RANK: Record<TaskPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
