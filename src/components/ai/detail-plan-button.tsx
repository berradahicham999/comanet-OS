"use client";

/** Bouton « Détailler » d'une recommandation : demande un plan d'exécution au copilote et l'affiche sous la carte. */
import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, ListChecks, Loader2, RefreshCw } from "lucide-react";
import type { PlanResult, RecSummary, StoredPlan } from "@/lib/ai/plans-shared";
import { detailRecommendationAction } from "@/app/(app)/ai-actions";
import { AnswerBlocks } from "./answer-blocks";

export function DetailPlanButton({ rec, initial }: { rec: RecSummary; initial: StoredPlan | null }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PlanResult | null>(initial ? { ok: true, plan: initial, cached: true } : null);
  const [pending, start] = useTransition();

  function run(force = false) {
    setOpen(true);
    start(async () => { setResult(await detailRecommendationAction(rec, { force })); });
  }

  return (
    <div className="w-full">
      <button type="button" className="btn-secondary btn-sm" onClick={() => (result?.ok ? setOpen((v) => !v) : run())} disabled={pending}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : <ListChecks size={14} />}
        {result?.ok ? (open ? "Masquer le plan" : "Voir le plan") : "Détailler"}
        {result?.ok && (open ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
      </button>
      {open && (
        <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
          {pending || !result ? (
            <div className="text-[13px] text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Le copilote relit la donnée et rédige le plan…</div>
          ) : result.ok ? (
            <>
              <AnswerBlocks text={result.plan.contentMd} />
              <div className="mt-2 flex items-center gap-2 text-[11px] text-faint">
                <span>Plan {result.cached ? "enregistré" : "généré"} le {new Date(result.plan.updatedAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{result.plan.model ? ` · ${result.plan.model}` : ""}</span>
                <button type="button" className="btn-ghost h-6 px-1.5 rounded text-[11px] inline-flex items-center gap-1" onClick={() => run(true)}><RefreshCw size={11} /> Regénérer</button>
              </div>
            </>
          ) : (
            <div className="text-[13px] text-ink-2">{result.configured ? result.error : <>Copilote non configuré : un administrateur doit renseigner <code className="px-1 rounded bg-black/5">ANTHROPIC_API_KEY</code> sur le serveur.</>}</div>
          )}
        </div>
      )}
    </div>
  );
}
