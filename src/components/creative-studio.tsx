import Link from "next/link";
import clsx from "clsx";
import { ArrowUpRight, Check, Flame, Sparkles, X } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";
import type { ComplianceFlag, ConceptReview, CreativeConcept, CreativeInsight, CreativeOpportunity, DataTag, ScoreItem, Scene, Shot, StoredConcept, ConceptStatus, Priority } from "@/lib/creative/types";
import { FUNNEL_LABELS, HOOK_LABELS, PERSONA_LABELS, FORMAT_LABELS, TERRITORY_LABELS } from "@/lib/creative/territories";
import { SEVERITY_LABELS } from "@/lib/creative/compliance";
import { fmtMAD } from "@/lib/format";

/* ------------------------------ Étiquettes ------------------------------ */

export const TAG_TONE: Record<DataTag, Tone> = { CONFIRMED: "green", CALCULATED: "blue", INFERRED: "purple", MISSING: "gray" };
export const TAG_LABEL: Record<DataTag, string> = { CONFIRMED: "confirmé", CALCULATED: "calculé", INFERRED: "hypothèse", MISSING: "manquant" };
export const PRIORITY_TONE: Record<Priority, Tone> = { HIGH: "red", MEDIUM: "orange", LOW: "gray" };
export const PRIORITY_LABEL: Record<Priority, string> = { HIGH: "Priorité haute", MEDIUM: "Priorité moyenne", LOW: "Priorité basse" };
export const STATUS_TONE: Record<ConceptStatus, Tone> = { PROPOSED: "gray", APPROVED: "blue", BUILT: "accent", SENT: "green", REJECTED: "red", ARCHIVED: "gray" };
export const STATUS_LABEL: Record<ConceptStatus, string> = { PROPOSED: "Proposé", APPROVED: "Approuvé", BUILT: "Contenu construit", SENT: "Envoyé en production", REJECTED: "Écarté", ARCHIVED: "Archivé" };
export const TERRITORY_TONE: Record<CreativeConcept["creativeTerritory"], Tone> = { EDUCATION: "blue", UGC: "orange", STORYTELLING: "purple", PERFORMANCE: "green", EMOTIONAL: "red" };

export const encodeKey = (key: string) => encodeURIComponent(key);
export const opportunityHref = (key: string) => `/marketing/studio/opportunite/${encodeKey(key)}`;
export const conceptHref = (id: string, tab?: string) => `/marketing/studio/concept/${id}${tab ? `?onglet=${tab}` : ""}`;

export function Tag({ tag }: { tag: DataTag }) {
  return <Badge tone={TAG_TONE[tag]} className="!text-[10px]">{TAG_LABEL[tag]}</Badge>;
}

export function ScoreRing({ score, size = "md" }: { score: number; size?: "md" | "lg" }) {
  const tone = score >= 70 ? "text-green" : score >= 50 ? "text-yellow" : "text-muted";
  return <div className={clsx("font-semibold tabular-nums", tone, size === "lg" ? "text-[28px] leading-none" : "text-[18px] leading-none")} title="Score d'aide à la décision (0 à 100), pas une mesure">{score}<span className="text-[11px] text-muted font-normal">/100</span></div>;
}

/** Détail d'un score : critère, points / max, raison, étiquette. */
export function ScoreList({ items, compact = false }: { items: ScoreItem[]; compact?: boolean }) {
  return (
    <ul className={clsx("space-y-1.5", compact ? "text-[12px]" : "text-[12.5px]")}>
      {items.filter((i) => i.max > 0 || i.points !== 0).map((i) => (
        <li key={i.key} className="flex items-start gap-2">
          <div className="w-32 shrink-0 text-ink-2">{i.label}</div>
          <div className="w-20 shrink-0"><div className="h-1.5 rounded-full bg-black/8 overflow-hidden mt-1.5"><div className={clsx("h-full rounded-full", i.points < 0 ? "bg-red" : i.points / Math.max(1, i.max) >= 0.7 ? "bg-green" : i.points / Math.max(1, i.max) >= 0.4 ? "bg-yellow" : "bg-faint")} style={{ width: `${Math.max(4, Math.min(100, (Math.abs(i.points) / Math.max(1, i.max)) * 100))}%` }} /></div></div>
          <div className="w-12 shrink-0 tabular-nums font-medium">{i.points}{i.max > 0 ? `/${i.max}` : ""}</div>
          <div className="min-w-0 text-muted flex-1">{i.why} <Tag tag={i.tag} /></div>
        </li>
      ))}
    </ul>
  );
}

