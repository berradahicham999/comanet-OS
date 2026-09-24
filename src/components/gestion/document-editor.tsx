"use client";

import { useMemo, useState } from "react";
import { baseUnitPriceHt, computeDocument } from "@/lib/gestion/calc";
import { defaultDiscount, type DocType } from "@/lib/gestion/documents-shared";
import type { EditorData, EditorProduct } from "@/lib/gestion/editor";

/**
 * Saisie d'une pièce (BL, facture directe de services, avoir) — pensée pour le téléphone :
 * recherche d'article par nom, référence ou EAN, lignes en cartes, totaux en direct (même
 * fonction `computeDocument` que le serveur, qui recalcule de toute façon à l'enregistrement).
 */

export type EditorLine = {
  key: string;
  productId: string | null;
  designation: string;
  ref: string | null;
  quantity: string;
  freeQuantity: string;
  unitPriceHt: string;
  discountPct: string;
  taxRate: string;
  sourceLineId: string | null;
  sourceNumber: string | null;
  returnWarehouseKey: string | null;
  /** Plafond de quantité (reste à facturer / à créditer), pour les lignes reprises d'une pièce. */
  maxQty: string | null;
};

export type EditorInitial = {
  id: string | null;
  clientId: string;
  date: string;
  site: string;
  salesRepId: string | null;
  paymentModeKey: string | null;
  globalDiscountPct: string;
  notes: string;
  reasonKey: string | null;
  originDocumentId: string | null;
  lines: EditorLine[];
};

const fmt = (v: string) => Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
let seq = 0;
const newKey = () => `n${Date.now()}_${seq++}`;

