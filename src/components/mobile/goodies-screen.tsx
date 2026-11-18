"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { useMobile } from "./mobile-app";
import { Skeleton } from "./mobile-shell";
import { Qty } from "./operations-screen";

/**
 * MES GOODIES — ce que la personne a en main, et le transfert : donner à une collègue, rendre au stock central. Le
 * responsable des goodies (et la direction) distribue aussi depuis le stock central. En ligne seulement : le refus
 * au-delà du stock en main est décidé par le serveur (`transferMaterial()`).
 */
type Held = { itemId: string; name: string; brand: string | null; unit: string; held: number };
type Move = { id: string; date: string; itemName: string; type: string; quantity: number; reason: string | null; activation: string | null };
type Data = {
  today: string; me: string; canManage: boolean; mine: Held[]; central: Held[]; movements: Move[];
  recipients: { id: string; name: string }[]; team: { id: string; name: string; held: number; received: number; used: number }[];
};

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

export function GoodiesScreen() {
  const { phase, online } = useMobile();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState<"me" | "central">("me");
  const [itemId, setItemId] = useState("");
  const [to, setTo] = useState("");
  const [qty, setQty] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/m/goodies", { cache: "no-store" });
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

  if (phase === "LOADING") return <Skeleton />;
  const source = data ? (from === "central" ? data.central : data.mine) : [];
  const item = source.find((i) => i.itemId === itemId) ?? null;
  const recipientName = to === "central" ? "stock central" : to === data?.me ? "moi" : data?.recipients.find((r) => r.id === to)?.name ?? "";

  async function submit() {
    if (!item || !to || qty <= 0) return;
    setBusy(true); setError(null); setDone(null);
    try {
      const r = await fetch("/api/m/goodies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to, itemId: item.itemId, quantity: qty }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Transfert impossible.");
      setDone(`${qty} ${item.name} → ${recipientName}`);
      setQty(0); setItemId("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Transfert impossible."); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[20px] font-semibold text-ink">Mes goodies</h1>
        <Link href="/m/operations" prefetch={false} className="text-[13.5px] text-accent min-h-11 flex items-center">Mes opérations</Link>
      </div>
      {!online && <div className="card p-4 text-[14px] text-muted">Pas de réseau : vos goodies s&apos;affichent et se transfèrent en ligne.</div>}
      {error && <div className="card p-3 text-[13.5px] text-red" role="alert">{error}</div>}
      {done && <div className="card p-3 text-[13.5px] text-green flex items-center gap-2"><CheckCircle2 size={17} />Transféré : {done}</div>}
      {online && !data && !error && <Skeleton />}
      {data && (
        <>
          <section>
            <div className="label mb-2">En main ({data.mine.reduce((s, i) => s + i.held, 0)})</div>
            {data.mine.length === 0 ? <p className="text-[13.5px] text-muted">Vous n&apos;avez aucun goodie en main. Le responsable des goodies vous en transfère ; ils apparaîtront ici et dans le formulaire d&apos;opération.</p> : (
              <ul className="card divide-y divide-line">{data.mine.map((i) => (
                <li key={i.itemId} className="px-3 py-2.5 flex items-center gap-2">
                  <div className="min-w-0 flex-1 text-[14px] leading-snug">{i.name}{i.brand ? <div className="text-[12px] text-muted">{i.brand}</div> : null}</div>
                  <div className="text-[16px] font-semibold tabular-nums">{i.held}</div>
                </li>
              ))}</ul>
            )}
          </section>

          {(data.mine.length > 0 || data.canManage) && (
            <section className="card p-3 space-y-3">
              <div className="label">{data.canManage ? "Distribuer ou rendre" : "Donner à une collègue ou rendre"}</div>
              {data.canManage && (
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Depuis">
                  {(["central", "me"] as const).map((f) => (
                    <button key={f} type="button" role="radio" aria-checked={from === f} onClick={() => { setFrom(f); setItemId(""); setQty(0); }}
                      className={clsx("h-11 rounded-xl border text-[14px]", from === f ? "border-accent bg-accent-soft text-accent font-medium" : "border-line bg-surface")}>
                      {f === "central" ? "Stock central" : "Mes goodies"}
                    </button>
                  ))}
                </div>
              )}
              <label className="block"><span className="label block mb-1">Goodie</span>
                <select value={itemId} onChange={(e) => { setItemId(e.target.value); setQty(0); }} className="select h-12" aria-label="Goodie">
                  <option value="">Choisir…</option>
                  {source.map((i) => <option key={i.itemId} value={i.itemId}>{i.name} ({i.held} {from === "central" ? "en stock" : "en main"})</option>)}
                </select>
              </label>
              <label className="block"><span className="label block mb-1">À qui</span>
                <select value={to} onChange={(e) => setTo(e.target.value)} className="select h-12" aria-label="Destinataire">
                  <option value="">Choisir…</option>
                  {data.recipients.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  {from === "me" && <option value="central">Rendre au stock central</option>}
                  {from === "central" && <option value={data.me}>Moi</option>}
                </select>
              </label>
              {item && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] text-muted">Quantité (max {item.held})</span>
                  <Qty value={qty} max={item.held} onChange={setQty} label={`Quantité de ${item.name}`} />
                </div>
              )}
              <button type="button" disabled={busy || !item || !to || qty <= 0} onClick={() => void submit()} className="btn-primary w-full h-12 text-[15px] disabled:opacity-50">
                {busy ? "Transfert…" : item && to && qty > 0 ? (to === "central" ? `Rendre ${qty} au stock central` : `Transférer ${qty} à ${recipientName}`) : "Transférer"}
              </button>
            </section>
          )}

          {data.canManage && data.team.length > 0 && (
            <section>
              <div className="label mb-2">Chez l&apos;équipe</div>
              <ul className="card divide-y divide-line">{data.team.map((t) => (
                <li key={t.id} className="px-3 py-2.5 text-[13.5px] flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="text-muted tabular-nums">reçu {t.received} · utilisé {t.used}</span>
                  <span className="font-semibold tabular-nums w-10 text-right">{t.held}</span>
                </li>
              ))}</ul>
            </section>
          )}

          <section>
            <div className="label mb-2">Derniers mouvements</div>
            {data.movements.length === 0 ? <p className="text-[13.5px] text-muted">Aucun mouvement.</p> : (
              <ul className="card divide-y divide-line">{data.movements.map((m) => (
                <li key={m.id} className="px-3 py-2 text-[13px] flex items-center gap-2">
                  <span className="text-muted w-14 shrink-0">{fmtDay(m.date)}</span>
                  <span className="min-w-0 flex-1 leading-snug">{m.itemName}<span className="block text-[11.5px] text-muted truncate">{m.activation ? `Opération : ${m.activation}` : m.reason ?? m.type}</span></span>
                  <span className={clsx("font-semibold tabular-nums", m.quantity > 0 ? "text-green" : "text-ink")}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
                </li>
              ))}</ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
