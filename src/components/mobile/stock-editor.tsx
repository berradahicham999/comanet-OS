"use client";

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { normKey } from "@/lib/import/normalize";
import type { LastStock, MobileProduct } from "@/lib/mobile/snapshot-shared";
import { useMobile } from "./mobile-app";

const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export const localDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * Relevé de stock d'un point de vente : ce qui a été relevé, et un nouveau relevé (photo datée, jamais d'écrasement).
 * Commun à l'animatrice et au commercial : le serveur choisit le canal selon le métier.
 */
export function StockEditor({ client, products, favoriteIds, last }: { client: { id: string; name: string }; products: MobileProduct[]; favoriteIds: string[]; last: LastStock }) {
  const { submit, online } = useMobile();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [done, setDone] = useState<number | null>(null);

  const list = useMemo(() => {
    const favorites = new Set(favoriteIds);
    const k = normKey(q);
    const all = k ? products.filter((p) => normKey(p.name).includes(k) || normKey(p.brandName ?? "").includes(k)) : products.filter((p) => favorites.has(p.id) || last[p.id]);
    return all.slice(0, 60);
  }, [products, favoriteIds, q, last]);

  const entered = Object.entries(qty).filter(([, v]) => v !== "");

  async function save() {
    if (!entered.length) return;
    await submit("STOCK", { clientId: client.id, date: localDay(), lines: entered.map(([productId, v]) => ({ productId, qty: v })) }, `Stock ${client.name} — ${entered.length} produit${entered.length > 1 ? "s" : ""}`);
    setDone(entered.length);
    setQty({});
  }

  return (
    <div className="space-y-2">
      {done !== null && (
        <div className="rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[14px] text-green font-medium flex items-center gap-2">
          <CheckCircle2 size={18} className="shrink-0" /> <span>Relevé enregistré : {done} produit{done > 1 ? "s" : ""}.{online ? "" : " Il partira au retour du réseau."}</span>
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un produit…" className="input h-12 text-[15px]" aria-label="Chercher un produit" />
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
      <button type="button" disabled={!entered.length} onClick={() => void save()} className="btn-primary w-full h-14 text-[16px] disabled:opacity-50">Enregistrer le relevé</button>
    </div>
  );
}
