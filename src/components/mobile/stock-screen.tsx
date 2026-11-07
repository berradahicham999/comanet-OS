"use client";

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { normKey } from "@/lib/import/normalize";
import type { MobileClient } from "@/lib/mobile/snapshot-shared";
import { ClientPicker } from "./client-picker";
import { useMobile } from "./mobile-app";
import { NoData, Skeleton } from "./mobile-shell";
import { localDay } from "./saisie-screen";

const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Stock du point de vente : ce qui a été relevé, et un nouveau relevé (photo datée, jamais d'écrasement). */
export function StockScreen() {
  const { phase, snapshot, submit, online } = useMobile();
  const t = snapshot?.terrain ?? null;
  const [picked, setPicked] = useState<MobileClient | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [done, setDone] = useState<number | null>(null);

  const client = picked ?? t?.clients.find((c) => c.id === (t.planned[0]?.clientId ?? t.lastClientId)) ?? null;
  const last = useMemo(() => (client && t ? (t.lastStock[client.id] ?? {}) : {}), [client, t]);

  const list = useMemo(() => {
    if (!t) return [];
    const favorites = new Set(t.favoriteIds);
    const k = normKey(q);
    const all = k ? t.products.filter((p) => normKey(p.name).includes(k) || normKey(p.brandName ?? "").includes(k)) : t.products.filter((p) => favorites.has(p.id) || last[p.id]);
    return all.slice(0, 60);
  }, [t, q, last]);

  if (phase === "LOADING") return <Skeleton />;
  if (!t) return <NoData />;

  const entered = Object.entries(qty).filter(([, v]) => v !== "");

  async function save() {
    if (!client || !entered.length) return;
    await submit("STOCK", { clientId: client.id, date: localDay(), lines: entered.map(([productId, v]) => ({ productId, qty: v })) }, `Stock ${client.name} — ${entered.length} produit${entered.length > 1 ? "s" : ""}`);
    setDone(entered.length);
    setQty({});
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-[20px] font-semibold text-ink">Stock du point de vente</h1>
      {done !== null && (
        <div className="rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[14px] text-green font-medium flex items-center gap-2">
          <CheckCircle2 size={18} className="shrink-0" /> <span>Relevé enregistré : {done} produit{done > 1 ? "s" : ""}.{online ? "" : " Il partira au retour du réseau."}</span>
        </div>
      )}
      <section>
        <span className="label block mb-1">Point de vente</span>
        <ClientPicker clients={t.clients} value={client} onChange={(c) => { setPicked(c); setQty({}); setDone(null); }} online={online} />
      </section>
      <section>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un produit…" className="input h-12 text-[15px] mb-2" aria-label="Chercher un produit" />
        {list.length === 0 && <p className="text-[13px] text-muted py-2">Aucun relevé encore ici. Cherchez un produit pour le relever.</p>}
        <ul className="space-y-2">
          {list.map((p) => (
            <li key={p.id} className="card px-3 py-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] leading-snug line-clamp-2">{p.name}</div>
                <div className="text-[12px] text-muted">{last[p.id] ? `${last[p.id].quantity} u. le ${shortDate(last[p.id].readAt)}` : "Jamais relevé"}</div>
              </div>
              <input value={qty[p.id] ?? ""} onChange={(e) => setQty((s) => ({ ...s, [p.id]: e.target.value.replace(/\D/g, "") }))} inputMode="numeric" pattern="[0-9]*" placeholder="—" aria-label={`Stock — ${p.name}`} className="input h-12 w-16 px-1 text-center text-[16px] font-semibold shrink-0" />
            </li>
          ))}
        </ul>
      </section>
      <button type="button" disabled={!client || !entered.length} onClick={() => void save()} className="btn-primary w-full h-14 text-[16px] disabled:opacity-50">Enregistrer le relevé</button>
    </div>
  );
}
