"use client";

import { useState, useTransition } from "react";
import { runWebChecksAction } from "./actions";
import { validateCabinetAction } from "@/app/(app)/medical/suivi/actions";
import { validatePositionAction } from "@/app/(app)/clients/visites/actions";
import type { PlaceKind } from "@/lib/places/web-check-shared";

/** « Vérifier maintenant » : un lot de recherches Google, résultat affiché sur place. */
export function RunWebChecksButton({ kind, batch }: { kind: PlaceKind; batch: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={pending}
        onClick={() => start(async () => {
          const r = await runWebChecksAction(kind);
          setMsg(r.error
            ? { ok: false, text: r.error }
            : { ok: true, text: `${r.checked} fiche(s) vérifiée(s), ${r.found} trouvée(s) sur Google · ${r.validated} position(s) validée(s), ${r.proposed} proposée(s)${r.gaps ? ` · ${r.gaps} nouvel(s) écart(s)` : ""} · ${r.remaining} restante(s).` });
        })}
      >
        {pending ? "Vérification en cours…" : `Vérifier maintenant (${batch} fiches)`}
      </button>
      {msg && <span className={`text-[12.5px] ${msg.ok ? "text-green" : "text-red"}`}>{msg.text}</span>}
    </div>
  );
}

/** Adopte la position Google pour la fiche et la valide (décision humaine, tracée comme une validation sur la carte). */
export function UseWebPositionButton({ kind, id, lat, lng }: { kind: PlaceKind; id: string; lat: number; lng: number }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  if (done) return <span className="text-[12px] text-muted">{done}</span>;
  return (
    <button
      type="button"
      className="btn-ghost btn-sm"
      disabled={pending}
      onClick={() => start(async () => {
        const r = kind === "doctor" ? await validateCabinetAction({ doctorId: id, lat, lng }) : await validatePositionAction({ id, lat, lng });
        setDone(r.ok ? "Position Google validée" : r.message ?? "Refusé");
      })}
    >
      Prendre la position Google
    </button>
  );
}
