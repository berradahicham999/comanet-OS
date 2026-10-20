"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { baseUnitPriceHt, computeDocument } from "@/lib/gestion/calc";
import { defaultDiscount, sourceRef, type DocType } from "@/lib/gestion/documents-shared";
import type { EditorData, EditorMaterial, EditorProduct } from "@/lib/gestion/editor";
import type { UsualClientProduct } from "@/lib/gestion/usual-products";
import type { ClientReturnContext } from "@/lib/gestion/client-returns";
import { Badge } from "@/components/ui";

/**
 * Saisie d'une pièce (commande client, BL, facture directe de services, avoir) — pensée pour le
 * téléphone : produits habituels du client en un geste, recherche d'article par nom, référence ou
 * EAN, lignes en cartes, totaux en direct (même fonction `computeDocument` que le serveur, qui
 * recalcule de toute façon à l'enregistrement).
 *
 * Lignes reprises d'une autre pièce (`sourceLineId`) : figées sur une facture (elles viennent du
 * BL qui a sorti le stock) et sur un avoir ; libres sur un BL préparé depuis une commande, car
 * c'est le BL qui engage (remise, prix, quantités, raison sociale restent à la main).
 *
 * Avoir libre (sans facture d'origine) : produits rendus ou crédités, marques ou libellés libres ; un produit reprend
 * le dernier prix du client (sinon PPH HT − remise client), le motif décide du dépôt de retour (ou d'aucun mouvement),
 * et un produit suivi par lot désigne le lot rendu (lots livrés au client, ou saisie libre).
 *
 * Sorties marketing : un BL cherche dans les produits ET dans le matériel marketing (badge Produit / Matériel).
 * Le matériel est offert (prix 0) ; sur un client interne, rien ne fait de CA et les produits sont valorisés au
 * coût de revient (charge marketing de la nature du client), avec une alerte si ce coût manque.
 */

export type EditorLine = {
  key: string;
  productId: string | null;
  /** Article de matériel marketing (jamais avec un produit). */
  inventoryItemId?: string | null;
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
  /** Avoir libre : lot rendu (produit suivi par lot), facultatif. */
  returnLot?: { lotNumber: string; expiryDate: string | null } | null;
  /** Plafond de quantité (reste à facturer / à créditer), pour les lignes reprises d'une pièce. */
  maxQty: string | null;
};

