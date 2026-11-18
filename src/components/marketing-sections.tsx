import Link from "next/link";
import clsx from "clsx";
import { getAccess, can } from "@/lib/permissions";
import type { ModuleKey } from "@/lib/access-shared";

/**
 * Onglets des deux entrées du menu Marketing qui regroupent plusieurs pages (décision d'Hicham, 18/11/2026) :
 *  - « Opérations » : opérations (table `activations`), campagnes, influence, goodies et matériel ;
 *  - « Plan & budget » : plan marketing, budget et dépenses, résultats (plan vs réel, revue par marque).
 * Chaque onglet n'apparaît que pour qui peut voir sa page.
 */
type SectionTab = { href: string; label: string; module: ModuleKey | ModuleKey[]; /** Libellé court sur téléphone (390 px). */ short?: string };

export const OPERATIONS_TABS: SectionTab[] = [
  { href: "/marketing/activations", label: "Opérations", module: ["marketing", "clients"] },
  { href: "/marketing/campagnes", label: "Campagnes", module: "marketing" },
  { href: "/marketing/influence", label: "Influence", module: "influence" },
  { href: "/marketing/materiel", label: "Goodies & matériel", short: "Goodies", module: ["marketing", "clients"] },
];

export const PLAN_TABS: SectionTab[] = [
  { href: "/marketing/plan", label: "Plan marketing", short: "Plan", module: "marketing" },
  { href: "/marketing/budgets", label: "Budget & dépenses", short: "Budget", module: "budgets" },
  { href: "/marketing/analytics/plan", label: "Résultats", module: "marketing" },
];

const SECTIONS = { operations: OPERATIONS_TABS, plan: PLAN_TABS } as const;

export async function MarketingSectionTabs({ section, current }: { section: keyof typeof SECTIONS; current: string }) {
  const a = await getAccess();
  const tabs = SECTIONS[section].filter((t) => !!a && (Array.isArray(t.module) ? t.module : [t.module]).some((m) => can(a.perms, m, "view")));
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={section === "operations" ? "Opérations" : "Plan & budget"} className="-mx-1 px-1 mb-4 flex gap-3 sm:gap-4 overflow-x-auto [scrollbar-width:none] border-b border-line">
      {tabs.map((t) => {
        const active = current === t.href || current.startsWith(t.href + "/");
        return (
          <Link key={t.href} href={t.href} className={clsx("shrink-0 -mb-px h-10 inline-flex items-center border-b-2 text-[13.5px] font-medium transition-colors", active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink-2")}>
            {t.short ? <><span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span></> : t.label}
          </Link>
        );
      })}
    </nav>
  );
}
