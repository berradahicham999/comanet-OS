"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

/** Copie un texte préparé côté serveur dans le presse-papiers (ex. le brief à coller dans un assistant IA). */
export function CopyButton({ text, label, className = "btn-secondary btn-sm" }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setDone(true); setFailed(false); setTimeout(() => setDone(false), 2000); }
    catch { setFailed(true); }
  }
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={copy} className={`${className} inline-flex items-center gap-1.5`}>
        {done ? <Check size={13} /> : <Copy size={13} />} {done ? "Copié" : label}
      </button>
      {failed && <span className="text-[11px] text-red mt-1">Copie refusée par le navigateur.</span>}
    </span>
  );
}
