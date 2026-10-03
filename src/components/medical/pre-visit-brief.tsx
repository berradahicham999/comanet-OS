"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { DoctorBrief } from "@/lib/medical/prescriptions";
import { BriefView } from "./brief-view";

/** Fiche pré-visite chargée à la demande (au démarrage d'une visite). Hors connexion : indisponible, sans bloquer. */
export function PreVisitBrief({ doctorId }: { doctorId: string }) {
  const [brief, setBrief] = useState<DoctorBrief | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "offline" | "error">("loading");
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch(`/api/medical/doctors/${doctorId}/brief`, { cache: "no-store" })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) { setState("error"); return; }
        setBrief(await r.json());
        setState("ok");
      })
      .catch(() => alive && setState("offline"));
    return () => { alive = false; };
  }, [doctorId]);
  return (
    <section className="rounded-2xl bg-surface border border-line p-4">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between text-[15px] font-semibold text-ink">
        Fiche pré-visite {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && (
        <div className="mt-3">
          {state === "loading" && <div className="text-[13px] text-muted">Chargement…</div>}
          {state === "offline" && <div className="text-[13px] text-muted">Fiche indisponible hors connexion.</div>}
          {state === "error" && <div className="text-[13px] text-muted">Fiche indisponible.</div>}
          {state === "ok" && brief && <BriefView brief={brief} />}
        </div>
      )}
    </section>
  );
}
