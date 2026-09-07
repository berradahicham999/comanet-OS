import { type ModuleKey } from "@/lib/access-shared";
import { can, type PermissionSet } from "@/lib/permissions-shared";

export type NavItem = {
  href: string;
  label: string;
  icon: string; // clé lucide (voir nav-icons)
  module: ModuleKey;
  exact?: boolean;
};

export type NavGroup = { title: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    title: "Pilotage",
    items: [
      { href: "/", label: "Cockpit", icon: "LayoutDashboard", module: "cockpit", exact: true },
      { href: "/actions", label: "Action Center", icon: "Zap", module: "actions" },
    ],
  },
  {
    title: "Commercial",
    items: [
      { href: "/ventes", label: "Ventes", icon: "ChartColumn", module: "ventes" },
      { href: "/clients", label: "Clients", icon: "Users", module: "clients" },
      { href: "/produits", label: "Produits", icon: "Package", module: "produits" },
      { href: "/marques", label: "Marques", icon: "Tags", module: "marques" },
      { href: "/stock", label: "Stock & achats", icon: "Boxes", module: "stock" },
    ],
  },
  {
    title: "Marketing",
    items: [
      { href: "/marketing", label: "Vue d'ensemble", icon: "Megaphone", module: "marketing", exact: true },
      { href: "/marketing/campagnes", label: "Campagnes", icon: "Rocket", module: "marketing" },
      { href: "/marketing/ads", label: "Digital Ads", icon: "MousePointerClick", module: "marketing" },
      { href: "/marketing/influence", label: "Influence", icon: "Heart", module: "marketing" },
      { href: "/marketing/planning", label: "Planning éditorial", icon: "CalendarDays", module: "marketing" },
      { href: "/marketing/budgets", label: "Budgets", icon: "Wallet", module: "marketing" },
    ],
  },
  {
    title: "Terrain",
    items: [
      { href: "/terrain", label: "Animations", icon: "Store", module: "terrain" },
      { href: "/terrain/saisie", label: "Saisie terrain", icon: "ClipboardList", module: "terrain" },
      { href: "/terrain/animatrices", label: "Animatrices", icon: "Sparkles", module: "terrain_animatrices" },
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
      { href: "/medical/delegues", label: "Délégués médicaux", icon: "IdCard", module: "medical_admin" },
      { href: "/medical/secteurs", label: "Secteurs", icon: "LandPlot", module: "medical_admin" },
      { href: "/medical/specialites", label: "Spécialités", icon: "BriefcaseMedical", module: "medical_admin" },
      { href: "/medical/parametrage", label: "Paramétrage médical", icon: "SlidersHorizontal", module: "medical_admin" },
    ],
  },
  {
    title: "Conformité & exécution",
    items: [
      { href: "/reglementaire", label: "Réglementaire", icon: "ShieldCheck", module: "reglementaire" },
      { href: "/taches", label: "Tâches", icon: "SquareCheck", module: "taches" },
    ],
  },
  {
    title: "Système",
    items: [
      { href: "/imports", label: "Imports Sage", icon: "Upload", module: "imports" },
      { href: "/parametres/evenements", label: "Événements", icon: "ScrollText", module: "parametres" },
      { href: "/parametres", label: "Paramètres", icon: "Settings", module: "parametres" },
    ],
  },
];

export function navForPermissions(perms: PermissionSet): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => can(perms, i.module, "view")),
  })).filter((g) => g.items.length > 0);
}

/**
 * Onglets de la barre mobile (4 max). La page d'accueil de la personne vient en
 * premier : c'est ce qui donne sa saisie à une animatrice ou à un délégué médical,
 * sans avoir à tester leur rôle.
 */
export function mobileTabsForPermissions(perms: PermissionSet, homePath: string): NavItem[] {
  const all = navForPermissions(perms).flatMap((g) => g.items);
  const prefer = [homePath, "/", "/actions", "/taches", "/ventes", "/marketing", "/reglementaire", "/terrain", "/medical"];
  const picked: NavItem[] = [];
  for (const href of prefer) {
    if (picked.length >= 4) break;
    const it = all.find((i) => i.href === href);
    if (it && !picked.some((p) => p.href === it.href)) picked.push(it);
  }
  return picked;
}
