import Link from "next/link";
import { Clapperboard, Sparkles } from "lucide-react";
import { requireAccess, canDo } from "@/lib/access";
import { decisionScopeFor } from "@/lib/decisions/server";
import { findOpportunities } from "@/lib/creative/server";
import { listConcepts, studioCounters } from "@/lib/creative/store";
import { TERRITORY_LABELS } from "@/lib/creative/territories";
import { PageHeader, Card, Kpi, Badge, BrandDot, Section, Empty, Tabs } from "@/components/ui";
import { InsightList, OpportunityCard, STATUS_LABEL, STATUS_TONE, ScoreRing, conceptHref, opportunityHref } from "@/components/creative-studio";
import { fmtDateShort, fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Studio créatif" };

export default async function StudioPage(props: { searchParams: Promise<{ brand?: string; note?: string }> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const [scope, canCreate] = await Promise.all([decisionScopeFor(sp.brand ?? null), canDo("marketing", "create")]);
  if (scope.allBrands.length === 0) return <><PageHeader eyebrow="Marketing · Intelligence contenu" title="Studio créatif" /><Empty title="Aucune marque dans votre périmètre" hint="Demander l'assignation d'une marque à un administrateur (Paramètres → Utilisateurs)." /></>;
  const brandIds = scope.brands.map((b) => b.id);
  const [board, counters, recent] = await Promise.all([
    findOpportunities(scope),
    studioCounters(brandIds),
    listConcepts({ brandIds, statuses: ["PROPOSED", "APPROVED", "BUILT", "SENT"], limit: 8 }),
  ]);
  const active = board.opportunities.filter((o) => !o.blocked);
  const blocked = board.opportunities.filter((o) => o.blocked);
  const href = (b: string | null) => `/marketing/studio${b ? `?brand=${b}` : ""}`;

  return (
    <>
      <PageHeader eyebrow="Marketing · Intelligence contenu" title="Studio créatif"
        subtitle={<>COMANET lit les ventes, le stock, le plan et les contenus récents, désigne le produit à pousser, la tension consommateur et le territoire créatif, puis construit le contenu et son brief de production. Calculé à {fmtTime(board.computedAt)}.</>}
        actions={<><Link href="/marketing/planning" className="btn-secondary btn-sm">Planning éditorial</Link><Link href="/marketing/priorites" className="btn-secondary btn-sm">Priorités & actions</Link></>}>
        <Tabs current={href(scope.selectedBrandId)} tabs={[{ href: href(null), label: "Toutes les marques" }, ...scope.allBrands.map((b) => ({ href: href(b.id), label: b.name }))]} />
      </PageHeader>

      {sp.note && <div className="card card-pad mb-4 text-[13px] border-yellow/40 bg-yellow-soft">{sp.note}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Opportunités du moment" value={active.length} sub={blocked.length ? `${blocked.length} produit(s) à ne pas pousser` : "produits et tensions désignés par la donnée"} />
        <Kpi label="Concepts proposés" value={counters.proposed} sub="à décider" />
        <Kpi label="Contenus construits" value={counters.built} sub="package et brief prêts" />
        <Kpi label="Envoyés en production" value={counters.sent} sub="au planning éditorial" />
      </div>

      <Section title="Opportunités créatives" description="Ce que COMANET recommande de produire maintenant : pour quel produit, quelle tension consommateur, par quelle mécanique — et pourquoi.">
        {active.length === 0 ? (
          <Empty icon={<Sparkles size={18} />} title="Aucune opportunité calculable"
            hint={<>Le studio a besoin de ventes importées (Imports → Ventes), d&apos;une photo de stock, de fiches produits renseignées (bénéfices, actifs, allégations : Produits → fiche marketing) et, pour apprendre, de contenus publiés avec portée et engagement ou d&apos;une synchronisation Meta. {board.notes.join(" ")}</>} />
        ) : (
          <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-3">{active.map((o) => <OpportunityCard key={o.key} o={o} />)}</div>
        )}
      </Section>

      {blocked.length > 0 && (
        <Section title="À ne pas pousser" description="Le moteur marketing recommande de ne pas créer de demande sur ces produits pour le moment (rupture, diagnostic en attente).">
          <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-3">{blocked.map((o) => <OpportunityCard key={o.key} o={o} />)}</div>
        </Section>
      )}

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2" title="Apprentissages créatifs (corrélations observées)">
          <InsightList insights={board.insights} />
        </Card>
        <Card title="Territoires et fraîcheur">
          {board.saturated.length === 0 ? <p className="text-[12.5px] text-muted">Aucun territoire saturé sur la fenêtre de fatigue ({scope.ctx.settings.creative.fatigueWindowDays} jours) : tous les angles restent ouverts.</p> : (
            <ul className="text-[12.5px] space-y-1">{board.saturated.map((s) => <li key={s.brandName}><b>{s.brandName}</b> : {s.territories.join(", ")} — COMANET recommande un autre angle.</li>)}</ul>
          )}
          <div className="mt-3 text-[11.5px] text-muted">Territoires : {Object.values(TERRITORY_LABELS).join(" · ")}. Les scores sont des aides à la décision, pas des mesures.</div>
          {board.notes.length > 0 && <ul className="mt-3 text-[11.5px] text-muted list-disc pl-4">{board.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </Card>
      </div>

      <Section title="Concepts récents" description="Les derniers concepts générés, à décider, construits ou envoyés." action={<Link href="/marketing/planning" className="text-[12.5px] text-accent hover:underline">Voir le planning</Link>}>
        {recent.length === 0 ? (
          <Empty icon={<Clapperboard size={18} />} title="Aucun concept généré pour l'instant" hint={canCreate ? "Explorez une opportunité ci-dessus et lancez « Générer les concepts »." : "Les concepts sont générés par les personnes qui créent sur Marketing."} />
        ) : (
          <Card pad={false}><div className="overflow-x-auto"><table className="tbl w-full">
            <thead><tr><th>Concept</th><th>Marque · produit</th><th>Mécanique</th><th>Score</th><th>Statut</th><th>Créé le</th><th></th></tr></thead>
            <tbody>{recent.map((s) => (
              <tr key={s.id}>
                <td className="min-w-56"><Link href={conceptHref(s.id)} className="font-medium hover:underline">{s.concept.title}</Link></td>
                <td className="text-[12px]"><span className="inline-flex items-center gap-1"><BrandDot color={scope.allBrands.find((b) => b.id === s.brandId)?.color ?? "#999"} />{s.brandName}</span>{s.productName ? ` · ${s.productName}` : ""}</td>
                <td className="text-[12px]">{s.concept.mechanicName} <span className="text-muted">· {TERRITORY_LABELS[s.concept.creativeTerritory]}</span></td>
                <td><ScoreRing score={s.score} /></td>
                <td><Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge></td>
                <td className="text-[12px] whitespace-nowrap">{fmtDateShort(s.createdAt)}</td>
                <td className="text-right"><Link href={opportunityHref(s.opportunityKey)} className="text-[12px] text-accent hover:underline">opportunité</Link></td>
              </tr>
            ))}</tbody>
          </table></div></Card>
        )}
      </Section>
    </>
  );
}
