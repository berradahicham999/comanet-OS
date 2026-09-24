"use client";

import { useMemo, useState } from "react";
import { zipSync } from "fflate";

/**
 * Sélection multiple et export groupé des pièces (BL, factures, avoirs) : cases à cocher, « tout
 * sélectionner », puis un ZIP assemblé dans le navigateur avec le PDF figé de chaque pièce et un
 * récapitulatif CSV (lisible dans Excel). Pas de limite de taille : chaque PDF est téléchargé à part.
 */
export type ExportRow = { id: string; type: string; number: string; date: string; client: string; ice: string | null; netHt: string; vatTotal: string; ttc: string };

const TYPE_LABEL: Record<string, string> = { BL: "BL", FACTURE: "Facture", AVOIR: "Avoir" };
const fr = (v: string) => Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const frCsv = (v: string, sign = 1) => (sign * Number(v)).toFixed(2).replace(".", ",");

export function PieceExporter({ rows, fileLabel }: { rows: ExportRow[]; fileLabel: string }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.map((r) => r.id)));
  const [q, setQ] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.number} ${r.client}`.toLowerCase().includes(s)) : rows;
  }, [rows, q]);
  const picked = rows.filter((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allShown = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const setShown = (on: boolean) => setSelected((cur) => { const n = new Set(cur); for (const r of shown) { if (on) n.add(r.id); else n.delete(r.id); } return n; });
  const total = (type: string) => picked.filter((r) => r.type === type).reduce((s, r) => s + Number(r.ttc), 0);

  const download = async () => {
    if (!picked.length) return;
    setBusy(true);
    try {
      const files: Record<string, [Uint8Array, { level: 0 }]> = {};
      let i = 0;
      for (const r of picked) {
        i++;
        setProgress(`PDF ${i} / ${picked.length} : ${r.number}`);
        const res = await fetch(`/gestion/pieces/${r.id}/pdf?download=1`);
        if (!res.ok) throw new Error(`${r.number} : PDF indisponible (${res.status}).`);
        files[`${r.number}.pdf`] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }];
      }
      // Récapitulatif : séparateur « ; » et virgule décimale (Excel en français) ; un avoir est négatif.
      const lines = [["Type", "N° pièce", "Date", "Client", "ICE", "Total HT", "Total TVA", "Total TTC"].join(";"),
        ...picked.map((r) => { const s = r.type === "AVOIR" ? -1 : 1; return [TYPE_LABEL[r.type] ?? r.type, r.number, r.date.split("-").reverse().join("/"), `"${r.client.replace(/"/g, '""')}"`, r.ice ?? "", frCsv(r.netHt, s), frCsv(r.vatTotal, s), frCsv(r.ttc, s)].join(";"); })];
      files["recapitulatif.csv"] = [new TextEncoder().encode("﻿" + lines.join("\r\n")), { level: 0 }];
      setProgress("Création du ZIP…");
      const zip = zipSync(files);
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url; a.download = `pieces-${fileLabel}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setProgress(`${picked.length} pièce(s) exportée(s).`);
    } catch (e) {
      setProgress((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 text-[13px]">
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <span className="font-medium">{picked.length} / {rows.length} sélectionnée(s)</span>
        <span className="text-muted">Factures {fr(String(total("FACTURE")))} · Avoirs {fr(String(total("AVOIR")))} · BL {fr(String(total("BL")))} MAD TTC</span>
        <button type="button" className="btn-primary btn-sm ml-auto" disabled={busy || !picked.length} onClick={download}>{busy ? "Export en cours…" : "Télécharger la sélection (ZIP)"}</button>
        {progress && <span className="w-full text-[12px] text-muted">{progress}</span>}
      </div>
      <div className="card p-0">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-line">
          <label className="flex items-center gap-2"><input type="checkbox" checked={allShown} onChange={(e) => setShown(e.target.checked)} /> Tout {q ? "(filtré)" : ""}</label>
          <input className="input h-8 max-w-64 ml-auto" placeholder="N°, client…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="divide-y divide-line max-h-[60vh] overflow-auto">
          {shown.map((r) => (
            <li key={r.id} className="px-4 py-2 flex items-center gap-3">
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Sélectionner ${r.number}`} />
              <span className="w-16 text-[11.5px] text-muted">{TYPE_LABEL[r.type] ?? r.type}</span>
              <a href={`/gestion/pieces/${r.id}/pdf`} target="_blank" className="font-mono hover:underline">{r.number}</a>
              <span className="text-muted">{r.date.split("-").reverse().join("/")}</span>
              <span className="truncate flex-1">{r.client}</span>
              <span className="tabular-nums">{fr(r.ttc)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
