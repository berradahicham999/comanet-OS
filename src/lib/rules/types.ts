import type { ComanetSettings } from "@/lib/settings";
import type { ProductStock } from "@/lib/stock";
import type { ClientIntel } from "@/lib/clients";
import type { TaskPriority, UserRole } from "@/db/schema";

export type RecCategory = "STOCK" | "MARKETING" | "REGLEMENTAIRE" | "TERRAIN" | "COMMERCIAL" | "BUDGET" | "EXECUTION" | "DATA" | "MEDICAL";

export const CATEGORY_META: Record<RecCategory, { label: string; tone: "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray" | "accent" }> = {
  STOCK: { label: "Stock & achats", tone: "orange" },
  MARKETING: { label: "Marketing", tone: "purple" },
  REGLEMENTAIRE: { label: "Réglementaire", tone: "red" },
  TERRAIN: { label: "Terrain", tone: "accent" },
  COMMERCIAL: { label: "Commercial", tone: "blue" },
  BUDGET: { label: "Budget", tone: "yellow" },
  EXECUTION: { label: "Exécution", tone: "gray" },
  DATA: { label: "Données", tone: "gray" },
  MEDICAL: { label: "Médical", tone: "green" },
};

export type Recommendation = {
  /** Clé stable (règle + entité) : sert à relier une tâche créée et à dédoublonner. */
  key: string;
  rule: string;
  category: RecCategory;
  priority: TaskPriority;
  /** Titre court : ex. "AURACOS — Pro Collagenium". */
  title: string;
  /** Sous-titre / contexte. */
  subtitle?: string;
  facts: { label: string; value: string }[];
  /** Pourquoi (diagnostic). */
  why: string;
  /** Quoi faire (action recommandée). */
  action: string;
  /** Impact attendu. */
  impact?: string;
  /** Tâche proposée. */
  task: { title: string; dueInDays: number; role: UserRole; priority?: TaskPriority };
  entity?: { type: "product" | "client" | "brand" | "regulatory" | "campaign" | "task" | "user" | "doctor" | "content" | "activation" | "inventory"; id: string; href: string };
  brandId?: string | null;
  /** Enjeu (MAD) pour ordonner les recommandations de même priorité. */
  score?: number;
};

export type RecommendationWithState = Recommendation & {
  /** Tâche ouverte déjà créée à partir de cette recommandation. */
  existingTask?: { id: string; status: string; assignee: string | null } | null;
};

export type RuleContext = {
  settings: ComanetSettings;
  /** Date de référence des données de vente (dernier import). */
  today: Date;
  /** Date réelle du jour (données opérationnelles : terrain, réglementaire, tâches, budgets). */
  now: Date;
  stocks: ProductStock[];
  clients: ClientIntel[];
};

export type Rule = {
  id: string;
  label: string;
  description: string;
  run: (ctx: RuleContext) => Promise<Recommendation[]>;
};

export const PRIORITY_ORDER: Record<TaskPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
