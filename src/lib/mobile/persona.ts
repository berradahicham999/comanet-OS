import type { ScopeKey } from "@/lib/access-shared";
import { can, isAdmin, type PermissionSet } from "@/lib/permissions-shared";

/**
 * Le métier d'une personne sur le téléphone, déduit de ses droits et jamais de `users.role` : c'est ce qui choisit
 * ses onglets et son écran d'accueil. Pure, partagée client et serveur (`tests/mobile-socle.test.ts`).
 */
export type Persona = "DIRECTION" | "ANIMATRICE" | "DELEGUE" | "COMMERCIAL" | "AUTRE";

export function personaOf(perms: PermissionSet, scope: ScopeKey): Persona {
  if (isAdmin(perms)) return "DIRECTION";
  if (scope === "OWN" && can(perms, "terrain", "create")) return "ANIMATRICE";
  if (scope === "OWN" && can(perms, "medical", "create")) return "DELEGUE";
  if (can(perms, "clients", "create") && can(perms, "commandes", "create")) return "COMMERCIAL";
  return "AUTRE";
}

/** Les métiers qui ont leurs écrans sous `/m`. Les autres gardent leur accueil habituel. */
export function hasMobileScreens(p: Persona): boolean {
  return p !== "AUTRE";
}

const SCREENS: Record<Persona, string[]> = {
  ANIMATRICE: ["/m", "/m/saisie", "/m/stock", "/m/mois", "/m/a-corriger"],
  COMMERCIAL: ["/m", "/m/client", "/m/commande", "/m/a-corriger"],
  DELEGUE: ["/m/tournee", "/m/medecins", "/m/fiche-medecin", "/m/historique", "/m/compte-rendu", "/m/a-corriger"],
  DIRECTION: ["/m/brief", "/m/validations"],
  AUTRE: [],
};

/** Premier écran du métier : chacun a sa propre page, donc seulement le code dont il a besoin. */
export function homePathOf(p: Persona): string {
  return SCREENS[p][0] ?? "/m";
}

/** Un écran d'un autre métier ramène à l'accueil plutôt que d'afficher un écran vide. */
export function screenAllowed(p: Persona, path: string): boolean {
  return SCREENS[p].includes(path);
}
