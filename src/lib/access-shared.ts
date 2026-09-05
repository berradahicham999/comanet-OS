import type { UserRole } from "@/db/schema";

/**
 * Modules de l'application et rôles autorisés (partagé client/serveur).
 * ADMIN (DG) a accès à tout.
 */
export const MODULES = {
  cockpit: ["ADMIN", "MARKETING", "TRADE", "REGLEMENTAIRE"],
  actions: ["ADMIN", "MARKETING", "TRADE", "REGLEMENTAIRE"],
  ventes: ["ADMIN", "TRADE", "MARKETING"],
  clients: ["ADMIN", "TRADE"],
  produits: ["ADMIN", "MARKETING", "TRADE", "REGLEMENTAIRE"],
  marques: ["ADMIN", "MARKETING", "TRADE", "REGLEMENTAIRE"],
  stock: ["ADMIN", "TRADE", "MARKETING"],
  terrain: ["ADMIN", "TRADE", "ANIMATRICE"],
  reglementaire: ["ADMIN", "REGLEMENTAIRE"],
  marketing: ["ADMIN", "MARKETING"],
  taches: ["ADMIN", "MARKETING", "TRADE", "REGLEMENTAIRE", "ANIMATRICE"],
  imports: ["ADMIN", "TRADE"],
  parametres: ["ADMIN"],
  recherche: ["ADMIN", "MARKETING", "TRADE", "REGLEMENTAIRE"],
} as const satisfies Record<string, readonly UserRole[]>;

export type ModuleKey = keyof typeof MODULES;

export function canAccess(role: UserRole, module: ModuleKey) {
  return role === "ADMIN" || (MODULES[module] as readonly UserRole[]).includes(role);
}

/** Page d'accueil par rôle. */
export function homeFor(role: UserRole) {
  if (role === "ANIMATRICE") return "/terrain/saisie";
  if (role === "REGLEMENTAIRE") return "/reglementaire";
  if (role === "MARKETING") return "/marketing";
  return "/";
}

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin / DG",
  MARKETING: "Marketing",
  REGLEMENTAIRE: "Réglementaire",
  TRADE: "Trade",
  ANIMATRICE: "Animatrice",
};
