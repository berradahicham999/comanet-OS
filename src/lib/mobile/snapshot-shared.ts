import type { Persona } from "./persona";

/** Ce que le téléphone garde pour travailler sans réseau. Aucun coût, aucune marge, aucune donnée d'un autre périmètre. */
export type MobileProduct = { id: string; name: string; brandName: string | null };
export type MobileClient = { id: string; name: string; city: string | null; mine: boolean };
export type LastStock = Record<string, { quantity: number; readAt: string }>;

export type MobileMonth = {
  label: string;
  /** Unités vendues sur le mois. */
  units: number;
  /** `null` : pas d'objectif sur sa ville, affiché « — », jamais estimé. */
  objectiveUnits: number | null;
  gapUnits: number | null;
  completionPct: number | null;
  /** Objectif du mois réparti sur ses jours calendaires : une moyenne, étiquetée comme telle à l'écran. */
  dayObjectiveUnits: number | null;
  selloutRevenue: number;
  days: number;
  score: number;
  rank: number | null;
  ranked: number;
  topProduct: string | null;
};

export type TerrainSnapshot = {
  products: MobileProduct[];
  /** Produits habituels, du plus fréquent au moins fréquent : ils ouvrent la saisie. */
  favoriteIds: string[];
  clients: MobileClient[];
  lastClientId: string | null;
  planned: { id: string; clientId: string; clientName: string; city: string | null }[];
  todayUnits: number;
  month: MobileMonth;
  lastStock: Record<string, LastStock>;
};

/** Une ligne du portefeuille, lisible sans réseau. Chiffres sell-in HT (ventes facturées au client). */
export type PortfolioClient = {
  id: string;
  name: string;
  city: string | null;
  segment: string;
  segmentLabel: string;
  revenue12: number;
  /** 3 derniers mois contre les 3 précédents. `null` : pas comparable, affiché « — ». */
  growthPct: number | null;
  daysSinceLast: number | null;
  /** Commande attendue dépassée d'après son rythme habituel. */
  orderLate: boolean;
  advice: string | null;
};

export type CommercialSnapshot = {
  clients: PortfolioClient[];
  /** Clients planifiés aujourd'hui : ils ouvrent la liste. */
  todayIds: string[];
  products: MobileProduct[];
  lastStock: Record<string, LastStock>;
  /** Sans stock à l'entrepôt COMANET : jamais proposés dans un pack. */
  outOfStockIds: string[];
};

/** Fiche courte, téléchargée à l'avance pour le début du portefeuille, et à l'ouverture pour les autres. */
export type ClientSheet = {
  clientId: string;
  fetchedAt: string;
  name: string;
  city: string | null;
  contactName: string | null;
  phone: string | null;
  revenue12: number;
  growthPct: number | null;
  segmentLabel: string | null;
  lastOrder: string | null;
  daysUntilNext: number | null;
  /** `null` : la personne ne voit ni règlements ni factures. */
  receivables: { outstanding: number; overdue: number; invoices: number; oldestDaysLate: number | null } | null;
  usual: { name: string; units: number }[];
  pack: { peers: number; /** Assez de clients comparables pour en tirer quelque chose (`settings.crm.assortmentMinPeers`). */ measurable: boolean; basis: string; items: { productId: string; name: string; brand: string | null; buyers: number; share: number }[] };
  lastVisit: { date: string; nextAction: string | null } | null;
  openTasks: { id: string; title: string; dueDate: string | null }[];
  lastStock: LastStock;
  salesUpTo: string | null;
};

export type MobileSnapshot = {
  generatedAt: string;
  user: { id: string; name: string };
  persona: Persona;
  /** Accueil de la version complète : où renvoyer un métier qui n'a pas encore ses écrans sous `/m`. */
  home: string;
  gpsNoticeAccepted: boolean;
  gpsTimeoutS: number;
  terrain: TerrainSnapshot | null;
  commercial: CommercialSnapshot | null;
};

/** Ordre du portefeuille : les visites du jour, puis les commandes en retard, puis le plus gros chiffre d'affaires. */
export function sortPortfolio<T extends { id: string; orderLate: boolean; revenue12: number }>(clients: T[], todayIds: string[]): T[] {
  const today = new Set(todayIds);
  return [...clients].sort((a, b) => Number(today.has(b.id)) - Number(today.has(a.id)) || Number(b.orderLate) - Number(a.orderLate) || b.revenue12 - a.revenue12);
}

/** Le pack retire ce qui ne peut pas être livré : on ne propose jamais un produit sans stock à l'entrepôt. */
export function deliverablePack<T extends { productId: string }>(items: T[], outOfStockIds: string[]): { items: T[]; removed: number } {
  const out = new Set(outOfStockIds);
  const kept = items.filter((i) => !out.has(i.productId));
  return { items: kept, removed: items.length - kept.length };
}

/** Fiches téléchargées à l'avance, et âge au-delà duquel on les renouvelle. */
export const SHEET_PRELOAD = 40;
export const SHEET_MAX_AGE_MS = 12 * 3600000;

export function sheetsToPreload(clientIds: string[], fetchedAt: (id: string) => string | null, now: number): string[] {
  return clientIds.slice(0, SHEET_PRELOAD).filter((id) => {
    const at = fetchedAt(id);
    return !at || now - new Date(at).getTime() > SHEET_MAX_AGE_MS;
  });
}

export function monthFigures(units: number, objectiveUnits: number, daysInMonth: number) {
  const objective = objectiveUnits > 0 ? Math.round(objectiveUnits) : null;
  return {
    objectiveUnits: objective,
    gapUnits: objective === null ? null : Math.round(units) - objective,
    completionPct: objective === null ? null : Math.round((units / objective) * 100),
    dayObjectiveUnits: objective === null ? null : Math.max(1, Math.round(objective / Math.max(1, daysInMonth))),
  };
}
