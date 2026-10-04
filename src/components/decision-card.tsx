import Link from "next/link";
import clsx from "clsx";
import { ArrowUpRight, Check, Plus, X } from "lucide-react";
import { Badge, PriorityBadge, type Tone } from "@/components/ui";
import type { UnifiedDecision } from "@/lib/decisions/types";
import { DECISION_STATUS, DOMAIN_LABELS } from "@/lib/decisions/types";
import type { DataTag } from "@/lib/marketing-intel/types";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import { addDays, fmtDateShort, fmtMAD, iso, today } from "@/lib/format";
import { approveDecisionAction, rejectDecisionAction } from "@/app/(app)/marketing/priorites/actions";

export type UserOption = { id: string; name: string };

const TAG_TONE: Record<DataTag, Tone> = { CONFIRMED: "green", CALCULATED: "blue", INFERRED: "purple", MISSING: "gray" };
const TAG_LABEL: Record<DataTag, string> = { CONFIRMED: "confirmé", CALCULATED: "calculé", INFERRED: "déduit", MISSING: "manquant" };
const CONF_TONE: Record<UnifiedDecision["confidence"]["level"], Tone> = { HIGH: "green", MEDIUM: "yellow", LOW: "gray" };
const CONF_LABEL: Record<UnifiedDecision["confidence"]["level"], string> = { HIGH: "élevée", MEDIUM: "moyenne", LOW: "faible" };
const BAR: Record<string, string> = { CRITICAL: "bg-red", HIGH: "bg-orange", MEDIUM: "bg-yellow", LOW: "bg-faint" };

/**
 * Carte d'une décision unifiée : POURQUOI / DONNÉES (étiquetées) / IMPACT / CONFIANCE / ACTION, et les deux
 * choix humains : approuver (crée l'action et sa tâche) ou refuser (avec raison). Rien n'est exécuté sans ce clic.
 */
