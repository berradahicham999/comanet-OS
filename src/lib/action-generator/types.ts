/**
 * Générateur d'actions marketing — contrats (partagés client / serveur, aucune dépendance base).
 *
 * Un modèle (`ActionTemplate`) décrit une action marketing complète et réutilisable ; le moteur (`engine.ts`) l'adapte
 * à une marque, un produit, un objectif, une période et un budget disponible lus dans COMANET OS (`GeneratorData`),
 * et rend une proposition prête à exécuter (`ActionProposal`).
 */
import type { BudgetCategory } from "@/db/schema";
import type { DataTag } from "@/lib/marketing-intel/types";
import type { AdVerdict } from "@/lib/marketing-shared";

export type AxisKey = "EVENEMENTIEL" | "TRADE" | "DIGITAL" | "INFLUENCE" | "CONTENU";
export type ObjectiveKey = "SELL_OUT" | "SELL_IN" | "LANCEMENT" | "NOTORIETE" | "ACQUISITION" | "FIDELISATION" | "ECOULEMENT";
export type TargetKey = "FEMMES_25_45" | "FEMMES_45_PLUS" | "JEUNES_18_25" | "HOMMES" | "MAMANS" | "SPORTIFS" | "PHARMACIENS" | "PRESCRIPTEURS";
export type ProductKind = "DERMO" | "COMPLEMENT" | "SOLAIRE";
export type StepRole = "MARKETING" | "TRADE" | "REGLEMENTAIRE" | "ANIMATRICE" | "DIRECTION";
export type Complexity = "LOW" | "MEDIUM" | "HIGH";
export type Level = "TRES_ELEVE" | "ELEVE" | "MOYEN" | "FAIBLE" | "NON_MESURABLE";

export type TemplateLine = {
  label: string;
  category: BudgetCategory;
  /** Poste d'activation (`activation_cost_items.key`) — obligatoire pour une exécution en activation. */
  costItem?: string;
  /** Part du budget (la somme des parts d'un modèle vaut 1, imprévus compris). */
  share: number;
};

export type TemplateStep = {
  /** Jours relatifs au jour J (événement, lancement, début d'opération). */
  offset: number;
  label: string;
  role: StepRole;
};

export type TemplateContent = { format: "POST" | "REEL" | "STORY" | "CARROUSEL" | "VIDEO" | "UGC" | "VISUEL_PHARMACIE" | "LIVE" | "NEWSLETTER"; count: number; title: string; offset: number };

/** Modèle de portée — hypothèses du modèle, toujours affichées comme telles. */
export type ReachModel = {
  /** Libellé des contacts : « participantes », « clientes en officine », « personnes touchées »… */
  contactLabel: string;
  /** Coût complet par contact (MAD) ; le digital le remplace par le coût par résultat Meta mesuré quand il existe. */
  costPerContact: number;
  /** Part des contacts qui essaient le produit (échantillon, démonstration, test). */
  trialRate: number;
  /** Part des essais qui achètent. */
  conversionRate: number;
  /** Unités par achat. */
  unitsPerBuyer: number;
  /** Utilise le coût par résultat Meta mesuré de la marque si disponible. */
  usesAdsCost?: boolean;
};

export type ExtraKpi = { label: string; value: (b: number) => number | string; unit?: string };

export type ActionTemplate = {
  key: string;
  axis: AxisKey;
  /** Famille affichée (« Padel Challenge », « Sell-out Challenge »…). */
  family: string;
  name: (c: AdaptCtx) => string;
  concept: (c: AdaptCtx) => string;
  /** Affinité objectif (0 à 1) ; absent = incompatible. */
  objectives: Partial<Record<ObjectiveKey, number>>;
  targets: TargetKey[];
  productKinds: ProductKind[] | "ANY";
  channels: string[];
  budget: { min: number; typical: number; max: number };
  lines: TemplateLine[];
  reach: ReachModel;
  steps: TemplateStep[];
  contents: TemplateContent[];
  extraKpis: ExtraKpi[];
  complexity: Complexity;
  /** Préparation nécessaire avant J (jours). */
  prepDays: number;
  /** Durée de l'action (jours, 1 pour un événement). */
  durationDays: number;
  /** Non-répétition : délai minimal entre deux actions de ce modèle pour la même marque. */
  cooldownDays: number;
  /** Conteneur d'exécution. */
  execution: { kind: "ACTIVATION"; activationType: string } | { kind: "CAMPAIGN"; campaignType: string; channel: "META" | "TIKTOK" | "GOOGLE" | "INFLUENCE" | "TRADE" | "EVENEMENT" | "AUTRE" };
  /** Affinités saisonnières (clés de `settings.forecast.events`) : +1 favorable, −1 défavorable. */
  seasons: Record<string, 1 | -1>;
  /** Le modèle s'appuie sur une ville (événement physique). */
  cityBased: boolean;
  /** Le modèle s'appuie sur une liste de points de vente. */
  posBased: boolean;
  /** Le modèle s'appuie sur des influenceuses. */
  influencerBased: boolean;
  /** Point de conformité à respecter (allégations). */
  compliance?: string;
};

