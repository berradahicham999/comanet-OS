"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, Minus, Plus, X } from "lucide-react";
import clsx from "clsx";
import { normKey } from "@/lib/import/normalize";
import type { MobileClient } from "@/lib/mobile/snapshot-shared";
import { ClientPicker } from "./client-picker";
import { useMobile } from "./mobile-app";
import { NoData, Skeleton } from "./mobile-shell";
import { localDay } from "./stock-editor";

/**
 * OPÉRATIONS DE TERRAIN — l'animatrice crée son opération (grossiste, événement en parapharmacie…) en une demi-minute,
 * puis en fait le compte rendu. En ligne : la création part aussitôt « Planifiée » sous le seuil, ou à valider au-dessus
 * (`createOperation()`), ce que seul le serveur peut décider. Tout passe par `/api/m/operations`.
 */
type Op = {
  id: string; name: string; typeLabel: string; date: string; endDate: string | null; statusLabel: string; tone: string;
  clientName: string | null; city: string | null; offerLabel: string | null; planned: number; awaitingValidation: boolean; validated: boolean;
  plannedMaterials: { itemId: string; quantity: number; name: string; unit: string }[]; hasReport: boolean; materialsDeclared: boolean;
};
type Data = {
  today: string; autoApproveMax: number;
  types: { key: string; label: string }[]; brands: { id: string; name: string }[];
  products: { id: string; name: string; brandId: string }[]; items: { id: string; name: string; unit: string; stock: number; brandId: string | null }[];
  upcoming: Op[]; toClose: Op[];
  /** D'où viennent les goodies proposés : vos goodies en main, ou le stock central (direction sans goodies en main). */
  stockSource: "MINE" | "CENTRAL";
};

