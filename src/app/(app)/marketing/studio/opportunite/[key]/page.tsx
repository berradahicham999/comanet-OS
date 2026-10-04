import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Clapperboard, RefreshCw, Sparkles } from "lucide-react";
import { requireAccess, canDo } from "@/lib/access";
import { decisionScopeFor } from "@/lib/decisions/server";
import { opportunityByKey } from "@/lib/creative/server";
import { parseOpportunityKey } from "@/lib/creative/opportunities";
import { listConcepts } from "@/lib/creative/store";
import { tensionOf } from "@/lib/creative/consumer";
import { FUNNEL_LABELS, HOOK_LABELS, TERRITORY_LABELS, mechanicOf } from "@/lib/creative/territories";
import { PageHeader, Card, Kpi, Badge, Section, Empty } from "@/components/ui";
import { ConceptCard, PRIORITY_LABEL, PRIORITY_TONE, ScoreList, Tag, TERRITORY_TONE, conceptHref } from "@/components/creative-studio";
import { fmtMAD } from "@/lib/format";
import { buildPackageAction, conceptStatusAction, generateConceptsAction } from "../../actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Opportunité créative" };

/** Bouton « Générer » / « Régénérer » : rejoue l'opportunité côté serveur, aucune donnée de la page n'est crue. */
function GenerateForm({ opportunityKey, regenerate }: { opportunityKey: string; regenerate: boolean }) {
  return (
    <form action={generateConceptsAction}><input type="hidden" name="key" value={opportunityKey} />{regenerate && <input type="hidden" name="regenerate" value="1" />}
      <button type="submit" className={regenerate ? "btn-secondary btn-sm" : "btn-primary btn-sm"}>{regenerate ? <><RefreshCw size={14} /> Régénérer</> : <><Sparkles size={14} /> Générer les concepts</>}</button>
    </form>
  );
}

