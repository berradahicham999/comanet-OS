"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LogOut } from "lucide-react";
import type { NavGroup } from "@/components/nav-config";
import { NavIcon } from "./nav-icons";
import { initials } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/access-shared";
import type { SessionUser } from "@/lib/auth";

export function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact || href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({ groups, user, logout, onNavigate }: {
  groups: NavGroup[];
  user: SessionUser;
  logout: () => Promise<void>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 px-4 h-14 shrink-0">
        <div className="h-8 w-8 rounded-lg bg-accent text-white flex items-center justify-center font-bold">C</div>
        <div className="leading-tight">
          <div className="font-semibold tracking-tight text-[15px]">COMANET OS</div>
          <div className="text-[10.5px] text-muted uppercase tracking-[0.08em]">Intelligence platform</div>
        </div>
      </Link>
      <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-4">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="label px-3 mb-1">{g.title}</div>
            <div className="space-y-0.5">
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
          </div>
        ))}
      </nav>
      <div className="border-t border-line p-3 flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-full bg-accent-soft text-accent-2 text-xs font-semibold flex items-center justify-center shrink-0">
          {initials(user.name)}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[13px] font-medium truncate">{user.name}</div>
          <div className="text-[11px] text-muted truncate">{ROLE_LABELS[user.role]}</div>
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
