"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";

/**
 * PÉRIODE D'UNE ANIMATION — « Du … au … » + jours animés.
 *
 * Une animatrice reste souvent plusieurs jours d'affilée dans le même point de vente et ne
 * relève les ventes que le dernier jour. Elle saisit donc une période : la date de fin (`date`,
 * le jour du relevé) et la date de début (`startDate`). Le nombre de jours (`days`) suit la
 * période ; −/+ retire un jour de repos au milieu. Validation définitive côté serveur
 * (`parseAnimationInput()`).
 */

const MAX_SPAN = 31;

function span(start: string, end: string): number {
  if (!start || !end) return 1;
  const n = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1;
  return Number.isFinite(n) ? n : 1;
}

export function AnimationPeriodFields({ initialStart, initialEnd, initialDays, size = "md" }: {
  initialStart?: string | null;
  initialEnd: string;
  initialDays?: number;
  /** `lg` : saisie rapide sur téléphone. */
  size?: "md" | "lg";
}) {
  const [end, setEnd] = useState(initialEnd);
  const [start, setStart] = useState(initialStart || initialEnd);
  const total = span(start, end);
  const valid = total >= 1 && total <= MAX_SPAN;
  const [days, setDays] = useState(Math.min(Math.max(1, initialDays ?? total), Math.max(1, total)));
  // La période change → les jours la suivent ; un jour retiré à la main reste retiré tant qu'il tient dedans.
  const [lastTotal, setLastTotal] = useState(total);
  if (total !== lastTotal) {
    setLastTotal(total);
    setDays(valid ? (days === lastTotal ? total : Math.min(days, total)) : 1);
  }

  const h = size === "lg" ? "h-12 text-[15px]" : "h-11";

  function changeEnd(v: string) {
    setEnd(v);
    // Fin avant le début : on ramène le début sur la fin plutôt que de laisser une période impossible.
    if (v && start && v < start) setStart(v);
  }

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[13px]">
          <span className="label block mb-1">Du</span>
          <input type="date" name="startDate" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} className={`input ${h}`} required />
        </label>
        <label className="block text-[13px]">
          <span className="label block mb-1">Au (relevé des ventes)</span>
          <input type="date" name="date" value={end} onChange={(e) => changeEnd(e.target.value)} className={`input ${h}`} required />
        </label>
      </div>
      <input type="hidden" name="days" value={days} />
      {!valid ? (
        <div className="text-[12px] text-red">La date de début doit précéder la date de fin, sur {MAX_SPAN} jours au plus.</div>
      ) : (
        <div className="flex items-center justify-between gap-2 text-[13px]">
          <span className="text-muted">
            {total === 1 ? "Animation d'une journée" : days === total ? `${total} jours d'affilée` : `${days} jours animés sur ${total}`}
          </span>
          {total > 1 && (
            <span className="flex items-center gap-1.5">
              <button type="button" onClick={() => setDays((d) => Math.max(1, d - 1))} disabled={days <= 1} className="btn-ghost h-9 w-9 p-0 rounded-lg border border-line" aria-label="Un jour de moins">
                <Minus size={14} />
              </button>
              <span className="w-12 text-center font-medium">{days} j</span>
              <button type="button" onClick={() => setDays((d) => Math.min(total, d + 1))} disabled={days >= total} className="btn-ghost h-9 w-9 p-0 rounded-lg border border-line" aria-label="Un jour de plus">
                <Plus size={14} />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
