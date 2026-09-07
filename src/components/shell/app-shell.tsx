"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { Bell, Eye, Menu, Search, X } from "lucide-react";
import type { NavGroup, NavItem } from "@/components/nav-config";
import type { SessionUser } from "@/lib/auth";
import { Sidebar, isActive } from "./sidebar";
import { NavIcon } from "./nav-icons";

export function AppShell({ groups, tabs, user, logout, canSearch, preview, unread = 0, children }: {
  groups: NavGroup[];
  tabs: NavItem[];
  user: SessionUser;
  logout: () => Promise<void>;
  canSearch: boolean;
  /** Prévisualisation « en tant que » : bandeau permanent, lecture seule. */
  preview: { adminName: string; targetName: string; targetId: string } | null;
  /** Notifications non lues (cloche de l'en-tête). */
  unread?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");

  // Ferme le menu mobile à chaque navigation (ajustement d'état pendant le rendu, sans effet).
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setOpen(false);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim()) router.push(`/recherche?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <div className="min-h-dvh flex">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex w-[248px] shrink-0 border-r border-line bg-surface sticky top-0 h-dvh">
        <div className="w-full"><Sidebar groups={groups} user={user} logout={logout} /></div>
      </aside>

      {/* Drawer mobile */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] bg-surface shadow-[var(--shadow-pop)]">
            <button className="absolute right-3 top-4 btn-ghost h-8 w-8 p-0 rounded-lg" onClick={() => setOpen(false)} aria-label="Fermer">
              <X size={18} />
            </button>
            <Sidebar groups={groups} user={user} logout={logout} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {preview && (
          <div className="sticky top-0 z-50 bg-amber-500 text-black text-[13px] px-3 sm:px-5 py-2 flex items-center gap-2 flex-wrap">
            <Eye size={16} />
            <span>
              <b>Prévisualisation</b> : vous voyez l&apos;application comme <b>{preview.targetName}</b> la verra. Lecture seule, aucune action n&apos;est enregistrée.
            </span>
            <span className="ml-auto flex items-center gap-2">
              <a href={`/api/preview/exit?next=/parametres/utilisateurs/${preview.targetId}`} className="btn-secondary btn-sm">Quitter et revenir à la fiche</a>
              <a href="/api/preview/exit" className="btn-ghost btn-sm">Quitter</a>
            </span>
          </div>
        )}
        {/* Header */}
        <header className="sticky top-0 z-40 h-14 bg-bg/85 backdrop-blur border-b border-line flex items-center gap-2 px-3 sm:px-5">
          <button className="btn-ghost h-9 w-9 p-0 rounded-lg lg:hidden" onClick={() => setOpen(true)} aria-label="Menu">
            <Menu size={20} />
          </button>
          <Link href="/" className="lg:hidden font-semibold tracking-tight text-[15px] mr-1 whitespace-nowrap">COMANET OS</Link>
          <div className="flex-1" />
          {canSearch && (
            <form onSubmit={submitSearch} className="relative w-full max-w-[360px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="input h-9 pl-9 rounded-full bg-surface"
                placeholder="Rechercher…"
                aria-label="Recherche universelle"
              />
            </form>
          )}
          <Link href="/notifications" className={clsx("relative btn-ghost h-9 w-9 p-0 rounded-full", pathname === "/notifications" && "bg-black/5")} aria-label={unread ? `${unread} notification${unread > 1 ? "s" : ""} non lue${unread > 1 ? "s" : ""}` : "Notifications"} title="Notifications">
            <Bell size={18} />
            {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red text-white text-[10px] font-semibold flex items-center justify-center">{unread > 99 ? "99+" : unread}</span>}
          </Link>
        </header>

        <main className="flex-1 px-3 sm:px-5 lg:px-7 py-4 sm:py-6 pb-24 lg:pb-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>

        {/* Barre d'onglets mobile */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
            {tabs.map((t) => {
              const active = isActive(pathname, t.href, t.exact);
              return (
                <Link key={t.href} href={t.href} className={clsx("flex flex-col items-center gap-1 py-2 text-[10.5px] font-medium", active ? "text-accent" : "text-muted")}>
                  <NavIcon name={t.icon} size={20} strokeWidth={active ? 2.2 : 1.8} />
                  {t.label}
                </Link>
              );
            })}
            <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-1 py-2 text-[10.5px] font-medium text-muted">
              <Menu size={20} strokeWidth={1.8} />
              Plus
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
