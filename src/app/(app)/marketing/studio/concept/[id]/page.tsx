import Link from "next/link";
import { notFound } from "next/navigation";
import { Clapperboard, FileText, Send, Shuffle } from "lucide-react";
import { requireAccess, canDo } from "@/lib/access";
import { decisionScopeFor } from "@/lib/decisions/server";
import { listUsers } from "@/lib/users";
import { contentRefs } from "@/lib/content/refs";
import { getConcept } from "@/lib/creative/store";
import { FORMAT_LABELS, FUNNEL_LABELS, HOOK_LABELS, PERSONA_LABELS, TERRITORY_LABELS } from "@/lib/creative/territories";
import type { Variation, VariationDimension } from "@/lib/creative/types";
import { PageHeader, Card, Kpi, Badge, Tabs, Section } from "@/components/ui";
import { ComplianceList, ConceptHeader, KV, ReviewPanel, STATUS_LABEL, STATUS_TONE, SceneTable, ScoreList, ShotTable, Tag, conceptHref, opportunityHref } from "@/components/creative-studio";
import { addDays, iso, today, fmtMAD } from "@/lib/format";
import { buildPackageAction, conceptStatusAction, sendToPlanningAction, variationsAction } from "../../actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Content Studio" };

const TABS: { key: string; label: string; needsPackage: boolean }[] = [
  { key: "strategie", label: "Stratégie", needsPackage: false }, { key: "concept", label: "Concept", needsPackage: false }, { key: "accroches", label: "Accroches", needsPackage: true },
  { key: "script", label: "Script", needsPackage: true }, { key: "storyboard", label: "Découpage", needsPackage: true }, { key: "plans", label: "Plans", needsPackage: true },
  { key: "direction", label: "Direction", needsPackage: true }, { key: "variations", label: "Variations", needsPackage: true }, { key: "organique", label: "Organique", needsPackage: true },
  { key: "payant", label: "Payant", needsPackage: true }, { key: "production", label: "Production", needsPackage: true },
];
const DIM_LABEL: Record<VariationDimension, string> = { HOOK: "Accroche", OPENING: "Ouverture visuelle", STRUCTURE: "Structure narrative", PERSONA: "Persona", ANGLE: "Angle émotionnel", CTA: "Appel à l'action", FORMAT: "Format" };

