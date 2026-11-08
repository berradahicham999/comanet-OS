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

export type MobileSnapshot = {
  generatedAt: string;
  user: { id: string; name: string };
  persona: Persona;
  /** Accueil de la version complète : où renvoyer un métier qui n'a pas encore ses écrans sous `/m`. */
  home: string;
  gpsNoticeAccepted: boolean;
  gpsTimeoutS: number;
  terrain: TerrainSnapshot | null;
};

export function monthFigures(units: number, objectiveUnits: number, daysInMonth: number) {
  const objective = objectiveUnits > 0 ? Math.round(objectiveUnits) : null;
  return {
    objectiveUnits: objective,
    gapUnits: objective === null ? null : Math.round(units) - objective,
    completionPct: objective === null ? null : Math.round((units / objective) * 100),
    dayObjectiveUnits: objective === null ? null : Math.max(1, Math.round(objective / Math.max(1, daysInMonth))),
  };
}
