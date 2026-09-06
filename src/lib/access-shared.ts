/**
 * Catalogue des modules de COMANET OS (partagé client/serveur).
 *
 * Ce fichier ne décide plus QUI a accès à QUOI : les droits vivent en base
 * (`roles` → `role_permissions` → `user_roles`) et se résolvent via
 * `src/lib/permissions.ts`. Il ne reste ici que la liste des modules, leurs
 * libellés et leur regroupement, qui servent à semer et à afficher la matrice
 * de permissions dans Paramètres.
 */

export const MODULE_KEYS = [
  "cockpit",
  "actions",
  "ventes",
  "clients",
  "produits",
  "marques",
  "stock",
  "terrain",
  "terrain_animatrices",
  "reglementaire",
  "marketing",
  "medical",
  "medical_admin",
  "taches",
  "imports",
  "parametres",
  "recherche",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  cockpit: "Cockpit",
  actions: "Action Center",
  ventes: "Ventes",
  clients: "Clients",
  produits: "Produits",
  marques: "Marques",
  stock: "Stock & achats",
  terrain: "Terrain",
  terrain_animatrices: "Terrain — animatrices",
  reglementaire: "Réglementaire",
  marketing: "Marketing",
  medical: "Médical",
  medical_admin: "Médical — administration",
  taches: "Tâches",
  imports: "Imports Sage",
  parametres: "Paramètres",
  recherche: "Recherche",
};

/** Les 7 grandes catégories, pour présenter la matrice de permissions. */
export const MODULE_GROUPS: { title: string; modules: ModuleKey[] }[] = [
  { title: "Pilotage", modules: ["cockpit", "actions", "recherche"] },
  { title: "Commercial", modules: ["ventes", "clients", "produits", "marques", "stock"] },
  { title: "Marketing", modules: ["marketing"] },
  { title: "Terrain", modules: ["terrain", "terrain_animatrices"] },
  { title: "Médical", modules: ["medical", "medical_admin"] },
  { title: "Conformité & exécution", modules: ["reglementaire", "taches"] },
  { title: "Système", modules: ["imports", "parametres"] },
];

/**
 * Description des modules dont la portée n'est pas évidente, affichée dans la matrice.
 * Les deux modules « _admin » remplacent les exceptions qui étaient codées en dur par
 * nom de rôle avant ce chantier.
 */
export const MODULE_HINTS: Partial<Record<ModuleKey, string>> = {
  terrain_animatrices: "Fiches et performances des animatrices, en plus de l'accès Terrain.",
  medical_admin: "Délégués, secteurs, spécialités et paramétrage médical, en plus de l'accès Médical.",
  parametres: "L'action « administrer » est requise pour modifier rôles, permissions et périmètres.",
};

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin / DG",
  MARKETING: "Marketing",
  REGLEMENTAIRE: "Réglementaire",
  TRADE: "Trade",
  ANIMATRICE: "Animatrice",
  DELEGUE_MEDICAL: "Délégué médical",
  MANAGER_MEDICAL: "Manager médical",
};