export function DocumentEditor({ type, data, initial, action, creditReasons = [], warehouses = [], canValidate }: {
  type: DocType;
  data: EditorData;
  initial: EditorInitial;
  action: (fd: FormData) => Promise<void>;
  creditReasons?: { key: string; label: string; withReturn: boolean }[];
  warehouses?: { key: string; label: string }[];
  canValidate: boolean;
}) {
  const [clientId, setClientId] = useState(initial.clientId);
  const [clientQuery, setClientQuery] = useState("");
  const [date, setDate] = useState(initial.date);
  const [site, setSite] = useState(initial.site);
  const [salesRepId, setSalesRepId] = useState(initial.salesRepId ?? "");
  const [paymentModeKey, setPaymentModeKey] = useState(initial.paymentModeKey ?? "");
  const [globalDiscountPct, setGlobal] = useState(initial.globalDiscountPct || "0");
  const [notes, setNotes] = useState(initial.notes);
  const [reasonKey, setReasonKey] = useState(initial.reasonKey ?? "");
  const [lines, setLines] = useState<EditorLine[]>(initial.lines);
  const [query, setQuery] = useState("");

  const client = data.clients.find((c) => c.id === clientId) ?? null;
  const fromOrigin = type === "AVOIR" || lines.some((l) => l.sourceLineId);
  const reason = creditReasons.find((r) => r.key === reasonKey);

  const calc = useMemo(() => {
    try {
      return computeDocument(lines.map((l) => ({ quantity: l.quantity || "0", unitPriceHt: l.unitPriceHt || "0", discountPct: l.discountPct || "0", taxRate: l.taxRate })), globalDiscountPct || "0");
    } catch {
      return null;
    }
  }, [lines, globalDiscountPct]);

  const clientMatches = useMemo(() => {
    const q = norm(clientQuery.trim());
    if (!q) return [];
    return data.clients.filter((c) => norm(`${c.name} ${c.legalName ?? ""} ${c.city ?? ""}`).includes(q)).slice(0, 8);
  }, [clientQuery, data.clients]);

  // BL : articles stockés ; facture directe : services et frais (un article stocké se facture depuis son BL).
  const productMatches = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return [];
    return data.products
      .filter((p) => (type === "BL" ? p.kind === "PRODUIT" : p.kind !== "PRODUIT"))
      .filter((p) => p.ean === query.trim() || norm(`${p.name} ${p.ref ?? ""} ${p.brand ?? ""}`).includes(q))
      .slice(0, 10);
  }, [query, data.products, type]);

  const pickClient = (id: string) => {
    setClientId(id);
    setClientQuery("");
    const c = data.clients.find((x) => x.id === id);
    if (c?.paymentModeKey && !paymentModeKey) setPaymentModeKey(c.paymentModeKey);
    // Les remises par défaut suivent le client choisi (lignes saisies, pas les lignes reprises).
    if (c) setLines((ls) => ls.map((l) => {
      if (l.sourceLineId || !l.productId) return l;
      const p = data.products.find((x) => x.id === l.productId);
      return { ...l, discountPct: defaultDiscount(c.defaultDiscountPct, p?.brandId ? c.brandDiscounts[p.brandId] ?? null : null) };
    }));
  };

  const addProduct = (p: EditorProduct) => {
    setQuery("");
    const existing = lines.find((l) => l.productId === p.id && !l.sourceLineId);
    if (existing) {
      update(existing.key, { quantity: String(Number(existing.quantity || "0") + 1) });
      return;
    }
    setLines((ls) => [...ls, {
      key: newKey(), productId: p.id, designation: p.name, ref: p.ref, quantity: "1", freeQuantity: "0",
      unitPriceHt: baseUnitPriceHt(p.publicPriceTtc, p.taxRate) ?? "", discountPct: client ? defaultDiscount(client.defaultDiscountPct, p.brandId ? client.brandDiscounts[p.brandId] ?? null : null) : "0",
      taxRate: p.taxRate, sourceLineId: null, sourceNumber: null, returnWarehouseKey: null, maxQty: null,
    }]);
  };
  const addFreeLine = () => setLines((ls) => [...ls, {
    key: newKey(), productId: null, designation: "", ref: null, quantity: "1", freeQuantity: "0", unitPriceHt: "", discountPct: "0",
    taxRate: data.defaultRate, sourceLineId: null, sourceNumber: null, returnWarehouseKey: null, maxQty: null,
  }]);
  const update = (key: string, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const payload = JSON.stringify({
    id: initial.id, type, clientId, date, site, salesRepId: salesRepId || null, paymentModeKey: paymentModeKey || null, globalDiscountPct: globalDiscountPct || "0",
    notes: notes.trim() || null, reasonKey: type === "AVOIR" ? reasonKey || null : null, originDocumentId: initial.originDocumentId,
    lines: lines.map((l) => ({
      productId: l.productId, designation: l.designation, quantity: l.quantity, freeQuantity: l.freeQuantity || "0", unitPriceHt: l.unitPriceHt,
      discountPct: l.discountPct || "0", taxRate: l.taxRate, sourceLineId: l.sourceLineId,
      returnWarehouseKey: type === "AVOIR" && reason?.withReturn && l.productId ? l.returnWarehouseKey ?? "PRINCIPAL" : null,
    })),
  });
  const available = (id: string | null) => (id ? data.products.find((p) => p.id === id)?.available ?? null : null);

  return (
    <form action={action} className="space-y-4 text-[13px]">
      <input type="hidden" name="payload" value={payload} />

      {/* En-tête */}
      <div className="card p-4 space-y-3">
        <div>
          <span className="label block mb-1">Client *</span>
          {client && !fromOrigin ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{client.name}</span>
              {client.city && <span className="text-muted">· {client.city}</span>}
              {client.blocked && <span className="text-red text-[12px]">client bloqué</span>}
              <button type="button" className="btn-ghost btn-sm" onClick={() => setClientId("")}>Changer</button>
            </div>
          ) : client ? (
            <div className="font-medium">{client.name}{client.city && <span className="text-muted font-normal"> · {client.city}</span>}</div>
          ) : (
            <div className="relative">
              <input className="input h-10" placeholder="Rechercher un client (nom, raison sociale, ville)…" value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} autoFocus />
              {clientMatches.length > 0 && (
                <ul className="absolute z-20 left-0 right-0 mt-1 card p-1 max-h-72 overflow-auto shadow-lg">
                  {clientMatches.map((c) => (
                    <li key={c.id}><button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-2" onClick={() => pickClient(c.id)}>
                      <span className="font-medium">{c.name}</span>{c.legalName && c.legalName !== c.name && <span className="text-muted"> · {c.legalName}</span>}{c.city && <span className="text-faint"> · {c.city}</span>}
                    </button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label className="block"><span className="label block mb-1">Date</span><input type="date" className="input h-9" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label className="block"><span className="label block mb-1">Site</span>
            <select className="select h-9" value={site} onChange={(e) => setSite(e.target.value)} disabled={fromOrigin}>{data.sites.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </label>
          <label className="block"><span className="label block mb-1">Commercial</span>
            <select className="select h-9" value={salesRepId} onChange={(e) => setSalesRepId(e.target.value)}><option value="">—</option>{data.reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </label>
          <label className="block"><span className="label block mb-1">Règlement</span>
            <select className="select h-9" value={paymentModeKey} onChange={(e) => setPaymentModeKey(e.target.value)}><option value="">Selon la fiche client</option>{data.paymentModes.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
          </label>
        </div>
        {type === "AVOIR" && (
          <label className="block max-w-sm"><span className="label block mb-1">Motif de l&apos;avoir *</span>
            <select className="select h-9" value={reasonKey} onChange={(e) => setReasonKey(e.target.value)} required>
              <option value="">Choisir…</option>{creditReasons.map((r) => <option key={r.key} value={r.key}>{r.label}{r.withReturn ? " (retour en stock)" : ""}</option>)}
            </select>
          </label>
        )}
      </div>

      {/* Lignes */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Lignes</h3>
          {type === "FACTURE" && !fromOrigin && <button type="button" className="btn-ghost btn-sm" onClick={addFreeLine}>+ Ligne libre (frais, service)</button>}
        </div>
        {!fromOrigin && (
          <div className="relative">
            <input className="input h-10" placeholder={type === "BL" ? "Ajouter un article : nom, référence, marque ou code-barres…" : "Ajouter un service ou des frais…"} value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (productMatches[0]) addProduct(productMatches[0]); } }} />
            {productMatches.length > 0 && (
              <ul className="absolute z-20 left-0 right-0 mt-1 card p-1 max-h-80 overflow-auto shadow-lg">
                {productMatches.map((p) => (
                  <li key={p.id}><button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-2 flex items-center gap-2" onClick={() => addProduct(p)}>
                    <span className="min-w-0 flex-1"><span className="font-medium">{p.name}</span><span className="text-faint text-[11.5px]"> {[p.ref, p.brand].filter(Boolean).join(" · ")}</span></span>
                    {p.available !== null && <span className={`text-[11.5px] tabular-nums ${Number(p.available) > 0 ? "text-muted" : "text-red"}`}>stock {Number(p.available).toLocaleString("fr-FR")}</span>}
                    {p.publicPriceTtc && <span className="text-[11.5px] text-faint tabular-nums">PPH {fmt(p.publicPriceTtc)}</span>}
                  </button></li>
                ))}
              </ul>
            )}
          </div>
        )}
        {type === "FACTURE" && !fromOrigin && <p className="text-[12px] text-muted">Les articles stockés se facturent depuis leurs bons de livraison (onglet « Facturer des BL ») : c&apos;est le BL qui sort le stock.</p>}

        {lines.length === 0 ? (
          <p className="text-muted py-4 text-center">Aucune ligne.</p>
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((l, i) => {
              const stock = type === "BL" ? available(l.productId) : null;
              const short = stock !== null && Number(l.quantity || 0) + Number(l.freeQuantity || 0) > Number(stock);
              return (
                <li key={l.key} className="py-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-faint text-[11px] w-5 pt-1 tabular-nums">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      {l.productId || l.sourceLineId ? (
                        <div className="font-medium">{l.designation}<span className="text-faint text-[11.5px] font-normal"> {[l.ref, l.sourceNumber ? `BL ${l.sourceNumber}` : null].filter(Boolean).join(" · ")}</span></div>
                      ) : (
                        <input className="input h-9" placeholder="Désignation" value={l.designation} onChange={(e) => update(l.key, { designation: e.target.value })} required />
                      )}
                      {stock !== null && <div className={`text-[11.5px] ${short ? "text-red" : "text-faint"}`}>Stock dépôt principal : {Number(stock).toLocaleString("fr-FR")}{short ? " — insuffisant" : ""}</div>}
                    </div>
                    <button type="button" className="btn-ghost btn-sm text-red" onClick={() => remove(l.key)} aria-label="Retirer la ligne">✕</button>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pl-7">
                    <label className="block"><span className="label block mb-0.5">Qté{l.maxQty ? ` (≤ ${Number(l.maxQty).toLocaleString("fr-FR")})` : ""}</span>
                      <input className="input h-9 text-right" inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value.replace(",", ".") })} /></label>
                    {type !== "AVOIR" && <label className="block"><span className="label block mb-0.5">UG</span>
                      <input className="input h-9 text-right" inputMode="decimal" value={l.freeQuantity} disabled={!!l.sourceLineId} onChange={(e) => update(l.key, { freeQuantity: e.target.value.replace(",", ".") })} /></label>}
                    <label className="block"><span className="label block mb-0.5">P.U. HT</span>
                      <input className="input h-9 text-right" inputMode="decimal" value={l.unitPriceHt} disabled={!!l.sourceLineId} onChange={(e) => update(l.key, { unitPriceHt: e.target.value.replace(",", ".") })} /></label>
                    <label className="block"><span className="label block mb-0.5">Remise %</span>
                      <input className="input h-9 text-right" inputMode="decimal" value={l.discountPct} disabled={!!l.sourceLineId} onChange={(e) => update(l.key, { discountPct: e.target.value.replace(",", ".") })} /></label>
                    {!l.productId && !l.sourceLineId ? (
                      <label className="block"><span className="label block mb-0.5">TVA %</span>
                        <input className="input h-9 text-right" inputMode="decimal" value={l.taxRate} onChange={(e) => update(l.key, { taxRate: e.target.value.replace(",", ".") })} /></label>
                    ) : <div className="block"><span className="label block mb-0.5">TVA</span><div className="h-9 flex items-center justify-end text-muted">{Number(l.taxRate).toLocaleString("fr-FR")} %</div></div>}
                    <div className="block"><span className="label block mb-0.5">Net HT</span><div className="h-9 flex items-center justify-end font-medium tabular-nums">{calc ? fmt(calc.lines[i].netHt) : "—"}</div></div>
                  </div>
                  {type === "AVOIR" && reason?.withReturn && l.productId && warehouses.length > 0 && (
                    <label className="flex items-center gap-2 pl-7 text-[12px]"><span className="text-muted">Retour au dépôt</span>
                      <select className="select h-8 max-w-48" value={l.returnWarehouseKey ?? "PRINCIPAL"} onChange={(e) => update(l.key, { returnWarehouseKey: e.target.value })}>{warehouses.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}</select>
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Pied */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="card p-4 space-y-3">
          {!fromOrigin && (
            <label className="block max-w-40"><span className="label block mb-1">Remise globale %</span>
              <input className="input h-9 text-right" inputMode="decimal" value={globalDiscountPct} onChange={(e) => setGlobal(e.target.value.replace(",", "."))} /></label>
          )}
          <label className="block"><span className="label block mb-1">Note imprimée sur la pièce</span>
            <textarea className="input min-h-16 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></label>
        </div>
        <div className="card p-4 text-[13px] space-y-1 tabular-nums">
          {calc ? (
            <>
              <div className="flex justify-between"><span className="text-muted">Total HT</span><span>{fmt(calc.grossHt)}</span></div>
              {Number(calc.globalDiscountAmount) > 0 && <div className="flex justify-between"><span className="text-muted">Remise globale</span><span>-{fmt(calc.globalDiscountAmount)}</span></div>}
              <div className="flex justify-between font-medium"><span>Net HT</span><span>{fmt(calc.netHt)}</span></div>
              {calc.vatBreakdown.map((v) => <div key={v.rate} className="flex justify-between"><span className="text-muted">TVA {Number(v.rate).toLocaleString("fr-FR")} %</span><span>{fmt(v.vat)}</span></div>)}
              <div className="flex justify-between font-semibold text-[15px] pt-1 border-t border-line"><span>Total TTC</span><span>{fmt(calc.ttc)} MAD</span></div>
            </>
          ) : <p className="text-red">Une remise ou un taux est invalide (remise entre 0 et 99,99 %).</p>}
        </div>
      </div>

      {/* Actions — collées en bas de l'écran, au-dessus de la barre de navigation du téléphone */}
      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-2 z-10 flex gap-2 justify-start lg:justify-end bg-surface/95 backdrop-blur rounded-2xl p-2 lg:pr-36 border border-line">
        <button type="submit" name="intent" value="save" className="btn-secondary" disabled={!clientId || !lines.length}><span className="lg:hidden">Brouillon</span><span className="hidden lg:inline">Enregistrer le brouillon</span></button>
        {canValidate && <button type="submit" name="intent" value="validate" className="btn-primary" disabled={!clientId || !lines.length || !calc}><span className="lg:hidden">Valider</span><span className="hidden lg:inline">Enregistrer et valider</span></button>}
      </div>
    </form>
  );
}