export function DecisionCard({ d, rank, users, canDecide, back, compact = false }: { d: UnifiedDecision; rank?: number | null; users: UserOption[]; canDecide: boolean; back: string; compact?: boolean }) {
  const st = DECISION_STATUS[d.status];
  const due = iso(addDays(today(), d.task.dueInDays));
  return (
    <article className={clsx("card overflow-hidden flex", d.status !== "PROPOSED" && "opacity-80")}>
      <div className={clsx("w-1.5 shrink-0", d.doNotPush ? "bg-red" : BAR[d.priority])} />
      <div className="flex-1 min-w-0 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {rank !== null && rank !== undefined && <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">Priorité {rank}</span>}
          <Badge tone={d.doNotPush ? "red" : "accent"}>{d.recommendationLabel}</Badge>
          <PriorityBadge priority={d.priority} />
          <Badge tone="gray">{DOMAIN_LABELS[d.domain]}</Badge>
          {d.status !== "PROPOSED" && <Badge tone={st.tone}>{st.label}{d.state?.decidedBy ? ` · ${d.state.decidedBy}` : ""}</Badge>}
          <span className="flex-1" />
          <Badge tone={CONF_TONE[d.confidence.level]} dot>confiance {CONF_LABEL[d.confidence.level]}{d.confidence.pct !== null ? ` (${d.confidence.pct} %)` : ""}</Badge>
        </div>
        <h3 className="font-semibold text-[15px] leading-snug">{d.entity.href ? <Link href={d.entity.href} className="hover:underline">{d.title}</Link> : d.title}</h3>
        <div className="text-[12px] text-muted mt-0.5">{d.brandName ?? "toutes marques"}{d.period ? ` · ${d.period.label}` : ""}{d.amount !== null ? ` · ${fmtMAD(d.amount, { compact: true })}` : ""}{d.category ? ` · canal suggéré : ${BUDGET_CATEGORY_LABELS[d.category]}` : ""}</div>

        {!compact && (
          <div className="grid md:grid-cols-2 gap-3 mt-3 text-[13px]">
            <div>
              <div className="label mb-1">Pourquoi</div>
              <ul className="list-disc pl-4 space-y-0.5 text-ink-2">{d.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
            <div>
              <div className="label mb-1">Données utilisées</div>
              <ul className="space-y-0.5">{d.evidence.slice(0, 6).map((f, i) => <li key={i} className="flex items-center gap-2 min-w-0"><span className="text-ink-2 truncate">{f.label} :</span><b className="truncate">{f.value}</b><Badge tone={TAG_TONE[f.tag]}>{TAG_LABEL[f.tag]}</Badge></li>)}</ul>
            </div>
          </div>
        )}
        <p className="mt-3 text-[13px]"><span className="label mr-1.5 text-accent">→ Action</span><span className="font-medium">{d.action}</span></p>
        {!compact && d.impact && <p className="mt-1 text-[13px]"><span className="label mr-1.5">Impact attendu</span><span className="text-ink-2">{d.impact}</span></p>}
        {!compact && <p className="mt-1 text-[11.5px] text-faint">{d.confidence.why.join(" ; ")} · à revoir le {fmtDateShort(d.expectedReviewDate)} · source : {d.source}</p>}
        {d.state?.reason && <p className="mt-1 text-[12px] text-muted">Raison : {d.state.reason}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {d.entity.href && <Link href={d.entity.href} className="btn-secondary btn-sm">Voir <ArrowUpRight size={14} /></Link>}
          {d.state?.actionId && <Link href={`/marketing/priorites/${d.state.actionId}`} className="btn-ghost btn-sm">Ouvrir l&apos;action</Link>}
          {canDecide && d.status === "PROPOSED" && !d.doNotPush && (
            <details className="group">
              <summary className="btn-primary btn-sm list-none cursor-pointer"><Plus size={14} /> Approuver → créer l&apos;action</summary>
              <form action={approveDecisionAction} className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-xl border border-line bg-surface-2 p-3 text-[12px]">
                <input type="hidden" name="key" value={d.id} /><input type="hidden" name="brandId" value={d.brandId ?? ""} /><input type="hidden" name="back" value={back} />
                <input type="hidden" name="productId" value={d.productId ?? ""} /><input type="hidden" name="why" value={d.why.join(" ; ")} /><input type="hidden" name="expectedResult" value={d.impact ?? ""} />
                <label className="sm:col-span-3"><span className="label block mb-1">Action</span><input name="title" defaultValue={d.task.title} className="input h-9" required /></label>
                <label><span className="label block mb-1">Responsable</span><select name="assigneeId" className="select h-9"><option value="">Non assigné</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                <label><span className="label block mb-1">Deadline</span><input type="date" name="dueDate" defaultValue={due} className="input h-9" /></label>
                <label><span className="label block mb-1">Priorité</span><select name="priority" defaultValue={d.priority} className="select h-9"><option value="LOW">Basse</option><option value="MEDIUM">Moyenne</option><option value="HIGH">Haute</option><option value="CRITICAL">Critique</option></select></label>
                <label><span className="label block mb-1">Budget prévu (MAD)</span><input name="budgetPlanned" defaultValue={d.amount ?? ""} className="input h-9" placeholder="0" /></label>
                <label><span className="label block mb-1">Canal</span><select name="category" defaultValue={d.category ?? ""} className="select h-9"><option value="">—</option>{BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{BUDGET_CATEGORY_LABELS[c]}</option>)}</select></label>
                <label><span className="label block mb-1">Objectif</span><input name="objective" className="input h-9" placeholder="Résultat visé" /></label>
                <div className="sm:col-span-3 flex justify-end"><button className="btn-primary btn-sm" type="submit"><Check size={14} /> Créer l&apos;action</button></div>
              </form>
            </details>
          )}
          {canDecide && d.status === "PROPOSED" && (
            <details className="group">
              <summary className="btn-ghost btn-sm list-none cursor-pointer"><X size={14} /> Refuser</summary>
              <form action={rejectDecisionAction} className="mt-3 flex flex-wrap gap-2 rounded-xl border border-line bg-surface-2 p-3 text-[12px]">
                <input type="hidden" name="key" value={d.id} /><input type="hidden" name="brandId" value={d.brandId ?? ""} /><input type="hidden" name="back" value={back} />
                <input name="reason" className="input h-9 flex-1 min-w-48" placeholder="Raison (facultatif) : déjà traité, hors saison, décision prise ailleurs…" />
                <button className="btn-secondary btn-sm" type="submit">Confirmer le refus</button>
              </form>
            </details>
          )}
        </div>
      </div>
    </article>
  );
}
