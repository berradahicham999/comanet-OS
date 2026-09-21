"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Minus, Plus, Search } from "lucide-react";
import { normKey } from "@/lib/import/normalize";

/**
 * MODE RELEVÉ — commercial en tournée, sur téléphone.
 *
 * Chaque ligne montre le dernier stock connu (et sa date) et un champ pré-rempli avec ce
 * dernier relevé : le commercial ne touche que ce qui a changé. Un seul bouton écrit une
 * ligne par produit MODIFIÉ ; l'option « relevé complet » écrit tous les produits affichés
 * (utile pour figer une photo complète du rayon). Les champs envoyés (`product_i`, `qty_i`,
 * `full`) sont lus par `recordClientStock()` côté serveur, qui délègue à `recordReadings()` :
 * ce composant ne contient aucune règle métier.
 */

export type ReadingProduct = {
  id: string;
  name: string;
  sku: string | null;
  brandId: string | null;
  brandName: string | null;
  last: { quantity: number; readAt: string } | null;
};

const shortDate = (isoDate: string) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;

export function StockReadingForm({
  clientId, clientName, products, brands, action, cancelHref,
}: {
  clientId: string;
  clientName: string;
  products: ReadingProduct[];
  brands: { id: string; name: string }[];
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
}) {
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState<string>("");
  const [full, setFull] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const p of products) v[p.id] = p.last ? String(p.last.quantity) : "";
    return v;
  });
  const [changed, setChanged] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const q = normKey(query);
    return products.filter((p) => (!brand || p.brandId === brand) && (!q || normKey(p.name).includes(q) || normKey(p.sku ?? "").includes(q)));
  }, [products, query, brand]);

  function setValue(id: string, next: string) {
    setValues((v) => ({ ...v, [id]: next }));
    setChanged((c) => { const n = new Set(c); n.add(id); return n; });
  }
  function bump(id: string, d: number) {
    const cur = Number((values[id] ?? "").replace(",", "."));
    const base = Number.isFinite(cur) && values[id] !== "" ? cur : 0;
    setValue(id, String(Math.max(0, base + d)));
  }

  /** Lignes réellement envoyées : modifiées, ou toutes celles affichées et renseignées en relevé complet. */
  const toSend = full
    ? visible.filter((p) => (values[p.id] ?? "") !== "")
    : products.filter((p) => changed.has(p.id) && (values[p.id] ?? "") !== "");

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      {full && <input type="hidden" name="full" value="1" />}
      {toSend.map((p, i) => (
        <span key={p.id}>
          <input type="hidden" name={`product_${i}`} value={p.id} />
          <input type="hidden" name={`qty_${i}`} value={values[p.id] ?? ""} />
        </span>
      ))}

      <div className="text-[13px] text-muted">Relevé chez <span className="font-medium text-ink">{clientName}</span>, daté d&apos;aujourd&apos;hui. Ne corrigez que ce qui a changé.</div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Produit ou référence…" className="input h-12 pl-9 text-[15px]" />
        </div>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} className="select h-12 w-[42%] text-[14px]" aria-label="Marque">
          <option value="">Toutes marques</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
        Relevé complet : enregistrer tous les produits affichés ({visible.filter((p) => (values[p.id] ?? "") !== "").length}), pas seulement ceux modifiés
      </label>

      <div className="divide-y divide-line rounded-2xl border border-line overflow-hidden">
        {visible.length === 0 && <div className="px-3 py-4 text-[13px] text-muted">Aucun produit ne correspond.</div>}
        {visible.map((p) => {
          const isChanged = changed.has(p.id);
          return (
            <div key={p.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 ${isChanged ? "bg-accent-soft/40" : ""}`}>
              <div className="min-w-0">
                <div className="text-[14px] font-medium truncate">{p.name}</div>
                <div className="text-[11px] text-faint truncate">
                  {p.brandName ? `${p.brandName} · ` : ""}
                  {p.last ? `dernier relevé ${p.last.quantity} u. le ${shortDate(p.last.readAt)}` : "jamais relevé"}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => bump(p.id, -1)} className="btn-secondary h-12 w-12 p-0 rounded-xl" aria-label={`Moins — ${p.name}`}><Minus size={18} /></button>
                <input
                  value={values[p.id] ?? ""}
                  onChange={(e) => setValue(p.id, e.target.value)}
                  inputMode="numeric" pattern="[0-9]*" placeholder="—"
                  aria-label={`Stock — ${p.name}`}
                  className={`input h-12 w-16 px-1 text-center text-[18px] font-semibold ${isChanged ? "border-accent" : ""}`}
                />
                <button type="button" onClick={() => bump(p.id, 1)} className="btn-secondary h-12 w-12 p-0 rounded-xl" aria-label={`Plus — ${p.name}`}><Plus size={18} /></button>
              </div>
            </div>
          );
        })}
      </div>

      <label className="block text-[13px]"><span className="label block mb-1">Commentaire (facultatif)</span><input name="comment" className="input h-11" placeholder="Rayon réorganisé, PLV absente…" /></label>

      <div className="sticky bottom-2 z-10 flex gap-2 bg-surface/95 backdrop-blur rounded-2xl p-2 -mx-2 border border-line">
        <Link href={cancelHref} className="btn-secondary h-12 px-4 flex items-center">Annuler</Link>
        <button type="submit" disabled={toSend.length === 0} className="btn-primary flex-1 h-12 text-[15px] disabled:opacity-50">
          Enregistrer le relevé{toSend.length ? ` (${toSend.length} produit${toSend.length > 1 ? "s" : ""})` : ""}
        </button>
      </div>
    </form>
  );
}
