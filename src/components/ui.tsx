import Link from "next/link";
import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { fmtPct } from "@/lib/format";

/* ------------------------------ Page header ------------------------------ */

export function PageHeader({ title, subtitle, eyebrow, actions, children }: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 sm:mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="label mb-1">{eyebrow}</div>}
          <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-tight leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-1 max-w-2xl">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Section({ title, description, action, children, className }: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("mb-6", className)}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-3 mb-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
            {description && <p className="text-[13px] text-muted mt-0.5">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/* ---------------------------------- Card --------------------------------- */

export function Card({ children, className, title, action, href, pad = true }: {
  children: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
  action?: React.ReactNode;
  href?: string;
  pad?: boolean;
}) {
  const inner = (
    <>
      {(title || action) && (
        <div className={clsx("flex items-center justify-between gap-2", pad ? "mb-3" : "px-4 pt-4 mb-2")}>
          {title && <div className="label">{title}</div>}
          {action}
        </div>
      )}
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={clsx("card block hover:border-line-2 transition-colors", pad && "card-pad", className)}>
        {inner}
      </Link>
    );
  }
  return <div className={clsx("card", pad && "card-pad", className)}>{inner}</div>;
}

/* ---------------------------------- KPI ---------------------------------- */

export function Delta({ value, suffix = "", invert = false, size = "sm" }: { value: number | null | undefined; suffix?: string; invert?: boolean; size?: "sm" | "xs" }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={clsx("inline-flex items-center gap-0.5 text-faint", size === "xs" ? "text-[11px]" : "text-[12px]")}><Minus size={12} />n/a</span>;
  }
  const good = invert ? value < 0 : value > 0;
  const neutral = Math.abs(value) < 0.5;
  const color = neutral ? "text-muted" : good ? "text-green" : "text-red";
  const Icon = neutral ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const text = Math.abs(value) > 999 ? (value > 0 ? "> +999 %" : "< -999 %") : fmtPct(value, 0, true);
  return (
    <span className={clsx("inline-flex items-center gap-0.5 font-medium tabular-nums", color, size === "xs" ? "text-[11px]" : "text-[12px]")}>
      <Icon size={size === "xs" ? 12 : 14} />
      {text}{suffix}
    </span>
  );
}

export function Kpi({ label, value, sub, delta, deltaLabel, invert, tone, href, className }: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  invert?: boolean;
  tone?: "red" | "orange" | "yellow" | "green" | "blue" | "accent";
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="label">{label}</div>
      <div className={clsx("kpi mt-2", tone && `text-${tone}`)}>{value}</div>
      {(sub || delta !== undefined) && (
        <div className="mt-1.5 flex items-center gap-2 text-[12px] text-muted">
          {delta !== undefined && <Delta value={delta} invert={invert} />}
          {deltaLabel && delta !== undefined && <span className="text-faint">{deltaLabel}</span>}
          {sub}
        </div>
      )}
    </>
  );
  return <Card href={href} className={className}>{body}</Card>;
}

/* --------------------------------- Badge --------------------------------- */

export type Tone = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray" | "accent";

const TONES: Record<Tone, string> = {
  red: "bg-red-soft text-red",
  orange: "bg-orange-soft text-orange",
  yellow: "bg-yellow-soft text-yellow",
  green: "bg-green-soft text-green",
  blue: "bg-blue-soft text-blue",
  purple: "bg-purple-soft text-purple",
  gray: "bg-black/5 text-ink-2",
  accent: "bg-accent-soft text-accent-2",
};

export function Badge({ tone = "gray", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={clsx("badge", TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function BrandDot({ color, className }: { color: string; className?: string }) {
  return <span className={clsx("inline-block h-2.5 w-2.5 rounded-full shrink-0", className)} style={{ background: color }} />;
}

/* ------------------------------- Progress -------------------------------- */

export function Progress({ value, tone = "accent", className }: { value: number; tone?: Tone; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const colors: Record<Tone, string> = { red: "bg-red", orange: "bg-orange", yellow: "bg-yellow", green: "bg-green", blue: "bg-blue", purple: "bg-purple", gray: "bg-faint", accent: "bg-accent" };
  return (
    <div className={clsx("h-1.5 w-full rounded-full bg-black/6 overflow-hidden", className)}>
      <div className={clsx("h-full rounded-full transition-all", colors[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* -------------------------------- Empty ---------------------------------- */

export function Empty({ title, hint, action, icon }: { title: string; hint?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="card card-pad text-center py-10">
      {icon && <div className="mx-auto mb-3 h-10 w-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center">{icon}</div>}
      <div className="font-medium">{title}</div>
      {hint && <div className="text-sm text-muted mt-1 max-w-md mx-auto">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* --------------------------------- Tabs ---------------------------------- */

export function Tabs({ tabs, current }: { tabs: { href: string; label: string; count?: number }[]; current: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1">
      {tabs.map((t) => {
        const active = t.href === current;
        return (
          <Link key={t.href} href={t.href} className={clsx("shrink-0 rounded-full px-3.5 h-8 inline-flex items-center gap-1.5 text-[13px] font-medium border transition-colors", active ? "bg-ink text-white border-ink" : "bg-surface border-line-2 text-ink-2 hover:bg-surface-2")}>
            {t.label}
            {t.count !== undefined && <span className={clsx("text-[11px] rounded-full px-1.5", active ? "bg-white/20" : "bg-black/6")}>{t.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}

/* ------------------------------ Definition list -------------------------- */

export function Facts({ items, cols = 2 }: { items: { label: React.ReactNode; value: React.ReactNode }[]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={clsx("grid gap-x-4 gap-y-3", cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4")}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="label">{it.label}</dt>
          <dd className="text-[14px] font-medium mt-0.5 truncate">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PriorityBadge({ priority }: { priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" }) {
  const map = { LOW: ["gray", "Basse"], MEDIUM: ["blue", "Moyenne"], HIGH: ["orange", "Haute"], CRITICAL: ["red", "Critique"] } as const;
  const [tone, label] = map[priority];
  return <Badge tone={tone}>{label}</Badge>;
}

export function StatusBadge({ status }: { status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED" }) {
  const map = { TODO: ["gray", "À faire"], IN_PROGRESS: ["blue", "En cours"], DONE: ["green", "Terminée"], CANCELLED: ["gray", "Annulée"] } as const;
  const [tone, label] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}
