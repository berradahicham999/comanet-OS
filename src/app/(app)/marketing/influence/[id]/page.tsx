import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, brandFilter, hasFlag, canDo } from "@/lib/access";
import { getRefDate } from "@/lib/ref-date";
import { listBrands } from "@/lib/users";
import { PageHeader, Card, Kpi, Badge, BrandDot, Section, Empty, Facts } from "@/components/ui";
import { fmtMAD, fmtNum, fmtPct, fmtDateShort, iso, addDays } from "@/lib/format";
import { COLLAB_STATUS } from "@/lib/marketing-shared";
import { listCollaborations, collabKpis, scoreCollaborations, rankInfluencers, influenceTotals, exposureAggregates } from "@/lib/influence";
import { INFLUENCE_ERRORS, INFLUENCE_OK } from "@/lib/influence-shared";
import { CollabForm, CollabRowActions, InfluencerEditButton, type FormInfluencer } from "@/components/influence-forms";
import { saveInfluencer, saveCollaboration, setCollaborationStatus, deleteCollaboration } from "../../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "Influenceuse" };
  const r = await db.execute(sql`select name from influencers where id = ${id}::uuid`);
  const name = (r.rows[0] as { name: string } | undefined)?.name;
  return { title: name ? `Influence — ${name}` : "Influenceuse" };
}