/** Ce que le moteur sait pour adapter un modèle (rempli par `engine.ts`). */
export type AdaptCtx = {
  hero: string;
  brand: string;
  product: string | null;
  target: string;
  city: string | null;
  season: string | null;
  month: string;
};

/* ------------------------------ Entrée et données ------------------------------ */

export type GeneratorInput = {
  brandId: string;
  objective: ObjectiveKey;
  /** `null` : tous les leviers (opportunités). */
  axis: AxisKey | null;
  /** Budget saisi par la personne ; `null` = le budget disponible calculé. */
  budget: number | null;
  /** Premier jour du mois de la période (AAAA-MM-01). */
  month: string;
  target: TargetKey;
  productId: string | null;
};

export type ProductData = {
  id: string; name: string; shortName: string | null; category: string | null; priceRetail: number | null;
  actives: string | null; marketingAngle: string | null;
  /** Profil commercial (`salesProfileOf`) ; `null` = non lu. */
  profile: string | null; growthPct: number | null; revenue90: number | null; contributionPct: number | null;
  /** Risque de stock (`stockRiskOf`) ; `null` = non lu. */
  stockRisk: string | null; daysOfStock: number | null;
};

export type AxisBudget = {
  axis: AxisKey;
  allocated: number;
  committed: number;
  reserved: number;
  /** Disponible ; `null` = non défini (ni allocation ni enveloppe). */
  available: number | null;
  source: "AXE" | "MARQUE" | "AUCUN";
};

export type HistoryItem = { kind: "ACTION" | "ACTIVATION" | "CAMPAIGN"; templateKey: string | null; activationType: string | null; productId: string | null; label: string; date: string; open: boolean };

export type GeneratorData = {
  today: string;
  brand: { id: string; name: string };
  product: ProductData | null;
  budgets: Record<AxisKey, AxisBudget>;
  brandAvailable: number | null;
  /** Budget du mois du plan restant (budget du mois − actions du mois), si un plan mensuel existe. */
  monthRemaining: number | null;
  history: HistoryItem[];
  /** Verdict du levier (canal principal) sur 12 mois, si mesuré. */
  verdicts: Partial<Record<BudgetCategory, AdVerdict>>;
  /** Coût par résultat Meta mesuré de la marque (90 jours) et son libellé. */
  adsCost: { value: number; label: string } | null;
  /** Événements saisonniers couvrant la période (clé → libellé). */
  seasonEvents: { key: string; label: string }[];
  /** Ville principale des clients de la marque (CA 12 mois), si connue. */
  topCity: string | null;
  topPos: { name: string; city: string | null; revenue: number; trendPct: number | null }[];
  influencers: { name: string; followers: number | null; usualRate: number | null; collabs: number; lastReach: number | null }[];
  /** Équipe par rôle (proposition de responsable). */
  team: Partial<Record<StepRole, { id: string; name: string }>>;
};

/* ------------------------------ Sortie ------------------------------ */

export type ScoreItem = { key: string; label: string; points: number; max: number; why: string; tag: DataTag };

export type BudgetLineOut = { label: string; category: BudgetCategory; costItem: string | null; amount: number };
export type StepOut = { offset: number; dayLabel: string; date: string; label: string; role: StepRole; assigneeId: string | null; assigneeName: string | null };
export type KpiOut = { label: string; target: string; tag: DataTag };

export type Estimate = {
  contacts: number; contactLabel: string; trials: number; buyers: number; units: number;
  /** CA sell-out TTC au prix public ; `null` si le prix public est inconnu (jamais estimé). */
  revenue: number | null;
  /** CA ÷ budget ; `null` si non mesurable. */
  roi: number | null;
  costPerContact: number; costSource: "MODELE" | "META";
  assumptions: string[];
};

export type ActionProposal = {
  key: string;
  templateKey: string;
  axis: AxisKey;
  family: string;
  name: string;
  objectiveText: string;
  concept: string;
  target: string;
  products: string[];
  channels: string[];
  budget: number;
  lines: BudgetLineOut[];
  eventDate: string;
  endDate: string;
  steps: StepOut[];
  contents: { format: string; count: number; title: string; date: string }[];
  kpis: KpiOut[];
  estimate: Estimate;
  impact: Level;
  roiLevel: Level;
  complexity: Complexity;
  score: number;
  scoreItems: ScoreItem[];
  /** 2 à 4 raisons, la première est le « pourquoi maintenant ». */
  why: string[];
  warnings: string[];
  suggestions: { pos: string[]; influencers: string[]; city: string | null };
  execution: ActionTemplate["execution"];
  compliance: string | null;
  data: { label: string; value: string; tag: DataTag }[];
};

export type Excluded = { templateKey: string; name: string; reason: string };

export type GeneratorResult = {
  input: GeneratorInput;
  budgetUsed: number | null;
  budgetSource: "SAISI" | "AXE" | "MARQUE" | "AUCUN";
  available: number | null;
  axisBudget: AxisBudget | null;
  options: ActionProposal[];
  excluded: Excluded[];
  blocked: string | null;
  notes: string[];
};