export default async function OpportunityPage(props: { params: Promise<{ key: string }>; searchParams: Promise<{ note?: string }> }) {
  await requireAccess("marketing");
  const { key: raw } = await props.params;
  const sp = await props.searchParams;
  const key = decodeURIComponent(raw);
  const k = parseOpportunityKey(key);
  if (!k) notFound();
  const [scope, canCreate, canEdit] = await Promise.all([decisionScopeFor(k.brandId), canDo("marketing", "create"), canDo("marketing", "edit")]);
  const found = await opportunityByKey(scope, key);
  if (!found) notFound();
  const { opportunity: o, data } = found;
  const [concepts, rejected] = await Promise.all([
    listConcepts({ opportunityKey: key, statuses: ["PROPOSED", "APPROVED", "BUILT", "SENT"], limit: 12 }),
    listConcepts({ opportunityKey: key, statuses: ["REJECTED", "ARCHIVED"], limit: 12 }),
  ]);
  const tension = tensionOf(o.tensionKey)!;
  const m = mechanicOf(o.recommendedMechanic)!;

  return (
    <>
      <PageHeader eyebrow={<Link href={`/marketing/studio?brand=${o.brandId}`} className="hover:underline">Studio créatif · {o.brandName}</Link>}
        title={`${o.productName ?? `Gamme ${o.brandName}`} — ${o.mechanicName}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone={o.blocked ? "gray" : PRIORITY_TONE[o.priority]} dot>{o.blocked ? "À ne pas pousser" : PRIORITY_LABEL[o.priority]}</Badge><Badge tone={TERRITORY_TONE[o.recommendedTerritory]}>{TERRITORY_LABELS[o.recommendedTerritory]}</Badge>{o.businessObjective} · étape {FUNNEL_LABELS[o.funnelStage].toLowerCase()} · cible {o.audience}</span>}
        actions={canCreate && !o.blocked ? <GenerateForm opportunityKey={key} regenerate={concepts.length > 0} /> : undefined}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Score d'opportunité" value={`${o.opportunityScore}/100`} sub="aide à la décision" />
          <Kpi label="Tension consommateur" value={<span className="text-[16px] leading-tight">{tension.label}</span>} sub={o.data.find((f) => f.label === "Fiche marketing")?.value} />
          <Kpi label={`Budget ${o.budget.axis.toLowerCase()}`} value={o.budget.available === null ? "—" : fmtMAD(o.budget.available, { compact: true })} sub={o.budget.available === null ? "non défini" : o.budget.source === "MARQUE" ? "enveloppe de la marque" : "alloué au levier"} />
          <Kpi label="Confiance" value={o.confidence === "HIGH" ? "élevée" : o.confidence === "MEDIUM" ? "moyenne" : "faible"} sub={o.confidenceWhy[0]} />
        </div>
      </PageHeader>

      {sp.note && <div className="card card-pad mb-4 text-[13px] border-yellow/40 bg-yellow-soft">{sp.note}</div>}
      {o.blocked && <div className="card card-pad mb-4 text-[13px] border-red/30 bg-red-soft">{o.blocked}</div>}

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <Card title="Pourquoi maintenant">
          <ul className="list-disc pl-4 text-[13px] text-ink-2 space-y-1">{o.reasoning.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <div className="mt-3 grid sm:grid-cols-2 gap-2 text-[12px]">{o.data.map((f) => <div key={f.label} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5"><span className="text-muted">{f.label}</span><span className="font-medium flex items-center gap-1">{f.value} <Tag tag={f.tag} /></span></div>)}</div>
          {o.learning.length > 0 && <div className="mt-3"><div className="label mb-1">Apprentissages</div><ul className="list-disc pl-4 text-[12.5px] text-ink-2 space-y-0.5">{o.learning.map((l, i) => <li key={i}>{l}</li>)}</ul></div>}
        </Card>
        <Card title="Score de l'opportunité"><ScoreList items={o.scoreItems} /></Card>
        <Card title={`Tension consommateur — ${tension.label}`}>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
            {([["Problème", tension.problem], ["Frustration", tension.frustration], ["Désir", tension.desire], ["Objection", tension.objection], ["Croyance", tension.belief], ["Idée reçue", tension.misconception], ["Question cherchée", tension.question], ["Émotion", tension.emotion]] as [string, string][]).map(([k2, v]) => <div key={k2}><dt className="label">{k2}</dt><dd className="mt-0.5 text-ink-2">{v}</dd></div>)}
          </dl>
          <p className="mt-3 text-[11.5px] text-muted">Tension activée par la fiche produit ({data.product.benefits.length} bénéfice(s), {data.product.actives.length} actif(s), {data.product.claims.length} allégation(s) renseignés). {data.product.missing.length ? `À compléter : ${data.product.missing.join(", ")}.` : ""}</p>
        </Card>
        <Card title={`Mécanique recommandée — ${m.name}`}>
          <dl className="grid gap-y-2 text-[13px]">
            <div><dt className="label">Déclencheur psychologique</dt><dd className="text-ink-2">{m.psychologicalTrigger}</dd></div>
            <div><dt className="label">Idéale pour</dt><dd className="text-ink-2">{m.bestFor}</dd></div>
            <div><dt className="label">Accroches types</dt><dd className="text-ink-2">{m.hookPatterns.join(" · ")}</dd></div>
            <div><dt className="label">Structure</dt><dd className="text-ink-2">{m.narrativeStructures[0]}</dd></div>
            <div><dt className="label">Adéquation</dt><dd className="text-ink-2">organique {Math.round(m.organicFit * 100)} % · payant {Math.round(m.paidFit * 100)} % · fatigue {m.fatigueRisk.toLowerCase()} · accroche par défaut {HOOK_LABELS[m.defaultHook].toLowerCase()}</dd></div>
          </dl>
        </Card>
      </div>

      <Section title="Concepts créatifs" description={concepts.length ? `${concepts.length} concept(s) : chacun change de mécanique ou d'accroche, avec son score explicable, sa revue et son contrôle d'allégations.` : "Trois à cinq concepts différenciés, générés à partir de cette opportunité."}
        action={canCreate && !o.blocked && concepts.length > 0 ? <GenerateForm opportunityKey={key} regenerate /> : undefined}>
        {concepts.length === 0 ? (
          <Empty icon={<Clapperboard size={18} />} title="Aucun concept généré pour cette opportunité" hint={o.blocked ? "Produit à ne pas pousser : aucune génération proposée." : "COMANET lit la tension, choisit des mécaniques variées, rédige les concepts, les relit et les note."} action={canCreate && !o.blocked ? <GenerateForm opportunityKey={key} regenerate={false} /> : undefined} />
        ) : (
          <div className="grid lg:grid-cols-2 gap-3">
            {concepts.map((s) => (
              <ConceptCard key={s.id} s={s} actions={
                <>
                  <Link href={conceptHref(s.id)} className="btn-secondary btn-sm">Ouvrir <ArrowUpRight size={14} /></Link>
                  {(s.status === "PROPOSED" || s.status === "APPROVED") && canCreate && <form action={buildPackageAction}><input type="hidden" name="id" value={s.id} /><button type="submit" className="btn-primary btn-sm"><Clapperboard size={14} /> Construire le contenu</button></form>}
                  {s.status === "PROPOSED" && canEdit && <form action={conceptStatusAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="status" value="APPROVED" /><button type="submit" className="btn-ghost btn-sm">Approuver</button></form>}
                  {(s.status === "PROPOSED" || s.status === "APPROVED") && canEdit && (
                    <form action={conceptStatusAction} className="flex items-center gap-1"><input type="hidden" name="id" value={s.id} /><input type="hidden" name="status" value="REJECTED" />
                      <input name="reason" className="input h-8 w-40 text-[12px]" placeholder="Motif (obligatoire)" required /><button type="submit" className="btn-ghost btn-sm">Écarter</button>
                    </form>
                  )}
                  {s.status === "SENT" && s.contentItemId && <Link href={`/marketing/planning/${s.contentItemId}`} className="btn-ghost btn-sm">Voir au planning</Link>}
                </>
              } />
            ))}
          </div>
        )}
      </Section>

      {rejected.length > 0 && (
        <details className="card card-pad text-[13px]"><summary className="cursor-pointer font-medium">{rejected.length} concept(s) écarté(s) ou archivé(s)</summary>
          <ul className="mt-2 space-y-1 text-ink-2">{rejected.map((s) => <li key={s.id}><Link href={conceptHref(s.id)} className="hover:underline">{s.concept.title}</Link> — {s.status === "REJECTED" ? `écarté : ${s.rejectReason ?? "sans motif"}` : "archivé (régénération)"}</li>)}</ul>
        </details>
      )}
    </>
  );
}