export default async function ConceptPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string; note?: string }> }) {
  await requireAccess("marketing");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const c = await getConcept(id);
  if (!c) notFound();
  const [scope, canCreate, canEdit, users, refs] = await Promise.all([decisionScopeFor(c.brandId), canDo("marketing", "create"), canDo("marketing", "edit"), listUsers(), contentRefs()]);
  if (!scope.allBrands.some((b) => b.id === c.brandId)) notFound();
  const k = c.concept, p = c.package;
  const tab = TABS.some((t) => t.key === sp.onglet && (!t.needsPackage || p)) ? sp.onglet! : "strategie";
  const tabs = TABS.filter((t) => !t.needsPackage || p).map((t) => ({ href: conceptHref(id, t.key), label: t.label }));
  const defaultDate = iso(addDays(today(), 10));
  const byDim = new Map<VariationDimension, Variation[]>();
  for (const v of c.variations?.variations ?? []) byDim.set(v.dimension, [...(byDim.get(v.dimension) ?? []), v]);

  return (
    <>
      <PageHeader eyebrow={<Link href={opportunityHref(c.opportunityKey)} className="hover:underline">Studio créatif · {c.brandName}{c.productName ? ` · ${c.productName}` : ""}</Link>} title={k.title}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge><ConceptHeader c={k} /></span>}
        actions={<>
          {p && <Link href={`${conceptHref(id)}/brief`} className="btn-secondary btn-sm"><FileText size={14} /> Brief de production</Link>}
          {!p && canCreate && (c.status === "PROPOSED" || c.status === "APPROVED") && <form action={buildPackageAction}><input type="hidden" name="id" value={id} /><button type="submit" className="btn-primary btn-sm"><Clapperboard size={14} /> Construire le contenu</button></form>}
          {p && canCreate && c.status !== "SENT" && <Link href={conceptHref(id, "production")} className="btn-primary btn-sm"><Send size={14} /> Envoyer en production</Link>}
          {c.status === "SENT" && c.contentItemId && <Link href={`/marketing/planning/${c.contentItemId}`} className="btn-primary btn-sm">Voir au planning</Link>}
        </>}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <Kpi label="Score créatif" value={`${k.scores.overall}/100`} sub="aide à la décision, pas une mesure" />
          <Kpi label="Format" value={FORMAT_LABELS[k.recommendedFormat]} sub={`${PERSONA_LABELS[k.persona]} · ${k.distribution === "BOTH" ? "organique + payant" : k.distribution === "PAID" ? "payant" : "organique"}`} />
          <Kpi label="Étape" value={FUNNEL_LABELS[k.funnelStage]} sub={`accroche ${HOOK_LABELS[k.hookType].toLowerCase()}`} />
          <Kpi label="Conformité" value={k.compliance.some((f) => f.severity === "BLOCK") || p?.compliance.some((f) => f.severity === "BLOCK") ? "bloquant" : (k.compliance.length + (p?.compliance.length ?? 0)) > 0 ? "à vérifier" : "aucune alerte"} sub="contrôle automatique + relecture réglementaire" tone={k.compliance.some((f) => f.severity === "BLOCK") || p?.compliance.some((f) => f.severity === "BLOCK") ? "red" : undefined} />
        </div>
        <Tabs current={conceptHref(id, tab)} tabs={tabs} />
      </PageHeader>

      {sp.note && <div className="card card-pad mb-4 text-[13px] border-yellow/40 bg-yellow-soft">{sp.note}</div>}
      {!p && <div className="card card-pad mb-4 text-[13px] text-muted">Le package de contenu (accroches, script, découpage, plans, direction, variations, versions organique et payante, brief) n&apos;est pas encore construit.{canCreate ? " Cliquez sur « Construire le contenu »." : ""}</div>}

      {tab === "strategie" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="Stratégie"><KV items={[["Objectif", p?.strategy.objective ?? c.objective], ["Étape du tunnel", FUNNEL_LABELS[k.funnelStage]], ["Audience", p?.strategy.audience ?? "—"], ["Produit", c.productName ?? `Gamme ${c.brandName}`], ["Tension consommateur", k.consumerTension], ["Message central", k.coreMessage], ["Concept", k.bigIdea]]} /></Card>
          <Card title="Score créatif (explicable)"><ScoreList items={k.scores.items} /></Card>
          <Card title="Conformité des allégations (concept)"><ComplianceList flags={k.compliance} /></Card>
          <div className="space-y-3">{k.review && <ReviewPanel review={k.review} />}{c.packageReview && <ReviewPanel review={c.packageReview} title="Revue du package" />}{!k.review && <p className="text-[12.5px] text-muted">Aucune revue IA (squelette déterministe ou revue indisponible).</p>}</div>
        </div>
      )}

      {tab === "concept" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="Grande idée"><p className="text-[14px]">{k.bigIdea}</p><div className="mt-3"><KV items={[["Insight", k.insight], ["Déclencheur psychologique", k.psychologicalTrigger], ["Rôle du produit", k.productRole], ["Réaction attendue", k.desiredConsumerReaction]]} /></div></Card>
          <Card title="Structure narrative"><ol className="list-decimal pl-5 text-[13px] space-y-1">{k.storytellingStructure.map((s, i) => <li key={i}>{s}</li>)}</ol><div className="mt-3"><div className="label">Direction visuelle</div><p className="text-[13px] text-ink-2 mt-0.5">{k.visualDirection}</p></div></Card>
          <Card title="Version organique"><p className="text-[13px] text-ink-2">{k.organicVersion}</p></Card>
          <Card title="Version payante"><p className="text-[13px] text-ink-2">{k.paidVersion}</p></Card>
          <Card title="Pourquoi ce concept" className="lg:col-span-2"><ul className="list-disc pl-4 text-[13px] text-ink-2 space-y-1">{k.reasoning.map((r, i) => <li key={i}>{r}</li>)}</ul>{k.similarity.to && <p className="mt-2 text-[12px] text-muted">Contenu récent le plus proche : « {k.similarity.to} » ({Math.round(k.similarity.score * 100)} % de proximité d&apos;empreinte).</p>}
            {canEdit && (c.status === "PROPOSED" || c.status === "APPROVED") && (
              <form action={conceptStatusAction} className="mt-3 flex flex-wrap items-center gap-2"><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value="concept" />
                {c.status === "PROPOSED" && <button type="submit" name="status" value="APPROVED" className="btn-secondary btn-sm">Approuver</button>}
                <input name="reason" className="input h-8 w-56 text-[12px]" placeholder="Motif pour écarter" /><button type="submit" name="status" value="REJECTED" className="btn-ghost btn-sm">Écarter</button>
              </form>
            )}
          </Card>
        </div>
      )}

      {tab === "accroches" && p && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="Cinq accroches"><ul className="space-y-2">{p.hooks.map((h, i) => <li key={i} className="rounded-xl bg-surface-2 p-3"><div className="flex items-center gap-2 mb-1"><Badge tone={h.type === k.hookType ? "accent" : "gray"}>{HOOK_LABELS[h.type]}</Badge>{h.type === k.hookType && <span className="text-[11px] text-muted">accroche du concept</span>}</div><p className="text-[14px]">{h.text}</p>{h.onScreen && <p className="text-[12px] text-muted mt-1">À l&apos;écran : « {h.onScreen} »</p>}</li>)}</ul></Card>
          <div className="space-y-4"><Card title="Accroches payantes (3 variantes)"><ul className="list-disc pl-4 text-[13px] space-y-1">{p.paidHookVariants.map((h, i) => <li key={i}>{h}</li>)}</ul></Card><Card title="Textes à l'écran"><ul className="flex flex-wrap gap-1.5">{p.onScreenTexts.map((t, i) => <li key={i}><Badge tone="gray">{t}</Badge></li>)}</ul></Card><Card title="Miniature"><p className="text-[13px] text-ink-2">{p.thumbnail}</p></Card></div>
        </div>
      )}

      {tab === "script" && p && (
        <div className="space-y-4">{p.scripts.map((s, i) => <Card key={i} title={`${s.label} · ${s.angle} · ${s.durationSec} s`} pad={false}><div className="px-4 pb-4"><SceneTable scenes={s.scenes} /><p className="mt-3 text-[13px]"><span className="label mr-2">CTA</span>{s.cta}</p></div></Card>)}</div>
      )}

      {tab === "storyboard" && p && <Card title="Découpage scène par scène" pad={false}><div className="px-4 pb-4"><SceneTable scenes={p.storyboard} /></div></Card>}
      {tab === "plans" && p && <Card title="Liste des plans" pad={false}><div className="px-4 pb-4"><ShotTable shots={p.shotList} /></div></Card>}

      {tab === "direction" && p && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="Direction visuelle"><KV items={[["Lumière", p.visual.lighting], ["Décor", p.visual.environment], ["Caméra", p.visual.cameraStyle], ["Cadrage", p.visual.framing], ["Mouvement", p.visual.movement], ["Rythme", p.visual.pacing], ["Montage", p.visual.editing], ["Sous-titres", p.visual.subtitles], ["Visibilité produit", p.visual.productVisibility], ["Direction de la créatrice", p.visual.creatorDirection]]} /></Card>
          <Card title="Direction de jeu"><KV items={[["Ton", p.performance.tone], ["Émotion", p.performance.emotionalTone], ["Rythme", p.performance.pacing], ["Expression", p.performance.expression], ["Authenticité", p.performance.authenticity]]} /><div className="mt-3"><div className="label mb-1">À éviter</div><ul className="list-disc pl-4 text-[13px] space-y-0.5">{p.performance.avoid.map((a, i) => <li key={i}>{a}</li>)}</ul></div></Card>
        </div>
      )}

      {tab === "variations" && p && (
        <Section title="Variations créatives" description={c.variations ? `Base : ${c.variations.baseLabel}. Chaque variation change une variable créative et dit laquelle.${c.variations.generatedBy === "RULES" ? " (déterministes, sans IA)" : ""}` : "Accroche (5), ouverture (3), structure (3), persona (2 à 3), angle émotionnel (2 à 3), CTA (2 à 3), format."}
          action={canCreate ? <form action={variationsAction}><input type="hidden" name="id" value={id} /><button type="submit" className="btn-primary btn-sm"><Shuffle size={14} /> {c.variations ? "Régénérer les variations" : "Générer des variations"}</button></form> : undefined}>
          {!c.variations ? <div className="card card-pad text-[13px] text-muted">Aucune variation générée pour l&apos;instant.</div> : (
            <div className="grid lg:grid-cols-2 gap-3">{(Object.keys(DIM_LABEL) as VariationDimension[]).filter((d) => byDim.has(d)).map((d) => (
              <Card key={d} title={DIM_LABEL[d]}><ul className="space-y-2">{byDim.get(d)!.map((v, i) => <li key={i} className="rounded-xl bg-surface-2 p-3 text-[13px]"><div className="flex items-center gap-2"><b>{v.label}</b>{v.format && <Badge tone="gray">{FORMAT_LABELS[v.format]}</Badge>}</div><p className="text-[12px] text-muted">Ce qui change : {v.changed}</p><p className="mt-1">{v.content}</p>{v.steps && v.steps.length > 0 && <ol className="list-decimal pl-5 mt-1 text-[12.5px]">{v.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>}</li>)}</ul></Card>
            ))}</div>
          )}
        </Section>
      )}

      {(tab === "organique" || tab === "payant") && p && (() => { const v = tab === "organique" ? p.organic : p.paid; return (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title={tab === "organique" ? "Version organique" : "Version payante"}><KV items={[["But", v.goal], ["Accroche", v.hook], ["CTA", v.cta], ["Durée", `${v.durationSec} s`], ...(tab === "payant" ? [["Budget de test", v.testBudgetMad === null ? "non défini (aucun disponible sur le levier)" : `${fmtMAD(v.testBudgetMad)} — borné par le disponible du levier`] as [string, React.ReactNode]] : [])]} /><div className="mt-3"><div className="label mb-1">Structure</div><ol className="list-decimal pl-5 text-[13px] space-y-0.5">{v.structure.map((s, i) => <li key={i}>{s}</li>)}</ol></div>{v.notes.length > 0 && <div className="mt-3"><div className="label mb-1">Notes</div><ul className="list-disc pl-4 text-[13px] space-y-0.5">{v.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}</Card>
          <Card title="KPI"><ul className="space-y-1.5 text-[13px]">{v.kpis.map((kp, i) => <li key={i} className="flex items-start gap-2"><span className="font-medium w-44 shrink-0">{kp.label}</span><span className="text-ink-2 flex-1">{kp.target}</span><Tag tag={kp.tag} /></li>)}</ul>{tab === "payant" && p.paidHookVariants.length > 0 && <div className="mt-3"><div className="label mb-1">Accroches à tester</div><ul className="list-disc pl-4 text-[13px]">{p.paidHookVariants.map((h, i) => <li key={i}>{h}</li>)}</ul></div>}</Card>
        </div>
      ); })()}

      {tab === "production" && p && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="Légende et hashtags"><pre className="whitespace-pre-wrap text-[13px] font-sans">{p.caption}</pre><p className="mt-2 text-[12.5px] text-accent">{p.hashtags.join(" ")}</p><p className="mt-2 text-[13px]"><span className="label mr-2">CTA</span>{p.cta}</p><div className="mt-2 text-[12.5px] text-muted">Variantes : {p.ctaVariants.join(" · ")}</div></Card>
          <Card title="Idées de stories"><ul className="list-disc pl-4 text-[13px] space-y-1">{p.storyIdeas.map((s, i) => <li key={i}>{s}</li>)}</ul></Card>
          <Card title="Livrables et éléments nécessaires"><ul className="list-disc pl-4 text-[13px] space-y-0.5">{p.assets.map((a, i) => <li key={i}>{a}</li>)}</ul></Card>
          <Card title="Notes de production"><ul className="list-disc pl-4 text-[13px] space-y-0.5">{p.productionNotes.map((a, i) => <li key={i}>{a}</li>)}</ul></Card>
          <Card title="Allégations et conformité" className="lg:col-span-2">
            <div className="grid sm:grid-cols-3 gap-3 text-[12.5px]"><div><div className="label mb-1">Autorisé (fiche produit)</div><ul className="list-disc pl-4">{p.claims.allowed.map((x, i) => <li key={i}>{x}</li>)}</ul></div><div><div className="label mb-1">Interdit</div><ul className="list-disc pl-4">{p.claims.forbidden.map((x, i) => <li key={i}>{x}</li>)}</ul></div><div><div className="label mb-1">Mentions obligatoires</div><ul className="list-disc pl-4">{p.claims.mandatory.map((x, i) => <li key={i}>{x}</li>)}</ul></div></div>
            <div className="mt-3"><ComplianceList flags={p.compliance} /></div>
          </Card>
          <Card title="KPI du contenu"><ul className="space-y-1.5 text-[13px]">{p.kpis.map((kp, i) => <li key={i} className="flex items-start gap-2"><span className="font-medium w-44 shrink-0">{kp.label}</span><span className="text-ink-2 flex-1">{kp.target}</span><Tag tag={kp.tag} /></li>)}</ul></Card>
          <Card title="Envoyer en production">
            {c.status === "SENT" && c.contentItemId ? <p className="text-[13px]">Déjà envoyé : <Link href={`/marketing/planning/${c.contentItemId}`} className="text-accent underline">ouvrir le contenu au planning éditorial</Link>.</p> : !canCreate ? <p className="text-[13px] text-muted">Réservé aux personnes qui créent sur Marketing.</p> : p.compliance.some((f) => f.severity === "BLOCK") ? <p className="text-[13px] text-red">Allégation bloquante détectée : régénérer le package avant l&apos;envoi.</p> : (
              <form action={sendToPlanningAction} className="grid sm:grid-cols-2 gap-2 text-[13px]"><input type="hidden" name="id" value={id} />
                <label className="block"><span className="label">Date de publication</span><input type="date" name="date" defaultValue={defaultDate} className="input mt-1" required /></label>
                <label className="block"><span className="label">Livrable attendu le</span><input type="date" name="deadline" defaultValue={iso(addDays(today(), 5))} className="input mt-1" /></label>
                <label className="block"><span className="label">Responsable</span><select name="responsibleId" className="select mt-1" defaultValue=""><option value="">— à définir —</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                <label className="block"><span className="label">Plateforme</span><select name="platform" className="select mt-1" defaultValue={refs.platforms.find((x) => x.active && /insta/i.test(x.key))?.key ?? ""}>{refs.platforms.filter((x) => x.active).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
                <div className="sm:col-span-2 flex items-center gap-2"><button type="submit" className="btn-primary btn-sm"><Send size={14} /> Créer le contenu au planning</button><span className="text-[12px] text-muted">Crée le brief complet dans le planning éditorial, rattache le produit et ouvre la tâche du responsable.</span></div>
              </form>
            )}
          </Card>
        </div>
      )}
      <p className="mt-6 text-[11.5px] text-muted">Territoire {TERRITORY_LABELS[k.creativeTerritory]} · mécanique {k.mechanicName} · empreinte {k.fingerprint} · généré {k.generatedBy === "AI" ? `par le copilote (${c.model ?? "modèle"})` : "sans IA (squelette déterministe)"}.</p>
    </>
  );
}
