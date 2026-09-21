import Link from "next/link";
import clsx from "clsx";
import { ArrowUpRight, CheckCircle2, Plus } from "lucide-react";
import { Badge, PriorityBadge } from "@/components/ui";
import { CATEGORY_META, type RecommendationWithState } from "@/lib/rules/types";
import { createTaskFromRecommendation } from "@/app/(app)/actions/actions";
import { addDays, iso, today } from "@/lib/format";
import type { UserRole } from "@/db/schema";
import { DetailPlanButton } from "@/components/ai/detail-plan-button";
import { recSummary, type StoredPlan } from "@/lib/ai/plans-shared";

export type UserOption = { id: string; name: string; role: UserRole };

const BAR: Record<string, string> = { CRITICAL: "bg-red", HIGH: "bg-orange", MEDIUM: "bg-yellow", LOW: "bg-faint" };

export function RecommendationCard({ rec, users, compact = false, redirectTo, copilot = false, plan = null }: {
  rec: RecommendationWithState; users: UserOption[]; compact?: boolean; redirectTo?: string;
  /** Copilote ouvert à la personne : affiche « Détailler » (plan d'exécution). */
  copilot?: boolean;
  /** Plan déjà enregistré pour cette recommandation. */
  plan?: StoredPlan | null;
}) {
  const cat = CATEGORY_META[rec.category];
  const defaultAssignee = (rec.suggestedAssigneeId ? users.find((u) => u.id === rec.suggestedAssigneeId) : undefined) ?? users.find((u) => u.role === rec.task.role) ?? users.find((u) => u.role === "ADMIN");
  const due = iso(addDays(today(), rec.task.dueInDays));
  const description = `${rec.why}\n\nAction recommandée : ${rec.action}`;
  return (
    <article className="card overflow-hidden flex">
      <div className={clsx("w-1.5 shrink-0", BAR[rec.priority])} />
      <div className="flex-1 min-w-0 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge tone={cat.tone}>{cat.label}</Badge>
          <PriorityBadge priority={rec.priority} />
          {rec.existingTask && (
            <Badge tone="green"><CheckCircle2 size={12} /> Tâche {rec.existingTask.status === "IN_PROGRESS" ? "en cours" : "créée"}{rec.existingTask.assignee ? ` · ${rec.existingTask.assignee}` : ""}</Badge>
          )}
        </div>
        <h3 className="font-semibold text-[15px] leading-snug">
          {rec.entity?.href ? <Link href={rec.entity.href} className="hover:underline">{rec.title}</Link> : rec.title}
        </h3>
        {rec.subtitle && <div className="text-[13px] text-muted mt-0.5">{rec.subtitle}</div>}

        {!compact && (
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
            {rec.facts.map((f, i) => (
              <div key={i} className="min-w-0">
                <dt className="text-[11px] text-muted">{f.label}</dt>
                <dd className="text-[13px] font-medium truncate" title={f.value}>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className={clsx("mt-3 space-y-2 text-[13px]", compact && "line-clamp-3")}>
          {!compact && (
            <p><span className="label mr-1.5">Pourquoi</span><span className="text-ink-2">{rec.why}</span></p>
          )}
          <p><span className="label mr-1.5 text-accent">→ Action</span><span className="font-medium">{rec.action}</span></p>
          {!compact && rec.impact && <p><span className="label mr-1.5">Impact</span><span className="text-ink-2">{rec.impact}</span></p>}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {rec.entity?.href && (
            <Link href={rec.entity.href} className="btn-secondary btn-sm">Voir <ArrowUpRight size={14} /></Link>
          )}
          {rec.existingTask ? (
            <Link href={`/taches/${rec.existingTask.id}`} className="btn-ghost btn-sm">Ouvrir la tâche</Link>
          ) : (
            <details className="group">
              <summary className="btn-primary btn-sm list-none cursor-pointer"><Plus size={14} /> Créer une tâche</summary>
              <form action={createTaskFromRecommendation} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-line bg-surface-2 p-3">
                <input type="hidden" name="key" value={rec.key} />
                <input type="hidden" name="description" value={description} />
                <input type="hidden" name="impact" value={rec.impact ?? ""} />
                <input type="hidden" name="brandId" value={rec.brandId ?? ""} />
                <input type="hidden" name="entityType" value={rec.entity?.type ?? ""} />
                <input type="hidden" name="entityId" value={rec.entity?.id ?? ""} />
                {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
                <label className="sm:col-span-2 text-[12px]">
                  <span className="label block mb-1">Tâche</span>
                  <input name="title" defaultValue={rec.task.title} className="input h-9" required />
                </label>
                <label className="text-[12px]">
                  <span className="label block mb-1">Responsable</span>
                  <select name="assigneeId" defaultValue={defaultAssignee?.id ?? ""} className="select h-9">
                    <option value="">Non assigné</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </label>
                <label className="text-[12px]">
                  <span className="label block mb-1">Deadline</span>
                  <input type="date" name="dueDate" defaultValue={due} className="input h-9" />
                </label>
                <label className="text-[12px]">
                  <span className="label block mb-1">Priorité</span>
                  <select name="priority" defaultValue={rec.task.priority ?? rec.priority} className="select h-9">
                    <option value="LOW">Basse</option><option value="MEDIUM">Moyenne</option><option value="HIGH">Haute</option><option value="CRITICAL">Critique</option>
                  </select>
                </label>
                <label className="text-[12px]">
                  <span className="label block mb-1">Commentaire</span>
                  <input name="comment" className="input h-9" placeholder="Optionnel" />
                </label>
                <div className="sm:col-span-2 flex justify-end">
                  <button className="btn-primary btn-sm" type="submit">Créer et assigner</button>
                </div>
              </form>
            </details>
          )}
          {copilot && <DetailPlanButton rec={recSummary(rec)} initial={plan} />}
        </div>
      </div>
    </article>
  );
}
