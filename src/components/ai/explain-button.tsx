"use client";

/**
 * Bouton ✦ « Expliquer » posé sur une carte : envoie le contexte exact de la carte au copilote et affiche
 * l'explication (Donnée / Analyse / Hypothèse / Recommandation) dans un volet sous la carte.
 */
import { useState, useTransition } from "react";
import clsx from "clsx";
import { Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import type { ExplainContext, ExplainResult } from "@/lib/ai/explain-shared";
import { explainCardAction } from "@/app/(app)/ai-actions";
import { AnswerBlocks } from "./answer-blocks";

export function ExplainButton({ context, className }: { context: ExplainContext; className?: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ExplainResult | null>(null);
  const [pending, start] = useTransition();

  function run(force = false) {
    setOpen(true);
    start(async () => { setResult(await explainCardAction(context, { force })); });
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!open) run(); else setOpen(false); }}
        className={clsx("h-7 w-7 rounded-full flex items-center justify-center text-accent hover:bg-accent-soft transition-colors", open && "bg-accent-soft", className)}
        title="Expliquer avec le copilote"
        aria-label={`Expliquer « ${context.title} »`}
        aria-expanded={open}
      >
        <Sparkles size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 card card-pad shadow-[var(--shadow-pop)] w-[400px] max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto text-left cursor-default" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={13} className="text-accent" />
            <span className="label">Explication · {context.title}</span>
            <div className="flex-1" />
            {result?.ok && <button type="button" className="btn-ghost h-7 w-7 p-0 rounded" onClick={() => run(true)} title="Regénérer" aria-label="Regénérer" disabled={pending}><RefreshCw size={13} /></button>}
            <button type="button" className="btn-ghost h-7 w-7 p-0 rounded" onClick={() => setOpen(false)} aria-label="Fermer"><X size={14} /></button>
          </div>
          {pending || !result ? (
            <div className="text-[13px] text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Lecture des données…</div>
          ) : result.ok ? (
            <>
              <AnswerBlocks text={result.text} />
              <div className="text-[11px] text-faint mt-2">{result.cached ? "Explication en cache" : "Générée à l'instant"} · {result.model} · {new Date(result.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
            </>
          ) : (
            <div className="text-[13px] text-ink-2">
              {result.configured ? result.error : <>Copilote non configuré : un administrateur doit renseigner <code className="px-1 rounded bg-black/5">ANTHROPIC_API_KEY</code> sur le serveur.</>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
