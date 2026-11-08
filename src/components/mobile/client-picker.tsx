"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { normKey } from "@/lib/import/normalize";
import type { MobileClient } from "@/lib/mobile/snapshot-shared";

/**
 * Choix du point de vente : ceux gardés sur le téléphone, sans réseau. Au-delà, recherche en ligne ; le résultat choisi
 * sert à la saisie en cours et n'est pas stocké.
 */
export function ClientPicker({ clients, value, onChange, online }: { clients: MobileClient[]; value: MobileClient | null; onChange: (c: MobileClient) => void; online: boolean }) {
  const [open, setOpen] = useState(!value);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<MobileClient[]>([]);

  const local = useMemo(() => {
    const k = normKey(q);
    const list = k ? clients.filter((c) => normKey(c.name).includes(k) || normKey(c.city ?? "").includes(k)) : clients;
    return list.slice(0, 40);
  }, [clients, q]);

  useEffect(() => {
    if (!online || normKey(q).length < 2) return;
    let stale = false;
    const t = setTimeout(() => {
      fetch(`/api/m/clients?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { clients: [] }))
        .then((r: { clients: MobileClient[] }) => { if (!stale) setRemote(r.clients); })
        .catch(() => {});
    }, 300);
    return () => { stale = true; clearTimeout(t); };
  }, [q, online]);

  const others = normKey(q).length >= 2 ? remote.filter((r) => !local.some((c) => c.id === r.id)) : [];

  if (value && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full min-h-12 rounded-xl border border-line bg-surface px-3 py-2 flex items-center justify-between gap-2 text-left text-[15px] font-medium">
        <span className="min-w-0 truncate">{value.name}{value.city ? <span className="text-muted font-normal"> — {value.city}</span> : null}</span>
        <ChevronDown size={16} className="text-faint shrink-0" />
      </button>
    );
  }
  const pick = (c: MobileClient) => { onChange(c); setQ(""); setOpen(false); };
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou ville du point de vente…" className="input h-12 text-[15px] mb-1.5" aria-label="Rechercher un point de vente" />
      <div className="max-h-64 overflow-y-auto rounded-xl border border-line divide-y divide-line bg-surface">
        {local.length === 0 && others.length === 0 && <div className="px-3 py-3 text-[13px] text-muted">{online ? "Aucun résultat." : "Aucun résultat sur ce téléphone. Les autres points de vente se cherchent avec du réseau."}</div>}
        {[...local, ...others].map((c) => (
          <button key={c.id} type="button" onClick={() => pick(c)} className="w-full text-left px-3 min-h-12 py-2 text-[14px]">
            {c.name}{c.city ? <span className="text-muted"> — {c.city}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
