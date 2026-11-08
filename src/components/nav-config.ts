import { type FlagKey, type ModuleKey } from "@/lib/access-shared";
import { type ScopeKey } from "@/lib/access-shared";
import { can, hasAnyModule, isAdmin, type FlagSet, type PermissionAction, type PermissionSet } from "@/lib/permissions-shared";
import { personaOf, type Persona } from "@/lib/mobile/persona";

/**
 * Page « Préparation » de la gestion commerciale (état des fiches, chiffre d'affaires de tous les clients) :
 * pour qui prépare, facture ou administre — pas pour qui ne fait que prendre des commandes.
 */
export const PREPARATION_MODULES: ModuleKey[] = ["livraisons", "facturation", "reglements", "achats", "stock", "administration"];

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
      { href: "/clients/tournee", label: "Ma tournée", icon: "MapPinned", module: "clients", action: "create" },
      { href: "/clients/visites", label: "Suivi des visites", icon: "CalendarCheck", module: "clients" },
      { href: "/clients/portefeuilles", label: "Portefeuilles", icon: "IdCard", module: "clients", action: "edit" },
      { href: "/clients/stock", label: "Stock chez les clients", icon: "Store", module: "clients" },
      { href: "/produits", label: "Produits", icon: "Package", module: "produits" },
      { href: "/marques", label: "Marques", icon: "Tags", module: "produits" },
      { href: "/stock", label: "Stock & achats", icon: "Boxes", module: "stock" },
    ],
  },
  {
    title: "Gestion commerciale",
    items: [
      { href: "/gestion", label: "Préparation", icon: "ClipboardCheck", module: PREPARATION_MODULES, exact: true },
      { href: "/gestion/pieces?type=COMMANDE", label: "Commandes clients", icon: "ShoppingCart", module: "commandes" },
      { href: "/gestion/pieces", label: "Pièces de vente", icon: "FileText", module: ["livraisons", "facturation"] },
      { href: "/gestion/reglements", label: "Règlements", icon: "Wallet", module: "reglements" },
      { href: "/gestion/achats", label: "Achats", icon: "PackagePlus", module: ["achats", "stock"] },
      { href: "/gestion/stock", label: "Stock réel", icon: "Warehouse", module: "stock" },
      { href: "/gestion/inventaires", label: "Inventaires", icon: "ClipboardList", module: "stock" },
      { href: "/gestion/fournisseurs", label: "Fournisseurs", icon: "Truck", module: "achats" },
      { href: "/gestion/pnl", label: "P&L", icon: "Scale", module: "administration", action: "validate" },
      { href: "/gestion/bascule", label: "Bascule", icon: "ArrowRightLeft", module: "administration" },
    ],
  },
  {
    title: "Marketing",
    items: [
      { href: "/marketing", label: "Command Center", icon: "Megaphone", module: "marketing", exact: true },
      { href: "/marketing/plan", label: "Plan marketing", icon: "Map", module: "marketing" },
      { href: "/marketing/priorites", label: "Priorités & actions", icon: "Zap", module: "marketing" },
      { href: "/marketing/bibliotheque", label: "Bibliothèque d'actions", icon: "LibraryBig", module: "marketing" },
      { href: "/marketing/campagnes", label: "Campagnes", icon: "Rocket", module: "marketing" },
      { href: "/marketing/influence", label: "Influence", icon: "Heart", module: "influence" },
      { href: "/marketing/ads", label: "Digital Ads", icon: "MousePointerClick", module: "marketing" },
      { href: "/marketing/planning", label: "Contenu", icon: "CalendarDays", module: "marketing" },
      { href: "/marketing/studio", label: "Studio créatif", icon: "Clapperboard", module: "marketing" },
      { href: "/marketing/activations", label: "Activations", icon: "PartyPopper", module: ["marketing", "clients"] },
      { href: "/marketing/materiel", label: "Matériel & goodies", icon: "Boxes", module: ["marketing", "clients"] },
      { href: "/marketing/budgets", label: "Budget & dépenses", icon: "Wallet", module: "budgets" },
      { href: "/marketing/analytics", label: "Analytics", icon: "ChartLine", module: "marketing" },
      { href: "/marketing/agent", label: "Agent marketing", icon: "Sparkles", module: "marketing" },
    ],
  },
  {
    title: "Terrain",
    items: [
      { href: "/terrain", label: "Animations", icon: "Store", module: "terrain" },
      { href: "/terrain/saisie", label: "Saisie terrain", icon: "ClipboardList", module: "terrain" },
      { href: "/terrain/rapports", label: "Rapports d'animation", icon: "ClipboardList", module: "terrain" },
      { href: "/terrain/animatrices", label: "Animatrices", icon: "Sparkles", module: "terrain", action: "validate" },
    ],
  },
  {
    title: "Médical",
    items: [
      { href: "/medical", label: "Dashboard médical", icon: "Stethoscope", module: "medical", exact: true },
      { href: "/medical/medecins", label: "Médecins", icon: "UserRound", module: "medical" },
      { href: "/medical/visites", label: "Visites", icon: "CalendarCheck", module: "medical" },
      { href: "/medical/journee", label: "Ma journée", icon: "Timer", module: "medical", action: "create" },
      { href: "/medical/visites/saisie", label: "Planifier une visite", icon: "ClipboardList", module: "medical" },
      { href: "/medical/suivi", label: "Suivi terrain", icon: "MapPinned", module: "medical", action: "validate" },
      { href: "/medical/ordonnances", label: "Ordonnances", icon: "Pill", module: "medical", action: "validate" },
      { href: "/medical/analyses", label: "Analyses et tournée", icon: "ChartLine", module: "medical" },
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

/** Hors du menu : la barre mobile y mène quand même. */
const ANY_TABS: NavItem[] = [
  { href: "/notifications", label: "Notifications", icon: "Bell", module: "any" },
  { href: "/recherche", label: "Recherche", icon: "Search", module: "any" },
  { href: "/m", label: "Clients", icon: "Users", module: "clients", exact: true },
  { href: "/m/tournee", label: "Tournée", icon: "Timer", module: "medical" },
  { href: "/m/medecins", label: "Médecins", icon: "UserRound", module: "medical" },
  { href: "/m/historique", label: "Historique", icon: "CalendarCheck", module: "medical" },
  { href: "/m/brief", label: "Brief", icon: "Sun", module: "any" },
  { href: "/m/validations", label: "Valider", icon: "SquareCheck", module: "any" },
];

/** L'animatrice a ses écrans sous `/m`, qui marchent sans réseau. */
export const ANIMATRICE_TABS: NavItem[] = [
  { href: "/m", label: "Aujourd'hui", icon: "Sun", module: "terrain", exact: true },
  { href: "/m/saisie", label: "Saisie", icon: "ClipboardList", module: "terrain" },
  { href: "/m/stock", label: "Stock", icon: "Store", module: "terrain" },
  { href: "/m/mois", label: "Mon mois", icon: "Trophy", module: "terrain" },
];

const TABS: Record<Exclude<Persona, "ANIMATRICE">, string[]> = {
  DIRECTION: ["/m/brief", "/actions", "/m/validations", "/recherche"],
  DELEGUE: ["/m/tournee", "/m/medecins", "/m/historique", "/taches"],
  COMMERCIAL: ["/m", "/clients/tournee", "/gestion/pieces?type=COMMANDE", "/taches"],
  AUTRE: ["/taches", "/notifications", "/recherche"],
};

/** Libellés courts : la barre fait 72 px par onglet sur un téléphone de 360 px. */
const SHORT: Record<string, string> = {
  "/gestion/pieces?type=COMMANDE": "Commandes",
  "/medical/medecins": "Médecins",
  "/actions": "Actions",
  "/clients/tournee": "Tournée",
  "/medical/journee": "Journée",
};

/** Onglets de la barre mobile (4 au plus) : ceux du métier de la personne, filtrés par ses droits. */
export function mobileTabsForPermissions(perms: PermissionSet, scope: ScopeKey, flags?: FlagSet): NavItem[] {
  const persona = personaOf(perms, scope);
  if (persona === "ANIMATRICE") return ANIMATRICE_TABS;
  const all = [...navForPermissions(perms, flags).flatMap((g) => g.items), ...ANY_TABS];
  return TABS[persona].flatMap((href) => {
    const it = all.find((i) => i.href === href);
    return it ? [{ ...it, label: SHORT[href] ?? it.label }] : [];
  });
}
