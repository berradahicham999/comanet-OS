/**
 * Intelligence contenu (Studio créatif) — contrats partagés client / serveur, aucune dépendance base.
 *
 * La chaîne : DONNÉE → PRIORITÉ → OBJECTIF BUSINESS → PRODUIT PRIORITAIRE → TENSION CONSOMMATEUR → OPPORTUNITÉ CRÉATIVE
 * → CONCEPT → PACKAGE DE CONTENU → PRODUCTION → PERFORMANCE → APPRENTISSAGE. Ce module ne redéfinit aucune notion
 * métier : le produit à pousser vient du moteur de décision (`marketing-intel`), le budget du générateur d'actions
 * (`axisAvailable`), la performance publicitaire de `ads-intel` (créatives étiquetées), le contenu du planning éditorial.
 * Chaque valeur rendue porte une étiquette de fiabilité (`DataTag`) ; un score est une aide à la décision, jamais une mesure.
 */
import type { DataTag, Fact, Confidence, MarketingAction } from "@/lib/marketing-intel/types";
import type { AxisKey, KpiOut, ObjectiveKey, ScoreItem } from "@/lib/action-generator/types";

export type { DataTag, Fact, Confidence };

/* ------------------------------ Référentiels ------------------------------ */

/** Catégorie créative d'un produit : elle change les tensions, les mécaniques et la discipline des allégations. */
export type CreativeCategory = "SKINCARE" | "DERMOCOSMETIC" | "SUPPLEMENT" | "SUN";
export type FunnelStage = "AWARENESS" | "CONSIDERATION" | "CONVERSION" | "RETENTION";
export type TerritoryKey = "EDUCATION" | "UGC" | "STORYTELLING" | "PERFORMANCE" | "EMOTIONAL";
export type HookType = "CURIOSITY" | "PROBLEM" | "CONTRARIAN" | "PERSONAL" | "EXPERT";
/** Formats du planning éditorial (`content_formats.key`) utilisables par le studio. */
export type CreativeFormat = "REEL" | "UGC" | "CARROUSEL" | "POST" | "STORY" | "VIDEO";
export type CreatorPersona = "CLIENTE" | "PHARMACIENNE" | "EXPERTE" | "CREATRICE" | "MARQUE";
export type Distribution = "ORGANIC" | "PAID" | "BOTH";
export type FatigueRisk = "LOW" | "MEDIUM" | "HIGH";
export type Complexity = "LOW" | "MEDIUM" | "HIGH";

/** Une mécanique créative : structure réutilisable, avec ses métadonnées (pas une simple chaîne). */
export type CreativeMechanic = {
  key: string;
  territory: TerritoryKey;
  name: string;
  psychologicalTrigger: string;
  bestFor: string;
  funnelStages: FunnelStage[];
  objectives: ObjectiveKey[];
  productTypes: CreativeCategory[];
  targetProfiles: string[];
  hookPatterns: string[];
  narrativeStructures: string[];
  visualPatterns: string[];
  ctaPatterns: string[];
  /** Adéquation organique / payant (0 à 1). */
  organicFit: number;
  paidFit: number;
  fatigueRisk: FatigueRisk;
  defaultHook: HookType;
  formats: CreativeFormat[];
  personas: CreatorPersona[];
  complexity: Complexity;
  /** Étiquette d'angle des créatives Meta (`autoTags()` de `src/lib/meta/entities.ts`) : lien avec la performance mesurée. */
  angleTag: string | null;
};

/** Tension consommateur : problème, frustration, désir, objection, croyance, idée reçue, question, émotion. */
export type ConsumerTension = {
  key: string;
  categories: CreativeCategory[];
  label: string;
  problem: string;
  frustration: string;
  desire: string;
  objection: string;
  belief: string;
  misconception: string;
  question: string;
  emotion: string;
  /** Mots de la fiche produit (bénéfices, angle, actifs, nom, catégorie) qui activent la tension. */
  keywords: string[];
  funnelStages: FunnelStage[];
};

/* ------------------------------ Couche A / B : contexte business et produit ------------------------------ */

