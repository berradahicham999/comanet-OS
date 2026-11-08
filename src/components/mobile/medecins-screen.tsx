"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { normKey } from "@/lib/import/normalize";
import { useMobile } from "./mobile-app";
import { NoData, Skeleton } from "./mobile-shell";

/** Médecins de ses secteurs, consultables sans réseau. Ceux à voir aujourd'hui ouvrent la liste. */
export function MedecinsScreen() {
  const { phase, snapshot } = useMobile();
  const m = snapshot?.medical ?? null;
  const [q, setQ] = useState("");
  const k = normKey(q);
  const list = useMemo(() => {
    if (!m) return [];
    const today = new Set(m.day.planned.map((p) => p.doctorId));
    const found = k ? m.day.doctors.filter((d) => normKey(`${d.name} ${d.city ?? ""} ${d.sector ?? ""}`).includes(k)) : m.day.doctors;
    return [...found].sort((a, b) => Number(today.has(b.id)) - Number(today.has(a.id))).slice(0, 80).map((d) => ({ ...d, today: today.has(d.id) }));
  }, [m, k]);

  if (phase === "LOADING") return <Skeleton />;
  if (!m) return <NoData />;
  return (
    <div className="space-y-3">
      <h1 className="text-[20px] font-semibold text-ink">Médecins</h1>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, ville ou secteur…" className="input h-12 text-[15px]" aria-label="Rechercher un médecin" />
      {list.length === 0 && <p className="text-[14px] text-muted py-2">Aucun médecin trouvé dans vos secteurs.</p>}
      <ul className="space-y-2">
        {list.map((d) => (
          <li key={d.id}>
            <Link href={`/m/fiche-medecin?id=${d.id}`} prefetch={false} className="card px-3 min-h-[60px] py-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-medium text-ink truncate">Dr {d.name}</div>
                <div className="text-[12.5px] text-muted truncate">{[d.city, d.sector].filter(Boolean).join(" · ") || "—"}</div>
                {d.today && <span className="mt-1 inline-block text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-accent text-white">Visite aujourd&apos;hui</span>}
              </div>
              <ChevronRight size={17} className="text-faint shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
