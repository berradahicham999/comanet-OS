"use client";

import { useMemo, useState, useTransition } from "react";

/**
 * Rapprochement d'un inventaire : théorique figé, compté (somme des saisies), écart en quantité,
 * valeur et %, motif et commentaire (enregistrés à chaque changement). Filtres : écarts, non comptés.
 */
export type ReconcileLine = {
  id: string; product: string; ref: string | null; brand: string | null; lotNumber: string | null; expiryDate: string | null;
  theoreticalQty: string; counted: string | null; entries: number; gapQty: string | null; gapValue: string | null; gapPct: number | null;
  reasonKey: string | null; comment: string | null; addedDuringCount: boolean;
};

const n = (v: string | null) => (v === null ? null : Number(v));
const fq = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 3 }));
const fm = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function CountReconcile({ countId, lines, reasons, editable, save }: {
  countId: string;
  lines: ReconcileLine[];
  reasons: { key: string; label: string }[];
  editable: boolean;
  save: (countId: string, lineId: string, reasonKey: string | null, comment: string | null) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [filter, setFilter] = useState<"GAPS" | "UNCOUNTED" | "ALL">("GAPS");
  const [q, setQ] = useState("");
  const [state, setState] = useState<Record<string, { reasonKey: string | null; comment: string | null }>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const gaps = lines.filter((l) => l.counted !== null && n(l.gapQty) !== 0);
  const uncounted = lines.filter((l) => l.counted === null);
  const shown = useMemo(() => {
    const base = filter === "GAPS" ? gaps : filter === "UNCOUNTED" ? uncounted : lines;
    const s = q.trim().toLowerCase();
    return s ? base.filter((l) => `${l.product} ${l.ref ?? ""} ${l.brand ?? ""} ${l.lotNumber ?? ""}`.toLowerCase().includes(s)) : base;
  }, [filter, q, lines, gaps, uncounted]);

  const update = (l: ReconcileLine, patch: { reasonKey?: string | null; comment?: string | null }) => {
    const cur = { reasonKey: state[l.id]?.reasonKey ?? l.reasonKey, comment: state[l.id]?.comment ?? l.comment, ...patch };
    setState((s) => ({ ...s, [l.id]: cur }));
    start(async () => {
      const r = await save(countId, l.id, cur.reasonKey, cur.comment);
      setError(r.ok ? null : r.error ?? "Enregistrement impossible.");
    });
  };

  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        {([["GAPS", `Écarts (${gaps.length})`], ["UNCOUNTED", `Non comptés (${uncounted.length})`], ["ALL", `Toutes les lignes (${lines.length})`]] as const).map(([k, label]) => (
          <button key={k} type="button" className={`btn-sm ${filter === k ? "btn-primary" : "btn-secondary"}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
        <input className="input h-8 max-w-60 ml-auto" placeholder="Article, référence, lot…" value={q} onChange={(e) => setQ(e.target.value)} />
        {pending && <span className="text-[12px] text-faint">Enregistrement…</span>}
      </div>
      {error && <p className="text-red text-[12px]">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead><tr className="text-left text-faint border-b border-line">
            <th className="px-2 py-2 font-medium">Article</th><th className="px-2 py-2 font-medium text-right">Théorique</th><th className="px-2 py-2 font-medium text-right">Compté</th>
            <th className="px-2 py-2 font-medium text-right">Écart</th><th className="px-2 py-2 font-medium text-right">Valeur</th><th className="px-2 py-2 font-medium">Motif</th>
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={6} className="px-2 py-6 text-center text-muted">{filter === "GAPS" ? "Aucun écart sur les lignes comptées." : "Rien à afficher."}</td></tr>}
            {shown.slice(0, 400).map((l) => {
              const g = n(l.gapQty);
              const cur = state[l.id] ?? { reasonKey: l.reasonKey, comment: l.comment };
              return (
                <tr key={l.id} className="border-b border-line last:border-0 align-top">
                  <td className="px-2 py-2"><div className="font-medium">{l.product}</div>
                    <div className="text-faint text-[11px]">{[l.ref, l.brand, l.lotNumber ? `lot ${l.lotNumber}` : null, l.addedDuringCount ? "trouvé au comptage" : null].filter(Boolean).join(" · ")}</div></td>
                  <td className="px-2 py-2 text-right tabular-nums">{fq(l.theoreticalQty)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{l.counted === null ? <span className="text-orange">non compté</span> : <>{fq(l.counted)}<div className="text-[10.5px] text-faint">{l.entries} saisie{l.entries > 1 ? "s" : ""}</div></>}</td>
                  <td className={`px-2 py-2 text-right tabular-nums font-medium ${g && g < 0 ? "text-red" : g && g > 0 ? "text-green" : ""}`}>{g === null ? "—" : `${g > 0 ? "+" : ""}${fq(l.gapQty)}`}{l.gapPct !== null && g ? <div className="text-[10.5px] font-normal">{l.gapPct > 0 ? "+" : ""}{l.gapPct.toLocaleString("fr-FR")} %</div> : null}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{g ? fm(l.gapValue) : ""}</td>
                  <td className="px-2 py-2 min-w-52">
                    {g ? (editable ? (
                      <div className="space-y-1">
                        <select className="select h-8 text-[12px]" value={cur.reasonKey ?? ""} onChange={(e) => update(l, { reasonKey: e.target.value || null })}>
                          <option value="">Motif… *</option>{reasons.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                        </select>
                        <input className="input h-8 text-[12px]" placeholder="Commentaire" defaultValue={cur.comment ?? ""} onBlur={(e) => { if (e.target.value !== (cur.comment ?? "")) update(l, { comment: e.target.value || null }); }} />
                      </div>
                    ) : <span>{reasons.find((r) => r.key === l.reasonKey)?.label ?? "—"}{l.comment ? <span className="text-faint"> · {l.comment}</span> : null}</span>) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length > 400 && <p className="text-[12px] text-faint pt-2">400 premières lignes affichées : utilisez la recherche.</p>}
      </div>
    </div>
  );
}