const TONE: Record<string, string> = { yellow: "bg-orange-soft text-orange", blue: "bg-blue-soft text-blue", green: "bg-green-soft text-green", red: "bg-red-soft text-red", accent: "bg-accent-soft text-accent", purple: "bg-purple-soft text-purple" };
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const fmtMad = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} MAD`;

export function useOperationsData() {
  const { online } = useMobile();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/m/operations", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Chargement impossible.");
      setData(j); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Chargement impossible."); }
  }, []);
  useEffect(() => {
    if (!online) return;
    const h = setTimeout(() => void load(), 0);
    return () => clearTimeout(h);
  }, [online, load]);
  return { data, error, reload: load, online };
}

function Offline() {
  return <div className="card p-4 text-[14px] text-muted">Pas de réseau : les opérations se créent et se clôturent en ligne. Vos saisies de ventes, elles, marchent sans réseau.</div>;
}

export function Qty({ value, onChange, label, max }: { value: number; onChange: (n: number) => void; label: string; max?: number }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} className="h-11 w-11 rounded-xl border border-line bg-surface flex items-center justify-center" aria-label={`Un de moins — ${label}`}><Minus size={17} /></button>
      <input value={value || ""} onChange={(e) => onChange(Math.min(max ?? Infinity, Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0)))} inputMode="numeric" placeholder="0" aria-label={label} className="input h-11 w-12 px-1 text-center text-[16px] font-semibold" />
      <button type="button" onClick={() => onChange(Math.min(max ?? Infinity, value + 1))} className="h-11 w-11 rounded-xl bg-accent text-white flex items-center justify-center" aria-label={`Un de plus — ${label}`}><Plus size={17} /></button>
    </div>
  );
}

function OpCard({ o, action }: { o: Op; action?: React.ReactNode }) {
  return (
    <li className="card p-3 space-y-1.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-ink leading-snug">{o.clientName ?? o.name}</div>
          <div className="text-[12.5px] text-muted">{o.typeLabel} · {fmtDay(o.date)}{o.city ? ` · ${o.city}` : ""}</div>
        </div>
        <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium", TONE[o.tone] ?? "bg-surface-2 text-ink-2")}>{o.statusLabel}</span>
      </div>
      {o.offerLabel && <div className="text-[13px] text-ink-2">Offre : {o.offerLabel}</div>}
      {o.plannedMaterials.length > 0 && <div className="text-[12.5px] text-muted">Goodies : {o.plannedMaterials.map((m) => `${m.quantity} ${m.name}`).join(", ")}</div>}
      {o.awaitingValidation && <div className="text-[12.5px] text-orange">Budget {fmtMad(o.planned)} : en attente de la direction.</div>}
      {action}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Liste                                                               */
/* ------------------------------------------------------------------ */

export function OperationsScreen() {
  const { phase } = useMobile();
  const { data, error, online } = useOperationsData();
  if (phase === "LOADING") return <Skeleton />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[20px] font-semibold text-ink">Mes opérations</h1>
        <Link href="/m/operation" prefetch={false} className="btn-primary h-11 px-4 text-[14.5px]">+ Opération</Link>
      </div>
      {!online && <Offline />}
      {error && <div className="card p-3 text-[13.5px] text-red">{error}</div>}
      {online && !data && !error && <Skeleton />}
      {data && (
        <>
          <section>
            <div className="label mb-2">À clôturer ({data.toClose.length})</div>
            {data.toClose.length === 0 ? <p className="text-[13.5px] text-muted">Rien à clôturer.</p> : (
              <ul className="space-y-2">{data.toClose.map((o) => <OpCard key={o.id} o={o} action={o.validated ? <Link href={`/m/operation-cr?id=${o.id}`} prefetch={false} className="btn-primary w-full h-12 text-[15px]">Faire le compte rendu</Link> : null} />)}</ul>
            )}
          </section>
          <section>
            <div className="label mb-2">À venir ({data.upcoming.length})</div>
            {data.upcoming.length === 0 ? <p className="text-[13.5px] text-muted">Aucune opération prévue. Touchez « + Opération » pour en créer une.</p> : (
              <ul className="space-y-2">{data.upcoming.map((o) => <OpCard key={o.id} o={o} action={o.validated && o.date <= data.today ? <Link href={`/m/operation-cr?id=${o.id}`} prefetch={false} className="btn-secondary w-full h-12 text-[15px]">Compte rendu</Link> : null} />)}</ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Création                                                            */
/* ------------------------------------------------------------------ */

export function OperationFormScreen() {
  const { phase, snapshot } = useMobile();
  const { data, error, online } = useOperationsData();
  const t = snapshot?.terrain ?? null;
  const [typeKey, setTypeKey] = useState<string | null>(null);
  const [allTypes, setAllTypes] = useState(false);
  const [client, setClient] = useState<MobileClient | null>(null);
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [productQ, setProductQ] = useState("");
  const [date, setDate] = useState(localDay);
  const [offer, setOffer] = useState("");
  const [goodies, setGoodies] = useState<Record<string, number>>({});
  const [budget, setBudget] = useState("");
  const [offerCost, setOfferCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<{ needsValidation: boolean } | null>(null);

  const foundProducts = useMemo(() => {
    if (!data) return [];
    const k = normKey(productQ);
    if (k.length < 2) return [];
    return data.products.filter((p) => (!brandIds.length || brandIds.includes(p.brandId)) && !productIds.includes(p.id) && normKey(p.name).includes(k)).slice(0, 8);
  }, [data, productQ, brandIds, productIds]);

  if (phase === "LOADING") return <Skeleton />;
  if (!t) return <NoData />;
  if (!online) return <div className="space-y-4"><h1 className="text-[20px] font-semibold text-ink">Nouvelle opération</h1><Offline /></div>;
  if (error) return <div className="card p-3 text-[13.5px] text-red">{error}</div>;
  if (!data) return <Skeleton />;

  const amount = (v: string) => { const n = Number(v.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };
  const total = amount(budget) + amount(offerCost);
  const overMax = Math.round(total * 100) > Math.round(data.autoApproveMax * 100);
  const items = data.items.filter((i) => !i.brandId || !brandIds.length || brandIds.includes(i.brandId));
  const canSave = !!typeKey && !!client && brandIds.length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/m/operations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create", typeKey, clientId: client!.id, brandIds, productIds, date, offerLabel: offer || null,
          plannedMaterials: Object.entries(goodies).filter(([, q]) => q > 0).map(([itemId, quantity]) => ({ itemId, quantity })),
          budget: budget || null, offerCost: offerCost || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Enregistrement impossible.");
      setDone({ needsValidation: j.needsValidation });
      window.scrollTo({ top: 0 });
    } catch (e) { setMsg(e instanceof Error ? e.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[14.5px] text-green font-medium flex items-start gap-2">
          <CheckCircle2 size={19} className="shrink-0 mt-0.5" />
          <span>{done.needsValidation ? `Opération créée. Budget au-dessus de ${fmtMad(data.autoApproveMax)} : elle attend la validation de la direction.` : "Opération créée et planifiée : elle part sans validation."}</span>
        </div>
        <Link href="/m/operations" prefetch={false} className="btn-primary w-full h-14 text-[16px]">Mes opérations</Link>
        <Link href="/m" prefetch={false} className="btn-secondary w-full h-12 text-[15px]">Accueil</Link>
      </div>
    );
  }

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div className="space-y-4">
      <h1 className="text-[20px] font-semibold text-ink">Nouvelle opération</h1>

      <section>
        <span className="label block mb-1.5">Type</span>
        <div className="flex flex-wrap gap-2">
          {/* Les types de terrain d'abord (ordre du référentiel) ; les autres sur demande. */}
          {data.types.filter((ty, i) => allTypes || i < 3 || ty.key === typeKey).map((ty) => (
            <button key={ty.key} type="button" onClick={() => setTypeKey(ty.key)} className={clsx("min-h-11 px-3.5 rounded-full border text-[14px] font-medium", typeKey === ty.key ? "bg-ink text-white border-ink" : "bg-surface border-line text-ink-2")}>{ty.label}</button>
          ))}
          {!allTypes && data.types.length > 3 && <button type="button" onClick={() => setAllTypes(true)} className="min-h-11 px-3.5 rounded-full border border-dashed border-line text-[14px] text-muted">Autres types…</button>}
        </div>
      </section>

      <section>
        <span className="label block mb-1">Client (grossiste ou point de vente)</span>
        <ClientPicker clients={t.clients} value={client} onChange={setClient} online={online} searchUrl="/api/m/operations/clients" />
      </section>

      <section>
        <span className="label block mb-1.5">Marque(s)</span>
        <div className="flex flex-wrap gap-2">
          {data.brands.map((b) => (
            <button key={b.id} type="button" onClick={() => { setBrandIds((l) => toggle(l, b.id)); setProductIds([]); }} className={clsx("min-h-11 px-3.5 rounded-full border text-[14px] font-medium", brandIds.includes(b.id) ? "bg-accent text-white border-accent" : "bg-surface border-line text-ink-2")}>{b.name}</button>
          ))}
        </div>
      </section>

      <section>
        <span className="label block mb-1">Produit(s) mis en avant (facultatif)</span>
        {productIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">{productIds.map((id) => (
            <button key={id} type="button" onClick={() => setProductIds((l) => l.filter((x) => x !== id))} className="min-h-9 px-3 rounded-full bg-surface-2 text-[13px] flex items-center gap-1">{data.products.find((p) => p.id === id)?.name}<X size={13} /></button>
          ))}</div>
        )}
        <input value={productQ} onChange={(e) => setProductQ(e.target.value)} placeholder="Chercher un produit…" className="input h-12 text-[15px]" aria-label="Chercher un produit" />
        {foundProducts.length > 0 && (
          <div className="mt-1.5 rounded-xl border border-line divide-y divide-line bg-surface">
            {foundProducts.map((p) => <button key={p.id} type="button" onClick={() => { setProductIds((l) => [...l, p.id]); setProductQ(""); }} className="w-full text-left px-3 min-h-12 py-2 text-[14px]">{p.name}</button>)}
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-2">
        <label className="block"><span className="label block mb-1">Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className="input h-12" /></label>
        <label className="block"><span className="label block mb-1">Offre proposée</span><input value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="10 + 2, -15 %…" maxLength={200} aria-label="Offre proposée" className="input h-12" /></label>
      </section>

      <section>
        <span className="label block mb-1">Goodies prévus {data.stockSource === "MINE" ? "(vos goodies en main)" : "(stock central)"}</span>
        {items.length === 0 ? <p className="text-[13px] text-muted">{data.stockSource === "MINE" ? <>Vous n&apos;avez aucun goodie en main pour ces marques. Demandez-en au responsable des goodies (<Link href="/m/goodies" prefetch={false} className="text-accent">Mes goodies</Link>).</> : "Aucun goodie au stock central pour ces marques."}</p> : (
          <ul className="space-y-2">{items.map((i) => (
            <li key={i.id} className="card px-3 py-2 flex items-center gap-2">
              <div className="min-w-0 flex-1 text-[14px] leading-snug">{i.name}<div className="text-[12px] text-muted">{i.stock} {data.stockSource === "MINE" ? "en main" : "en stock"}</div></div>
              <Qty value={goodies[i.id] ?? 0} max={i.stock} onChange={(n) => setGoodies((g) => ({ ...g, [i.id]: n }))} label={i.name} />
            </li>
          ))}</ul>
        )}
      </section>

      <section className="grid grid-cols-2 gap-2">
        <label className="block"><span className="label block mb-1">Budget prévu (MAD)</span><input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="facultatif" aria-label="Budget prévu (MAD)" className="input h-12" /></label>
        <label className="block"><span className="label block mb-1">Coût de l&apos;offre / UG</span><input value={offerCost} onChange={(e) => setOfferCost(e.target.value)} inputMode="decimal" placeholder="facultatif" aria-label="Coût de l'offre / UG (MAD)" className="input h-12" /></label>
      </section>
      <p className={clsx("text-[12.5px] -mt-2", overMax ? "text-orange font-medium" : "text-muted")}>
        {overMax ? `Total ${fmtMad(total)} : au-dessus de ${fmtMad(data.autoApproveMax)}, la direction devra valider.` : `Jusqu'à ${fmtMad(data.autoApproveMax)}, l'opération part sans validation.`}
      </p>

      {msg && <div className="rounded-xl bg-red-soft border border-red/30 px-3 py-2 text-[13.5px] text-red">{msg}</div>}
      <button type="button" disabled={!canSave} onClick={() => void save()} className="btn-primary w-full h-14 text-[16px] disabled:opacity-50">{busy ? "Enregistrement…" : "Créer l'opération"}</button>
      {!canSave && !busy && <p className="text-[12.5px] text-muted -mt-2">Type, client et au moins une marque suffisent.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Compte rendu                                                        */
/* ------------------------------------------------------------------ */

/** Photo réduite à 1600 px de côté (JPEG) : envoi rapide en 3G, sous la limite des fonctions serveur. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("photo"))), "image/jpeg", 0.82));
  } catch { return file; }
}

export function OperationReportScreen() {
  const { phase } = useMobile();
  const { data, error, online } = useOperationsData();
  const [id, setId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [pharmacies, setPharmacies] = useState("");
  const [orders, setOrders] = useState("");
  const [amount, setAmount] = useState("");
  const [remark, setRemark] = useState("");
  const [used, setUsed] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { const h = setTimeout(() => setId(new URLSearchParams(window.location.search).get("id")), 0); return () => clearTimeout(h); }, []);
  const op = useMemo(() => [...(data?.toClose ?? []), ...(data?.upcoming ?? [])].find((o) => o.id === id) ?? null, [data, id]);
  useEffect(() => {
    if (!op || used) return;
    const h = setTimeout(() => setUsed(Object.fromEntries(op.plannedMaterials.map((m) => [m.itemId, m.quantity]))), 0);
    return () => clearTimeout(h);
  }, [op, used]);

  if (phase === "LOADING") return <Skeleton />;
  if (!online) return <div className="space-y-4"><h1 className="text-[20px] font-semibold text-ink">Compte rendu</h1><Offline /></div>;
  if (error) return <div className="card p-3 text-[13.5px] text-red">{error}</div>;
  if (!data || !id) return <Skeleton />;
  if (!op) return <div className="card p-4 text-[14px] text-muted">Opération introuvable ou déjà clôturée. <Link href="/m/operations" className="text-accent">Mes opérations</Link></div>;

  const needsGoodies = op.plannedMaterials.length > 0 && !op.materialsDeclared;

  async function save(close: boolean) {
    setBusy(true); setMsg(null);
    try {
      for (const f of photos) {
        const fd = new FormData();
        fd.set("id", op!.id);
        fd.set("file", await shrink(f), f.name.replace(/\.\w+$/, "") + ".jpg");
        const r = await fetch("/api/m/operations/photo", { method: "POST", body: fd });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Envoi de la photo impossible.");
      }
      setPhotos([]);
      const r = await fetch("/api/m/operations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "report", id: op!.id, pharmaciesReached: pharmacies || null, ordersOnSite: orders || null, ordersAmount: amount || null, remark: remark || null,
          materialsUsed: needsGoodies ? Object.entries(used ?? {}).map(([itemId, quantity]) => ({ itemId, quantity })) : null, close,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Enregistrement impossible.");
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (e) { setMsg(e instanceof Error ? e.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[14.5px] text-green font-medium flex items-center gap-2"><CheckCircle2 size={19} className="shrink-0" /> Compte rendu enregistré.</div>
        <Link href="/m/operations" prefetch={false} className="btn-primary w-full h-14 text-[16px]">Mes opérations</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-semibold text-ink">Compte rendu</h1>
        <div className="text-[13.5px] text-muted">{op.clientName ?? op.name} · {fmtDay(op.date)}{op.offerLabel ? ` · ${op.offerLabel}` : ""}</div>
      </div>

      <section>
        <span className="label block mb-1">Photos</span>
        <label className="btn-secondary w-full h-12 text-[15px] flex items-center justify-center gap-2 cursor-pointer">
          <Camera size={18} /> {photos.length ? `${photos.length} photo${photos.length > 1 ? "s" : ""} prête${photos.length > 1 ? "s" : ""}` : "Prendre ou choisir des photos"}
          <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => setPhotos((p) => [...p, ...Array.from(e.target.files ?? [])].slice(0, 8))} />
        </label>
      </section>

      <section className="grid grid-cols-3 gap-2 items-end">
        <label className="block"><span className="label block mb-1 text-[11px]">Pharmacies touchées</span><input value={pharmacies} onChange={(e) => setPharmacies(e.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label="Pharmacies touchées" className="input h-12" /></label>
        <label className="block"><span className="label block mb-1 text-[11px]">Commandes prises</span><input value={orders} onChange={(e) => setOrders(e.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label="Commandes prises" className="input h-12" /></label>
        <label className="block"><span className="label block mb-1 text-[11px]">Montant (MAD)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Montant des commandes (MAD)" className="input h-12" /></label>
      </section>
      <p className="text-[12px] text-muted -mt-2">Commandes et montant sont déclarés par vous ; les ventes réelles se lisent à part.</p>

      {needsGoodies && (
        <section>
          <span className="label block mb-1">Goodies réellement utilisés</span>
          <ul className="space-y-2">{op.plannedMaterials.map((m) => (
            <li key={m.itemId} className="card px-3 py-2 flex items-center gap-2">
              <div className="min-w-0 flex-1 text-[14px] leading-snug">{m.name}<div className="text-[12px] text-muted">{m.quantity} prévu{m.quantity > 1 ? "s" : ""}</div></div>
              <Qty value={used?.[m.itemId] ?? 0} onChange={(n) => setUsed((u) => ({ ...(u ?? {}), [m.itemId]: n }))} label={m.name} />
            </li>
          ))}</ul>
        </section>
      )}

      <label className="block"><span className="label block mb-1">Remarque</span><textarea value={remark} onChange={(e) => setRemark(e.target.value)} className="textarea" placeholder="Accueil, affluence, ce qui a marché…" /></label>

      {msg && <div className="rounded-xl bg-red-soft border border-red/30 px-3 py-2 text-[13.5px] text-red">{msg}</div>}
      <button type="button" disabled={busy} onClick={() => void save(true)} className="btn-primary w-full h-14 text-[16px] disabled:opacity-50">{busy ? "Enregistrement…" : "Enregistrer et clôturer"}</button>
      <button type="button" disabled={busy} onClick={() => void save(false)} className="btn-secondary w-full h-12 text-[15px] disabled:opacity-50">Enregistrer sans clôturer</button>
    </div>
  );
}

/** Bloc de l'accueil : prochaines opérations et celles à clôturer. */
export function HomeOperations() {
  const { data, online } = useOperationsData();
  if (!online || !data) return null;
  const next = data.upcoming[0];
  return (
    <section className="card p-4 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="label">Mes opérations</span>
        <Link href="/m/operations" prefetch={false} className="text-[13px] text-accent min-h-11 flex items-center">Tout voir</Link>
      </div>
      {data.toClose.length > 0 && <Link href="/m/operations" prefetch={false} className="block rounded-xl bg-orange-soft text-orange px-3 py-2 text-[13.5px] font-medium">{data.toClose.length} à clôturer : faites le compte rendu</Link>}
      {next ? <div className="text-[14px] text-ink">Prochaine : <b>{next.clientName ?? next.name}</b> · {fmtDay(next.date)}</div> : <div className="text-[13.5px] text-muted">Aucune opération à venir.</div>}
      <div className="grid grid-cols-2 gap-2">
        <Link href="/m/operation" prefetch={false} className="btn-secondary h-12 text-[15px]">+ Opération</Link>
        <Link href="/m/goodies" prefetch={false} className="btn-secondary h-12 text-[15px]">Mes goodies</Link>
      </div>
    </section>
  );
}
