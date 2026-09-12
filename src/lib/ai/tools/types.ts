/**
 * Couche d'accès aux données pour le copilote IA — contrats.
 *
 * Un outil = un nom, une description lue par le modèle, un module et une action de la matrice
 * de permissions, un schéma Zod, et une fonction `run` qui n'appelle QUE les fonctions métier
 * officielles (`sellout.ts`, `stock.ts`, `budget.ts`, `clients.ts`…) à travers `ToolDeps`.
 * Les dépendances sont injectées : les tests unitaires passent des doublures, aucune base requise.
 * Le modèle n'écrit jamais de SQL ; il choisit un outil et des paramètres, c'est tout.
 */
import type { z } from "zod";
import type { ModuleKey, ScopeKey } from "@/lib/access-shared";
import type { PermissionAction, PermissionSet } from "@/lib/permissions-shared";
import type { ComanetSettings } from "@/lib/settings";
import type { ClientIntel } from "@/lib/clients";
import type { BudgetCategoryRow } from "@/lib/budget";
import type { Totals as AnimTotals, DimRow as AnimDimRow, ObjectiveRow, Range } from "@/lib/animations";
import type { RecommendationWithState } from "@/lib/rules/types";
import type { TaskRow } from "@/lib/tasks";
import type { TaskPriority } from "@/db/schema";
import type { SearchResult } from "@/lib/search";
import type { ADS_AGENT_API } from "@/lib/ads-intel/agent";
import type { MarketingIntelDeps } from "@/lib/marketing-intel/types";

/** Droits de la personne connectée, tels que résolus par `permissions.ts`. `brandIds`/`clientIds` à `null` = tout. */
export type ToolAccess = {
  userId: string;
  userName: string;
  perms: PermissionSet;
  scope: ScopeKey;
  brandIds: string[] | null;
  clientIds: string[] | null;
  /** Portée OWN : ne voit que ses propres saisies (animatrice, délégué). */
  ownOnly: boolean;
  /** Interrupteur « voir les coûts internes » (coût animatrice, prix d'achat). */
  seeInternalCosts: boolean;
};

export type Ref = { id: string; name: string };

export type RegulatoryRow = {
  id: string; dossier: string | null; reference: string | null; variant_type: string | null; size: string | null;
  status: string; blocked: boolean; expiry_date: string | null; certificate_status: string | null;
  product_name: string | null; brand_name: string | null; brand_id: string | null; responsible: string | null;
};

export type ProposedTaskInput = {
  title: string; description: string; priority: TaskPriority; dueDate: string | null; brandId: string | null;
  assigneeId: string | null; entityType: string | null; entityId: string | null; expectedImpact: string | null; createdById: string;
};

export type ReportDraftInput = {
  type: "WEEKLY" | "MONTHLY_BRAND_REVIEW"; brandId: string | null; periodStart: string; periodEnd: string;
  title: string; contentMd: string; sources: unknown; createdById: string; model: string | null;
};

export type ToolCallLog = {
  userId: string; tool: string; params: unknown; durationMs: number; rowCount: number; error: string | null; messageId?: string | null;
};

/**
 * Fonctions métier accessibles aux outils. Chacune renvoie vers la définition officielle
 * du tableau « Une notion métier = une seule fonction » de CLAUDE.md ; aucune n'est redéfinie ici.
 * Les lectures ventes / stock / budget / publicité / catalogue / activité marketing sont celles de la
 * couche Marketing Intelligence (`MarketingIntelDeps`) : mêmes fonctions, un seul câblage (`deps.ts`).
 */
export type ToolDeps = MarketingIntelDeps & {
  // Référentiels (résolution d'un nom saisi par le modèle vers un identifiant)
  findBrand(query: string): Promise<Ref | null>;
  findClient(query: string): Promise<Ref | null>;
  findProduct(query: string): Promise<Ref | null>;
  findUser(query: string): Promise<Ref | null>;
  clientIdsInCity(city: string): Promise<string[]>;
  // Clients
  clientIntel(opts: { clientIds?: string[] | null; brandIds?: string[] | null }, ref: Date): Promise<ClientIntel[]>;
  // Terrain (sell-out animatrices)
  animationTotals(range: Range, filter?: { animatriceId?: string; city?: string }): Promise<AnimTotals>;
  animationsByDim(dim: "animatrice" | "city" | "pos" | "brand" | "product", range: Range, prev: Range, filter?: { animatriceId?: string; city?: string }): Promise<AnimDimRow[]>;
  animationObjectives(year: number): Promise<ObjectiveRow[]>;
  objectiveForRange(objectives: ObjectiveRow[], range: Range, opts?: { cities?: string[]; brandId?: string }): number;
  // Budget marketing (répartition par catégorie ; la consommation vient de `MarketingIntelDeps`)
  budgetByCategory(year: number, brandId: string | null, brandIds: string[] | null): Promise<BudgetCategoryRow[]>;
  /** Ads Command Center : mêmes moteurs que l'écran (`lib/ads-intel/agent.ts`), aucune logique ici. */
  adsIntel: typeof ADS_AGENT_API;
  // Réglementaire
  regulatoryFiles(): Promise<RegulatoryRow[]>;
  // Action Center, tâches, recherche
  recommendations(): Promise<RecommendationWithState[]>;
  listTasks(opts: { assigneeId?: string; brandIds?: string[] | null; overdue?: boolean; includeDone?: boolean }): Promise<TaskRow[]>;
  search(query: string): Promise<SearchResult>;
  // Écritures autorisées (les seules)
  insertProposedTask(input: ProposedTaskInput): Promise<{ id: string }>;
  insertReportDraft(input: ReportDraftInput): Promise<{ id: string }>;
  // Journal
  logToolCall(entry: ToolCallLog): Promise<void>;
};

export type ToolContext = {
  access: ToolAccess;
  /** Date de référence des ventes (dernier import Sage). */
  refDate: Date;
  /** Date réelle du jour (terrain, réglementaire, tâches). */
  now: Date;
  settings: ComanetSettings;
  deps: ToolDeps;
  /** Message assistant en cours, pour rattacher le journal (optionnel). */
  messageId?: string | null;
};

/** Résultat compact renvoyé au modèle. `source` nomme toujours la réalité mesurée (sell-in Sage, sell-out animatrices…). */
export type ToolResult =
  | {
      available: true;
      /** Ex. « Sage — sell-in HT », « Animatrices — sell-out TTC ». */
      source: string;
      period?: { start: string; end: string; label: string };
      /** Périmètre appliqué (marque, ville, portée de la personne). */
      scope: string;
      data: unknown;
      rowCount: number;
      /** Écran filtré correspondant, à proposer à l'utilisateur. */
      links?: { label: string; href: string }[];
      /** Précisions à répéter à l'utilisateur (ex. « période incomplète »). */
      notes?: string[];
    }
  | {
      available: false;
      reason: string;
      /** Quel import ou quelle saisie rendrait la donnée disponible. */
      howToFix: string;
      source?: string;
    };

export type AiTool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  /** Module de la matrice ; `any` = dès qu'un module est visible (Action Center, recherche). */
  module: ModuleKey | ModuleKey[] | "any";
  action: PermissionAction;
  /** Outil d'écriture (tâche ou rapport proposé) : jamais appelé par les surfaces automatiques. */
  writes?: boolean;
  schema: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
};
