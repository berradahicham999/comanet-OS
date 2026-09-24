"use client";

import { useMemo, useState } from "react";
import { allocateLandedCosts, computePurchase, rateError, unitCostMad, type PurchaseType } from "@/lib/gestion/purchases-shared";
import type { PurchaseEditorData } from "@/lib/gestion/purchase-editor";

/**
 * Saisie d'une pièce d'achat (commande, réception, facture, retour). Montants en devise et en
 * dirhams au taux saisi, frais d'approche et coût de revient en direct — mêmes fonctions que le
 * serveur, qui recalcule tout à l'enregistrement.
 */

export type PurchaseEditorLine = {
  key: string;
  productId: string | null;
  inventoryItemId: string | null;
  designation: string;
  ref: string | null;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxRate: string;
  lotNumber: string;
  expiryDate: string;
  trackLots: boolean;
  sourceLineId: string | null;
  maxQty: string | null;
};
export type PurchaseEditorCost = { key: string; label: string; amountMad: string; allocation: "VALEUR" | "QUANTITE"; ref: string };
export type PurchaseEditorInitial = {
  id: string | null;
  supplierId: string;
  date: string;
  expectedDate: string;
  supplierRef: string;
  currency: string;
  exchangeRate: string;
  warehouseKey: string;
  originDocumentId: string | null;
  notes: string;
  lines: PurchaseEditorLine[];
  landedCosts: PurchaseEditorCost[];
};

const fmt = (v: string, d = 2) => Number(v).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
let seq = 0;
const newKey = () => `n${Date.now()}_${seq++}`;

