import type { ScopeKey } from "@/lib/access-shared";
import { can, isAdmin, type PermissionSet } from "@/lib/permissions-shared";

/**
 * Le métier d'une personne sur le téléphone, déduit de ses droits et jamais de `users.role` : c'est ce qui choisit
 * ses onglets et son écran d'accueil. Pure, partagée client et serveur (`tests/mobile-socle.test.ts`).
 */
export type Persona = "DIRECTION" | "ANIMATRICE" | "DELEGUE" | "COMMERCIAL" | "AUTRE";

/**
 * Tous les métiers de terrain d'une personne, le principal d'abord. Une déléguée qui anime aussi de temps en temps
 * (Médical et Terrain → Créer, portée « ses données ») a les deux : la visite médicale d'abord, l'animation ensuite.
 */
export function personasOf(perms: PermissionSet, scope: ScopeKey): Persona[] {
  if (isAdmin(perms)) return ["DIRECTION"];
  const field: Persona[] = [];
  if (scope === "OWN" && can(perms, "medical", "create")) field.push("DELEGUE");
  if (scope === "OWN" && can(perms, "terrain", "create")) field.push("ANIMATRICE");
  if (field.length) return field;
  if (can(perms, "clients", "create") && can(perms, "commandes", "create")) return ["COMMERCIAL"];
  return ["AUTRE"];
}

/** Le métier principal : celui des onglets de la version complète et de l'accueil par défaut. */
export function personaOf(perms: PermissionSet, scope: ScopeKey): Persona {
  return personasOf(perms, scope)[0];
}

/** Les métiers qui ont leurs écrans sous `/m`. Les autres gardent leur accueil habituel. */
export function hasMobileScreens(p: Persona): boolean {
  return p !== "AUTRE";
}

const SCREENS: Record<Persona, string[]> = {
  ANIMATRICE: ["/m", "/m/saisie", "/m/stock", "/m/mois", "/m/a-corriger", "/m/operations", "/m/operation", "/m/operation-cr"],
  COMMERCIAL: ["/m", "/m/client", "/m/commande", "/m/a-corriger"],
  DELEGUE: ["/m/tournee", "/m/medecins", "/m/fiche-medecin", "/m/historique", "/m/compte-rendu", "/m/a-corriger"],
  DIRECTION: ["/m/brief", "/m/validations"],
  AUTRE: [],
};

/** Libellés du sélecteur des profils à deux métiers. */
export const SIDE_LABELS: Partial<Record<Persona, string>> = { DELEGUE: "Visites médicales", ANIMATRICE: "Animations" };

/** Premier écran du métier : chacun a sa propre page, donc seulement le code dont il a besoin. */
export function homePathOf(p: Persona): string {
  return SCREENS[p][0] ?? "/m";
}

/** Un écran d'un autre métier ramène à l'accueil plutôt que d'afficher un écran vide. */
export function screenAllowed(p: Persona, path: string): boolean {
  return SCREENS[p].includes(path);
}

/**
 * Le côté affiché : l'écran ouvert le dit quand il n'appartient qu'à un des métiers (la tournée = visites médicales,
 * la saisie = animations) ; sinon (« À corriger », écran commun) le dernier côté choisi ; sinon le métier principal.
 */
export function sideFor(personas: Persona[], path: string, remembered: Persona | null): Persona {
  const owners = personas.filter((p) => screenAllowed(p, path));
  if (owners.length === 1) return owners[0];
  return remembered && personas.includes(remembered) ? remembered : personas[0];
}

/**
 * Où envoyer le téléphone à l'ouverture, `null` pour rester. Un écran d'aucun de ses métiers ramène à l'accueil du côté
 * retenu. `/m` est aussi l'entrée de l'app (après connexion) : un profil à deux métiers y retrouve le dernier côté utilisé.
 */
export function redirectFor(personas: Persona[], path: string, remembered: Persona | null, entry: boolean): string | null {
  const main = personas.find(hasMobileScreens);
  if (!main) return null;
  const kept = remembered && personas.includes(remembered) ? remembered : main;
  if (!personas.some((p) => screenAllowed(p, path))) return homePathOf(kept);
  if (entry && path === "/m" && personas.length > 1 && !screenAllowed(kept, "/m")) return homePathOf(kept);
  return null;
}
