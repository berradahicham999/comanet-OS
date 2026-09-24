"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Search } from "lucide-react";

/**
 * Tableau « intelligent » réutilisable : recherche, filtres, tri par colonne, affichage progressif,
 * et vue en cartes sur mobile. Les cellules arrivent déjà rendues par la page serveur (aucun
 * calcul ici) ; chaque ligne fournit ses clés de tri, son texte de recherche et ses filtres.
 */

export type DataColumn = {
  key: string;
  label: string;
  num?: boolean;
  /** Colonne triable (vrai par défaut dès qu'une ligne fournit une clé de tri pour elle). */
  sortable?: boolean;
  /** Masquée dans la vue en cartes (mobile). */
  hideOnMobile?: boolean;
  className?: string;
};

export type DataRow = {
  id: string;
  href?: string;
  cells: Record<string, React.ReactNode>;
  sort?: Record<string, string | number | null>;
  search?: string;
  /** Valeur(s) de la ligne pour chaque filtre : une liste correspond si elle contient la valeur choisie. */
  filters?: Record<string, string | string[]>;
  /** Ligne atténuée (archivée, inactive). */
  muted?: boolean;
};

export type DataFilter = { key: string; label: string; options: { value: string; label: string }[] };

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function DataTable({
  columns, rows, filters = [], searchPlaceholder = "Rechercher…", empty = "Aucune ligne.", initialSort, pageSize = 50, primary,
}: {
  columns: DataColumn[];
  rows: DataRow[];
  filters?: DataFilter[];
  searchPlaceholder?: string;
  empty?: React.ReactNode;
  initialSort?: { key: string; dir: "asc" | "desc" };
  pageSize?: number;
  /** Colonne affichée en titre de carte sur mobile (première colonne par défaut). */
  primary?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Record<string, string>>({});
  const [sort, setSort] = useState(initialSort ?? null);
  const [limit, setLimit] = useState(pageSize);

  const visible = useMemo(() => {
    const needle = norm(q.trim());
    let out = rows.filter((r) => {
      if (needle && !norm(r.search ?? "").includes(needle)) return false;
      for (const [k, v] of Object.entries(active)) {
        if (!v) continue;
        const own = r.filters?.[k];
        if (Array.isArray(own) ? !own.includes(v) : own !== v) return false;
      }
      return true;
    });
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const x = a.sort?.[sort.key] ?? null;
        const y = b.sort?.[sort.key] ?? null;
        if (x === y) return 0;
        if (x === null) return 1; // les valeurs manquantes toujours en bas
        if (y === null) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "fr")) * dir;
      });
    }
    return out;
  }, [rows, q, active, sort]);

  const canSort = (c: DataColumn) => c.sortable !== false && rows.some((r) => r.sort && c.key in r.sort);
  const toggle = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const primaryKey = primary ?? columns[0]?.key;
  const shown = visible.slice(0, limit);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(pageSize); }} placeholder={searchPlaceholder} className="input h-9 pl-8" />
        </label>
        {filters.map((f) => (
          <select key={f.key} value={active[f.key] ?? ""} onChange={(e) => { setActive((a) => ({ ...a, [f.key]: e.target.value })); setLimit(pageSize); }} className="select h-9 w-auto" aria-label={f.label}>
            <option value="">{f.label} : tous</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        <span className="text-[12px] text-muted ml-auto">{visible.length} / {rows.length}</span>
      </div>

      {visible.length === 0 ? (
        <div className="card card-pad text-sm text-muted text-center">{empty}</div>
      ) : (
        <>
          {/* Bureau : tableau */}
          <div className="table-wrap hidden md:block">
            <table className="tbl">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className={clsx(c.num && "num", c.className)}>
                      {canSort(c) ? (
                        <button type="button" onClick={() => toggle(c.key)} className={clsx("inline-flex items-center gap-1 uppercase", sort?.key === c.key && "text-ink")}>
                          {c.label}
                          {sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={clsx(r.href && "row-link", r.muted && "opacity-60")} onClick={r.href ? (e) => { if (!(e.target as HTMLElement).closest("a,button,input,select,form")) router.push(r.href!); } : undefined}>
                    {columns.map((c) => <td key={c.key} className={clsx(c.num && "num", c.className)}>{r.cells[c.key] ?? "—"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile : cartes */}
          <div className="md:hidden space-y-2">
            {shown.map((r) => {
              const body = (
                <>
                  <div className="font-medium mb-1.5">{r.cells[primaryKey] ?? "—"}</div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
                    {columns.filter((c) => c.key !== primaryKey && !c.hideOnMobile).map((c) => (
                      <div key={c.key} className="min-w-0"><dt className="text-[10.5px] uppercase tracking-wide text-faint">{c.label}</dt><dd className="truncate">{r.cells[c.key] ?? "—"}</dd></div>
                    ))}
                  </dl>
                </>
              );
              // Une carte n'est jamais un lien englobant : ses cellules contiennent souvent leurs propres liens.
              return (
                <div key={r.id} className={clsx("card px-4 py-3", r.href && "cursor-pointer", r.muted && "opacity-60")}
                  onClick={r.href ? (e) => { if (!(e.target as HTMLElement).closest("a,button,input,select,form")) router.push(r.href!); } : undefined}>
                  {body}
                </div>
              );
            })}
          </div>

          {visible.length > limit && (
            <button type="button" onClick={() => setLimit((l) => l + pageSize)} className="btn-secondary btn-sm mt-3 w-full">
              Afficher {Math.min(pageSize, visible.length - limit)} de plus ({visible.length - limit} restantes)
            </button>
          )}
        </>
      )}
    </div>
  );
}
