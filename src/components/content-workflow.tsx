"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { toneClass } from "@/lib/content/shared";

/**
 * Boutons de transition d'un contenu. La liste vient du serveur (`nextTransitions()`), déjà
 * filtrée par le référentiel ; les étapes réservées aux validateurs sont visibles mais grisées.
 * Une transition à commentaire obligatoire ouvre un champ avant l'envoi.
 */
export type TransitionButton = { toKey: string; label: string | null; requiresComment: boolean; requiresValidator: boolean; allowed: boolean; target: { label: string; tone: string } };

export function ContentWorkflow({ id, transitions, action, redirectTo }: {
  id: string; transitions: TransitionButton[];
  action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState<TransitionButton | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(t: TransitionButton, c?: string) {
    setError(null);
    const fd = new FormData();
    fd.set("id", id); fd.set("to", t.toKey); if (c) fd.set("comment", c);
    start(async () => {
      const r = await action(fd).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      if (!r.ok) setError(r.error ?? "Transition refusée.");
      else { setAsk(null); setComment(""); if (redirectTo) router.push(redirectTo); else router.refresh(); }
    });
  }

  if (!transitions.length) return <p className="text-[12px] text-muted">Aucune étape suivante : ce statut est final ou aucune transition n&apos;est configurée.</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {transitions.map((t) => (
          <button key={t.toKey} type="button" disabled={!t.allowed || pending}
            onClick={() => (t.requiresComment ? setAsk(t) : run(t))}
            title={!t.allowed ? "Réservé aux validateurs (Administration, droit « Valider » sur Marketing, ou validateur de la marque)" : undefined}
            className={clsx("btn-sm rounded-lg border px-2.5 h-8 text-[12.5px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40", toneClass(t.target.tone), "border-transparent hover:brightness-95")}>
            {t.label ?? t.target.label}{t.requiresValidator && <span aria-hidden>🔒</span>}
          </button>
        ))}
      </div>
      {ask && (
        <div className="rounded-xl border border-line p-3 space-y-2 bg-surface-2/60">
          <div className="text-[13px] font-medium">{ask.label ?? ask.target.label} — commentaire obligatoire</div>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} className="textarea min-h-[70px]" placeholder="Ce qui doit être corrigé, précisément (le créateur le reçoit en notification)…" autoFocus />
          <div className="flex gap-2">
            <button type="button" className="btn-primary btn-sm" disabled={!comment.trim() || pending} onClick={() => run(ask, comment)}>Envoyer</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => { setAsk(null); setComment(""); }}>Annuler</button>
          </div>
        </div>
      )}
      {error && <p className="text-[12.5px] text-red">{error}</p>}
    </div>
  );
}