export function PurchaseEditor({ type, data, initial, action, canValidate }: {
  type: PurchaseType;
  data: PurchaseEditorData;
  initial: PurchaseEditorInitial;
  action: (fd: FormData) => Promise<void>;
  canValidate: boolean;
}) {
  const [supplierId, setSupplierId] = useState(initial.supplierId);
  const supplier = data.suppliers.find((s) => s.id === supplierId) ?? null;
  const [date, setDate] = useState(initial.date);
  const [expectedDate, setExpectedDate] = useState(initial.expectedDate);
  const [supplierRef, setSupplierRef] = useState(initial.supplierRef);
  const [currency, setCurrency] = useState(initial.currency || supplier?.currency || "MAD");
  const [rate, setRate] = useState(initial.exchangeRate || "");
  const [warehouseKey, setWarehouseKey] = useState(initial.warehouseKey || "PRINCIPAL");
  const [notes, setNotes] = useState(initial.notes);
  const [lines, setLines] = useState<PurchaseEditorLine[]>(initial.lines);
  const [costs, setCosts] = useState<PurchaseEditorCost[]>(initial.landedCosts);
  const [query, setQuery] = useState("");
  const [material, setMaterial] = useState(false);

  const fromSource = type === "RETOUR" || lines.some((l) => l.sourceLineId);
  const effRate = currency === "MAD" ? "1" : rate;
  const rErr = rateError(currency, effRate);

  const calc = useMemo(() => {
    try {
      const c = computePurchase(lines.map((l) => ({ quantity: l.quantity || "0", unitPrice: l.unitPrice || "0", discountPct: l.discountPct || "0", taxRate: l.taxRate })), rErr ? "0" : effRate);
      const landed = type === "RECEPTION" ? allocateLandedCosts(lines.map((l, i) => ({ netHtMad: c.lines[i].netHtMad, quantity: l.quantity || "0" })), costs.map((x) => ({ amountMad: x.amountMad || "0", allocation: x.allocation }))) : lines.map(() => "0.00");
      const unit = lines.map((l, i) => (Number(l.quantity) > 0 && type === "RECEPTION" ? unitCostMad(c.lines[i].netHtMad, landed[i], l.quantity) : null));
      return { ...c, landed, unit, landedTotal: landed.reduce((a, x) => a + Number(x), 0) };
    } catch {
      return null;
    }
  }, [lines, costs, effRate, rErr, type]);

  // Réception / retour : articles stockés et matériel ; commande : tout ; facture sans réception : services et frais.
  const matches = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return [];
    if (material) return data.items.filter((i) => norm(`${i.name} ${i.sku ?? ""}`).includes(q)).slice(0, 10).map((i) => ({ kind: "item" as const, id: i.id, name: i.name, sub: i.sku ?? "Matériel marketing" }));
    const brands = new Set(supplier?.brandIds ?? []);
    return data.products
      .filter((p) => (type === "FACTURE" ? p.kind !== "PRODUIT" : type === "COMMANDE" ? true : p.kind === "PRODUIT"))
      .filter((p) => p.ean === query.trim() || norm(`${p.name} ${p.ref ?? ""} ${p.brand ?? ""}`).includes(q))
      .sort((a, b) => Number(brands.has(b.brandId ?? "")) - Number(brands.has(a.brandId ?? "")))
      .slice(0, 10)
      .map((p) => ({ kind: "product" as const, id: p.id, name: p.name, sub: [p.ref, p.brand].filter(Boolean).join(" · ") }));
  }, [query, material, data, supplier, type]);

  const add = (m: { kind: "product" | "item"; id: string; name: string }) => {
    setQuery("");
    const p = m.kind === "product" ? data.products.find((x) => x.id === m.id) : null;
    const it = m.kind === "item" ? data.items.find((x) => x.id === m.id) : null;
    const last = data.lastPrices[`${supplierId}|${currency}|${m.id}`];
    setLines((ls) => [...ls, {
      key: newKey(), productId: p?.id ?? null, inventoryItemId: it?.id ?? null, designation: m.name, ref: p?.ref ?? it?.sku ?? null, quantity: "1",
      unitPrice: last ?? (it && currency === "MAD" ? it.unitCost : ""), discountPct: "0", taxRate: p?.taxRate ?? data.defaultRate,
      lotNumber: "", expiryDate: "", trackLots: !!p?.trackLots, sourceLineId: null, maxQty: null,
    }]);
  };
  const addFree = () => setLines((ls) => [...ls, { key: newKey(), productId: null, inventoryItemId: null, designation: "", ref: null, quantity: "1", unitPrice: "", discountPct: "0", taxRate: data.defaultRate, lotNumber: "", expiryDate: "", trackLots: false, sourceLineId: null, maxQty: null }]);
  const update = (key: string, patch: Partial<PurchaseEditorLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const updateCost = (key: string, patch: Partial<PurchaseEditorCost>) => setCosts((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const dec = (v: string) => v.replace(",", ".");

  const payload = JSON.stringify({
    id: initial.id, type, supplierId, date, expectedDate: expectedDate || null, supplierRef: supplierRef.trim() || null, currency, exchangeRate: effRate,
    warehouseKey, originDocumentId: initial.originDocumentId, notes: notes.trim() || null,
    lines: lines.map((l) => ({
      productId: l.productId, inventoryItemId: l.inventoryItemId, designation: l.designation, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct || "0",
      taxRate: l.taxRate, lotNumber: l.lotNumber || null, expiryDate: l.expiryDate || null, sourceLineId: l.sourceLineId,
    })),
    landedCosts: costs.map((c) => ({ label: c.label, amountMad: c.amountMad, allocation: c.allocation, ref: c.ref || null })),
  });

  return (
    <form action={action} className="space-y-4 text-[13px]">
      <input type="hidden" name="payload" value={payload} />

      <div className="card p-4 space-y-3">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="block sm:col-span-2"><span className="label block mb-1">Fournisseur *</span>
            <select className="select h-9" value={supplierId} disabled={!!initial.originDocumentId || fromSource} required
              onChange={(e) => { setSupplierId(e.target.value); const s = data.suppliers.find((x) => x.id === e.target.value); if (s) { setCurrency(s.currency); setRate(s.currency === "MAD" ? "1" : ""); } }}>
              <option value="">Choisir…</option>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.currency !== "MAD" ? ` (${s.currency})` : ""}</option>)}
            </select></label>
          <label className="block"><span className="label block mb-1">Date</span><input type="date" className="input h-9" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          {type === "COMMANDE" && <label className="block"><span className="label block mb-1">Livraison attendue</span><input type="date" className="input h-9" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></label>}
          {(type === "FACTURE" || type === "RECEPTION" || type === "RETOUR") && (
            <label className="block"><span className="label block mb-1">{type === "FACTURE" ? "N° de facture du fournisseur *" : type === "RECEPTION" ? "N° de BL du fournisseur" : "Référence du retour"}</span>
              <input className="input h-9" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} /></label>
          )}
          <label className="block"><span className="label block mb-1">Devise</span>
            <select className="select h-9" value={currency} disabled={fromSource} onChange={(e) => { setCurrency(e.target.value); setRate(e.target.value === "MAD" ? "1" : ""); }}>
              {["MAD", "EUR", "USD"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
          {currency !== "MAD" && (
            <label className="block"><span className="label block mb-1">Taux : MAD pour 1 {currency} *</span>
              <input className="input h-9 text-right" inputMode="decimal" value={rate} placeholder="ex. 10,85" onChange={(e) => setRate(dec(e.target.value))} required /></label>
          )}
          {type === "RECEPTION" && (
            <label className="block"><span className="label block mb-1">Dépôt</span>
              <select className="select h-9" value={warehouseKey} onChange={(e) => setWarehouseKey(e.target.value)}>{data.warehouses.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}</select></label>
          )}
        </div>
        {rErr && currency !== "MAD" && <p className="text-[12px] text-orange">{rErr} Le taux n&apos;est jamais deviné : c&apos;est celui de la pièce.</p>}
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold">Lignes</h3>
          {!fromSource && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={material} onChange={(e) => setMaterial(e.target.checked)} /> Matériel marketing</label>
              {(type === "COMMANDE" || type === "FACTURE") && <button type="button" className="btn-ghost btn-sm" onClick={addFree}>+ Ligne libre</button>}
            </div>
          )}
        </div>
        {!fromSource && (
          <div className="relative">
            <input className="input h-10" placeholder={material ? "Ajouter du matériel (PLV, goodies)…" : type === "FACTURE" ? "Ajouter un service…" : "Ajouter un article : nom, référence, marque ou code-barres…"} value={query} onChange={(e) => setQuery(e.target.value)} />
            {matches.length > 0 && (
              <ul className="absolute z-20 left-0 right-0 mt-1 card p-1 max-h-80 overflow-auto shadow-lg">
                {matches.map((m) => <li key={m.id}><button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-2" onClick={() => add(m)}><span className="font-medium">{m.name}</span> <span className="text-faint text-[11.5px]">{m.sub}</span></button></li>)}
              </ul>
            )}
          </div>
        )}
        {type === "FACTURE" && !fromSource && <p className="text-[12px] text-muted">Une facture de marchandises se crée depuis ses réceptions (« Facturer des réceptions ») : la réception a fait entrer le stock. Ici : services, frais, prestations.</p>}

        {lines.length === 0 ? <p className="text-muted py-4 text-center">Aucune ligne.</p> : (
          <ul className="divide-y divide-line">
            {lines.map((l, i) => (
              <li key={l.key} className="py-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-faint text-[11px] w-5 pt-1 tabular-nums">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    {l.productId || l.inventoryItemId || l.sourceLineId ? (
                      <div className="font-medium">{l.designation}<span className="text-faint text-[11.5px] font-normal"> {[l.ref, l.inventoryItemId ? "matériel" : null].filter(Boolean).join(" · ")}</span></div>
                    ) : <input className="input h-9" placeholder="Désignation (transport, prestation…)" value={l.designation} onChange={(e) => update(l.key, { designation: e.target.value })} required />}
                  </div>
                  <button type="button" className="btn-ghost btn-sm text-red" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Retirer la ligne">✕</button>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pl-7">
                  <label className="block"><span className="label block mb-0.5">Qté{l.maxQty ? ` (≤ ${Number(l.maxQty).toLocaleString("fr-FR")})` : ""}</span>
                    <input className="input h-9 text-right" inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: dec(e.target.value) })} /></label>
                  <label className="block"><span className="label block mb-0.5">P.U. HT {currency}</span>
                    <input className="input h-9 text-right" inputMode="decimal" value={l.unitPrice} disabled={type === "RETOUR"} onChange={(e) => update(l.key, { unitPrice: dec(e.target.value) })} /></label>
                  <label className="block"><span className="label block mb-0.5">Remise %</span>
                    <input className="input h-9 text-right" inputMode="decimal" value={l.discountPct} disabled={type === "RETOUR"} onChange={(e) => update(l.key, { discountPct: dec(e.target.value) })} /></label>
                  {type === "RECEPTION" && l.productId ? (
                    <>
                      <label className="block"><span className="label block mb-0.5">Lot{l.trackLots ? " *" : ""}</span>
                        <input className="input h-9" value={l.lotNumber} onChange={(e) => update(l.key, { lotNumber: e.target.value })} required={l.trackLots} /></label>
                      <label className="block"><span className="label block mb-0.5">Péremption</span>
                        <input type="date" className="input h-9" value={l.expiryDate} onChange={(e) => update(l.key, { expiryDate: e.target.value })} /></label>
                    </>
                  ) : !l.productId && !l.inventoryItemId && !l.sourceLineId ? (
                    <label className="block"><span className="label block mb-0.5">TVA %</span>
                      <input className="input h-9 text-right" inputMode="decimal" value={l.taxRate} onChange={(e) => update(l.key, { taxRate: dec(e.target.value) })} /></label>
                  ) : type === "RETOUR" && l.lotNumber ? <div><span className="label block mb-0.5">Lot</span><div className="h-9 flex items-center">{l.lotNumber}</div></div> : null}
                  <div className="block"><span className="label block mb-0.5">Montant HT</span>
                    <div className="h-9 flex flex-col items-end justify-center tabular-nums">
                      <span className="font-medium">{calc ? `${fmt(calc.lines[i].netHtCurrency)}${currency !== "MAD" ? ` ${currency}` : ""}` : "—"}</span>
                      {calc && type === "RECEPTION" && calc.unit[i] && <span className="text-[11px] text-faint">revient {fmt(calc.unit[i]!, 4)} MAD/u</span>}
                    </div></div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {type === "RECEPTION" && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between"><h3 className="font-semibold">Frais d&apos;approche (MAD HT)</h3>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setCosts((cs) => [...cs, { key: newKey(), label: "", amountMad: "", allocation: "VALEUR", ref: "" }])}>+ Frais</button></div>
          {costs.length === 0 && <p className="text-[12px] text-muted">Transport, dédouanement, transit : ils s&apos;ajoutent au coût de revient des articles reçus, à la valeur ou à la quantité.</p>}
          {costs.map((c) => (
            <div key={c.key} className="grid grid-cols-2 sm:grid-cols-[1.4fr_110px_130px_1fr_auto] gap-2 items-end">
              <label className="block"><span className="label block mb-0.5">Libellé</span><input className="input h-9" value={c.label} placeholder="Transport, douane…" onChange={(e) => updateCost(c.key, { label: e.target.value })} /></label>
              <label className="block"><span className="label block mb-0.5">Montant</span><input className="input h-9 text-right" inputMode="decimal" value={c.amountMad} onChange={(e) => updateCost(c.key, { amountMad: dec(e.target.value) })} /></label>
              <label className="block"><span className="label block mb-0.5">Répartition</span>
                <select className="select h-9" value={c.allocation} onChange={(e) => updateCost(c.key, { allocation: e.target.value as "VALEUR" | "QUANTITE" })}><option value="VALEUR">À la valeur</option><option value="QUANTITE">À la quantité</option></select></label>
              <label className="block"><span className="label block mb-0.5">Réf. (facture transitaire…)</span><input className="input h-9" value={c.ref} onChange={(e) => updateCost(c.key, { ref: e.target.value })} /></label>
              <button type="button" className="btn-ghost btn-sm text-red" onClick={() => setCosts((cs) => cs.filter((x) => x.key !== c.key))} aria-label="Retirer le frais">✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_340px] gap-4">
        <div className="card p-4"><label className="block"><span className="label block mb-1">Note</span><textarea className="input min-h-16 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></label></div>
        <div className="card p-4 text-[13px] space-y-1 tabular-nums">
          {calc ? (
            <>
              {currency !== "MAD" && <div className="flex justify-between"><span className="text-muted">Total HT {currency}</span><span>{fmt(calc.netHtCurrency)}</span></div>}
              <div className="flex justify-between font-medium"><span>Total HT MAD</span><span>{fmt(calc.netHtMad)}</span></div>
              {type === "RECEPTION" && calc.landedTotal > 0 && <div className="flex justify-between"><span className="text-muted">Frais d&apos;approche</span><span>{fmt(String(calc.landedTotal))}</span></div>}
              {calc.vatBreakdown.map((v) => <div key={v.rate} className="flex justify-between"><span className="text-muted">TVA {Number(v.rate).toLocaleString("fr-FR")} %</span><span>{fmt(v.vat)}</span></div>)}
              <div className="flex justify-between font-semibold text-[15px] pt-1 border-t border-line"><span>Total TTC</span><span>{fmt(calc.ttcMad)} MAD</span></div>
            </>
          ) : <p className="text-red">Une remise ou un taux est invalide.</p>}
        </div>
      </div>

      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-2 z-10 flex gap-2 justify-start lg:justify-end bg-surface/95 backdrop-blur rounded-2xl p-2 lg:pr-36 border border-line">
        <button type="submit" name="intent" value="save" className="btn-secondary" disabled={!supplierId || !lines.length}><span className="lg:hidden">Brouillon</span><span className="hidden lg:inline">Enregistrer le brouillon</span></button>
        {canValidate && <button type="submit" name="intent" value="validate" className="btn-primary" disabled={!supplierId || !lines.length || !calc || !!rErr}><span className="lg:hidden">Valider</span><span className="hidden lg:inline">Enregistrer et valider</span></button>}
      </div>
    </form>
  );
}