export type ProductIntelligence = {
  productId: string | null;
  name: string;
  /** Mot-héros (`heroWord()` du générateur). */
  hero: string;
  brandName: string;
  category: CreativeCategory;
  categoryLabel: string;
  priceRetail: number | null;
  /** Fiche marketing du produit, telle quelle (jamais complétée par le moteur). */
  benefits: string[];
  actives: string[];
  claims: string[];
  marketingAngle: string | null;
  target: string | null;
  /** Rôle dans la routine / occasion d'usage, déduit de la catégorie et du nom (INFERRED). */
  routineRole: string;
  /** Discipline des allégations de la catégorie : ton permis et formulations interdites. */
  claimDiscipline: { allowed: string; restricted: string[] };
  profile: string | null;
  growthPct: number | null;
  contributionPct: number | null;
  revenue90: number | null;
  stockRisk: string | null;
  daysOfStock: number | null;
  /** Part des champs de la fiche marketing renseignés (bénéfices, actifs, allégations, angle, cible, prix). */
  sheetCompleteness: number;
  missing: string[];
};

export type BusinessContext = {
  brandId: string;
  brandName: string;
  brandColor: string;
  positioning: string | null;
  brandTarget: string | null;
  objective: ObjectiveKey;
  objectiveLabel: string;
  /** Décision du moteur marketing à l'origine (PUSH, CREATE_CONTENT…) ; `null` = produit choisi par défaut. */
  priorityAction: MarketingAction | null;
  commercialPriority: string;
  funnelStage: FunnelStage;
  audience: string;
  month: string;
  season: string | null;
  /** Budget disponible par levier du générateur (`axisAvailable()`), pour les leviers du studio : contenu, digital, influence. */
  budgets: Partial<Record<AxisKey, { available: number | null; source: string }>>;
  /** Coût par résultat Meta mesuré de la marque (90 j), s'il existe. */
  adsCost: { value: number; label: string } | null;
};

/* ------------------------------ Mémoire et apprentissage ------------------------------ */

export type PerformanceSource = "ADS" | "CONTENT" | "INFLUENCE";

/** Une pièce de contenu diffusée et sa performance mesurée — la mémoire créative de COMANET. */
export type CreativePerformance = {
  source: PerformanceSource;
  id: string;
  label: string;
  brandId: string | null;
  productId: string | null;
  conceptId: string | null;
  territory: TerritoryKey | null;
  mechanic: string | null;
  hookType: HookType | null;
  format: string | null;
  persona: CreatorPersona | null;
  objective: string | null;
  funnelStage: FunnelStage | null;
  publishedAt: string | null;
  /** Métriques disponibles seulement : une métrique absente est `null`, jamais 0 ni estimée. */
  metrics: {
    spend: number | null;
    results: number | null;
    resultKind: string | null;
    costPerResult: number | null;
    reach: number | null;
    impressions: number | null;
    engagement: number | null;
    views: number | null;
    ctr: number | null;
    conversions: number | null;
    revenue: number | null;
  };
};

export type InsightDirection = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

/** Apprentissage créatif : une phrase, ses preuves, sa confiance. Toujours une corrélation observée, jamais une causalité. */
export type CreativeInsight = {
  key: string;
  scope: "BRAND" | "PRODUCT" | "CROSS_BRAND";
  brandId: string | null;
  productId: string | null;
  territory: TerritoryKey | null;
  mechanic: string | null;
  hookType: HookType | null;
  format: string | null;
  direction: InsightDirection;
  statement: string;
  evidence: Fact[];
  /** 0 à 100. */
  confidence: number;
  kind: "CORRELATION";
};

export type TerritoryUsage = { territory: TerritoryKey; mechanic: string | null; count: number; lastDate: string | null; sources: PerformanceSource[] | ("CONCEPT")[] };

export type RecentConcept = { id: string; fingerprint: string; title: string; date: string; status: string; mechanic: string; territory: TerritoryKey; tensionKey: string; hookType: HookType; productId: string | null };

/* ------------------------------ Opportunité ------------------------------ */

export type Priority = "HIGH" | "MEDIUM" | "LOW";

