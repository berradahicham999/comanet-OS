"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { normKey } from "@/lib/import/normalize";
import { fmtMadCompact } from "@/lib/mobile/format";
import type { PortfolioClient } from "@/lib/mobile/snapshot-shared";
import { useMobile } from "./mobile-app";
import { NoData, Skeleton } from "./mobile-shell";

/** Tendance : un chiffre mesuré, ou « — » si la comparaison n'existe pas. */
export function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted">—</span>;
  const v = Math.round(pct);
  return <span className={v >= 0 ? "text-green" : "text-red"}>{v > 0 ? "+" : ""}{v} %</span>;
}

const SEGMENT_TONE: Record<string, string> = {
  CROISSANCE: "bg-green-soft text-green",
  STABLE: "bg-sunk text-ink-2",
  A_RISQUE: "bg-orange-soft text-orange",
  INACTIF: "bg-red-soft text-red",
  NOUVEAU: "bg-accent-soft text-accent",
};

function Row({ c, today }: { c: PortfolioClient; today: boolean }) {
  return (
    <li>
      <Link href={`/m/client?id=${c.id}`} prefetch={false} className="card px-3 py-2.5 min-h-[60px] flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium text-ink truncate">{c.name}</div>
          <div className="text-[12.5px] text-muted truncate">
            {c.city ?? "Ville inconnue"} · {fmtMadCompact(c.revenue12)} · <Trend pct={c.growthPct} />
          </div>
          <div className="mt-1 flex flex-wrap gap-1 text-[11px] font-medium">
            {today && <span className="px-1.5 py-0.5 rounded-full bg-accent text-white">Visite aujourd&apos;hui</span>}
            <span className={`px-1.5 py-0.5 rounded-full ${SEGMENT_TONE[c.segment] ?? "bg-sunk text-ink-2"}`}>{c.segmentLabel}</span>
            {c.orderLate && <span className="px-1.5 py-0.5 rounded-full bg-orange-soft text-orange">Commande en retard</span>}
          </div>
        </div>
        <ChevronRight size={17} className="text-faint shrink-0" />
      </Link>
    </li>
  );
}

/** Qu'est-ce que je dois faire maintenant ? Les visites du jour, puis les commandes en retard, puis le plus gros chiffre d'affaires. */
export function ClientsScreen() {
  const { phase, snapshot, online } = useMobile();
  const c = snapshot?.commercial ?? null;
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<{ id: string; name: string; city: string | null }[]>([]);

  const today = useMemo(() => new Set(c?.todayIds ?? []), [c]);
  const k = normKey(q);
  const found = useMemo(() => {
    if (!c) return [];
    const list = k ? c.clients.filter((x) => normKey(x.name).includes(k) || normKey(x.city ?? "").includes(k)) : c.clients;
    return list.slice(0, 60);
  }, [c, k]);

  useEffect(() => {
    if (!online || k.length < 2) return;
    let stale = false;
    const t = setTimeout(() => {
      fetch(`/api/m/clients?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { clients: [] }))
        .then((r: { clients: typeof remote }) => { if (!stale) setRemote(r.clients); })
        .catch(() => {});
    }, 300);
    return () => { stale = true; clearTimeout(t); };
  }, [q, k, online]);

  if (phase === "LOADING") return <Skeleton />;
  if (!c) return <NoData />;

  const others = k.length >= 2 ? remote.filter((r) => !c.clients.some((x) => x.id === r.id)) : [];

  return (
    <div className="space-y-3">
      <h1 className="text-[20px] font-semibold text-ink">Mes clients</h1>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou ville…" className="input h-12 text-[15px]" aria-label="Rechercher un client" />
      {c.clients.length === 0 && !k && <p className="card p-4 text-[14px] text-muted">Aucun client dans votre portefeuille. La direction l&apos;affecte depuis Clients → Portefeuilles ; en attendant, cherchez un client par son nom.</p>}
      {found.length === 0 && others.length === 0 && k && <p className="text-[14px] text-muted py-2">{online ? "Aucun client trouvé." : "Aucun client trouvé sur ce téléphone. Les autres se cherchent avec du réseau."}</p>}
      <ul className="space-y-2">
        {found.map((x) => <Row key={x.id} c={x} today={today.has(x.id)} />)}
        {others.map((x) => (
          <li key={x.id}>
            <Link href={`/m/client?id=${x.id}`} prefetch={false} className="card px-3 min-h-[60px] flex items-center gap-2">
              <div className="min-w-0 flex-1"><div className="text-[14.5px] font-medium text-ink truncate">{x.name}</div><div className="text-[12.5px] text-muted truncate">{x.city ?? "Ville inconnue"}</div></div>
              <ChevronRight size={17} className="text-faint shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
