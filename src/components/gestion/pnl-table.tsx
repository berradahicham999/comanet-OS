"use client";

import { useState } from "react";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { fmtMAD } from "@/lib/format";
import { MONTHS_SHORT, type PnlLine } from "@/lib/pnl-shared";

/** Tableau du compte de résultat : mois en colonnes, familles repliables, cumul, % du CA et N-1. */
export function PnlTable({ lines, lastMonth, previous, revenueTotal }: {
  lines: PnlLine[];
  lastMonth: number;
  /** Cumul N-1 sur la même période, par clé de ligne ; absent = non comparable. */
  previous: Record<string, number | undefined>;
  revenueTotal: number;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const parents = new Set(lines.filter((l) => l.parent).map((l) => l.parent!));
  const allOpen = parents.size > 0 && [...parents].every((p) => open.has(p));
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const months = MONTHS_SHORT.slice(0, lastMonth);

  const money = (v: number) => (Math.abs(v) < 0.5 ? "—" : fmtMAD(v, { suffix: false }));
  const pct = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
  const cell = (l: PnlLine, v: number) => (l.pct ? (v ? pct(v) : "—") : money(v));
  const tone = (l: PnlLine, v: number) => ((l.kind === "subtotal" || l.kind === "total") && v < -0.5 ? "text-red" : undefined);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="label">Compte de résultat (MAD HT)</div>
        {parents.size > 0 && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(allOpen ? new Set() : new Set(parents))}>
            {allOpen ? "Tout replier" : "Tout déplier"}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] tabular-nums border-collapse">
          <thead>
            <tr className="text-faint text-[11px] uppercase tracking-wide">
              <th className="sticky left-0 z-10 bg-surface text-left font-medium px-4 py-2 min-w-[230px]">Poste</th>
              {months.map((m) => <th key={m} className="text-right font-medium px-2 py-2 whitespace-nowrap">{m}</th>)}
              <th className="text-right font-semibold px-3 py-2 bg-surface-2 whitespace-nowrap">Cumul</th>
              <th className="text-right font-medium px-2 py-2 whitespace-nowrap">% CA</th>
              <th className="text-right font-medium px-3 py-2 whitespace-nowrap">N-1</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              if (l.depth === 1 && l.parent && !open.has(l.parent)) return null;
              const hasKids = parents.has(l.key);
              const strong = l.kind === "subtotal" || l.kind === "total" || l.key === "ca";
              const prev = previous[l.key];
              return (
                <tr key={l.key} className={clsx("border-t border-line", l.kind === "total" && "bg-surface-2 border-t-2 border-line-2", l.kind === "subtotal" && "bg-surface-2/60", l.key === "revente_distributeur" && "text-faint italic")}>
                  <td className={clsx("sticky left-0 z-10 px-4 py-2", l.kind === "total" || l.kind === "subtotal" ? "bg-surface-2" : "bg-surface", l.depth === 1 && "pl-9 text-muted")}>
                    {hasKids ? (
                      <button type="button" onClick={() => toggle(l.key)} className={clsx("inline-flex items-center gap-1 text-left", strong && "font-semibold")}>
                        <ChevronRight className={clsx("h-3.5 w-3.5 shrink-0 transition-transform", open.has(l.key) && "rotate-90")} />
                        {l.label}
                      </button>
                    ) : (
                      <span className={clsx(strong && "font-semibold", !hasKids && l.depth === 0 && "pl-[18px]")}>{l.label}</span>
                    )}
                  </td>
                  {l.months.slice(0, lastMonth).map((v, i) => (
                    <td key={i} className={clsx("text-right px-2 py-2 whitespace-nowrap", strong && "font-medium", tone(l, v))}>{cell(l, v)}</td>
                  ))}
                  <td className={clsx("text-right px-3 py-2 bg-surface-2 whitespace-nowrap font-semibold", tone(l, l.total))}>{cell(l, l.total)}</td>
                  <td className="text-right px-2 py-2 text-muted whitespace-nowrap">{l.pct || l.key === "revente_distributeur" || !revenueTotal ? "" : pct((l.total / revenueTotal) * 100)}</td>
                  <td className="text-right px-3 py-2 text-muted whitespace-nowrap">{prev === undefined ? "—" : cell(l, prev)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
