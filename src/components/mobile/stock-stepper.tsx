"use client";

import { Minus, Plus } from "lucide-react";

/**
 * Saisie rapide d'un stock en rayon au pouce : − / + autour du champ, sans ouvrir le clavier.
 * `value` reste une chaîne : "" = pas compté (rien n'est envoyé), "0" = compté, rupture.
 * Depuis "pas compté", le premier appui part du dernier relevé quand il existe (le cas courant : le rayon a peu bougé),
 * sinon de 0. Le bouton « = n » recopie le dernier relevé en un appui.
 */
export function StockStepper({ value, onChange, last, label, size = "md" }: {
  value: string;
  onChange: (v: string) => void;
  last?: number | null;
  label: string;
  size?: "md" | "sm";
}) {
  const h = size === "sm" ? "h-11" : "h-12";
  const w = size === "sm" ? "w-11" : "w-12";
  const base = value === "" ? (last ?? 0) : Number(value);
  const minus = () => onChange(String(value === "" && last == null ? 0 : Math.max(0, base - 1)));
  const plus = () => onChange(String(base + 1));

  return (
    <div className="flex items-center gap-1 shrink-0">
      {value === "" && last != null && (
        <button type="button" onClick={() => onChange(String(last))} className={`${h} min-w-11 px-2 rounded-xl border border-line bg-surface text-[13px] font-medium text-muted`} aria-label={`Même stock que le dernier relevé (${last}) — ${label}`}>
          = {last}
        </button>
      )}
      <button type="button" onClick={minus} className={`${h} ${w} rounded-xl border border-line bg-surface flex items-center justify-center text-ink`} aria-label={`Une unité de moins en rayon — ${label}`}>
        <Minus size={17} />
      </button>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        inputMode="numeric" pattern="[0-9]*" placeholder="—"
        aria-label={`Stock en rayon — ${label}`}
        className={`input ${h} w-12 px-1 text-center text-[16px] font-semibold ${value === "0" ? "text-red" : ""}`}
      />
      <button type="button" onClick={plus} className={`${h} ${w} rounded-xl bg-accent text-white flex items-center justify-center`} aria-label={`Une unité de plus en rayon — ${label}`}>
        <Plus size={17} />
      </button>
    </div>
  );
}
