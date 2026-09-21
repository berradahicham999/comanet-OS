import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, brandFilter, hasFlag, canDo } from "@/lib/access";
import { getRefDate } from "@/lib/ref-date";
import { listBrands } from "@/lib/users";
import { resolvePeriod, PERIOD_OPTIONS, type PeriodParam } from "@/lib/periods";
import { PageHeader, Card, Kpi, Badge, BrandDot, Section, Empty, Tabs, Progress } from "@/components/ui";
import { fmtMAD, fmtNum, fmtPct, fmtDateShort, iso } from "@/lib/format";
import { INFLUENCE_ERRORS, INFLUENCE_OK } from "@/lib/influence-shared";
import { CollabForm, CollabRowActions, InfluencerDirectory, type FormInfluencer } from "@/components/influence-forms";
import { COLLAB_STATUS, CAMPAIGN_STATUS } from "@/lib/marketing-shared";
import { listCollaborations, collabKpis, scoreCollaborations, rankInfluencers, collabPipeline, influenceTotals, influenceAdvice } from "@/lib/influence";
import { saveInfluencer, saveCollaboration, setCollaborationStatus, deleteCollaboration, saveCampaign } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Influence" };

const ADVICE_TONE = { green: "green", orange: "orange", red: "red", blue: "blue" } as const;

