/**
 * Catalogue des modules, des interrupteurs transverses et des portées
 * (partagé client/serveur).
 *
 * Ce fichier ne décide pas QUI a accès à QUOI : les droits vivent en base
 * (`user_permissions`, `user_scope`, `user_flags`) et se résolvent via
 * `src/lib/permissions.ts`. Il ne reste ici que la liste des modules, leurs
 * libellés et leur regroupement, qui servent à afficher la matrice de
 * permissions dans l'administration et à filtrer la navigation.
 *
 * Cockpit, Action Center et Recherche ne sont PAS des modules : ils agrègent
 * ce que la personne a déjà le droit de voir et apparaissent dès qu'un module
 * est visible.
 */

export const MODULE_KEYS = [
  "produits",
  "stock",
  "reglementaire",
  "ventes",
  "clients",
  "livraisons",
  "facturation",
  "achats",
  "marketing",
  "influence",
  "budgets",
  "terrain",
  "medical",
  "taches",
  "assets",
  "rapports",
  "administration",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  produits: "Référentiel produits",
  stock: "Stock et inventaires",
  reglementaire: "Réglementaire",
  ventes: "Suivi commercial et ventes",
  clients: "Clients et trade marketing",
  livraisons: "Bons de livraison",
  facturation: "Facturation et encaissements",
  achats: "Achats et fournisseurs",
  marketing: "Marketing digital",
  influence: "Influence et UGC",
  budgets: "Budgets",
  terrain: "Terrain / animations",
  medical: "Délégué médical",
  taches: "Tâches et projets",
  assets: "Bibliothèque d'assets",
  rapports: "Rapports et exports",
  administration: "Administration",
};

/** Libellé court, pour les puces de la liste des utilisateurs. */
export const MODULE_SHORT: Record<ModuleKey, string> = {
  produits: "Produits",
  stock: "Stock",
  reglementaire: "Réglementaire",
  ventes: "Ventes",
  clients: "Clients",
  livraisons: "Livraisons",
  facturation: "Facturation",
  achats: "Achats",
  marketing: "Marketing",
  influence: "Influence",
  budgets: "Budgets",
  terrain: "Terrain",
  medical: "Médical",
  taches: "Tâches",
  assets: "Assets",
  rapports: "Rapports",
  administration: "Admin",
};

/** Ce que contient chaque module, affiché dans la matrice. */
export const MODULE_HINTS: Record<ModuleKey, string> = {
  produits: "Fiches produits, marques, prix publics, assets produit.",
  stock: "Couverture de stock, journal des mouvements, lots, stock initial, inventaires.",
  reglementaire: "Dossiers, autorisations, alertes d'expiration, dépôts.",
  ventes: "Import des ventes, objectifs, analyses, classements clients.",
  clients: "Fiches clients (identité légale, conditions, adresses), plans d'animation, calendrier trade.",
  livraisons: "Bons de livraison : saisie, validation (sortie de stock), annulation.",
  facturation: "Factures, avoirs, encours et règlements clients.",
  achats: "Fournisseurs, commandes, réceptions, factures fournisseurs.",
  marketing: "Planning éditorial, campagnes, rapports publicitaires (Meta Ads).",
  influence: "Créatrices, collaborations, performances, bibliothèque UGC.",
  budgets: "Enveloppes par marque, engagements, dépenses, factures.",
  terrain: "Saisie journalière, rapports d'animation, animatrices, ROI.",
  medical: "Prescripteurs, visites, échantillons, tournées, délégués.",
  taches: "Attribution, suivi, kanban d'équipe.",
  assets: "Visuels, PLV, vidéos, argumentaires.",
  rapports: "Génération et export des rapports.",
  administration: "Utilisateurs, permissions, modèles de rôle, seuils, connexions, imports système.",
};