export type EditorInitial = {
  id: string | null;
  clientId: string;
  legalEntityId: string | null;
  date: string;
  site: string;
  salesRepId: string | null;
  paymentModeKey: string | null;
  globalDiscountPct: string;
  notes: string;
  reasonKey: string | null;
  originDocumentId: string | null;
  /** Activation alimentée par ce BL (sorties marketing). */
  activationId?: string | null;
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
  creditReasons?: { key: string; label: string; withReturn: boolean; returnWarehouseKey: string | null }[];
  warehouses?: { key: string; label: string }[];
  canValidate: boolean;
}) {
  const [clientId, setClientId] = useState(initial.clientId);
  const [clientQuery, setClientQuery] = useState("");
  const [legalEntityId, setLegalEntityId] = useState(initial.legalEntityId ?? "");
  const [date, setDate] = useState(initial.date);
  const [site, setSite] = useState(initial.site);
  const [salesRepId, setSalesRepId] = useState(initial.salesRepId ?? "");
  const [paymentModeKey, setPaymentModeKey] = useState(initial.paymentModeKey ?? "");
  const [globalDiscountPct, setGlobal] = useState(initial.globalDiscountPct || "0");
  const [notes, setNotes] = useState(initial.notes);
  const [reasonKey, setReasonKey] = useState(initial.reasonKey ?? "");
  const [lines, setLines] = useState<EditorLine[]>(initial.lines);
  const [query, setQuery] = useState("");
  const [activationId, setActivationId] = useState(initial.activationId ?? "");

  const client = data.clients.find((c) => c.id === clientId) ?? null;
  const fromOrigin = !!initial.originDocumentId || lines.some((l) => l.sourceLineId);
  // Verrou des lignes et de l'en-tête repris : facture et avoir seulement. Un BL préparé depuis une commande reste libre.
  const locked = fromOrigin && type !== "BL";
  const stocked = type === "BL" || type === "COMMANDE";
  // Sortie marketing : client interne (échantillons animation, médical, digital, commercial).
  const internal = type === "BL" && !!client?.isInternal;

  // Produits habituels du client (12 mois), chargés dès que le client est connu : commande et BL.
  const [usualFor, setUsualFor] = useState<{ clientId: string; rows: UsualClientProduct[] } | null>(null);
  useEffect(() => {
    if (!clientId || !stocked) return;
    let alive = true;
    fetch(`/api/gestion/produits-habituels/${clientId}`).then((r) => (r.ok ? r.json() : [])).then((rows) => { if (alive) setUsualFor({ clientId, rows: Array.isArray(rows) ? rows : [] }); }).catch(() => {});
    return () => { alive = false; };
  }, [clientId, stocked]);
  const usual = usualFor && usualFor.clientId === clientId ? usualFor.rows : [];
  // Avoir libre : ni facture ni BL d'origine ; produits rendus ou crédités, marques (remise sur objectifs…) ou libellés.
  const freeCredit = type === "AVOIR" && !fromOrigin;
  const reasons = creditReasons;
  const [returnCtx, setReturnCtx] = useState<{ clientId: string; ctx: ClientReturnContext } | null>(null);
  useEffect(() => {
    if (!clientId || !freeCredit) return;
    let alive = true;
    fetch(`/api/gestion/retours-client/${clientId}`).then((r) => (r.ok ? r.json() : null)).then((ctx) => { if (alive && ctx?.lastPrices) setReturnCtx({ clientId, ctx }); }).catch(() => {});
    return () => { alive = false; };
  }, [clientId, freeCredit]);
  const ctx = returnCtx && returnCtx.clientId === clientId ? returnCtx.ctx : null;
  const [brandPick, setBrandPick] = useState("");
  const addBrandLine = (brandId: string) => {
    const b = data.brands.find((x) => x.id === brandId);
    if (!b) return;
    setBrandPick("");
    setLines((ls) => [...ls, { key: newKey(), productId: null, designation: b.name, ref: null, quantity: "1", freeQuantity: "0", unitPriceHt: "", discountPct: "0", taxRate: data.defaultRate, sourceLineId: null, sourceNumber: null, returnWarehouseKey: null, maxQty: null }]);
  };
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

  // Commande et BL : articles stockés ; facture directe : services et frais (un article stocké se facture depuis son BL).
  const productMatches = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return [];
    return data.products
      .filter((p) => (stocked || freeCredit ? p.kind === "PRODUIT" : p.kind !== "PRODUIT"))
      .filter((p) => p.ean === query.trim() || norm(`${p.name} ${p.ref ?? ""} ${p.brand ?? ""}`).includes(q))
      .slice(0, 10);
  }, [query, data.products, stocked, freeCredit]);
  // BL : le matériel marketing (goodies, PLV, print) se cherche dans la même liste.
  const materialMatches = useMemo(() => {
    const q = norm(query.trim());
    if (!q || type !== "BL") return [];
    return data.materials.filter((m) => norm(`${m.name} ${m.sku ?? ""} ${m.brand ?? ""} ${m.categoryLabel}`).includes(q)).slice(0, 6);
  }, [query, data.materials, type]);

  const pickClient = (id: string) => {
    setClientId(id);
    setClientQuery("");
    setLegalEntityId("");
    const c = data.clients.find((x) => x.id === id);
    if (c?.paymentModeKey && !paymentModeKey) setPaymentModeKey(c.paymentModeKey);
    // Les remises par défaut suivent le client choisi (lignes saisies, pas les lignes reprises).
    // Client interne (sortie marketing) : ni prix ni remise.
    if (c?.isInternal && type === "BL") {
      setGlobal("0");
      setLines((ls) => ls.map((l) => (l.productId ? { ...l, unitPriceHt: "0", discountPct: "0" } : l)));
      return;
    }
    if (c) setLines((ls) => ls.map((l) => {
      if (l.sourceLineId || !l.productId) return l;
      const p = data.products.find((x) => x.id === l.productId);
      return { ...l, discountPct: defaultDiscount(c.defaultDiscountPct, p?.brandId ? c.brandDiscounts[p.brandId] ?? null : null) };
    }));
  };

  const addProduct = (p: EditorProduct, qty = 1) => {
    setQuery("");
    const existing = lines.find((l) => l.productId === p.id && !l.sourceLineId);
    if (existing) {
      update(existing.key, { quantity: String(Number(existing.quantity || "0") + qty) });
      return;
    }
    // Avoir libre : dernier prix et dernière remise du client sur ce produit, s'il en a un.
    const last = freeCredit ? ctx?.lastPrices[p.id] ?? null : null;
    setLines((ls) => [...ls, {
      key: newKey(), productId: p.id, designation: p.name, ref: p.ref, quantity: String(qty), freeQuantity: "0",
      unitPriceHt: internal ? "0" : last ? last.unitPriceHt : baseUnitPriceHt(p.publicPriceTtc, p.taxRate) ?? "",
      discountPct: internal ? "0" : last ? String(Number(last.discountPct)) : client ? defaultDiscount(client.defaultDiscountPct, p.brandId ? client.brandDiscounts[p.brandId] ?? null : null) : "0",
      taxRate: p.taxRate, sourceLineId: null, sourceNumber: null, returnWarehouseKey: freeCredit ? reason?.returnWarehouseKey ?? null : null, maxQty: null,
    }]);
  };
  const addMaterial = (m: EditorMaterial) => {
    setQuery("");
    const existing = lines.find((l) => l.inventoryItemId === m.id);
    if (existing) {
      update(existing.key, { quantity: String(Number(existing.quantity || "0") + 1) });
      return;
    }
    setLines((ls) => [...ls, {
      key: newKey(), productId: null, inventoryItemId: m.id, designation: m.name, ref: m.sku, quantity: "1", freeQuantity: "0", unitPriceHt: "0", discountPct: "0",
      taxRate: data.defaultRate, sourceLineId: null, sourceNumber: null, returnWarehouseKey: null, maxQty: null,
    }]);
  };
  const addFreeLine = () => setLines((ls) => [...ls, {
    key: newKey(), productId: null, designation: "", ref: null, quantity: "1", freeQuantity: "0", unitPriceHt: "", discountPct: "0",
    taxRate: data.defaultRate, sourceLineId: null, sourceNumber: null, returnWarehouseKey: null, maxQty: null,
  }]);
  const update = (key: string, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const payload = JSON.stringify({
    id: initial.id, type, clientId, legalEntityId: legalEntityId || null, date, site, salesRepId: salesRepId || null, paymentModeKey: paymentModeKey || null, globalDiscountPct: globalDiscountPct || "0",
    notes: notes.trim() || null, reasonKey: type === "AVOIR" ? reasonKey || null : null, originDocumentId: initial.originDocumentId,
    activationId: type === "BL" ? activationId || null : null,
    lines: lines.map((l) => ({
      productId: l.productId, inventoryItemId: l.inventoryItemId ?? null, designation: l.designation, quantity: l.quantity, freeQuantity: l.freeQuantity || "0", unitPriceHt: l.unitPriceHt,
      discountPct: l.discountPct || "0", taxRate: l.taxRate, sourceLineId: l.sourceLineId,
      returnWarehouseKey: type === "AVOIR" && reason?.withReturn && l.productId ? l.returnWarehouseKey ?? reason.returnWarehouseKey ?? "PRINCIPAL" : null,
      returnLot: type === "AVOIR" && reason?.withReturn && l.productId && !l.sourceLineId && l.returnLot?.lotNumber.trim() ? l.returnLot : null,
    })),
  });
  const available = (id: string | null) => (id ? data.products.find((p) => p.id === id)?.available ?? null : null);
  const materialOf = (id: string | null | undefined) => (id ? data.materials.find((m) => m.id === id) ?? null : null);
  // Coût d'une ligne : matériel au coût de l'article, échantillon (client interne) au coût de revient de la fiche.
  const lineCost = (l: EditorLine): string | null =>
    l.inventoryItemId ? materialOf(l.inventoryItemId)?.unitCost ?? null : internal && l.productId ? data.products.find((p) => p.id === l.productId)?.costPrice ?? null : null;
  const watched = lines.filter((l) => l.inventoryItemId || (internal && l.productId));
  const missingCost = watched.filter((l) => !lineCost(l) || Number(lineCost(l)) === 0);
  const outputValue = watched.reduce((a, l) => a + (Number(l.quantity || 0) + Number(l.freeQuantity || 0)) * Number(lineCost(l) ?? 0), 0);
  const chargedValue = internal ? lines.filter((l) => l.productId).reduce((a, l) => a + (Number(l.quantity || 0) + Number(l.freeQuantity || 0)) * Number(lineCost(l) ?? 0), 0) : 0;

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
        {client && client.legalEntities.length > 0 && (
          <label className="block max-w-md">
            <span className="label block mb-1">Au nom de (raison sociale)</span>
            <select className="select h-9" value={legalEntityId} onChange={(e) => setLegalEntityId(e.target.value)} disabled={locked}>
              <option value="">{client.legalName ?? client.name} — fiche client</option>
              {client.legalEntities.map((e) => <option key={e.id} value={e.id}>{e.legalName}{e.ice ? ` — ICE ${e.ice}` : " — ICE manquant"}</option>)}
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label className="block"><span className="label block mb-1">Date</span><input type="date" className="input h-9" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label className="block"><span className="label block mb-1">Site</span>
            <select className="select h-9" value={site} onChange={(e) => setSite(e.target.value)} disabled={locked}>{data.sites.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </label>
          <label className="block"><span className="label block mb-1">Commercial</span>
            <select className="select h-9" value={salesRepId} onChange={(e) => setSalesRepId(e.target.value)}><option value="">—</option>{data.reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </label>
          <label className="block"><span className="label block mb-1">Règlement</span>
            <select className="select h-9" value={paymentModeKey} onChange={(e) => setPaymentModeKey(e.target.value)}><option value="">Selon la fiche client</option>{data.paymentModes.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
          </label>
        </div>
        {internal && (
          <div className="rounded-xl bg-purple-soft border border-purple/30 px-3 py-2 text-[12.5px] space-y-1">
            <div><b>Sortie marketing — {data.natures[client!.outputNatureKey ?? ""] ?? "nature à compléter"}</b> : ce BL ne fait aucun CA. Les produits deviennent une charge marketing au coût de revient figé à la validation ; le matériel est tracé (déjà passé en charge à l&apos;achat).</div>
            <label className="flex items-center gap-2"><span className="text-muted">Activation alimentée</span>
              <select className="select h-8 max-w-sm" value={activationId} onChange={(e) => setActivationId(e.target.value)}>
                <option value="">Aucune</option>{data.activations.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.date}</option>)}
              </select>
            </label>
          </div>
        )}
        {type === "AVOIR" && (
          <label className="block max-w-sm"><span className="label block mb-1">Motif de l&apos;avoir *</span>
            <select className="select h-9" value={reasonKey} required onChange={(e) => {
              // Le dépôt de retour des lignes suit le motif choisi (modifiable ensuite ligne par ligne).
              const next = creditReasons.find((r) => r.key === e.target.value);
              setReasonKey(e.target.value);
              setLines((ls) => ls.map((l) => (l.productId ? { ...l, returnWarehouseKey: next?.returnWarehouseKey ?? null } : l)));
            }}>
              <option value="">Choisir…</option>{reasons.map((r) => <option key={r.key} value={r.key}>{r.label}{r.withReturn ? ` (retour : ${warehouses.find((w) => w.key === r.returnWarehouseKey)?.label ?? r.returnWarehouseKey})` : ""}</option>)}
            </select>
            {reason && <span className="block text-[11.5px] text-muted mt-1">{reason.withReturn
              ? `Les produits rendus rentrent au dépôt « ${warehouses.find((w) => w.key === reason.returnWarehouseKey)?.label ?? reason.returnWarehouseKey} » à la validation (modifiable ligne par ligne).`
              : "Aucun mouvement de stock : seul le montant est crédité au client."}</span>}
          </label>
        )}
      </div>

      {/* Lignes */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Lignes</h3>
          {(type === "FACTURE" || freeCredit) && !locked && <button type="button" className="btn-ghost btn-sm" onClick={addFreeLine}>+ Ligne libre</button>}
        </div>
        {freeCredit && (
          <div className="space-y-2">
            <p className="text-[12px] text-muted">Avoir libre : produits rendus ou crédités (recherche ci-dessous, au dernier prix du client), marques (« Gamarde », « Alphascience »… avec le montant HT remboursé) ou libellés libres. Le motif décide du stock : retour en bon état → remis en stock vendable ; périmé ou abîmé → dépôt non vendable ; crédité sans retour ou financier → aucun mouvement. Une fois validé, le montant devient un crédit client à imputer sur ses factures.</p>
            <select className="select h-10" value={brandPick} onChange={(e) => addBrandLine(e.target.value)}>
              <option value="">Ajouter une marque (montant libre)…</option>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        {!locked && stocked && client && usual.length > 0 && (
          <div className="space-y-1">
            <div className="text-[11.5px] text-muted">Produits habituels de {client.name} (12 mois) — un appui ajoute la quantité moyenne commandée</div>
            <div className="flex flex-wrap gap-1.5">
              {usual.filter((u) => !lines.some((l) => l.productId === u.id)).slice(0, 8).map((u) => {
                const p = data.products.find((x) => x.id === u.id);
                if (!p) return null;
                return (
                  <button key={u.id} type="button" className="btn-secondary btn-sm text-[12px] max-w-full" onClick={() => addProduct(p, u.avgQty)} title={`${u.orders} commande(s), dernière le ${u.lastDate}`}>
                    <span className="truncate">{u.name}</span><span className="text-faint ml-1">× {u.avgQty}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {!locked && (
          <div className="relative">
            <input className="input h-10" placeholder={type === "BL" ? "Ajouter un produit ou du matériel (goodie, PLV) : nom, référence, marque, code-barres…" : freeCredit ? "Ajouter un produit rendu ou crédité : nom, référence, marque ou code-barres…" : stocked ? "Ajouter un article : nom, référence, marque ou code-barres…" : "Ajouter un service ou des frais…"} value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (productMatches[0]) addProduct(productMatches[0]); } }} />
            {(productMatches.length > 0 || materialMatches.length > 0) && (
              <ul className="absolute z-20 left-0 right-0 mt-1 card p-1 max-h-80 overflow-auto shadow-lg">
                {productMatches.map((p) => (
                  <li key={p.id}><button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-2 flex items-center gap-2" onClick={() => addProduct(p)}>
                    {type === "BL" && <Badge tone="blue" className="text-[10.5px] shrink-0">Produit</Badge>}
                    <span className="min-w-0 flex-1"><span className="font-medium">{p.name}</span><span className="text-faint text-[11.5px]"> {[p.ref, p.brand].filter(Boolean).join(" · ")}</span></span>
                    {p.available !== null && <span className={`text-[11.5px] tabular-nums ${Number(p.available) > 0 ? "text-muted" : "text-red"}`}>stock {Number(p.available).toLocaleString("fr-FR")}</span>}
                    {p.publicPriceTtc && <span className="text-[11.5px] text-faint tabular-nums">PPH {fmt(p.publicPriceTtc)}</span>}
                  </button></li>
                ))}
                {materialMatches.map((m) => (
                  <li key={m.id}><button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-2 flex items-center gap-2" onClick={() => addMaterial(m)}>
                    <Badge tone="purple" className="text-[10.5px] shrink-0">Matériel</Badge>
                    <span className="min-w-0 flex-1"><span className="font-medium">{m.name}</span><span className="text-faint text-[11.5px]"> {[m.categoryLabel, m.brand].filter(Boolean).join(" · ")}</span></span>
                    <span className={`text-[11.5px] tabular-nums ${m.stock > 0 ? "text-muted" : "text-red"}`}>stock {m.stock.toLocaleString("fr-FR")}</span>
                    <span className="text-[11.5px] text-faint tabular-nums">offert</span>
                  </button></li>
                ))}
              </ul>
            )}
          </div>
        )}
        {type === "FACTURE" && !locked && <p className="text-[12px] text-muted">Les articles stockés se facturent depuis leurs bons de livraison (onglet « Facturer des BL ») : c&apos;est le BL qui sort le stock.</p>}

        {lines.length === 0 ? (
          <p className="text-muted py-4 text-center">Aucune ligne.</p>
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((l, i) => {
              const mat = materialOf(l.inventoryItemId);
              if (l.inventoryItemId) {
                const shortM = !!mat && Number(l.quantity || 0) > mat.stock;
                const cost = lineCost(l);
                return (
                  <li key={l.key} className="py-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="text-faint text-[11px] w-5 pt-1 tabular-nums">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium flex items-center gap-1.5 flex-wrap"><Badge tone="purple" className="text-[10.5px]">Matériel</Badge>{l.designation}<span className="text-faint text-[11.5px] font-normal">{[mat?.categoryLabel, mat?.brand, l.ref].filter(Boolean).join(" · ")}</span></div>
                        <div className={`text-[11.5px] ${shortM ? "text-red" : "text-faint"}`}>Stock matériel : {mat ? mat.stock.toLocaleString("fr-FR") : "—"}{shortM ? " — insuffisant" : ""} · offert (aucun CA){cost && Number(cost) > 0 ? ` · valeur ${fmt(String(Number(cost) * Number(l.quantity || 0)))} MAD au coût de l'article` : " · coût de l'article à 0 : sortie non valorisée"}</div>
                      </div>
                      <button type="button" className="btn-ghost btn-sm text-red" onClick={() => remove(l.key)} aria-label="Retirer la ligne">✕</button>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pl-7">
                      <label className="block"><span className="label block mb-0.5">Qté ({mat?.unit ?? "u."})</span>
                        <input className="input h-9 text-right" inputMode="numeric" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value.replace(/[^0-9]/g, "") })} /></label>
                    </div>
                  </li>
                );
              }
              const stock = stocked ? available(l.productId) : null;
              const frozen = !!l.sourceLineId && locked;
              const short = stock !== null && Number(l.quantity || 0) + Number(l.freeQuantity || 0) > Number(stock);
              return (
                <li key={l.key} className="py-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-faint text-[11px] w-5 pt-1 tabular-nums">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      {l.productId || l.sourceLineId ? (
                        <div className="font-medium">{l.designation}<span className="text-faint text-[11.5px] font-normal"> {[l.ref, sourceRef(type, l.sourceNumber)].filter(Boolean).join(" · ")}</span></div>
                      ) : (
                        <input className="input h-9" placeholder="Désignation" value={l.designation} onChange={(e) => update(l.key, { designation: e.target.value })} required />
                      )}
                      {stock !== null && <div className={`text-[11.5px] ${short ? "text-red" : "text-faint"}`}>Stock dépôt principal : {Number(stock).toLocaleString("fr-FR")}{short ? " — insuffisant" : ""}</div>}
                      {internal && l.productId && (() => {
                        const c = lineCost(l);
                        return c && Number(c) > 0
                          ? <div className="text-[11.5px] text-faint">Échantillon : {fmt(String((Number(l.quantity || 0) + Number(l.freeQuantity || 0)) * Number(c)))} MAD au coût de revient ({fmt(c)} / u.)</div>
                          : <div className="text-[11.5px] text-orange">Coût de revient {c ? "à 0" : "inconnu"} : la sortie ne sera pas valorisée (renseignez le prix d&apos;achat de la fiche produit).</div>;
                      })()}
                    </div>
                    <button type="button" className="btn-ghost btn-sm text-red" onClick={() => remove(l.key)} aria-label="Retirer la ligne">✕</button>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pl-7">
                    <label className="block"><span className="label block mb-0.5">Qté{l.maxQty ? (locked ? ` (≤ ${Number(l.maxQty).toLocaleString("fr-FR")})` : ` (reste ${Number(l.maxQty).toLocaleString("fr-FR")})`) : ""}</span>
                      <input className="input h-9 text-right" inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value.replace(",", ".") })} /></label>
                    {type !== "AVOIR" && <label className="block"><span className="label block mb-0.5">UG</span>
                      <input className="input h-9 text-right" inputMode="decimal" value={l.freeQuantity} disabled={frozen} onChange={(e) => update(l.key, { freeQuantity: e.target.value.replace(",", ".") })} /></label>}
                    {internal ? (
                      <div className="block col-span-2"><span className="label block mb-0.5">Prix</span><div className="h-9 flex items-center text-muted text-[12px]">sortie marketing : sans prix</div></div>
                    ) : (<>
                    <label className="block"><span className="label block mb-0.5">P.U. HT</span>
                      <input className="input h-9 text-right" inputMode="decimal" value={l.unitPriceHt} disabled={frozen} onChange={(e) => update(l.key, { unitPriceHt: e.target.value.replace(",", ".") })} /></label>
                    <label className="block"><span className="label block mb-0.5">Remise %</span>
                      <input className="input h-9 text-right" inputMode="decimal" value={l.discountPct} disabled={frozen} onChange={(e) => update(l.key, { discountPct: e.target.value.replace(",", ".") })} /></label>
                    </>)}
                    {!l.productId && !l.sourceLineId ? (
                      <label className="block"><span className="label block mb-0.5">TVA %</span>
                        <input className="input h-9 text-right" inputMode="decimal" value={l.taxRate} onChange={(e) => update(l.key, { taxRate: e.target.value.replace(",", ".") })} /></label>
                    ) : <div className="block"><span className="label block mb-0.5">TVA</span><div className="h-9 flex items-center justify-end text-muted">{Number(l.taxRate).toLocaleString("fr-FR")} %</div></div>}
                    <div className="block"><span className="label block mb-0.5">Net HT</span><div className="h-9 flex items-center justify-end font-medium tabular-nums">{calc ? fmt(calc.lines[i].netHt) : "—"}</div></div>
                  </div>
                  {freeCredit && l.productId && (() => {
                    const last = ctx?.lastPrices[l.productId];
                    return <div className="pl-7 text-[11.5px] text-faint">{last
                      ? `Dernier prix de ce client : ${fmt(last.unitPriceHt)} HT, remise ${Number(last.discountPct).toLocaleString("fr-FR")} % (${last.number ?? "pièce"} du ${last.date.split("-").reverse().join("/")})`
                      : ctx ? "Aucune pièce validée de ce produit pour ce client : prix de base PPH HT, remise du client." : null}</div>;
                  })()}
                  {type === "AVOIR" && reason?.withReturn && l.productId && warehouses.length > 0 && (
                    <label className="flex items-center gap-2 pl-7 text-[12px]"><span className="text-muted">Retour au dépôt</span>
                      <select className="select h-8 max-w-48" value={l.returnWarehouseKey ?? reason.returnWarehouseKey ?? "PRINCIPAL"} onChange={(e) => update(l.key, { returnWarehouseKey: e.target.value })}>{warehouses.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}</select>
                    </label>
                  )}
                  {freeCredit && reason?.withReturn && l.productId && data.products.find((p) => p.id === l.productId)?.trackLots && (() => {
                    const known = ctx?.lots[l.productId] ?? [];
                    const listId = `lots-${l.key}`;
                    const setLot = (lotNumber: string) => {
                      // Lot connu : sa péremption ; on quitte un lot connu : la péremption saisie repart de zéro.
                      const k = known.find((x) => x.lotNumber === lotNumber.trim());
                      const wasKnown = known.some((x) => x.lotNumber === l.returnLot?.lotNumber.trim());
                      update(l.key, { returnLot: { lotNumber, expiryDate: k ? k.expiryDate : wasKnown ? null : l.returnLot?.expiryDate ?? null } });
                    };
                    const isKnown = !!l.returnLot && known.some((x) => x.lotNumber === l.returnLot!.lotNumber.trim());
                    return (
                      <div className="flex flex-wrap items-center gap-2 pl-7 text-[12px]">
                        <span className="text-muted">Lot rendu</span>
                        <input className="input h-8 max-w-40" list={listId} placeholder={known.length ? "Choisir ou saisir" : "N° de lot (facultatif)"} value={l.returnLot?.lotNumber ?? ""} onChange={(e) => setLot(e.target.value)} />
                        <datalist id={listId}>{known.map((x) => <option key={x.lotNumber} value={x.lotNumber}>{x.expiryDate ? `péremption ${x.expiryDate.split("-").reverse().join("/")} · ` : ""}livré le {x.lastDate.split("-").reverse().join("/")}</option>)}</datalist>
                        {l.returnLot?.lotNumber.trim() && !isKnown && (
                          <label className="flex items-center gap-1"><span className="text-muted">péremption</span>
                            <input type="date" className="input h-8" value={l.returnLot.expiryDate ?? ""} onChange={(e) => update(l.key, { returnLot: { lotNumber: l.returnLot!.lotNumber, expiryDate: e.target.value || null } })} /></label>
                        )}
                        {!l.returnLot?.lotNumber.trim() && <span className="text-faint">sans lot, l&apos;entrée se fait hors lot</span>}
                      </div>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Pied */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="card p-4 space-y-3">
          {!locked && !internal && (
            <label className="block max-w-40"><span className="label block mb-1">Remise globale %</span>
              <input className="input h-9 text-right" inputMode="decimal" value={globalDiscountPct} onChange={(e) => setGlobal(e.target.value.replace(",", "."))} /></label>
          )}
          {type === "COMMANDE" && <p className="text-[12px] text-muted">Remise pré-remplie avec celle du client (par marque, sinon par défaut), modifiable ligne par ligne. Au-delà de la remise autorisée, la confirmation demande un déblocage ; la remise confirmée est reprise telle quelle sur le BL.</p>}
          <label className="block"><span className="label block mb-1">Note imprimée sur la pièce</span>
            <textarea className="input min-h-16 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></label>
        </div>
        <div className="card p-4 text-[13px] space-y-1 tabular-nums">
          {watched.length > 0 && (
            <div className="pb-2 mb-1 border-b border-line text-[12.5px] space-y-0.5">
              {internal && <div className="flex justify-between"><span className="text-muted">Charge marketing (échantillons)</span><span>{fmt(String(chargedValue))}</span></div>}
              <div className="flex justify-between"><span className="text-muted">Valeur sortie au coût</span><span>{fmt(String(outputValue))}</span></div>
              {missingCost.length > 0 && <div className="text-orange">{missingCost.length} ligne(s) sans coût : non valorisée(s).</div>}
            </div>
          )}
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
        <SubmitButtons type={type} canValidate={canValidate} canSave={!!clientId && lines.length > 0} canConfirm={!!clientId && lines.length > 0 && !!calc} />
      </div>
    </form>
  );
}

/**
 * Boutons d'enregistrement : bloqués dès le premier clic tant que le serveur n'a pas répondu
 * (l'enregistrement peut prendre plusieurs secondes ; un second clic créait une seconde pièce).
 */
function SubmitButtons({ type, canValidate, canSave, canConfirm }: { type: DocType; canValidate: boolean; canSave: boolean; canConfirm: boolean }) {
  const { pending } = useFormStatus();
  const busy = <span>Enregistrement…</span>;
  return (
    <>
      <button type="submit" name="intent" value="save" className="btn-secondary" disabled={pending || !canSave} aria-busy={pending}>
        {pending ? busy : <><span className="lg:hidden">Brouillon</span><span className="hidden lg:inline">Enregistrer le brouillon</span></>}
      </button>
      {canValidate && (
        <button type="submit" name="intent" value="validate" className="btn-primary" disabled={pending || !canConfirm} aria-busy={pending}>
          {pending ? busy : <><span className="lg:hidden">{type === "COMMANDE" ? "Confirmer" : "Valider"}</span><span className="hidden lg:inline">{type === "COMMANDE" ? "Enregistrer et confirmer" : "Enregistrer et valider"}</span></>}
        </button>
      )}
    </>
  );
}
