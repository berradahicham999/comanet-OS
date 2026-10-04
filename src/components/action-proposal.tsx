import Link from "next/link";
import clsx from "clsx";
import { ArrowUpRight, CalendarDays, Plus, TriangleAlert } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";
import type { ActionProposal, GeneratorInput, Level } from "@/lib/action-generator/types";
import type { DataTag } from "@/lib/marketing-intel/types";
import { AXES, COMPLEXITY_LABELS, ROLE_LABELS } from "@/lib/action-generator/catalog";
import { LEVEL_LABELS } from "@/lib/action-generator/engine";
import { generatorQuery } from "@/lib/action-generator/params";
import { BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import { fmtDateShort, fmtMAD } from "@/lib/format";
import { addGeneratedActionAction } from "@/app/(app)/marketing/priorites/actions";

const LEVEL_TONE: Record<Level, Tone> = { TRES_ELEVE: "green", ELEVE: "green", MOYEN: "yellow", FAIBLE: "gray", NON_MESURABLE: "gray" };
const TAG_TONE: Record<DataTag, Tone> = { CONFIRMED: "green", CALCULATED: "blue", INFERRED: "purple", MISSING: "gray" };
const TAG_LABEL: Record<DataTag, string> = { CONFIRMED: "confirmé", CALCULATED: "calculé", INFERRED: "hypothèse", MISSING: "manquant" };
const FORMAT_LABEL: Record<string, string> = { POST: "Post", REEL: "Réel", STORY: "Story", CARROUSEL: "Carrousel", VIDEO: "Vidéo", UGC: "UGC", VISUEL_PHARMACIE: "Visuel pharmacie", LIVE: "Live", NEWSLETTER: "Newsletter" };

export const detailHref = (input: GeneratorInput, templateKey: string) => `/marketing/priorites/generer/${templateKey}?${generatorQuery({ ...input })}`;

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2" title="Score de pertinence (0 à 100)">
      <div className="h-1.5 w-20 rounded-full bg-black/8 overflow-hidden"><div className={clsx("h-full rounded-full", score >= 70 ? "bg-green" : score >= 50 ? "bg-yellow" : "bg-faint")} style={{ width: `${Math.max(4, score)}%` }} /></div>
      <span className="text-[12px] font-semibold tabular-nums">{score}</span>
    </div>
  );
}

/** Bouton « Ajouter au plan » : rejoue la génération côté serveur à partir des mêmes paramètres (aucune donnée de la page n'est crue). */
export function AddToPlanForm({ input, templateKey, axes, label = "Ajouter au plan", compact = false }: { input: GeneratorInput; templateKey: string; axes?: { id: string; label: string }[]; label?: string; compact?: boolean }) {
  return (
    <form action={addGeneratedActionAction} className={clsx("flex flex-wrap items-center gap-2", !compact && "text-[12.5px]")}>
      <input type="hidden" name="brand" value={input.brandId} /><input type="hidden" name="objectif" value={input.objective} /><input type="hidden" name="mois" value={input.month.slice(0, 7)} />
      <input type="hidden" name="cible" value={input.target} /><input type="hidden" name="levier" value={input.axis ?? ""} /><input type="hidden" name="budget" value={input.budget ?? ""} />
      <input type="hidden" name="produit" value={input.productId ?? ""} /><input type="hidden" name="template" value={templateKey} />
      {axes && axes.length > 0 && (
        <select name="planAxisId" className="select h-8 w-auto text-[12px]" defaultValue=""><option value="">Axe du plan (facultatif)</option>{axes.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
      )}
      <button type="submit" className="btn-primary btn-sm"><Plus size={14} /> {label}</button>
    </form>
  );
}

/** Carte d'une option : lisible en 5 secondes (action, objectif, budget, impact, pourquoi). Le détail est sur la fiche. */
export function ProposalCard({ p, rank, input, canAdd, statusLabel }: { p: ActionProposal; rank?: number; input: GeneratorInput; canAdd: boolean; statusLabel?: string }) {
  return (
    <article className="card p-4 flex flex-col gap-2.5 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        {rank !== undefined && <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">Option {rank}</span>}
        <Badge tone="accent">{AXES[p.axis].label}</Badge>
        <Badge tone="gray">{p.family}</Badge>
        {statusLabel && <Badge tone="blue">{statusLabel}</Badge>}
        <span className="flex-1" />
        <ScoreBar score={p.score} />
      </div>
      <div>
        <h3 className="font-semibold text-[16px] leading-snug"><Link href={detailHref(input, p.templateKey)} className="hover:underline">{p.name}</Link></h3>
        <p className="text-[13px] text-ink-2 mt-0.5">{p.objectiveText}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
        <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Budget</div><div className="font-semibold text-[14px]">{fmtMAD(p.budget, { compact: true })}</div></div>
        <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Impact</div><Badge tone={LEVEL_TONE[p.impact]}>{LEVEL_LABELS[p.impact]}</Badge></div>
        <div><div className="text-[10.5px] text-muted uppercase tracking-wide">ROI potentiel</div><Badge tone={LEVEL_TONE[p.roiLevel]}>{p.estimate.roi === null ? LEVEL_LABELS[p.roiLevel] : `${p.estimate.roi.toFixed(1)}× · ${LEVEL_LABELS[p.roiLevel]}`}</Badge></div>
        <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Complexité</div><div className="font-medium">{COMPLEXITY_LABELS[p.complexity]}</div></div>
      </div>
      {p.why[0] && <p className="text-[12.5px] text-ink-2"><span className="label mr-1.5">Pourquoi</span>{p.why.slice(0, 2).join(" · ")}</p>}
      <div className="flex flex-wrap items-center gap-2 mt-auto pt-1">
        <span className="text-[11.5px] text-muted inline-flex items-center gap-1"><CalendarDays size={12} /> J = {fmtDateShort(p.eventDate)}</span>
        {p.warnings.length > 0 && <span className="text-[11.5px] text-amber-800 inline-flex items-center gap-1"><TriangleAlert size={12} /> {p.warnings.length} point(s) d&apos;attention</span>}
        <span className="flex-1" />
        <Link href={detailHref(input, p.templateKey)} className="btn-secondary btn-sm">Voir le plan <ArrowUpRight size={14} /></Link>
        {canAdd && <AddToPlanForm input={input} templateKey={p.templateKey} compact />}
      </div>
    </article>
  );
}

