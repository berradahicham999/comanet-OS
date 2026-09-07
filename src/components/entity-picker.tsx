"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";

export type PickerOption = { id: string; label: string; hint?: string | null; group?: string | null };

/**
 * Sélecteur multiple avec recherche (clients, produits, contributeurs). Les valeurs choisies
 * sont émises comme champs cachés `name` (un par valeur) : le formulaire serveur les lit
 * avec `formData.getAll(name)`. Sans JavaScript, rien n'est cassé : la liste initiale reste.
 */
export function EntityPicker({ name, options, initial = [], placeholder = "Rechercher…", max, onChange, single = false }: {
  name: string; options: PickerOption[]; initial?: string[]; placeholder?: string; max?: number;
  onChange?: (ids: string[]) => void; single?: boolean;
}) {
  const [ids, setIds] = useState<string[]>(initial);
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hits = useMemo(() => {
    const k = norm(q.trim());
    if (!k) return [];
    return options.filter((o) => !ids.includes(o.id) && (norm(o.label).includes(k) || (o.hint && norm(o.hint).includes(k)))).slice(0, 12);
  }, [q, options, ids]);
  function set(next: string[]) { setIds(next); onChange?.(next); }
  function add(id: string) {
    if (single) { set([id]); setQ(""); return; }
    if (max && ids.length >= max) return;
    set([...ids, id]); setQ("");
  }
  return (
    <div className="space-y-1.5">
      {ids.map((id) => <input key={id} type="hidden" name={name} value={id} />)}
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ids.map((id) => {
            const o = byId.get(id);
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent-2 px-2 h-7 text-[12px]">
                {o?.label ?? id}{o?.hint ? <span className="text-accent-2/70">· {o.hint}</span> : null}
                <button type="button" onClick={() => set(ids.filter((x) => x !== id))} className="hover:text-red" aria-label="Retirer"><X size={12} /></button>
              </span>
            );
          })}
        </div>
      )}
      {(!single || ids.length === 0) && (!max || ids.length < max) && (
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} className="input h-9" placeholder={placeholder}
            onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { e.preventDefault(); add(hits[0].id); } if (e.key === "Escape") setQ(""); }} />
          {hits.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-line bg-surface shadow-lg text-[13px]">
              {hits.map((o) => (
                <li key={o.id}><button type="button" onClick={() => add(o.id)} className="w-full text-left px-3 py-2 hover:bg-surface-2 flex items-center justify-between gap-2">
                  <span className="truncate">{o.label}</span>{o.hint && <span className="text-muted text-[11.5px] shrink-0">{o.hint}</span>}
                </button></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
