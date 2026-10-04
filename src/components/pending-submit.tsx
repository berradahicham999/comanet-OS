"use client";

/**
 * Bouton d'envoi qui se bloque dès le clic tant que l'action serveur tourne (`useFormStatus`), et affiche un message
 * d'attente. Sert aux générations longues du studio créatif (une à trois minutes) : un second clic relancerait une
 * génération payante. Tant qu'un bouton de la page est en cours, tous les autres `PendingSubmit` de la page sont aussi
 * bloqués (« Régénérer » en haut et en bas, « Construire le contenu » sur chaque concept).
 */
import { useEffect, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

/* Nombre d'envois en cours sur la page (partagé par tous les boutons). */
let running = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => running;
const serverSnapshot = () => 0;

export function PendingSubmit({ children, pendingLabel, className = "btn-primary btn-sm", name, value }: { children: React.ReactNode; pendingLabel: string; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  const others = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    if (!pending) return;
    running += 1; emit();
    return () => { running = Math.max(0, running - 1); emit(); };
  }, [pending]);
  const blocked = pending || others > 0;
  return (
    <button type="submit" className={className} disabled={blocked} aria-busy={pending} name={name} value={value} title={!pending && blocked ? "Une génération est déjà en cours sur cette page" : undefined}>
      {pending ? <><Loader2 size={14} className="animate-spin" /> {pendingLabel}</> : children}
    </button>
  );
}
