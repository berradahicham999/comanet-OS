"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LogOut, ChevronDown } from "lucide-react";
import type { NavGroup } from "@/components/nav-config";
import { NavIcon } from "./nav-icons";
import { initials } from "@/lib/format";
import type { SessionUser } from "@/lib/auth";

export function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact || href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

const COLLAPSE_KEY = "comanet-nav-collapsed";

function groupIsActive(g: NavGroup, pathname: string) {
  return g.items.some((it) => isActive(pathname, it.href, it.exact));
}

export function Sidebar({ groups, user, logout, onNavigate }: {
  groups: NavGroup[];
  user: SessionUser;
  logout: () => Promise<void>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed(JSON.parse(raw));
    } catch {
      // localStorage indisponible : catégories toutes dépliées par défaut
    }
  }, []);

  function toggle(title: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [title]: !prev[title] };
      try {
        window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        // ignoré si le stockage local est bloqué
      }
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 px-4 h-14 shrink-0">
        <div className="h-8 w-8 rounded-lg bg-accent text-white flex items-center justify-center font-bold">C</div>
        <div className="leading-tight">
          <div className="font-semibold tracking-tight text-[15px]">COMANET OS</div>
          <div className="text-[10.5px] text-muted uppercase tracking-[0.08em]">Intelligence platform</div>
        </div>
      </Link>
      <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
        {groups.map((g) => {
          // Une catégorie contenant la page active reste dépliée même si elle a été repliée
          const open = !collapsed[g.title] || groupIsActive(g, pathname);
          return (
            <div key={g.title} className="py-1">
              <button
                type="button"
                onClick={() => toggle(g.title)}
                aria-expanded={open}
                className="w-full flex items-center justify-between px-3 py-1 rounded-md hover:bg-black/5 transition-colors"
              >
                <span className="label">{g.title}</span>
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  className={clsx("text-muted transition-transform", open ? "rotate-0" : "-rotate-90")}
                />
              </button>
              {open && (
                <div className="space-y-0.5 mt-1">
                  {g.items.map((it) => {
                    // Un item plus spécifique (ex: /marketing/planning) ne doit pas activer /marketing
                    const moreSpecific = g.items.some((o) => o.href !== it.href && o.href.startsWith(it.href + "/") && isActive(pathname, o.href));
                    const active = isActive(pathname, it.href, it.exact) && !moreSpecific;
                    return (
                      <Link key={it.href} href={it.href} onClick={onNavigate} className={clsx("nav-item", active && "nav-item-active")}>
                        <NavIcon name={it.icon} size={17} strokeWidth={1.9} className={active ? "text-accent" : "text-muted"} />
                        {it.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-line p-3 flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-full bg-accent-soft text-accent-2 text-xs font-semibold flex items-center justify-center shrink-0">
          {initials(user.name)}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[13px] font-medium truncate">{user.name}</div>
          <div className="text-[11px] text-muted truncate">{user.email}</div>
        </div>
        <form action={logout}>
          <button className="btn-ghost h-8 w-8 p-0 rounded-lg" title="Se déconnecter" aria-label="Se déconnecter">
            <LogOut size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
