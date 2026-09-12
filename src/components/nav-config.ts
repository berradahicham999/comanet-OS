import { type FlagKey, type ModuleKey } from "@/lib/access-shared";
import { can, hasAnyModule, isAdmin, type FlagSet, type PermissionAction, type PermissionSet } from "@/lib/permissions-shared";

export type NavItem = {
  href: string;
  label: string;
  icon: string; // clé lucide (voir nav-icons)
  /** `any` : visible dès qu'un module l'est (Cockpit, Action Center). Une liste : l'un des modules suffit (Activations). */
  module: ModuleKey | ModuleKey[] | "any";
  /** Droit requis au-delà de « voir » (ex. Valider pour les fiches animatrices). */
  action?: PermissionAction;
  /** Interrupteur transverse requis (ou module Administration avec Valider). */
  flag?: FlagKey;
  exact?: boolean;
};

export type NavGroup = { title: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    title: "Pilotage",
    items: [
      { href: "/", label: "Cockpit", icon: "LayoutDashboard", module: "any", exact: true },
      { href: "/actions", label: "Action Center", icon: "Zap", module: "any" },
    ],
  },
  {
    title: "Commercial",
    items: [
      { href: "/ventes", label: "Ventes", icon: "ChartColumn", module: "ventes" },
      { href: "/clients", label: "Clients", icon: "Users", module: "clients" },
      { href: "/produits", label: "Produits", icon: "Package", module: "produits" },
      { href: "/marques", label: "Marques", icon: "Tags", module: "produits" },
      { href: "/stock", label: "Stock & achats", icon: "Boxes", module: "stock" },
    ],
  },
  {
    title: "Marketing",
    items: [
      { href: "/marketing", label: "Vue d'ensemble", icon: "Megaphone", module: "marketing", exact: true },
      { href: "/marketing/campagnes", label: "Campagnes", icon: "Rocket", module: "marketing" },
      { href: "/marketing/ads", label: "Digital Ads", icon: "MousePointerClick", module: "marketing" },
      { href: "/marketing/influence", label: "Influence", icon: "Heart", module: "influence" },
      { href: "/marketing/planning", label: "Planning éditorial", icon: "CalendarDays", module: "marketing" },
      { href: "/marketing/activations", label: "Activations", icon: "PartyPopper", module: ["marketing", "clients"] },
      { href: "/marketing/materiel", label: "Matériel", icon: "Boxes", module: ["marketing", "clients"] },
      { href: "/marketing/budgets", label: "Budgets", icon: "Wallet", module: "budgets" },
      { href: "/marketing/analytics", label: "Analytics marketing", icon: "ChartLine", module: "marketing" },
      { href: "/marketing/agent", label: "Agent marketing", icon: "Sparkles", module: "marketing" },
    ],
  },
  {
    title: "Terrain",
    items: [
      { href: "/terrain", label: "Animations", icon: "Store", module: "terrain" },
      { href: "/terrain/saisie", label: "Saisie terrain", icon: "ClipboardList", module: "terrain" },
      { href: "/terrain/animatrices", label: "Animatrices", icon: "Sparkles", module: "terrain", action: "validate" },
    ],
  },
  {
    title: "Médical",
    items: [
      { href: "/medical", label: "Dashboard médical", icon: "Stethoscope", module: "medical", exact: true },
      { href: "/medical/medecins", label: "Médecins", icon: "UserRound", module: "medical" },
      { href: "/medical/visites", label: "Visites", icon: "CalendarCheck", module: "medical" },
      { href: "/medical/visites/saisie", label: "Saisie visite", icon: "ClipboardList", module: "medical" },
      { href: "/medical/planning", label: "Planning / tournée", icon: "Map", module: "medical" },
      { href: "/medical/echantillons", label: "Échantillons", icon: "FlaskConical", module: "medical" },
      { href: "/medical/delegues", label: "Délégués médicaux", icon: "IdCard", module: "medical", action: "validate" },
      { href: "/medical/secteurs", label: "Secteurs", icon: "LandPlot", module: "medical", action: "validate" },
      { href: "/medical/specialites", label: "Spécialités", icon: "BriefcaseMedical", module: "medical", action: "validate" },
      { href: "/medical/parametrage", label: "Paramétrage médical", icon: "SlidersHorizontal", module: "medical", action: "validate" },
    ],
  },
  {
    title: "Conformité & exécution",
    items: [
      { href: "/reglementaire", label: "Réglementaire", icon: "ShieldCheck", module: "reglementaire" },
      { href: "/taches", label: "Tâches", icon: "SquareCheck", module: "taches" },
      { href: "/rapports", label: "Rapports", icon: "FileBarChart", module: "rapports" },
    ],
  },
  {
    title: "Système",
    items: [
      { href: "/imports", label: "Imports", icon: "Upload", module: "any" },
      { href: "/parametres/utilisateurs", label: "Utilisateurs & droits", icon: "UserCog", module: "administration", action: "validate" },
      { href: "/parametres/evenements", label: "Événements", icon: "ScrollText", module: "any", flag: "readActivityLog" },
      { href: "/parametres", label: "Paramètres", icon: "Settings", module: "administration" },
    ],
  },
];

export function navItemVisible(perms: PermissionSet, i: NavItem, flags?: FlagSet): boolean {
  if (i.flag && !(flags?.[i.flag] || isAdmin(perms))) return false;
  if (i.module === "any") return hasAnyModule(perms);
  if (Array.isArray(i.module)) return i.module.some((m) => can(perms, m, i.action ?? "view"));
  return can(perms, i.module, i.action ?? "view");
}

export function navForPermissions(perms: PermissionSet, flags?: FlagSet): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => navItemVisible(perms, i, flags)),
  })).filter((g) => g.items.length > 0);
}

/**
 * Onglets de la barre mobile (4 max). La page d'accueil de la personne vient en
 * premier : c'est ce qui donne sa saisie à une animatrice ou à un délégué médical,
 * sans avoir à tester leur rôle.
 */
export function mobileTabsForPermissions(perms: PermissionSet, homePath: string, flags?: FlagSet): NavItem[] {
  const all = navForPermissions(perms, flags).flatMap((g) => g.items);
  const prefer = [homePath, "/", "/actions", "/taches", "/ventes", "/marketing", "/reglementaire", "/terrain", "/medical"];
  const picked: NavItem[] = [];
  for (const href of prefer) {
    if (picked.length >= 4) break;
    const it = all.find((i) => i.href === href);
    if (it && !picked.some((p) => p.href === it.href)) picked.push(it);
  }
  return picked;
}