export function ComplianceList({ flags }: { flags: ComplianceFlag[] }) {
  if (!flags.length) return <p className="text-[12.5px] text-muted">Contrôle automatique : aucune alerte. La relecture réglementaire reste obligatoire avant diffusion.</p>;
  return (
    <ul className="space-y-1 text-[12.5px]">
      {flags.map((f, i) => (
        <li key={i} className="flex items-start gap-2">
          <Badge tone={f.severity === "BLOCK" ? "red" : f.severity === "WARN" ? "orange" : "gray"}>{SEVERITY_LABELS[f.severity]}</Badge>
          <span><span className="font-medium">{f.text}</span>{f.excerpt ? <span className="text-muted"> — « {f.excerpt} »</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

const AXIS_LABEL: Record<keyof ConceptReview["axes"], string> = { strategic: "Stratégie", creative: "Créativité", product: "Produit", audience: "Audience", brand: "Marque", production: "Production", compliance: "Conformité", repetition: "Répétition" };

export function ReviewPanel({ review, title = "Revue créative" }: { review: ConceptReview; title?: string }) {
  const tone: Tone = review.verdict === "PASS" ? "green" : review.verdict === "IMPROVE" ? "yellow" : "red";
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3 text-[12.5px]">
      <div className="flex items-center gap-2 mb-2"><span className="label">{title}</span><Badge tone={tone}>{review.verdict === "PASS" ? "présentable" : review.verdict === "IMPROVE" ? "à améliorer" : "à régénérer"}</Badge></div>
      <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
        {(Object.keys(AXIS_LABEL) as (keyof ConceptReview["axes"])[]).map((k) => (
          <li key={k} className="flex items-start gap-1.5">{review.axes[k].ok ? <Check size={13} className="text-green mt-0.5 shrink-0" /> : <X size={13} className="text-red mt-0.5 shrink-0" />}<span><b>{AXIS_LABEL[k]}</b> — {review.axes[k].note}</span></li>
        ))}
      </ul>
      {review.improvements.length > 0 && <div className="mt-2"><span className="label">Améliorations</span><ul className="list-disc pl-4 mt-1">{review.improvements.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
    </div>
  );
}

/* ------------------------------ Opportunité ------------------------------ */

export function OpportunityCard({ o }: { o: CreativeOpportunity }) {
  return (
    <article className={clsx("card p-4 flex flex-col gap-2.5 min-w-0", o.blocked && "opacity-80")}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Badge tone={o.blocked ? "gray" : PRIORITY_TONE[o.priority]} dot>{o.blocked ? "À ne pas pousser" : PRIORITY_LABEL[o.priority]}</Badge>
        <span className="inline-flex items-center gap-1.5 font-medium"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: o.brandColor }} />{o.brandName}</span>
        <span className="text-faint">·</span><span className="text-muted truncate">{o.businessObjective}</span>
        <span className="flex-1" /><ScoreRing score={o.opportunityScore} />
      </div>
      <div className="flex items-start gap-2">
        {o.priority === "HIGH" && !o.blocked ? <Flame size={16} className="text-red mt-1 shrink-0" /> : <Sparkles size={16} className="text-accent mt-1 shrink-0" />}
        <div className="min-w-0">
          <div className="font-semibold text-[16px] leading-snug">{o.productName ?? `Gamme ${o.brandName}`}</div>
          <p className="text-[13px] text-ink-2"><span className="label mr-1.5">Opportunité</span>{o.mechanicName} <Badge tone={TERRITORY_TONE[o.recommendedTerritory]} className="ml-1">{TERRITORY_LABELS[o.recommendedTerritory]}</Badge></p>
        </div>
      </div>
      <div className="rounded-xl bg-surface-2 p-3 text-[12.5px]">
        <div className="label mb-1">Tension consommateur — {o.consumerTension}</div>
        <p className="text-ink-2">{o.consumerProblem} <span className="text-muted">→ {o.consumerDesire}</span></p>
      </div>
      <div><div className="label mb-1">Pourquoi</div><ul className="list-disc pl-4 text-[12.5px] text-ink-2 space-y-0.5">{o.reasoning.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}</ul></div>
      {o.blocked && <p className="text-[12.5px] text-red">{o.blocked}</p>}
      <div className="grid grid-cols-3 gap-2 text-[12px]">
        <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Étape</div><div className="font-medium">{FUNNEL_LABELS[o.funnelStage]}</div></div>
        <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Budget {o.budget.axis.toLowerCase()}</div><div className="font-medium">{o.budget.available === null ? "non défini" : fmtMAD(o.budget.available, { compact: true })}</div></div>
        <div><div className="text-[10.5px] text-muted uppercase tracking-wide">Confiance</div><div className="font-medium">{o.confidence === "HIGH" ? "élevée" : o.confidence === "MEDIUM" ? "moyenne" : "faible"}</div></div>
      </div>
      <div className="flex items-center gap-2 mt-auto">
        {o.saturated.length > 0 && <span className="text-[11px] text-muted">Saturé : {o.saturated.join(", ")}</span>}
        <span className="flex-1" />
        <Link href={opportunityHref(o.key)} className={clsx("btn-sm", o.blocked ? "btn-secondary" : "btn-primary")}>{o.blocked ? "Voir pourquoi" : "Explorer l'opportunité"} <ArrowUpRight size={14} /></Link>
      </div>
    </article>
  );
}

export function InsightList({ insights }: { insights: CreativeInsight[] }) {
  if (!insights.length) return <p className="text-[12.5px] text-muted">Aucun apprentissage mesuré : il faut au moins deux créatives ou publications comparables par motif (Meta synchronisé, contenus publiés avec portée et engagement saisis, collaborations analysées).</p>;
  return (
    <ul className="space-y-2">
      {insights.map((i) => (
        <li key={i.key} className="rounded-xl border border-line bg-surface p-3 text-[12.5px]">
          <div className="flex items-start gap-2"><Badge tone={i.direction === "POSITIVE" ? "green" : i.direction === "NEGATIVE" ? "red" : "gray"}>{i.direction === "POSITIVE" ? "fonctionne" : i.direction === "NEGATIVE" ? "à éviter" : "neutre"}</Badge><span className="flex-1">{i.statement}</span><span className="text-[11px] text-muted whitespace-nowrap">confiance {i.confidence}</span></div>
          <div className="mt-1 text-[11px] text-muted">{i.evidence.map((e) => `${e.label} : ${e.value}`).join(" · ")} · corrélation observée</div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------ Concept ------------------------------ */

export function ConceptHeader({ c }: { c: CreativeConcept }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      <Badge tone={TERRITORY_TONE[c.creativeTerritory]}>{TERRITORY_LABELS[c.creativeTerritory]}</Badge>
      <Badge tone="gray">{c.mechanicName}</Badge>
      <Badge tone="gray">{HOOK_LABELS[c.hookType]}</Badge>
      <Badge tone="gray">{PERSONA_LABELS[c.persona]}</Badge>
      <Badge tone="gray">{FORMAT_LABELS[c.recommendedFormat]}</Badge>
      <Badge tone="gray">{c.distribution === "BOTH" ? "organique + payant" : c.distribution === "PAID" ? "payant" : "organique"}</Badge>
      {c.generatedBy === "RULES" && <Badge tone="yellow">squelette sans IA</Badge>}
    </div>
  );
}

export function ConceptCard({ s, actions }: { s: StoredConcept; actions?: React.ReactNode }) {
  const c = s.concept;
  const blocks = c.compliance.filter((f) => f.severity === "BLOCK").length;
  return (
    <article className="card p-4 flex flex-col gap-2.5 min-w-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link href={conceptHref(s.id)} className="font-semibold text-[16px] leading-snug hover:underline">{c.title}</Link>
          <div className="mt-1"><ConceptHeader c={c} /></div>
        </div>
        <div className="text-right"><ScoreRing score={c.scores.overall} /><div className="mt-1"><Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge></div></div>
      </div>
      <p className="text-[13px] text-ink-2">{c.bigIdea}</p>
      <div className="grid sm:grid-cols-2 gap-2 text-[12.5px]">
        <div className="rounded-xl bg-surface-2 p-3"><div className="label mb-1">Tension</div>{c.consumerTension}</div>
        <div className="rounded-xl bg-surface-2 p-3"><div className="label mb-1">Message central</div>{c.coreMessage}</div>
      </div>
      <div><div className="label mb-1">Pourquoi ce concept</div><ul className="list-disc pl-4 text-[12.5px] text-ink-2 space-y-0.5">{c.reasoning.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}</ul></div>
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
        {c.similarity.score >= 0.5 && <span>proche de « {c.similarity.to} » ({Math.round(c.similarity.score * 100)} %)</span>}
        {blocks > 0 && <Badge tone="red">{blocks} allégation(s) bloquante(s)</Badge>}
        {c.review && <Badge tone={c.review.verdict === "PASS" ? "green" : c.review.verdict === "IMPROVE" ? "yellow" : "red"}>revue : {c.review.verdict === "PASS" ? "présentable" : c.review.verdict === "IMPROVE" ? "à améliorer" : "à régénérer"}</Badge>}
        {s.rejectReason && <span>écarté : {s.rejectReason}</span>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 mt-auto pt-1">{actions}</div>}
    </article>
  );
}

/* ------------------------------ Package ------------------------------ */

export function SceneTable({ scenes }: { scenes: Scene[] }) {
  return (
    <div className="overflow-x-auto"><table className="tbl w-full text-[12.5px]">
      <thead><tr><th>Scène</th><th>Durée</th><th>Visuel</th><th>Cadrage</th><th>Action</th><th>Dialogue / voix off</th><th>Texte à l&apos;écran</th><th>Produit</th><th>Transition</th></tr></thead>
      <tbody>{scenes.map((s) => (
        <tr key={s.n}><td className="font-medium">{s.n}</td><td className="num">{s.durationSec} s</td><td>{s.visual}</td><td>{s.framing}</td><td>{s.action}</td><td>{s.dialogue ? <>« {s.dialogue} »</> : null}{s.voiceOver ? <div className="text-muted">Voix off : {s.voiceOver}</div> : null}</td><td>{s.onScreenText ?? "—"}</td><td>{s.productVisible ? <Badge tone="green">oui</Badge> : <span className="text-faint">non</span>}</td><td className="text-muted">{s.transition ?? "—"}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

export function ShotTable({ shots }: { shots: Shot[] }) {
  return (
    <div className="overflow-x-auto"><table className="tbl w-full text-[12.5px]">
      <thead><tr><th>Plan</th><th>Visuel</th><th>Durée</th><th>Cadrage</th><th>Produit</th><th>Notes</th></tr></thead>
      <tbody>{shots.map((s) => <tr key={s.n}><td className="font-medium">{String(s.n).padStart(2, "0")}</td><td>{s.visual}</td><td className="num">{s.durationSec} s</td><td>{s.framing}</td><td>{s.product ? "Oui" : "Non"}</td><td className="text-muted">{s.notes ?? "—"}</td></tr>)}</tbody>
    </table></div>
  );
}

export function KV({ items }: { items: [string, React.ReactNode][] }) {
  return <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">{items.map(([k, v]) => <div key={k}><dt className="label">{k}</dt><dd className="mt-0.5 text-ink-2">{v}</dd></div>)}</dl>;
}
