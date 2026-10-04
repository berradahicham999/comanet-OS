"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { VisitBrief } from "@/lib/crm/intelligence";
import { BriefBody } from "./brief-body";

/** Fiche pré-visite chargée à la demande (au démarrage d'une visite). Hors connexion : indisponible, sans bloquer. */
export function ClientBrief({ clientId }: { clientId: string }) {
  const [brief, setBrief] = useState<VisitBrief | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "offline" | "error">("loading");
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch(`/api/crm/clients/${clientId}/brief`, { cache: "no-store" })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) { setState("error"); return; }
        setBrief(await r.json());
        setState("ok");
      })
      .catch(() => alive && setState("offline"));
    return () => { alive = false; };
  }, [clientId]);
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
          {state === "ok" && brief && <BriefBody brief={brief} />}
        </div>
      )}
    </section>
  );
}