/** Fiche d'une influenceuse : profil, historique complet des collaborations, comparaison aux autres profils. */
export default async function InfluencerDetailPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  await requireAccess("influence");
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [scopeBrands, seeCosts, canEdit, canDelete, canCreate, { ref }] = await Promise.all([
    brandFilter(), hasFlag("seeInternalCosts"), canDo("influence", "edit"), canDo("influence", "validate"), canDo("influence", "create"), getRefDate(),
  ]);
  const infRes = await db.execute(sql`select id, name, instagram, tiktok, followers, engagement_rate::float8 as engagement_rate, category, city, usual_rate::float8 as usual_rate, contact, notes, active, created_at::text as created_at from influencers where id = ${id}::uuid`);
  const inf = infRes.rows[0] as (FormInfluencer & { created_at: string }) | undefined;
  if (!inf) notFound();

  // Historique complet (depuis 2000) ; les 12 derniers mois servent à la comparaison avec les autres profils.
  const all: { start: string; end: string } = { start: "2000-01-01", end: iso(addDays(ref, 366)) };
  const last12 = { start: iso(addDays(ref, -364)), end: iso(addDays(ref, 1)) };
  const [rows, peerRows, brands, campaignRows, productRows] = await Promise.all([
    listCollaborations(all, { influencerId: id, brandIds: scopeBrands }),
    listCollaborations(last12, { brandIds: scopeBrands }),
    listBrands().then((bs) => bs.filter((b) => b.active && (scopeBrands === null || scopeBrands.includes(b.id)))),
    db.execute(sql`select id, name, brand_id from campaigns where channel = 'INFLUENCE' and status in ('DRAFT','PLANNED','ACTIVE') order by name`),
    db.execute(sql`select id, name, brand_id from products where active order by name limit 600`),
  ]);

  const scored = scoreCollaborations(rows.map(collabKpis));
  const totals = influenceTotals(scored);
  const peers = rankInfluencers(scoreCollaborations(peerRows.map(collabKpis)), new Map());
  const me = peers.find((p) => p.id === id) ?? null;
  const rank = me ? peers.findIndex((p) => p.id === id) + 1 : null;
  const others = peers.filter((p) => p.id !== id);
  const avg = (vals: (number | null)[]) => { const v = vals.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const peerAvg = { cpm: avg(others.map((p) => p.cpm)), engagement: avg(others.map((p) => p.engagement)), roas: avg(others.map((p) => p.roas)) };

  // Par marque : exposition et résultat mesuré.
  const byBrand = [...new Map(scored.map((r) => [r.brand_id, r])).values()].map((first) => {
    const list = scored.filter((r) => r.brand_id === first.brand_id);
    const measured = list.filter((r) => r.measured);
    const mCost = measured.reduce((a, r) => a + r.cost, 0);
    const mRev = measured.reduce((a, r) => a + (r.attributed_revenue ?? 0), 0);
    return { brand: first.brand, color: first.brand_color, collabs: list.length, cost: list.reduce((a, r) => a + r.cost, 0), ...exposureAggregates(list), measuredCollabs: measured.length, measuredRevenue: mRev, roas: mCost > 0 ? mRev / mCost : null };
  }).sort((a, b) => b.collabs - a.collabs);

  const campaigns = campaignRows.rows as { id: string; name: string; brand_id: string }[];
  const products = productRows.rows as { id: string; name: string; brand_id: string | null }[];
  const message = sp.ok ? { tone: "green", text: INFLUENCE_OK[sp.ok] ?? sp.ok } : sp.erreur ? { tone: "red", text: INFLUENCE_ERRORS[sp.erreur] ?? sp.erreur } : null;
  const returnParams = { path: `/marketing/influence/${id}` };
  const influencers: FormInfluencer[] = [inf];
  const formProps = { action: saveCollaboration, brands, influencers, campaigns, products, seeCosts, returnParams };
  const cmp = (mine: number | null, other: number | null, invert = false) => {
    if (mine === null || other === null || other === 0) return null;
    const d = ((mine - other) / other) * 100;
    return { d, good: invert ? d < 0 : d > 0 };
  };

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/marketing/influence" className="hover:text-accent">Influence</Link>}
        title={inf.name}
        subtitle={[inf.instagram, inf.tiktok, inf.category, inf.city, inf.followers ? `${fmtNum(inf.followers)} abonnés` : null, !inf.active ? "profil inactif" : null].filter(Boolean).join(" · ") || "Aucune information de profil"}
        actions={<>{canEdit && <InfluencerEditButton influencer={inf} action={saveInfluencer} returnParams={returnParams} />}<Link href="/marketing/influence" className="btn-ghost btn-sm">← Toutes les influenceuses</Link></>}
      >
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Kpi label="Collaborations" value={String(totals.collabs)} sub={totals.collabs ? `${byBrand.length} marque(s)` : "aucune saisie"} />
          <Kpi label="Investissement total" value={seeCosts ? fmtMAD(totals.cost, { compact: true }) : "masqué"} sub={seeCosts ? "cachets + valeur produits" : "coûts internes non visibles"} />
          <Kpi label="Personnes touchées" value={totals.reach !== null ? fmtNum(totals.reach) : "—"} sub={totals.cpm !== null ? `CPM ${fmtMAD(totals.cpm)}` : "reach non saisi"} />
          <Kpi label="Engagement" value={totals.engagement !== null ? fmtPct(totals.engagement, 2) : "—"} sub={totals.interactions !== null ? `${fmtNum(totals.interactions)} interactions` : "statistiques non saisies"} />
          <Kpi label="ROAS mesuré" value={totals.roas === null ? "—" : totals.roas.toFixed(2) + "×"} tone={totals.roas !== null && totals.roas < 1 ? "red" : totals.roas !== null && totals.roas >= 3 ? "green" : undefined} sub={`${totals.measuredCollabs}/${totals.collabs} mesurable(s)`} />
        </div>
      </PageHeader>

      {message && <div className={`mb-4 rounded-2xl px-4 py-3 text-[13px] font-medium ${message.tone === "green" ? "bg-green-soft border border-green/30 text-green" : "bg-red-soft border border-red/30 text-red"}`}>{message.text}</div>}

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <Card title="Profil">
          <Facts cols={2} items={[
            { label: "Instagram", value: inf.instagram ?? "—" },
            { label: "TikTok", value: inf.tiktok ?? "—" },
            { label: "Abonnés", value: inf.followers ? fmtNum(inf.followers) : "—" },
            { label: "Taux d'engagement déclaré", value: inf.engagement_rate !== null ? fmtPct(inf.engagement_rate, 2) : "—" },
            { label: "Tarif habituel", value: inf.usual_rate ? fmtMAD(inf.usual_rate) : "—" },
            { label: "Contact", value: inf.contact ?? "—" },
            { label: "Catégorie", value: inf.category ?? "—" },
            { label: "Ville", value: inf.city ?? "—" },
          ]} />
          {inf.notes && <p className="text-[12.5px] text-ink-2 mt-3 whitespace-pre-line">{inf.notes}</p>}
        </Card>

        <Card title="Face aux autres profils">
          <p className="text-[11.5px] text-faint mb-2">12 derniers mois, marques de votre périmètre. Un axe non mesuré s&apos;affiche « — », il n&apos;est jamais estimé.</p>
          {!me ? <Empty title="Pas de collaboration sur 12 mois" hint="La comparaison n'est possible qu'avec une collaboration récente." /> : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="text-[28px] font-semibold">{me.score === null ? <span className="text-faint">n/c</span> : me.score}</div>
                <div className="text-[12px] text-muted">score /100{rank ? <> · <span className="font-medium text-ink">{rank}<sup>e</sup></span> sur {peers.length} profil(s)</> : null}</div>
              </div>
              <table className="tbl text-[12.5px]">
                <thead><tr><th>Axe</th><th className="num">Ce profil</th><th className="num">Moyenne des autres</th><th className="num">Écart</th></tr></thead>
                <tbody>
                  {([
                    { label: "CPM (MAD)", mine: me.cpm, other: peerAvg.cpm, fmt: (v: number) => String(Math.round(v)), invert: true },
                    { label: "Engagement", mine: me.engagement, other: peerAvg.engagement, fmt: (v: number) => v.toFixed(1) + " %", invert: false },
                    { label: "ROAS mesuré", mine: me.roas, other: peerAvg.roas, fmt: (v: number) => v.toFixed(2) + "×", invert: false },
                  ] as const).map((a) => {
                    const c = cmp(a.mine, a.other, a.invert);
                    return (
                      <tr key={a.label}>
                        <td>{a.label}</td>
                        <td className="num">{a.mine !== null ? a.fmt(a.mine) : "—"}</td>
                        <td className="num">{a.other !== null ? a.fmt(a.other) : "—"}</td>
                        <td className={`num ${c ? (c.good ? "text-green" : "text-red") : "text-faint"}`}>{c ? `${c.d > 0 ? "+" : ""}${Math.round(c.d)} %` : "non comparable"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[11px] text-faint">Corrélation observée entre profils, jamais une causalité : le contexte (marque, produit, période) diffère d&apos;une collaboration à l&apos;autre.</p>
            </div>
          )}
        </Card>

        <Card title="Par marque">
          {byBrand.length === 0 ? <Empty title="Aucune collaboration" /> : (
            <table className="tbl text-[12.5px]">
              <thead><tr><th>Marque</th><th className="num">Collabs</th><th className="num">Reach</th><th className="num">CPM</th><th className="num">Eng.</th><th className="num">ROAS</th></tr></thead>
              <tbody>
                {byBrand.map((b) => (
                  <tr key={b.brand}>
                    <td><span className="flex items-center gap-1.5">{b.color && <BrandDot color={b.color} />}{b.brand}</span></td>
                    <td className="num">{b.collabs}</td>
                    <td className="num">{b.reach !== null ? fmtNum(b.reach) : "—"}</td>
                    <td className="num">{b.cpm !== null ? Math.round(b.cpm) : "—"}</td>
                    <td className="num">{b.engagement !== null ? b.engagement.toFixed(1) + " %" : "—"}</td>
                    <td className="num">{b.roas !== null ? b.roas.toFixed(2) + "×" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Section title={`Historique (${scored.length})`} description="Toutes les collaborations de ce profil, de la plus récente à la plus ancienne. Le score est relatif aux collaborations de ce profil uniquement.">
        <Card>
          {scored.length === 0 ? <Empty title="Aucune collaboration enregistrée" hint="Saisissez la première ci-dessous." /> : (
            <div className="overflow-x-auto">
              <table className="tbl text-[12.5px]">
                <thead><tr><th>Date</th><th>Marque</th><th>Contenu</th><th className="num">Coût</th><th className="num">Reach</th><th className="num">Eng.</th><th className="num">Clics</th><th className="num">CA mesuré</th><th className="num">Score</th><th colSpan={2}>Statut</th></tr></thead>
                <tbody>
                  {scored.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{fmtDateShort(r.date)}</td>
                      <td><span className="flex items-center gap-1.5">{r.brand_color && <BrandDot color={r.brand_color} />}{r.brand}</span>{r.product && <div className="text-[11px] text-faint">{r.product}</div>}</td>
                      <td className="text-muted">{[r.reels ? `${r.reels} reel(s)` : null, r.stories ? `${r.stories} story(s)` : null, r.posts ? `${r.posts} post(s)` : null].filter(Boolean).join(" · ") || r.content_type || "—"}{r.campaign && <span className="text-faint"> · {r.campaign}</span>}</td>
                      <td className="num">{seeCosts ? fmtMAD(r.cost, { suffix: false }) : "•••"}</td>
                      <td className="num">{r.reach !== null ? fmtNum(r.reach) : "—"}</td>
                      <td className="num">{r.engagement !== null ? r.engagement.toFixed(1) + " %" : "—"}</td>
                      <td className="num">{r.link_clicks !== null ? fmtNum(r.link_clicks) : "—"}</td>
                      <td className="num">{r.measured ? fmtMAD(r.attributed_revenue ?? 0, { suffix: false }) : <span className="text-faint">non mesurable</span>}</td>
                      <td className="num">{r.score === null ? <span className="text-faint">n/c</span> : <Badge tone={r.score >= 70 ? "green" : r.score >= 40 ? "yellow" : "red"}>{r.score}</Badge>}</td>
                      <td colSpan={2}>
                        {canEdit || canDelete ? (
                          <CollabRowActions row={r} label={`${r.influencer} · ${r.brand} · ${fmtDateShort(r.date)}`} canEdit={canEdit} canDelete={canDelete} statusAction={setCollaborationStatus} deleteAction={deleteCollaboration} {...formProps} />
                        ) : <Badge tone={COLLAB_STATUS[r.status]?.tone ?? "gray"}>{COLLAB_STATUS[r.status]?.label ?? r.status}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      {canCreate && (
        <Section title="Nouvelle collaboration" description={`Pour ${inf.name}. La fiche revient ici après l'enregistrement.`}>
          <Card className="max-w-3xl"><CollabForm {...formProps} /></Card>
        </Section>
      )}
    </>
  );
}
