"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { OutboxItem } from "@/lib/mobile/outbox-shared";
import { useMobile } from "./mobile-app";
import { Skeleton } from "./mobile-shell";

/**
 * Écran de conflits : il n'apparaît que si le serveur a refusé une saisie. Rien n'est effacé sans que la personne l'ait
 * décidé : le serveur peut refuser, seule elle peut abandonner.
 */
function Item({ item }: { item: OutboxItem }) {
  const { abandon } = useMobile();
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="card p-4 space-y-2">
      <div className="font-medium text-ink text-[14.5px]">{item.label}</div>
      <p className="text-[13.5px] text-red">{item.error?.message ?? "Saisie refusée."}</p>
      {item.error?.existingId && <a href={`/terrain/${item.error.existingId}`} className="btn-secondary w-full h-12 text-[14px]">Ouvrir la saisie existante</a>}
      {confirming ? (
        <div className="flex gap-2">
          <button type="button" onClick={() => setConfirming(false)} className="btn-secondary flex-1 h-12">Garder</button>
          <button type="button" onClick={() => void abandon(item.clientEventId)} className="btn-primary flex-1 h-12 bg-red">Oui, abandonner</button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="min-h-11 text-[13.5px] text-muted">Abandonner cette saisie</button>
      )}
    </li>
  );
}

export function FixScreen() {
  const { phase, toFix } = useMobile();
  if (phase === "LOADING") return <Skeleton />;
  return (
    <div className="space-y-4">
      <h1 className="text-[20px] font-semibold text-ink">À corriger</h1>
      {toFix.length === 0 ? (
        <div className="card p-4 flex items-center gap-2 text-[14px] text-muted"><CheckCircle2 size={18} className="text-green" /> Rien à corriger.</div>
      ) : (
        <ul className="space-y-3">{toFix.map((i) => <Item key={i.clientEventId} item={i} />)}</ul>
      )}
    </div>
  );
}