export type CreativeOpportunity = {
  /** Clé stable (marque, produit, objectif, mécanique) : rejouable, jamais stockée. */
  key: string;
  brandId: string;
  brandName: string;
  brandColor: string;
  productId: string | null;
  productName: string | null;
  category: CreativeCategory;
  objective: ObjectiveKey;
  businessObjective: string;
  commercialPriority: string;
  priorityAction: MarketingAction | null;
  funnelStage: FunnelStage;
  audience: string;
  tensionKey: string;
  consumerProblem: string;
  consumerTension: string;
  consumerDesire: string;
  consumerObjection: string | null;
  recommendedTerritory: TerritoryKey;
  recommendedMechanic: string;
  mechanicName: string;
  /** Pourquoi maintenant : 2 à 5 raisons, chacune adossée à une donnée. */
  reasoning: string[];
  opportunityScore: number;
  scoreItems: ScoreItem[];
  confidence: Confidence;
  confidenceWhy: string[];
  priority: Priority;
  /** Territoires déjà très utilisés récemment (fatigue). */
  saturated: string[];
  learning: string[];
  data: Fact[];
  budget: { axis: AxisKey; available: number | null; source: string };
  /** Raison de ne pas produire (rupture de stock…) ; l'opportunité est alors affichée « à ne pas pousser ». */
  blocked: string | null;
};

/* ------------------------------ Concept ------------------------------ */

export type ScoreKey = "hook" | "consumerRelevance" | "productRelevance" | "brandFit" | "differentiation" | "scrollStop" | "emotionalTension" | "conversionPotential" | "productionFeasibility" | "historicalFit";

export type CreativeScores = {
  overall: number;
  items: (ScoreItem & { key: ScoreKey })[];
};

export type ComplianceSeverity = "BLOCK" | "WARN" | "INFO";
export type ComplianceFlag = { severity: ComplianceSeverity; code: string; text: string; excerpt: string | null };

export type ReviewAxis = "strategic" | "creative" | "product" | "audience" | "brand" | "production" | "compliance" | "repetition";
export type ConceptReview = { axes: Record<ReviewAxis, { ok: boolean; note: string }>; verdict: "PASS" | "IMPROVE" | "FAIL"; improvements: string[] };

export type CreativeConcept = {
  title: string;
  bigIdea: string;
  consumerTension: string;
  tensionKey: string;
  insight: string;
  creativeTerritory: TerritoryKey;
  mechanic: string;
  mechanicName: string;
  psychologicalTrigger: string;
  coreMessage: string;
  productRole: string;
  desiredConsumerReaction: string;
  storytellingStructure: string[];
  visualDirection: string;
  recommendedFormat: CreativeFormat;
  funnelStage: FunnelStage;
  hookType: HookType;
  persona: CreatorPersona;
  distribution: Distribution;
  organicVersion: string;
  paidVersion: string;
  reasoning: string[];
  scores: CreativeScores;
  fingerprint: string;
  /** Proximité avec le contenu récent le plus proche (0 à 1) et son libellé. */
  similarity: { score: number; to: string | null };
  compliance: ComplianceFlag[];
  review: ConceptReview | null;
  generatedBy: "AI" | "RULES";
};

export type ConceptStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "BUILT" | "SENT" | "ARCHIVED";

/** Concept persisté (table `creative_concepts`). */
export type StoredConcept = {
  id: string;
  brandId: string;
  brandName: string;
  productId: string | null;
  productName: string | null;
  opportunityKey: string;
  status: ConceptStatus;
  score: number;
  concept: CreativeConcept;
  contentItemId: string | null;
  rejectReason: string | null;
  model: string | null;
  createdAt: string;
  hasPackage: boolean;
};

/* ------------------------------ Package de contenu ------------------------------ */

export type Hook = { type: HookType; text: string; onScreen: string | null };

export type Scene = {
  n: number;
  durationSec: number;
  visual: string;
  framing: string;
  action: string;
  dialogue: string | null;
  voiceOver: string | null;
  onScreenText: string | null;
  productVisible: boolean;
  transition: string | null;
};

export type Shot = { n: number; visual: string; durationSec: number; framing: string; product: boolean; notes: string | null };

export type ScriptVersion = { label: string; angle: string; scenes: Scene[]; cta: string; durationSec: number };

