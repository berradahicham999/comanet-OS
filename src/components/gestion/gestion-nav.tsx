import { redirect } from "next/navigation";
import { requireAccessContext, can } from "@/lib/access";
import type { ModuleKey } from "@/lib/access-shared";
import { Tabs } from "@/components/ui";
import { PREPARATION_MODULES } from "@/components/nav-config";

/** Modules qui ouvrent l'espace « Gestion commerciale ». */
export const GESTION_MODULES: ModuleKey[] = ["commandes", "livraisons", "facturation", "reglements", "achats", "stock", "clients", "produits", "administration"];

/** Page « Préparation » : pour qui prépare, facture ou administre (voir `PREPARATION_MODULES`). */
export function canSeePreparation(perms: Awaited<ReturnType<typeof requireAccessContext>>["perms"]) {
  return PREPARATION_MODULES.some((m) => can(perms, m, "view"));
}

/** Garde de page : au moins un module de la gestion commerciale en lecture. */
export async function requireGestionView() {
  const a = await requireAccessContext();
  if (!GESTION_MODULES.some((m) => can(a.perms, m, "view"))) redirect(a.home);
  return a;
}

/** Onglets de l'espace, filtrés par droits. */
export async function GestionTabs({ current }: { current: string }) {
  const a = await requireAccessContext();
  const tabs = [
    { href: "/gestion", label: "Préparation", ok: canSeePreparation(a.perms) },
    { href: "/gestion/pieces", label: "Pièces", ok: can(a.perms, "commandes", "view") || can(a.perms, "livraisons", "view") || can(a.perms, "facturation", "view") },
    { href: "/gestion/pieces/facturer", label: "Facturer des BL", ok: can(a.perms, "facturation", "create") },
    { href: "/gestion/reglements", label: "Règlements", ok: can(a.perms, "reglements", "view") },
    { href: "/gestion/stock", label: "Stock réel", ok: can(a.perms, "stock", "view") },
    { href: "/gestion/inventaires", label: "Inventaires", ok: can(a.perms, "stock", "view") },
    { href: "/gestion/achats", label: "Achats", ok: can(a.perms, "achats", "view") || can(a.perms, "stock", "view") },
    { href: "/gestion/fournisseurs", label: "Fournisseurs", ok: can(a.perms, "achats", "view") },
    { href: "/gestion/pnl", label: "P&L", ok: can(a.perms, "administration", "validate") },
    { href: "/gestion/exports", label: "Envoi au comptable", ok: can(a.perms, "facturation", "view") },
    { href: "/gestion/bascule", label: "Bascule", ok: can(a.perms, "administration", "view") },
    { href: "/parametres/gestion", label: "Paramètres", ok: can(a.perms, "administration", "view") },
  ].filter((t) => t.ok);
  return <Tabs current={current} tabs={tabs.map(({ href, label }) => ({ href, label }))} />;
}

/** Types de pièces d'achat visibles : commandes et factures = Achats ; réceptions et retours = Achats ou Stock (magasin). */
export function visiblePurchaseTypes(perms: Awaited<ReturnType<typeof requireAccessContext>>["perms"]) {
  const achats = can(perms, "achats", "view"), stock = can(perms, "stock", "view");
  return (["COMMANDE", "RECEPTION", "FACTURE", "RETOUR"] as const).filter((t) => achats || (stock && (t === "RECEPTION" || t === "RETOUR")));
}

/** Onglets de l'espace P&L (administrateurs). */
export function PnlTabs({ current, year }: { current: string; year?: number }) {
  const q = year ? `?year=${year}` : "";
  return <Tabs current={current} tabs={[
    { href: "/gestion/pnl", label: "Compte de résultat" },
    { href: "/gestion/pnl/charges", label: "Charges" },
    { href: "/gestion/pnl/ventes-bloc", label: "Ventes en bloc" },
    { href: "/gestion/pnl/regles", label: "Règles" },
  ].map((t) => ({ ...t, href: t.href === current ? t.href : t.href + (t.href.endsWith("regles") ? "" : q) }))} />;
}
