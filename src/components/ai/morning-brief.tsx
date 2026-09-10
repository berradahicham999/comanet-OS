"use client";

/**
 * Brief du matin en haut du Cockpit (direction). Lit le brief du jour en cache ; s'il n'existe pas encore,
 * le génère à l'ouverture. Chaque action du jour a un bouton « Créer la tâche ».
 */
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Check, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { BriefResult } from "@/lib/ai/brief-shared";
import { createTaskFromBriefAction, generateBriefAction } from "@/app/(app)/ai-actions";
import { PriorityBadge } from "@/components/ui";
import { Inline } from "./answer-blocks";

export function MorningBrief({ initial, configured }: { initial: BriefResult | null; configured: boolean }) {
  const [result, setResult] = useState<BriefResult | null>(initial);
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});

  const needsGeneration = configured && (!initial || (!initial.ok && initial.configured));
  useEffect(() => {
    if (needsGeneration) start(async () => { setResult(await generateBriefAction({ force: false })); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function regenerate() { start(async () => { setResult(await generateBriefAction({ force: true })); }); }

  async function createTask(i: number) {
    setCreating(i);
    const r = await createTaskFromBriefAction(i);
    if (r.ok) setResult((cur) => (cur && cur.ok ? { ...cur, brief: { ...cur.brief, createdTaskIds: { ...cur.brief.createdTaskIds, [i]: r.taskId } } } : cur));
    else setErrors((e) => ({ ...e, [i]: r.error }));
    setCreating(null);
  }

  if (!configured) return null;

  return (
    <section className="card card-pad border-accent/30 bg-accent-soft/40 mb-5">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={15} className="text-accent" />
        <div className="label">Brief du matin</div>
        <div className="flex-1" />
        {result?.ok && <span className="text-[11px] text-faint">{result.cached ? "généré" : "généré à l'instant"} à {new Date(result.brief.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · {result.brief.model}</span>}
        <button type="button" className="btn-ghost h-7 w-7 p-0 rounded" onClick={regenerate} disabled={pending} title="Regénérer" aria-label="Regénérer le brief"><RefreshCw size={13} className={clsx(pending && "animate-spin")} /></button>
      </div>
      {pending && !result?.ok ? (
        <div className="text-[13px] text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Le copilote lit les données du jour…</div>
      ) : !result ? null : !result.ok ? (
        <div className="text-[13px] text-ink-2">{result.error}</div>
      ) : (
        <>
          <ul className="text-[13.5px] space-y-1 list-disc pl-5">
            {result.brief.text.split("\n").map((l) => l.replace(/^\s*[-*•]\s+/, "").trim()).filter(Boolean).map((l, i) => <li key={i}><Inline text={l} /></li>)}
          </ul>
          {result.brief.actions.length > 0 && (
            <div className="mt-3 grid md:grid-cols-3 gap-2">
              {result.brief.actions.map((a, i) => {
                const taskId = result.brief.createdTaskIds[i];
                return (
                  <div key={i} className="card card-pad bg-surface">
                    <div className="flex items-center gap-2 mb-1"><PriorityBadge priority={a.priority} /><span className="text-[11px] text-faint">J+{a.due_in_days} · {a.assignee_role || "à assigner"}</span></div>
                    <div className="font-medium text-[13.5px]">{a.title}</div>
                    <div className="text-[12px] text-ink-2 mt-1"><span className="font-medium">Pourquoi :</span> {a.why}</div>
                    <div className="text-[12px] text-muted mt-1"><span className="font-medium">Résultat attendu :</span> {a.expected}</div>
                    <div className="mt-2 flex items-center gap-2">
                      {taskId ? (
                        <Link href={`/taches/${taskId}`} className="btn-secondary btn-sm inline-flex items-center gap-1"><Check size={13} /> Tâche créée</Link>
                      ) : (
                        <button type="button" className="btn-primary btn-sm" onClick={() => createTask(i)} disabled={creating === i}>{creating === i ? "Création…" : "Créer la tâche"}</button>
                      )}
                      {errors[i] && <span className="text-[12px] text-red">{errors[i]}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
