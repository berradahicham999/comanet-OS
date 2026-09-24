import { redirect } from "next/navigation";
import { requireAccessContext, can } from "@/lib/access";
import type { ModuleKey } from "@/lib/access-shared";
import { Tabs } from "@/components/ui";

/** Modules qui ouvrent l'espace « Gestion commerciale ». */
export const GESTION_MODULES: ModuleKey[] = ["livraisons", "facturation", "achats", "stock", "clients", "produits", "administration"];

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
    { href: "/gestion", label: "Préparation", ok: true },
    { href: "/gestion/pieces", label: "Pièces", ok: can(a.perms, "livraisons", "view") || can(a.perms, "facturation", "view") },
    { href: "/gestion/pieces/facturer", label: "Facturer des BL", ok: can(a.perms, "facturation", "create") },
    { href: "/gestion/stock", label: "Stock réel", ok: can(a.perms, "stock", "view") },
    { href: "/gestion/achats", label: "Achats", ok: can(a.perms, "achats", "view") || can(a.perms, "stock", "view") },
    { href: "/gestion/fournisseurs", label: "Fournisseurs", ok: can(a.perms, "achats", "view") },
    { href: "/parametres/gestion", label: "Paramètres", ok: can(a.perms, "administration", "view") },
  ].filter((t) => t.ok);
  return <Tabs current={current} tabs={tabs.map(({ href, label }) => ({ href, label }))} />;
}

/** Types de pièces d'achat visibles : commandes et factures = Achats ; réceptions et retours = Achats ou Stock (magasin). */
export function visiblePurchaseTypes(perms: Awaited<ReturnType<typeof requireAccessContext>>["perms"]) {
  const achats = can(perms, "achats", "view"), stock = can(perms, "stock", "view");
  return (["COMMANDE", "RECEPTION", "FACTURE", "RETOUR"] as const).filter((t) => achats || (stock && (t === "RECEPTION" || t === "RETOUR")));
}