export default async function InfluencePage(props: { searchParams: Promise<{ brand?: string; period?: string; start?: string; end?: string; status?: string; ok?: string; erreur?: string }> }) {
  await requireAccess("influence");
  const sp = await props.searchParams;
  const [scopeBrands, seeCosts, canEdit, canDelete, canCreate] = await Promise.all([brandFilter(), hasFlag("seeInternalCosts"), canDo("influence", "edit"), canDo("influence", "validate"), canDo("influence", "create")]);
  const { ref } = await getRefDate();
  const period = resolvePeriod((sp.period as PeriodParam) || "last90", ref, { start: sp.start, end: sp.end });
  const brands = (await listBrands()).filter((b) => b.active && (scopeBrands === null || scopeBrands.includes(b.id)));
  const brandId = sp.brand && brands.some((b) => b.id === sp.brand) ? sp.brand : null;
  const status = sp.status && sp.status in COLLAB_STATUS ? sp.status : null;

  const [rows, influencerRows, campaignRows, productRows] = await Promise.all([
    listCollaborations({ start: period.start, end: period.end }, { brandId, brandIds: scopeBrands }),
    db.execute(sql`select id, name, instagram, tiktok, followers, engagement_rate::float8 as engagement_rate, category, city, usual_rate::float8 as usual_rate, contact, notes, active from influencers order by active desc, name`),
    db.execute(sql`select id, name, brand_id from campaigns where channel = 'INFLUENCE' and status in ('DRAFT','PLANNED','ACTIVE') order by name`),
    db.execute(sql`select id, name, brand_id from products where active order by name limit 600`),
  ]);

  const influencerList = influencerRows.rows as FormInfluencer[];
  const meta = new Map(influencerList.map((i) => [i.id, { instagram: i.instagram, tiktok: i.tiktok, active: i.active, usualRate: i.usual_rate }]));

  // Le pipeline compte toutes les étapes ; le filtre de statut ne s'applique qu'ensuite.
  const all = scoreCollaborations(rows.map(collabKpis));
  const pipeline = collabPipeline(all);
  const scored = status ? scoreCollaborations(all.filter((r) => r.status === status)) : all;
  const ranked = rankInfluencers(scored, meta);
  const totals = influenceTotals(scored);
  const advice = influenceAdvice(scored, ranked, iso(ref));
  const campaigns = campaignRows.rows as { id: string; name: string; brand_id: string }[];
  const products = productRows.rows as { id: string; name: string; brand_id: string | null }[];
  const message = sp.ok ? { tone: "green", text: INFLUENCE_OK[sp.ok] ?? sp.ok } : sp.erreur ? { tone: "red", text: INFLUENCE_ERRORS[sp.erreur] ?? sp.erreur } : null;

  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    if (brandId) p.set("brand", brandId);
    if (period.key !== "last90") p.set("period", period.key);
    if (status) p.set("status", status);
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    const s = p.toString();
    return s ? `/marketing/influence?${s}` : "/marketing/influence";
  };
  /** Filtres courants, renvoyés aux actions pour revenir au même écran. */
  const returnParams: Record<string, string> = {};
  if (brandId) returnParams.brand = brandId;
  if (period.key !== "last90") returnParams.period = period.key;
  if (period.key === "custom") { if (sp.start) returnParams.start = sp.start; if (sp.end) returnParams.end = sp.end; }
  if (status) returnParams.status = status;
  const formProps = { action: saveCollaboration, brands, influencers: influencerList, campaigns, products, seeCosts, returnParams };

  return (
    <>
      <PageHeader
        eyebrow="Marketing Command Center"
        title="Influence"
        subtitle={`${period.label} · ${totals.collabs} collaboration(s), ${totals.influencers} influenceuse(s). Le CA n'est compté comme attribué que lorsqu'un code promo ou un lien tracké le mesure.`}
        actions={<><Link href="/marketing" className="btn-secondary btn-sm">Vue d&apos;ensemble</Link><Link href="/marketing/campagnes" className="btn-ghost btn-sm">Campagnes</Link></>}
      >
        <form className="flex flex-wrap items-end gap-2 mb-3">
          {brandId && <input type="hidden" name="brand" value={brandId} />}
          {status && <input type="hidden" name="status" value={status} />}
          <label className="block"><span className="label block mb-1">Période</span><select name="period" defaultValue={period.key} className="select h-9 w-44">{PERIOD_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
          {period.key === "custom" && (<><label className="block"><span className="label block mb-1">Du</span><input type="date" name="start" defaultValue={period.start} className="input h-9" /></label><label className="block"><span className="label block mb-1">Au</span><input type="date" name="end" defaultValue={sp.end ?? ""} className="input h-9" /></label></>)}
          <button className="btn-secondary btn-sm h-9" type="submit">Appliquer</button>
        </form>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
          <Kpi label="Investissement influence" value={seeCosts ? fmtMAD(totals.cost, { compact: true }) : "masqué"} sub={seeCosts ? "cachets + valeur produits" : "coûts internes non visibles sur ce compte"} />
          <Kpi label="Personnes touchées" value={totals.reach !== null ? fmtNum(totals.reach) : "—"} sub={totals.reach !== null ? `CPM ${totals.cpm !== null ? fmtMAD(totals.cpm) : "—"}` : "reach non saisi"} />
          <Kpi label="Engagement moyen" value={totals.engagement !== null ? fmtPct(totals.engagement, 2) : "—"} sub={totals.interactions !== null ? `${fmtNum(totals.interactions)} interactions` : "statistiques non saisies"} />
          <Kpi label="CA attribué mesuré" value={totals.measuredCollabs ? fmtMAD(totals.measuredRevenue, { compact: true }) : "—"} sub={`${totals.measuredCollabs}/${totals.collabs} collaboration(s) mesurable(s)`} />
          <Kpi label="ROAS mesuré" value={totals.roas === null ? "—" : totals.roas.toFixed(2) + "×"} tone={totals.roas !== null && totals.roas < 1 ? "red" : totals.roas !== null && totals.roas >= 3 ? "green" : undefined} sub={totals.measuredCost > 0 ? `sur ${fmtMAD(totals.measuredCost, { compact: true })} traçables` : "aucune attribution"} />
        </div>
        <Tabs current={qs({})} tabs={[{ href: qs({ brand: "" }), label: "Toutes les marques" }, ...brands.map((b) => ({ href: qs({ brand: b.id }), label: b.name }))]} />
      </PageHeader>

      {message && <div className={`mb-4 rounded-2xl px-4 py-3 text-[13px] font-medium ${message.tone === "green" ? "bg-green-soft border border-green/30 text-green" : "bg-red-soft border border-red/30 text-red"}`}>{message.text}</div>}

      {advice.length > 0 && (
        <Section title="Ce que dit la période">
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {advice.map((a, i) => (
              <Card key={i}>
                <Badge tone={ADVICE_TONE[a.tone]}>{a.tone === "green" ? "À reconduire" : a.tone === "red" ? "À arbitrer" : a.tone === "orange" ? "À corriger" : "À compléter"}</Badge>
                <div className="font-semibold text-[14px] mt-2">{a.title}</div>
                <p className="text-[12.5px] text-ink-2 mt-1">{a.detail}</p>
              </Card>
            ))}
          </div>
        </Section>
      )}

      <Section title="Pipeline" description="Où en sont les collaborations de la période.">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {pipeline.map((p) => (
            <Link key={p.status} href={qs({ status: status === p.status ? "" : p.status })} className={`card p-3 hover:border-accent transition-colors ${status === p.status ? "border-accent" : ""}`}>
              <div className="text-[11px] text-muted">{p.label}</div>
              <div className="text-[19px] font-semibold mt-0.5">{p.count}</div>
              <div className="text-[11px] text-faint">{!seeCosts ? "" : p.cost ? fmtMAD(p.cost, { compact: true }) : "—"}</div>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Classement des influenceuses" description="Score 0-100 : efficience du coût (CPM), qualité de l'audience (engagement) et résultat mesuré (ROAS). Un axe non mesuré est retiré du calcul plutôt que remplacé par une estimation.">
        <Card>
          {ranked.length === 0 ? <Empty title="Aucune collaboration sur la période" hint="Saisissez une collaboration ci-dessous pour commencer à comparer les profils." /> : (
            <div className="overflow-x-auto">
              <table className="tbl text-[12.5px]">
                <thead><tr><th>Influenceuse</th><th>Marques</th><th className="num">Collabs</th><th className="num">Coût</th><th className="num">Reach</th><th className="num">CPM</th><th className="num">Engagement</th><th className="num">CA mesuré</th><th className="num">ROAS</th><th className="num">Score</th></tr></thead>
                <tbody>
                  {ranked.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="font-medium"><Link href={`/marketing/influence/${r.id}`} className="hover:text-accent">{r.name}</Link>{!r.active && <span className="text-faint"> (inactive)</span>}</div>
                        <div className="text-[11px] text-faint">{[r.instagram, r.category, r.city, r.followers ? `${fmtNum(r.followers)} abonnés` : null].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="text-muted">{r.brands.join(", ")}</td>
                      <td className="num">{r.collabs}</td>
                      <td className="num">{seeCosts ? fmtMAD(r.cost, { compact: true, suffix: false }) : "•••"}</td>
                      <td className="num">{r.reach !== null ? fmtNum(r.reach) : "—"}</td>
                      <td className="num">{r.cpm !== null ? Math.round(r.cpm) : "—"}</td>
                      <td className="num">{r.engagement !== null ? r.engagement.toFixed(1) + " %" : "—"}</td>
                      <td className="num">{r.measuredCost > 0 ? fmtMAD(r.measuredRevenue, { compact: true, suffix: false }) : "—"}</td>
                      <td className={`num ${r.roas !== null && r.roas >= 3 ? "text-green" : r.roas !== null && r.roas < 1 ? "text-red" : ""}`}>{r.roas !== null ? r.roas.toFixed(2) + "×" : "—"}</td>
                      <td className="num">{r.score === null ? <span className="text-faint">n/c</span> : <Badge tone={r.score >= 70 ? "green" : r.score >= 40 ? "yellow" : "red"}>{r.score}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      <Section title={`Collaborations (${scored.length})`} description="Une ligne par collaboration. Complétez les statistiques après publication pour que le profil soit noté.">
        <Card>
          <div className="overflow-x-auto">
            <table className="tbl text-[12.5px]">
              <thead><tr><th>Date</th><th>Influenceuse</th><th>Marque</th><th>Contenu</th><th className="num">Coût</th><th className="num">Reach</th><th className="num">Eng.</th><th className="num">CA mesuré</th><th className="num">Score</th><th colSpan={2}>Statut</th></tr></thead>
              <tbody>
                {scored.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{fmtDateShort(r.date)}</td>
                    <td className="font-medium"><Link href={`/marketing/influence/${r.influencer_id}`} className="hover:text-accent">{r.influencer}</Link></td>
                    <td><span className="flex items-center gap-1.5">{r.brand_color && <BrandDot color={r.brand_color} />}{r.brand}</span></td>
                    <td className="text-muted">{[r.reels ? `${r.reels} reel(s)` : null, r.stories ? `${r.stories} story(s)` : null, r.posts ? `${r.posts} post(s)` : null].filter(Boolean).join(" · ") || r.content_type || "—"}{r.campaign && <span className="text-faint"> · {r.campaign}</span>}</td>
                    <td className="num">{seeCosts ? fmtMAD(r.cost, { suffix: false }) : "•••"}</td>
                    <td className="num">{r.reach !== null ? fmtNum(r.reach) : "—"}</td>
                    <td className="num">{r.engagement !== null ? r.engagement.toFixed(1) + " %" : "—"}</td>
                    <td className="num">{r.measured ? fmtMAD(r.attributed_revenue ?? 0, { suffix: false }) : <span className="text-faint" title="Aucun code promo ou lien tracké : impossible d'attribuer un CA à cette collaboration.">non mesurable</span>}</td>
                    <td className="num">{r.score === null ? <span className="text-faint">n/c</span> : r.score}</td>
                    <td colSpan={2}>
                      <CollabRowActions row={r} label={`${r.influencer} · ${r.brand} · ${fmtDateShort(r.date)}`} canEdit={canEdit} canDelete={canDelete} statusAction={setCollaborationStatus} deleteAction={deleteCollaboration} {...formProps} />
                    </td>
                  </tr>
                ))}
                {scored.length === 0 && <tr><td colSpan={10} className="text-muted text-center py-4">Aucune collaboration sur cette période.</td></tr>}
              </tbody>
            </table>
          </div>
          {scored.some((r) => r.missing.length > 0) && (
            <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
              {scored.filter((r) => r.missing.length).length} collaboration(s) incomplète(s) : sans reach, sans engagement ou sans code promo, le score ne peut pas être calculé sur tous les axes.
              <Progress value={totals.measuredShare} className="mt-2" tone={totals.measuredShare >= 70 ? "green" : totals.measuredShare >= 40 ? "orange" : "red"} />
              <span className="text-faint">{Math.round(totals.measuredShare)} % des collaborations de la période sont attribuables.</span>
            </div>
          )}
        </Card>
      </Section>

      <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
        <Card className="min-w-0" title="Nouvelle campagne influence">
          <form action={saveCampaign} className="grid gap-2 text-[13px]">
            <input type="hidden" name="channel" value="INFLUENCE" />
            <input type="hidden" name="type" value="INFLUENCE" />
            <label className="block"><span className="label block mb-1">Marque *</span>
              <select name="brandId" defaultValue={brandId ?? ""} className="select h-9" required><option value="">— choisir —</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </label>
            <label className="block"><span className="label block mb-1">Nom *</span><input name="name" className="input h-9" placeholder="Ex : KLORANE — Influenceuses rentrée" required /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="label block mb-1">Début</span><input type="date" name="startDate" className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">Fin</span><input type="date" name="endDate" className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">Budget (MAD)</span><input name="budget" className="input h-9" placeholder="0" /></label>
              <label className="block"><span className="label block mb-1">Statut</span><select name="status" className="select h-9" defaultValue="PLANNED">{Object.entries(CAMPAIGN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
            </div>
            <label className="block"><span className="label block mb-1">Objectif</span><input name="objective" className="input h-9" placeholder="Ex : recruter 300 clientes via 8 influenceuses" /></label>
            <button className="btn-primary" type="submit">Créer la campagne</button>
            <p className="text-[11.5px] text-faint">Canal « Influence » appliqué automatiquement. Une fois créée, elle apparaît dans le menu « Campagne » du formulaire de collaboration, pour y rattacher chaque influenceuse.</p>
          </form>
        </Card>

        {canCreate && (
          <Card className="min-w-0" title="Nouvelle collaboration">
            <CollabForm {...formProps} defaultBrandId={brandId} />
          </Card>
        )}

        <Card className="min-w-0" title={`Répertoire influenceuses (${influencerList.length})`} action={canCreate ? <Link href="/imports?type=INFLUENCERS" className="btn-secondary btn-sm">Importer une liste</Link> : undefined}>
          <InfluencerDirectory influencers={influencerList} action={saveInfluencer} canEdit={canEdit} canCreate={canCreate} returnParams={returnParams} />
        </Card>
      </div>
    </>
  );
}
