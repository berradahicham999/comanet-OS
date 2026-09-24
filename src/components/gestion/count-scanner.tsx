"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Comptage sur téléphone : scan du code-barres par la caméra (API BarcodeDetector, Chrome Android),
 * ou saisie de l'EAN (une douchette tape le code puis Entrée), ou recherche par nom. On choisit le
 * lot, on tape la quantité, on ajoute ; chaque saisie s'additionne à celles des autres compteurs.
 * À l'aveugle, le stock théorique n'est jamais envoyé à cet écran.
 */
export type ScanProduct = { id: string; name: string; ref: string | null; ean: string | null; brand: string | null; trackLots: boolean; lots: { lot: string; expiry: string | null; theoretical?: string }[]; theoretical?: string };
export type MyEntry = { id: string; product: string; ref: string | null; lot_number: string | null; quantity: string; created_at: string };

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function CountScanner({ countId, products, entries, blind, add, remove }: {
  countId: string;
  products: ScanProduct[];
  entries: MyEntry[];
  blind: boolean;
  add: (countId: string, input: { productId: string; lotNumber: string | null; expiryDate: string | null; quantity: string }) => Promise<{ ok: boolean; error?: string }>;
  remove: (countId: string, entryId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ScanProduct | null>(null);
  const [lot, setLot] = useState("");
  const [newLot, setNewLot] = useState(false);
  const [expiry, setExpiry] = useState("");
  const [qty, setQty] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [camera, setCamera] = useState<"off" | "on" | "unsupported">("off");
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const s = norm(query.trim());
    if (!s) return [];
    return products.filter((p) => p.ean === query.trim() || norm(`${p.name} ${p.ref ?? ""} ${p.brand ?? ""}`).includes(s)).slice(0, 8);
  }, [query, products]);

  const pick = (p: ScanProduct) => {
    setPicked(p); setQuery(""); setQty(""); setExpiry("");
    const first = p.lots[0]?.lot ?? "";
    setLot(first); setNewLot(p.trackLots && !first);
    setTimeout(() => qtyRef.current?.focus(), 50);
  };
  const byEan = (code: string) => products.find((p) => p.ean && p.ean === code.trim());

  const stopCamera = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setCamera("off"); };
  useEffect(() => () => stopCamera(), []);
  const startCamera = async () => {
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) { setCamera("unsupported"); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      stream.current = s;
      setCamera("on");
      const det = new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "code_128"] });
      await new Promise((r) => setTimeout(r, 50));
      if (!video.current) return;
      video.current.srcObject = s;
      await video.current.play();
      const loop = async () => {
        if (!stream.current || !video.current) return;
        try {
          const codes = await det.detect(video.current);
          const code = codes[0]?.rawValue;
          if (code) {
            const p = byEan(code);
            stopCamera();
            if (p) pick(p); else { setQuery(code); setMsg({ tone: "err", text: `Code ${code} : aucun article avec cet EAN. Cherchez-le par son nom (et complétez son EAN sur sa fiche).` }); }
            return;
          }
        } catch { /* image pas encore prête */ }
        setTimeout(loop, 250);
      };
      loop();
    } catch {
      setCamera("unsupported");
    }
  };

  const submit = () => {
    if (!picked) return;
    const lotValue = lot.trim() || null;
    if (picked.trackLots && !lotValue) { setMsg({ tone: "err", text: "Article suivi par lot : indiquez le lot." }); return; }
    if (qty.trim() === "" || Number(qty.replace(",", ".")) < 0) { setMsg({ tone: "err", text: "Quantité comptée ?" }); return; }
    start(async () => {
      const r = await add(countId, { productId: picked.id, lotNumber: lotValue, expiryDate: newLot && expiry ? expiry : null, quantity: qty.replace(",", ".") });
      if (!r.ok) { setMsg({ tone: "err", text: r.error ?? "Saisie refusée." }); return; }
      setMsg({ tone: "ok", text: `${picked.name}${lotValue ? ` · lot ${lotValue}` : ""} : ${qty} ajouté(s).` });
      setPicked(null); setQty(""); setLot(""); setNewLot(false);
      router.refresh();
      setTimeout(() => searchRef.current?.focus(), 50);
    });
  };

  return (
    <div className="space-y-4 text-[13px]">
      <div className="card p-4 space-y-3">
        <div className="flex gap-2">
          <input ref={searchRef} autoFocus className="input h-11 text-[15px]" placeholder="Code-barres (EAN), nom ou référence…" value={query} inputMode="search"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const p = byEan(query) ?? (matches.length === 1 ? matches[0] : null); if (p) pick(p); } }} />
          {camera === "on" ? <button type="button" className="btn-secondary" onClick={stopCamera}>Arrêter</button> : <button type="button" className="btn-primary" onClick={startCamera}>Scanner</button>}
        </div>
        {camera === "on" && <video ref={video} className="w-full rounded-xl bg-black aspect-video object-cover" muted playsInline />}
        {camera === "unsupported" && <p className="text-[12px] text-orange">Scan par caméra indisponible sur ce navigateur (il faut Chrome sur Android, ou autoriser la caméra). Tapez l&apos;EAN, utilisez une douchette, ou cherchez par nom.</p>}
        {matches.length > 0 && !picked && (
          <ul className="card p-1 max-h-72 overflow-auto">
            {matches.map((p) => <li key={p.id}><button type="button" className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-surface-2" onClick={() => pick(p)}><span className="font-medium">{p.name}</span> <span className="text-faint text-[11.5px]">{[p.ref, p.brand].filter(Boolean).join(" · ")}</span></button></li>)}
          </ul>
        )}
      </div>

      {picked && (
        <div className="card p-4 space-y-3 border-accent/40">
          <div className="flex items-start gap-2">
            <div className="flex-1"><div className="font-semibold text-[15px]">{picked.name}</div><div className="text-faint text-[12px]">{[picked.ref, picked.brand, picked.ean].filter(Boolean).join(" · ")}</div></div>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPicked(null)}>Changer</button>
          </div>
          {!blind && picked.theoretical !== undefined && <p className="text-[12px] text-muted">Stock théorique : {Number(picked.theoretical).toLocaleString("fr-FR")}</p>}
          {(picked.trackLots || picked.lots.some((l) => l.lot)) && (
            <div className="space-y-2">
              <span className="label block">Lot{picked.trackLots ? " *" : ""}</span>
              <div className="flex flex-wrap gap-2">
                {picked.lots.filter((l) => l.lot).map((l) => (
                  <button key={l.lot} type="button" className={`btn-sm ${!newLot && lot === l.lot ? "btn-primary" : "btn-secondary"}`} onClick={() => { setLot(l.lot); setNewLot(false); }}>
                    {l.lot}{l.expiry ? ` · ${l.expiry.split("-").reverse().join("/")}` : ""}{!blind && l.theoretical !== undefined ? ` · th. ${Number(l.theoretical).toLocaleString("fr-FR")}` : ""}
                  </button>
                ))}
                <button type="button" className={`btn-sm ${newLot ? "btn-primary" : "btn-secondary"}`} onClick={() => { setNewLot(true); setLot(""); }}>Autre lot</button>
              </div>
              {newLot && (
                <div className="grid grid-cols-2 gap-2">
                  <input className="input h-10" placeholder="N° de lot" value={lot} onChange={(e) => setLot(e.target.value)} />
                  <input type="date" className="input h-10" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Péremption" />
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <label className="block flex-1"><span className="label block mb-1">Quantité comptée</span>
              <input ref={qtyRef} className="input h-12 text-[20px] text-right tabular-nums" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} /></label>
            <button type="button" className="btn-primary h-12 px-6" disabled={pending} onClick={submit}>Ajouter</button>
          </div>
        </div>
      )}

      {msg && <div className={`rounded-xl px-3 py-2 text-[12.5px] border ${msg.tone === "ok" ? "bg-green-soft border-green/30 text-green" : "bg-red-soft border-red/30 text-red"}`}>{msg.text}</div>}

      <div className="card p-4">
        <h3 className="font-semibold mb-2">Mes saisies ({entries.length})</h3>
        {entries.length === 0 ? <p className="text-muted">Rien encore. Chaque saisie s&apos;ajoute à celles des autres compteurs : si vous comptez un rayon en deux fois, saisissez les deux.</p> : (
          <ul className="divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id} className="py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0"><div className="truncate">{e.product}</div><div className="text-faint text-[11px]">{[e.ref, e.lot_number ? `lot ${e.lot_number}` : null, e.created_at].filter(Boolean).join(" · ")}</div></div>
                <span className="tabular-nums font-medium">{Number(e.quantity).toLocaleString("fr-FR")}</span>
                <button type="button" className="btn-ghost btn-sm text-red" aria-label="Retirer la saisie" onClick={() => start(async () => { const r = await remove(countId, e.id); if (!r.ok) setMsg({ tone: "err", text: r.error ?? "Suppression refusée." }); router.refresh(); })}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
