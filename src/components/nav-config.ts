import type { UserRole } from "@/db/schema";
import { canAccess, type ModuleKey } from "@/lib/access-shared";

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
      { href: "/terrain/animatrices", label: "Animatrices", icon: "Sparkles", module: "terrain" },
    ],
  },
  {
    title: "Médical",
    items: [
      { href: "/medical", label: "Dashboard médical", icon: "Stethoscope", module: "medical", exact: true },
      { href: "/medical/medecins", label: "Médecins", icon: "UserRound", module: "medical" },
      { href: "/medical/delegues", label: "Délégués médicaux", icon: "IdCard", module: "medical" },
      { href: "/medical/visites", label: "Visites", icon: "CalendarCheck", module: "medical" },
      { href: "/medical/planning", label: "Planning / tournée", icon: "Map", module: "medical" },
      { href: "/medical/echantillons", label: "Échantillons", icon: "FlaskConical", module: "medical" },
      { href: "/medical/secteurs", label: "Secteurs", icon: "LandPlot", module: "medical" },
      { href: "/medical/specialites", label: "Spécialités", icon: "BriefcaseMedical", module: "medical" },
      { href: "/medical/parametrage", label: "Paramétrage médical", icon: "SlidersHorizontal", module: "medical" },
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
      { href: "/parametres", label: "Paramètres", icon: "Settings", module: "parametres" },
    ],
  },
];

/** Pages Médical réservées manager/admin — masquées à un délégué médical. */
const MEDICAL_MANAGER_ONLY = ["/medical/delegues", "/medical/secteurs", "/medical/specialites", "/medical/parametrage"];

export function navForRole(role: UserRole): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) =>
        canAccess(role, i.module) &&
        !(role === "ANIMATRICE" && i.href === "/terrain/animatrices") &&
        !(role === "DELEGUE_MEDICAL" && MEDICAL_MANAGER_ONLY.includes(i.href)),
    ),
  })).filter((g) => g.items.length > 0);
}

/** Onglets de la barre mobile (5 max). */
export function mobileTabsForRole(role: UserRole): NavItem[] {
  if (role === "ANIMATRICE") {
    return [
      { href: "/terrain/saisie", label: "Saisie", icon: "ClipboardList", module: "terrain" },
      { href: "/terrain", label: "Animations", icon: "Store", module: "terrain" },
      { href: "/taches", label: "Tâches", icon: "SquareCheck", module: "taches" },
    ];
  }
  if (role === "DELEGUE_MEDICAL") {
    return [
      { href: "/medical/visites/saisie", label: "Saisie", icon: "ClipboardList", module: "medical" },
      { href: "/medical/planning", label: "Planning", icon: "Map", module: "medical" },
      { href: "/medical/medecins", label: "Médecins", icon: "UserRound", module: "medical" },
      { href: "/taches", label: "Tâches", icon: "SquareCheck", module: "taches" },
    ];
  }
  const all = navForRole(role).flatMap((g) => g.items);
  const prefer = ["/", "/actions", "/taches", "/ventes", "/marketing", "/reglementaire", "/terrain", "/medical"];
  const picked: NavItem[] = [];
  for (const p of prefer) {
    const it = all.find((i) => i.href === p);
    if (it && picked.length < 4) picked.push(it);
  }
  return picked;
}