export type VisualDirection = {
  lighting: string; environment: string; cameraStyle: string; framing: string; movement: string; pacing: string; editing: string;
  subtitles: string; productVisibility: string; creatorDirection: string;
};

export type PerformanceDirection = { tone: string; emotionalTone: string; pacing: string; expression: string; authenticity: string; avoid: string[] };

export type DistributionVersion = {
  goal: string;
  hook: string;
  structure: string[];
  cta: string;
  durationSec: number;
  notes: string[];
  /** Budget de test proposé (payant) : borné par le disponible du levier, `null` si non défini. */
  testBudgetMad: number | null;
  kpis: KpiOut[];
};

export type PackageStrategy = {
  objective: string;
  funnelStage: FunnelStage;
  audience: string;
  product: string;
  consumerTension: string;
  coreMessage: string;
  concept: string;
};

export type ContentPackage = {
  strategy: PackageStrategy;
  hooks: Hook[];
  scripts: ScriptVersion[];
  storyboard: Scene[];
  shotList: Shot[];
  visual: VisualDirection;
  performance: PerformanceDirection;
  organic: DistributionVersion;
  paid: DistributionVersion;
  paidHookVariants: string[];
  ctaVariants: string[];
  storyIdeas: string[];
  thumbnail: string;
  caption: string;
  hashtags: string[];
  cta: string;
  onScreenTexts: string[];
  kpis: KpiOut[];
  assets: string[];
  productionNotes: string[];
  claims: { allowed: string[]; forbidden: string[]; mandatory: string[] };
  compliance: ComplianceFlag[];
  generatedBy: "AI" | "RULES";
};

/* ------------------------------ Variations ------------------------------ */

export type VariationDimension = "HOOK" | "OPENING" | "STRUCTURE" | "PERSONA" | "ANGLE" | "CTA" | "FORMAT";

export type Variation = {
  dimension: VariationDimension;
  label: string;
  /** Ce qui change par rapport à la version de base, en une phrase. */
  changed: string;
  content: string;
  /** Pour STRUCTURE : les étapes ; pour FORMAT : le format cible. */
  steps?: string[];
  format?: CreativeFormat;
};

export type VariationSet = { baseLabel: string; variations: Variation[]; generatedBy: "AI" | "RULES" };

/* ------------------------------ Brief de production ------------------------------ */

export type BriefSection = { key: string; title: string; lines: string[] };

export type ProductionBrief = { title: string; subtitle: string; sections: BriefSection[]; markdown: string };

/* ------------------------------ Données du studio ------------------------------ */

export type CreativeData = {
  today: string;
  business: BusinessContext;
  product: ProductIntelligence;
  /** Tensions candidates (déterministes) : la plus forte est choisie par la couche consommateur. */
  tensions: ConsumerTension[];
  usage: TerritoryUsage[];
  recentConcepts: RecentConcept[];
  performances: CreativePerformance[];
  insights: CreativeInsight[];
  /** Convictions de la direction (« ce qui marche par marque »), hypothèse. */
  playbookNote: string | null;
  /** Levier contenu / digital / influence favori selon la direction (0 à 1), si saisi. */
  playbookLevers: Partial<Record<AxisKey, number>>;
  /** Formats actifs du planning éditorial (clé → libellé). */
  formats: { key: string; label: string }[];
};

export type { ScoreItem, KpiOut, ObjectiveKey, AxisKey, MarketingAction };

/** Seuils du studio (sous-ensemble de `settings.creative`, utilisable par les moteurs purs). */
export type CreativeThresholds = {
  /** Fenêtre de fatigue : contenus et concepts des N derniers jours comptent dans l'usage des territoires. */
  fatigueWindowDays: number;
  /** Proximité d'empreinte (0 à 1) à partir de laquelle un concept est un doublon. */
  duplicateThreshold: number;
  /** Nombre de contenus récents à partir duquel un territoire est dit saturé. */
  saturationMinCount: number;
  maxOpportunities: number;
  maxConcepts: number;
  /** Budget de test payant proposé par concept (MAD), borné par le disponible du levier. */
  paidTestBudgetMad: number;
  /** Volume minimal (créatives ou publications) pour qu'un apprentissage soit énoncé. */
  minLearningCreatives: number;
};
