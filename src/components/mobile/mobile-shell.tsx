"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Bell, ClipboardList, CloudOff, MapPinned, RefreshCw, ShoppingCart, SquareCheck, Store, Sun, Trophy, TriangleAlert, Users } from "lucide-react";
import type { Persona } from "@/lib/mobile/persona";
import { MobileApp, useMobile } from "./mobile-app";

const ANIMATRICE_TABS = [
  { href: "/m", label: "Aujourd'hui", Icon: Sun },
  { href: "/m/saisie", label: "Saisie", Icon: ClipboardList },
  { href: "/m/stock", label: "Stock", Icon: Store },
  { href: "/m/mois", label: "Mon mois", Icon: Trophy },
];

/** Tournée, Commandes et Tâches restent les pages existantes : elles gardent la même barre basse. */
const COMMERCIAL_TABS = [
  { href: "/m", label: "Clients", Icon: Users },
  { href: "/clients/tournee", label: "Tournée", Icon: MapPinned },
  { href: "/gestion/pieces?type=COMMANDE", label: "Commandes", Icon: ShoppingCart },
  { href: "/taches", label: "Tâches", Icon: SquareCheck },
];

const tabsOf = (p: Persona | undefined) => (p === "COMMERCIAL" ? COMMERCIAL_TABS : p === "ANIMATRICE" ? ANIMATRICE_TABS : []);

function SyncBadge() {
  const { pending, toFix, online, authLost, retry } = useMobile();
  if (toFix.length) {
    return <Link href="/m/a-corriger" className="flex items-center gap-1.5 h-11 px-3 rounded-full bg-red-soft text-red text-[12.5px] font-medium"><TriangleAlert size={15} /> {toFix.length} à corriger</Link>;
  }
  if (authLost) {
    return <a href="/login?next=/m" className="flex items-center h-11 px-3 rounded-full bg-orange-soft text-orange text-[12.5px] font-medium">Reconnectez-vous</a>;
  }
  if (pending.length) {
    const n = pending.length;
    return <button type="button" onClick={() => void retry()} className="flex items-center gap-1.5 h-11 px-3 rounded-full bg-orange-soft text-orange text-[12.5px] font-medium"><RefreshCw size={14} /> {n} saisie{n > 1 ? "s" : ""} en attente</button>;
  }
  if (!online) return <span className="flex items-center gap-1.5 h-11 px-3 text-muted text-[12.5px]"><CloudOff size={15} /> Hors connexion</span>;
  return null;
}

function Frame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { snapshot } = useMobile();
  return (
    <div className="min-h-dvh flex flex-col bg-bg">
      <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-line pt-[env(safe-area-inset-top)]">
        <div className="h-14 px-4 flex items-center gap-2">
          <span className="font-semibold tracking-tight text-[15px] text-ink">COMANET</span>
          <div className="flex-1" />
          <SyncBadge />
          <Link href="/notifications" prefetch={false} className="h-11 w-11 flex items-center justify-center text-muted" aria-label="Notifications"><Bell size={19} /></Link>
        </div>
      </header>
      <main className="flex-1 px-4 pt-4 pb-[calc(84px+env(safe-area-inset-bottom))]">{children}</main>
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4">
          {tabsOf(snapshot?.persona).map(({ href, label, Icon }) => {
            const active = href === "/m" ? path === "/m" || path === "/m/client" : path.startsWith(href);
            return (
              <Link key={href} href={href} prefetch={false} className={clsx("flex flex-col items-center justify-center gap-1 min-h-[56px] text-[11px] font-medium", active ? "text-accent" : "text-muted")}>
                <Icon size={21} strokeWidth={active ? 2.2 : 1.8} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <MobileApp>
      <Frame>{children}</Frame>
    </MobileApp>
  );
}

/** Attente du premier affichage : la forme de l'écran, pas un spinner plein écran. */
export function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="Chargement">
      <div className="h-7 w-44 rounded-lg bg-sunk" />
      <div className="h-32 rounded-2xl bg-sunk" />
      <div className="h-20 rounded-2xl bg-sunk" />
      <div className="h-20 rounded-2xl bg-sunk" />
    </div>
  );
}

/** Rien sur ce téléphone et pas de réseau : première ouverture à faire avec du réseau. */
export function NoData() {
  return (
    <div className="card p-5 text-center">
      <CloudOff size={26} className="mx-auto text-muted" />
      <h1 className="mt-2 text-[17px] font-semibold text-ink">Pas de réseau</h1>
      <p className="mt-1 text-[14px] text-muted">Ouvrez l&apos;application une première fois avec du réseau : vos produits et points de vente seront ensuite disponibles partout.</p>
    </div>
  );
}