/** Ce que « Valider » veut dire, module par module (action irréversible ou externe). */
export const VALIDATE_HINTS: Record<ModuleKey, string> = {
  produits: "Valider une fiche produit ; supprimer un produit.",
  stock: "Valider une commande conseillée, un inventaire, une casse ou un transfert ; annuler un stock initial.",
  reglementaire: "Déposer un dossier à l'autorité, valider une étape ; supprimer un dossier.",
  ventes: "Valider un objectif ; annuler un import de ventes.",
  clients: "Valider un plan d'animation ; archiver, bloquer ou supprimer un client.",
  livraisons: "Valider un BL (sortie de stock) ou l'annuler.",
  facturation: "Valider une facture (numérotée, verrouillée) ou émettre un avoir.",
  achats: "Valider une réception (entrée en stock) ; archiver ou supprimer un fournisseur.",
  marketing: "Publier ou clôturer une campagne.",
  influence: "Clôturer une collaboration (le cachet passe par « Valider une dépense »).",
  budgets: "Engager une ligne (nécessite aussi « Valider une dépense »). Les enveloppes annuelles restent en Administration.",
  terrain: "Clôturer une animation (fige son ROI) ; gérer les fiches animatrices.",
  medical: "Valider une visite, ajuster le stock d'échantillons, gérer délégués, secteurs et spécialités.",
  taches: "Clôturer ou supprimer une tâche d'autrui.",
  assets: "Publier ou retirer un asset.",
  rapports: "Publier un rapport.",
  administration: "Gérer utilisateurs et droits, modèles, seuils, connexions ; suppressions définitives.",
};

/** Regroupement des modules pour présenter la matrice. */
export const MODULE_GROUPS: { title: string; modules: ModuleKey[] }[] = [
  { title: "Référentiels", modules: ["produits", "stock", "reglementaire"] },
  { title: "Commercial", modules: ["ventes", "clients"] },
  { title: "Gestion commerciale", modules: ["livraisons", "facturation", "achats"] },
  { title: "Marketing", modules: ["marketing", "influence", "budgets", "assets"] },
  { title: "Terrain et médical", modules: ["terrain", "medical"] },
  { title: "Exécution", modules: ["taches", "rapports"] },
  { title: "Système", modules: ["administration"] },
];

/** Cookie de prévisualisation « en tant que » (défini ici pour rester importable sans base). */
export const PREVIEW_COOKIE = "comanet_preview";

/* ------------------------------------------------------------------ */
/* Interrupteurs transverses                                           */
/* ------------------------------------------------------------------ */

export const FLAG_KEYS = [
  "seeMargins",
  "seeGlobalBudgets",
  "seeInternalCosts",
  "approveSpend",
  "exportData",
  "readActivityLog",
  "overrideCommercial",
] as const;

export type FlagKey = (typeof FLAG_KEYS)[number];

export const FLAG_LABELS: Record<FlagKey, string> = {
  seeMargins: "Voir les prix d'achat et les marges",
  seeGlobalBudgets: "Voir les budgets globaux",
  seeInternalCosts: "Voir les coûts internes (cachets, rémunération des animatrices)",
  approveSpend: "Valider une dépense",
  exportData: "Exporter des données",
  readActivityLog: "Consulter le journal d'activité",
  overrideCommercial: "Lever un blocage commercial (remise hors plafond, client bloqué, encours, vente à perte)",
};

/* ------------------------------------------------------------------ */
/* Portée des données                                                  */
/* ------------------------------------------------------------------ */

export const SCOPE_KEYS = ["OWN", "ASSIGNED", "ALL"] as const;
export type ScopeKey = (typeof SCOPE_KEYS)[number];

export const SCOPE_LABELS: Record<ScopeKey, string> = {
  OWN: "Ses propres données uniquement",
  ASSIGNED: "Ses marques et clients assignés",
  ALL: "Tout",
};

export const SCOPE_SHORT: Record<ScopeKey, string> = {
  OWN: "Ses données",
  ASSIGNED: "Assignés",
  ALL: "Tout",
};

export const SCOPE_HINTS: Record<ScopeKey, string> = {
  OWN: "Animations, visites, tâches et dossiers dont la personne est responsable. Sur un module sans propriétaire (produits, clients, ventes), équivaut à « assignés ».",
  ASSIGNED: "Données rattachées aux marques et aux clients cochés ci-dessous.",
  ALL: "Aucun filtre.",
};