/** Fiche complète d'une action (proposée ou ajoutée au plan). */
export function ProposalSheet({ p, taskStatus }: { p: ActionProposal; taskStatus?: Map<number, { status: string; assignee: string | null; id: string }> }) {
  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5">
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-5">
          <div>
            <div className="label mb-1">Concept</div>
            <p className="text-[14px] text-ink-2 leading-relaxed">{p.concept}</p>
            <div className="grid sm:grid-cols-3 gap-3 mt-4 text-[13px]">
              <div><div className="label mb-0.5">Cible</div>{p.target}</div>
              <div><div className="label mb-0.5">Produit(s)</div>{p.products.length ? p.products.join(", ") : "toute la marque"}</div>
              <div><div className="label mb-0.5">Canaux</div>{p.channels.join(" · ")}</div>
            </div>
            {(p.suggestions.city || p.suggestions.pos.length > 0 || p.suggestions.influencers.length > 0) && (
              <div className="mt-4 rounded-xl bg-surface-2 p-3 text-[12.5px] space-y-1">
                <div className="label">Adapté à vos données</div>
                {p.suggestions.city && <div><span className="text-muted">Ville : </span><b>{p.suggestions.city}</b> <span className="text-faint">(1ʳᵉ ville des ventes de la marque sur 12 mois)</span></div>}
                {p.suggestions.pos.length > 0 && <div><span className="text-muted">Pharmacies à cibler : </span>{p.suggestions.pos.join(", ")} <span className="text-faint">(meilleurs clients de la marque, 90 jours)</span></div>}
                {p.suggestions.influencers.length > 0 && <div><span className="text-muted">Influenceuses suggérées : </span>{p.suggestions.influencers.join(" ; ")}</div>}
              </div>
            )}
            {p.compliance && <p className="mt-3 text-[12px] text-amber-800"><b>Conformité :</b> {p.compliance}</p>}
            {p.warnings.length > 0 && <ul className="mt-2 text-[12px] text-amber-800 space-y-0.5">{p.warnings.map((w, i) => <li key={i}>• {w}</li>)}</ul>}
          </div>
          <div>
            <div className="label mb-1">Résultat attendu (hypothèses du modèle)</div>
            <div className="grid grid-cols-2 gap-2 text-[13px]">
              {p.kpis.map((k, i) => (
                <div key={i} className="rounded-lg border border-line px-2.5 py-1.5"><div className="text-[11px] text-muted flex items-center gap-1">{k.label}<Badge tone={TAG_TONE[k.tag]} className="!text-[9.5px] !px-1">{TAG_LABEL[k.tag]}</Badge></div><div className="font-semibold">{k.target}</div></div>
              ))}
            </div>
            <ul className="mt-2 text-[11.5px] text-faint space-y-0.5">{p.estimate.assumptions.map((a, i) => <li key={i}>• {a}</li>)}</ul>
            <p className="mt-1 text-[11.5px] text-faint">Mesure : CA attribué seulement par code promo ou montant saisi ; sinon ventes des pharmacies relais = corrélation observée.</p>
          </div>
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-2"><div className="label">Budget détaillé</div><b className="text-[14px]">{fmtMAD(p.budget)}</b></div>
          <table className="tbl text-[12.5px]"><tbody>
            {p.lines.map((l, i) => <tr key={i}><td>{l.label}<div className="text-[10.5px] text-muted">{BUDGET_CATEGORY_LABELS[l.category]}</div></td><td className="num font-medium">{fmtMAD(l.amount, { suffix: false })}</td><td className="num text-muted w-14">{Math.round((l.amount / p.budget) * 100)} %</td></tr>)}
          </tbody></table>
        </section>
        <section className="card p-4 sm:p-5">
          <div className="label mb-2">Score de pertinence · {p.score}/100</div>
          <ul className="space-y-1.5 text-[12.5px]">
            {p.scoreItems.map((s) => (
              <li key={s.key} className="flex items-start gap-2"><span className={clsx("w-12 shrink-0 text-right font-semibold tabular-nums", s.points < 0 && "text-red")}>{s.points}{s.max ? `/${s.max}` : ""}</span><span className="flex-1"><b className="font-medium">{s.label}</b> <span className="text-muted">— {s.why}</span></span><Badge tone={TAG_TONE[s.tag]}>{TAG_LABEL[s.tag]}</Badge></li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card p-4 sm:p-5">
        <div className="flex items-center justify-between mb-2"><div className="label">Rétroplanning et tâches ({p.steps.length})</div><span className="text-[12px] text-muted">J = {fmtDateShort(p.eventDate)}{p.endDate !== p.eventDate ? ` → fin ${fmtDateShort(p.endDate)}` : ""}</span></div>
        <table className="tbl text-[12.5px]">
          <thead><tr><th>Quand</th><th>Tâche</th><th>Rôle</th><th>Responsable</th>{taskStatus && <th>Statut</th>}</tr></thead>
          <tbody>
            {p.steps.map((s, i) => { const t = taskStatus?.get(i + 1); return (
              <tr key={i}><td className="whitespace-nowrap"><b>{s.dayLabel}</b> <span className="text-muted">{fmtDateShort(s.date)}</span></td><td>{t ? <Link href={`/taches/${t.id}`} className="hover:underline">{s.label}</Link> : s.label}</td><td className="text-muted">{ROLE_LABELS[s.role]}</td><td>{t?.assignee ?? s.assigneeName ?? <span className="text-faint">à assigner</span>}</td>{taskStatus && <td>{t ? <Badge tone={t.status === "DONE" ? "green" : t.status === "IN_PROGRESS" ? "blue" : t.status === "BLOCKED" ? "orange" : t.status === "CANCELLED" ? "gray" : "gray"}>{({ TODO: "À faire", IN_PROGRESS: "En cours", BLOCKED: "Bloquée", DONE: "Faite", CANCELLED: "Annulée", PROPOSED: "Proposée" } as Record<string, string>)[t.status] ?? t.status}</Badge> : "—"}</td>}</tr>
            ); })}
          </tbody>
        </table>
        {p.contents.length > 0 && (
          <div className="mt-3 text-[12.5px]"><span className="label mr-2">Contenus nécessaires</span>{p.contents.map((c, i) => <span key={i} className="inline-block mr-3">{c.count} × {FORMAT_LABEL[c.format] ?? c.format} « {c.title} » <span className="text-muted">({fmtDateShort(c.date)})</span></span>)}</div>
        )}
      </section>

      <section className="card p-4 sm:p-5">
        <div className="label mb-2">Pourquoi cette action, données utilisées</div>
        <ul className="list-disc pl-4 text-[13px] text-ink-2 space-y-0.5 mb-3">{p.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-[12.5px]">{p.data.map((f, i) => <li key={i} className="flex items-center gap-2 min-w-0"><span className="text-muted truncate">{f.label} :</span><b className="truncate">{f.value}</b><Badge tone={TAG_TONE[f.tag]}>{TAG_LABEL[f.tag]}</Badge></li>)}</ul>
        <p className="text-[11.5px] text-faint mt-2">Exécution : {p.execution.kind === "ACTIVATION" ? "une activation (module Activations) porte le budget par poste ; il est engagé à la validation de l'activation." : "une campagne (module Campagnes) et des dépenses prévues dans Budget & dépenses."}</p>
      </section>
    </div>
  );
}
