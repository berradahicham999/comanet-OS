import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { getRefDate } from "@/lib/ref-date";
import { listBrands } from "@/lib/users";
import { resolvePeriod, PERIOD_OPTIONS, type PeriodParam } from "@/lib/periods";
import { PageHeader, Card, Kpi, Badge, BrandDot, Section, Empty, Tabs } from "@/components/ui";
import { SimpleLine } from "@/components/charts";
import { fmtMAD, fmtNum, fmtPct, fmtDate, fmtDateShort, fmtTime, fmtAgo, delta } from "@/lib/format";
import { adsByDim, kpis, diagnose, brandAverages, verdictMeta, primaryResult, type AdKpis } from "@/lib/ads";
import { accountsFreshness, intradayTotals, liveCampaigns } from "@/lib/meta/live";
import { AD_PLATFORMS, platformLabel, deliveryStatus } from "@/lib/marketing-shared";
import { refreshMetaNow } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Digital Ads" };

const VERDICT_ORDER = ["STOP", "OPTIMIZE", "SCALE", "MAINTAIN", "WATCH"] as const;

export default async function AdsPage(props: { searchParams: Promise<{ brand?: string; period?: string; platform?: string; start?: string; end?: string; dim?: string }> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const { ref } = await getRefDate();
  const period = resolvePeriod((sp.period as PeriodParam) || "last30", ref, { start: sp.start, end: sp.end });
  const brands = (await listBrands()).filter((b) => b.active);
  const brandId = sp.brand && brands.some((b) => b.id === sp.brand) ? sp.brand : null;
  const platform = sp.platform && sp.platform in AD_PLATFORMS ? sp.platform : null;
  const dim: "campaign" | "ad" = sp.dim === "ad" ? "ad" : "campaign";

  const [curRows, refRows, byPlatform, daily, coverage, freshness, intraday, live] = await Promise.all([
    adsByDim(dim, period, { brandId, platform }),
    adsByDim(dim, period.prev, { brandId, platform }),
    adsByDim("platform", period, { brandId }),
    db.execute(sql`
      select date::text as date, coalesce(sum(spend),0)::float8 as spend, coalesce(sum(revenue),0)::float8 as revenue,
             coalesce(sum(purchases),0)::int as purchases, coalesce(sum(impressions),0)::float8 as impressions
      from ad_metrics
      where date >= ${period.start}::date and date < ${period.end}::date and is_partial = false
        ${brandId ? sql`and brand_id = ${brandId}::uuid` : sql``} ${platform ? sql`and platform = ${platform}` : sql``}
      group by 1 order by 1`),
    // Les bornes affichées portent sur les journées closes ; `rows` compte tout, sinon un
    // compte fraîchement connecté (une seule journée, en cours) tomberait sur l'écran vide.
    db.execute(sql`
      select min(date) filter (where not is_partial)::text as first_day,
             max(date) filter (where not is_partial)::text as last_day,
             count(*)::int as rows,
             count(*) filter (where not is_partial)::int as closed_rows,
             count(distinct platform)::int as platforms
      from ad_metrics`),
    accountsFreshness(),
    intradayTotals({ brandId, platform }),
    liveCampaigns({ brandId, platform }),
  ]);

  const cur = curRows.map(kpis);
  const prev = new Map(refRows.map((r) => [r.key, kpis(r)]));
  const avg = brandAverages(cur);
  const cov = coverage.rows[0] as { first_day: string | null; last_day: string | null; rows: number; closed_rows: number; platforms: number };
  // Au moins un compte synchronisé par API : l'écran ne parle plus d'exports de fichiers.
  const connected = freshness.length > 0;
  const lastSync = freshness.reduce<string | null>((a, f) => (f.lastSyncAt && (!a || f.lastSyncAt > a) ? f.lastSyncAt : a), null);
  const inError = freshness.filter((f) => f.syncStatus === "ERROR");

  const totals = cur.reduce((a, r) => ({
    spend: a.spend + r.spend, revenue: a.revenue + r.revenue, purchases: a.purchases + r.purchases,
    impressions: a.impressions + r.impressions, clicks: a.clicks + (r.linkClicks || r.clicks), leads: a.leads + r.leads, reach: a.reach + r.reach,
  }), { spend: 0, revenue: 0, purchases: 0, impressions: 0, clicks: 0, leads: 0, reach: 0 });
  const prevTotals = refRows.reduce((a, r) => ({ spend: a.spend + r.spend, revenue: a.revenue + r.revenue, purchases: a.purchases + r.purchases }), { spend: 0, revenue: 0, purchases: 0 });

  const analyzed = cur
    .map((r) => ({ row: r, diag: diagnose(r, prev.get(r.key) ?? null, avg) }))
    .sort((a, b) => VERDICT_ORDER.indexOf(a.diag.verdict) - VERDICT_ORDER.indexOf(b.diag.verdict) || b.row.spend - a.row.spend);

  const chart = (daily.rows as Record<string, number | string>[]).map((r) => ({ date: fmtDateShort(String(r.date)), spend: Number(r.spend), revenue: Number(r.revenue) }));

  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    if (brandId) p.set("brand", brandId);
    if (platform) p.set("platform", platform);
    if (period.key !== "last30") p.set("period", period.key);
    if (dim !== "campaign") p.set("dim", dim);
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    const s = p.toString();
    return s ? `/marketing/ads?${s}` : "/marketing/ads";
  };

  if (cov.rows === 0) {
    return (
      <>
        <PageHeader eyebrow="Marketing Command Center" title="Digital Ads" subtitle="Dépenses et performance des campagnes Meta, en continu depuis la régie." actions={<><Link href="/marketing/ads/comptes" className="btn-primary btn-sm">Connecter Meta</Link><Link href="/imports?type=ADS" className="btn-secondary btn-sm">Importer un export</Link></>} />
        <Card>
          <Empty
            title="Aucune donnée publicitaire"
            hint={
              <span className="block max-w-2xl">
                <b>Le plus simple : connecter le compte Meta.</b> La dépense et les conversions remontent alors toutes les heures, sans export à refaire. Deux prérequis, tous les deux sur l&apos;écran <i>Comptes publicitaires</i> : un jeton de lecture Meta, et le taux de conversion vers le dirham pour les comptes facturés en euros ou en dollars.
                <br /><br />
                <b>Sinon, par fichier.</b> Exportez depuis votre régie un tableau <b>par jour</b> (une ligne = un jour × une campagne, ou × une publicité si vous voulez le détail créative) avec au minimum : date, nom de campagne, montant dépensé — et si possible impressions, couverture, clics sur le lien, achats et valeur de conversion. Sur Meta : <i>Gestionnaire de publicités → Rapports → Ventilation par jour → Exporter</i>.
              </span>
            }
            action={<Link href="/marketing/ads/comptes" className="btn-primary btn-sm">Connecter Meta</Link>}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Marketing Command Center"
        title="Digital Ads"
        subtitle={
          connected
            ? `${period.label} · synchronisation Meta ${fmtAgo(lastSync)} · ${fmtNum(cov.closed_rows)} lignes closes jusqu'au ${fmtDate(cov.last_day)}`
            : `${period.label} · ${fmtNum(cov.rows)} lignes importées du ${fmtDate(cov.first_day)} au ${fmtDate(cov.last_day)}`
        }
        actions={<><Link href="/marketing" className="btn-secondary btn-sm">Vue d&apos;ensemble</Link><Link href="/marketing/ads/comptes" className="btn-secondary btn-sm">Comptes</Link><Link href="/imports?type=ADS" className="btn-primary btn-sm">Importer un export</Link></>}
      >
        <form className="flex flex-wrap items-end gap-2 mb-3">
          {brandId && <input type="hidden" name="brand" value={brandId} />}
          {dim !== "campaign" && <input type="hidden" name="dim" value={dim} />}
          <label className="block"><span className="label block mb-1">Période</span><select name="period" defaultValue={period.key} className="select h-9 w-44">{PERIOD_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
          <label className="block"><span className="label block mb-1">Régie</span><select name="platform" defaultValue={platform ?? ""} className="select h-9 w-40"><option value="">Toutes</option>{Object.entries(AD_PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {period.key === "custom" && (<><label className="block"><span className="label block mb-1">Du</span><input type="date" name="start" defaultValue={period.start} className="input h-9" /></label><label className="block"><span className="label block mb-1">Au</span><input type="date" name="end" defaultValue={sp.end ?? ""} className="input h-9" /></label></>)}
          <button className="btn-secondary btn-sm h-9" type="submit">Appliquer</button>
        </form>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
          <Kpi label="Dépense" value={fmtMAD(totals.spend, { compact: true })} delta={delta(totals.spend, prevTotals.spend)} deltaLabel={period.prev.label} />
          <Kpi label="CA remonté par la régie" value={fmtMAD(totals.revenue, { compact: true })} delta={delta(totals.revenue, prevTotals.revenue)} deltaLabel={period.prev.label} sub="valeur de conversion déclarée" />
          <Kpi label="ROAS" value={totals.spend > 0 ? (totals.revenue / totals.spend).toFixed(2) + "×" : "—"} tone={totals.spend > 0 && totals.revenue / totals.spend < 1 ? "red" : totals.spend > 0 && totals.revenue / totals.spend >= 3 ? "green" : undefined} />
          <Kpi label="Achats" value={fmtNum(totals.purchases)} delta={delta(totals.purchases, prevTotals.purchases)} deltaLabel={period.prev.label} sub={totals.purchases ? `CPA ${fmtMAD(totals.spend / totals.purchases)}` : "aucun achat suivi"} />
          <Kpi label="CTR" value={totals.impressions > 0 ? fmtPct((totals.clicks / totals.impressions) * 100, 2) : "—"} sub={`${fmtNum(totals.clicks)} clics sur ${fmtNum(totals.impressions)} impressions`} />
          <Kpi label="CPM" value={totals.impressions > 0 ? fmtMAD((totals.spend / totals.impressions) * 1000) : "—"} sub={totals.reach > 0 ? `fréquence ${(totals.impressions / totals.reach).toFixed(1)}` : "couverture non fournie"} />
        </div>
        <Tabs current={brandId ? `/marketing/ads?brand=${brandId}` : "/marketing/ads"} tabs={[{ href: "/marketing/ads", label: "Toutes les marques" }, ...brands.map((b) => ({ href: `/marketing/ads?brand=${b.id}`, label: b.name }))]} />
      </PageHeader>

      {connected && (
        <Section
          title="Journée en cours"
          description="Chiffres relevés dans la régie, non définitifs : la dépense est déjà enregistrée, les conversions remontent plus tard. Ils n'entrent dans aucune moyenne ni comparaison de cette page."
          action={
            <form action={refreshMetaNow}>
              <button className="btn-secondary btn-sm" type="submit">Actualiser maintenant</button>
            </form>
          }
        >
          <Card>
            {intraday ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <Kpi label="Dépense depuis ce matin" value={fmtMAD(intraday.spend)} sub={`relevée à ${fmtTime(intraday.syncedAt)}`} />
                  <Kpi label="Impressions" value={fmtNum(intraday.impressions)} />
                  <Kpi label="Clics" value={fmtNum(intraday.clicks)} sub={intraday.impressions > 0 ? `CTR ${fmtPct((intraday.clicks / intraday.impressions) * 100, 2)}` : undefined} />
                  <Kpi label="Achats remontés" value={fmtNum(intraday.purchases)} sub="peut encore augmenter" />
                  <Kpi label="CA remonté par la régie" value={fmtMAD(intraday.revenue)} sub="valeur de conversion déclarée" />
                </div>
                <p className="text-[11.5px] text-faint mt-2">
                  Ni CPA ni ROAS ne sont calculés sur la journée en cours : la dépense est déjà comptée alors que les conversions arrivent plusieurs heures après, le rapport des deux serait faux. Journée du {intraday.dates.map((d) => fmtDate(d)).join(", ")}, découpée dans le fuseau de chaque compte publicitaire.
                </p>
              </>
            ) : (
              <Empty
                title="Aucune diffusion enregistrée aujourd'hui"
                hint="Soit rien ne tourne en ce moment, soit la première synchronisation de la journée n'a pas encore eu lieu. Le tableau d'état ci-dessous dit lequel des deux."
              />
            )}

            <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11.5px]">
              <span className="text-muted">Dernier relevé par compte :</span>
              {freshness.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1.5">
                  <Badge tone={f.syncStatus === "ERROR" ? "red" : f.syncing ? "blue" : "green"} dot>{f.name}</Badge>
                  <span className="text-faint">{f.syncing ? "synchronisation en cours" : fmtAgo(f.lastSyncAt)}</span>
                </span>
              ))}
            </div>

            {inError.length > 0 && (
              <div className="mt-3 rounded-xl border border-red/40 bg-red-soft/40 px-3 py-2 text-[12.5px] space-y-1">
                {inError.map((f) => (
                  <div key={f.id}><b>{f.name}</b> — {f.lastError}</div>
                ))}
              </div>
            )}
          </Card>
        </Section>
      )}

      {live.length > 0 && (
        <Section
          title="État de diffusion"
          description="Relevé auprès de Meta à chaque synchronisation. Une campagne active qui n'a rien dépensé depuis ce matin est visible ici, alors qu'elle est absente de tous les chiffres."
        >
          <Card className="min-w-0">
            <div className="overflow-x-auto">
              <table className="tbl text-[12.5px]">
                <thead>
                  <tr>
                    <th>Campagne</th><th>Compte</th><th>État</th>
                    <th className="num">Budget / jour</th><th className="num">Dépensé aujourd&apos;hui</th>
                    <th className="num">Rythme</th><th className="num">Achats</th>
                  </tr>
                </thead>
                <tbody>
                  {live.map((c) => {
                    const st = deliveryStatus(c.effectiveStatus, c.status);
                    // Un rythme au-delà de 100 % du budget quotidien n'est pas une anomalie :
                    // Meta s'autorise à dépasser le budget d'un jour et compense sur la semaine.
                    const pace = c.budgetPace;
                    return (
                      <tr key={c.externalCampaignId}>
                        <td className="max-w-[280px] truncate">{c.name}</td>
                        <td className="text-muted">{c.accountName ?? "—"}</td>
                        <td><Badge tone={st.tone}>{st.label}</Badge></td>
                        <td className="num">{c.dailyBudget !== null ? fmtMAD(c.dailyBudget, { suffix: false }) : <span className="text-faint" title="Budget porté par les ensembles de publicités, pas par la campagne">—</span>}</td>
                        <td className="num font-medium">{c.spendToday > 0 ? fmtMAD(c.spendToday, { suffix: false }) : <span className="text-faint">—</span>}</td>
                        <td className={`num ${pace !== null && pace >= 1 ? "text-orange" : ""}`}>{pace !== null ? fmtPct(pace * 100) : <span className="text-faint">non mesurable</span>}</td>
                        <td className="num">{c.purchasesToday || <span className="text-faint">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-faint mt-2">
              Le rythme est la part du budget quotidien déjà consommée à l&apos;heure du relevé. Il décrit ce qui s&apos;est passé, il n&apos;annonce pas la dépense de fin de journée. Sans budget au niveau de la campagne, il n&apos;est pas mesurable.
            </p>
          </Card>
        </Section>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 min-w-0" title="Dépense et CA remonté, jour par jour (journées closes)">
          {chart.length > 1 ? <SimpleLine data={chart} xKey="date" yKey="spend" height={200} /> : <Empty title="Un seul jour de données sur la période" hint="Élargissez la période pour voir la tendance." />}
          <p className="text-[11.5px] text-faint mt-2">Le CA affiché est celui déclaré par la régie (valeur de conversion). Il ne correspond pas au CA facturé dans Sage et peut compter plusieurs fois un même achat selon la fenêtre d&apos;attribution de la plateforme.</p>
        </Card>
        <Card className="min-w-0" title="Par régie">
          {byPlatform.length === 0 ? <Empty title="Aucune dépense" /> : (
            <table className="tbl text-[12.5px] w-full">
              <thead><tr><th>Régie</th><th className="num">Dépense</th><th className="num">Achats</th><th className="num">ROAS</th></tr></thead>
              <tbody>{byPlatform.map(kpis).map((p) => (
                <tr key={p.key}>
                  <td><Link href={qs({ platform: p.platform })} className="hover:underline">{platformLabel(p.platform)}</Link></td>
                  <td className="num font-medium">{fmtMAD(p.spend, { compact: true, suffix: false })}</td>
                  <td className="num">{fmtNum(p.purchases)}</td>
                  <td className={`num ${p.roas !== null && p.roas >= 3 ? "text-green" : p.roas !== null && p.roas < 1 ? "text-red" : ""}`}>{p.roas !== null ? p.roas.toFixed(2) + "×" : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {platform && <Link href={qs({ platform: "" })} className="text-[12px] text-accent mt-2 inline-block">Retirer le filtre régie</Link>}
        </Card>
      </div>

      <Section
        title={dim === "campaign" ? "Diagnostic par campagne publicitaire" : "Diagnostic par publicité"}
        description={`Chaque ligne est comparée à elle-même sur ${period.prev.label} et à la moyenne du périmètre. Le verdict porte sur ce qu'il faut faire, le diagnostic sur le maillon qui se dégrade.`}
        action={<div className="flex gap-1.5"><Link href={qs({ dim: "" })} className={`px-2.5 py-1 rounded-lg text-[12px] border ${dim === "campaign" ? "border-accent text-accent bg-accent-soft/40" : "border-line text-muted"}`}>Par campagne</Link><Link href={qs({ dim: "ad" })} className={`px-2.5 py-1 rounded-lg text-[12px] border ${dim === "ad" ? "border-accent text-accent bg-accent-soft/40" : "border-line text-muted"}`}>Par créative</Link></div>}
      >
        {analyzed.length === 0 ? (
          <Card><Empty title="Aucune dépense sur la période" hint="Changez de période ou importez un export plus récent." /></Card>
        ) : (
          <div className="space-y-3">
            {analyzed.map(({ row, diag }) => {
              const vm = verdictMeta(diag.verdict);
              return (
                <Card key={row.key} className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.brandColor && <BrandDot color={row.brandColor} />}
                    <span className="font-semibold text-[14.5px]">{row.campaignName}</span>
                    <Badge tone="gray">{platformLabel(row.platform)}</Badge>
                    {row.brandName && <span className="text-[12px] text-muted">{row.brandName}</span>}
                    <Badge tone={vm.tone} className="ml-auto">{vm.label}</Badge>
                    {row.campaignId && <Link href={`/marketing/campagnes/${row.campaignId}`} className="text-[12px] text-accent">Campagne 360 →</Link>}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[13px]">
                    <span className="font-medium">{diag.headline}</span>
                    {row.objective && <Badge tone="blue" className="text-[10.5px]">objectif : {row.objective.replace(/^OUTCOME_/, "").toLowerCase()}</Badge>}
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[12px]">
                    {(() => {
                      const res = primaryResult(row.objective, row);
                      return (
                        <div className="rounded-lg bg-accent-soft/40 px-2 py-1.5 min-w-0 border border-accent/20">
                          <div className="text-accent text-[11px]">Résultat — {res.label}</div>
                          <div className="font-semibold">{res.formatted}</div>
                          {res.sub && <div className="text-[11px] text-faint">{res.sub}</div>}
                        </div>
                      );
                    })()}
                    {diag.signals.map((s) => (
                      <div key={s.label} className="rounded-lg bg-surface-2 px-2 py-1.5 min-w-0">
                        <div className="text-muted text-[11px]">{s.label}</div>
                        <div className="font-semibold">{s.value}</div>
                        {s.delta !== null && <div className={`text-[11px] ${s.good === null ? "text-faint" : s.good ? "text-green" : "text-red"}`}>{s.delta > 0 ? "+" : ""}{Math.round(s.delta)} %</div>}
                      </div>
                    ))}
                  </div>
                  <p className="mt-2.5 text-[12.5px] text-ink-2">{diag.diagnostic}</p>
                  {diag.actions.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[12.5px]">
                      {diag.actions.map((a, i) => <li key={i} className="flex gap-2"><span className="text-accent">→</span><span>{a}</span></li>)}
                    </ul>
                  )}
                  <div className="mt-2 text-[11.5px] text-faint">{row.days} jour(s) de diffusion · {fmtNum(row.impressions)} impressions · {fmtNum(row.linkClicks || row.clicks)} clics · {fmtNum(row.purchases)} achat(s){row.leads ? ` · ${fmtNum(row.leads)} lead(s)` : ""}</div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Tableau complet" description="Toutes les lignes de la période, triées par dépense.">
        <Card className="min-w-0">
          <div className="overflow-x-auto">
            <table className="tbl text-[12.5px]">
              <thead><tr><th>{dim === "campaign" ? "Campagne" : "Publicité"}</th><th>Régie</th><th>Marque</th><th className="num">Dépense</th><th>Résultat (objectif)</th><th className="num">Impr.</th><th className="num">CPM</th><th className="num">CTR</th><th className="num">CPC</th><th className="num">Achats</th><th className="num">CPA</th><th className="num">CA régie</th><th className="num">ROAS</th></tr></thead>
              <tbody>
                {cur.map((r: AdKpis) => {
                  const res = primaryResult(r.objective, r);
                  return (
                  <tr key={r.key}>
                    <td className="max-w-[280px] truncate">{r.campaignId ? <Link href={`/marketing/campagnes/${r.campaignId}`} className="hover:underline">{r.campaignName}</Link> : r.campaignName}</td>
                    <td className="text-muted">{platformLabel(r.platform)}</td>
                    <td className="text-muted">{r.brandName ?? <span className="text-faint">non identifiée</span>}</td>
                    <td className="num font-medium">{fmtMAD(r.spend, { suffix: false })}</td>
                    <td className="whitespace-nowrap"><span className="font-medium">{res.formatted}</span> <span className="text-faint text-[11px]">{res.label}</span></td>
                    <td className="num">{fmtNum(r.impressions)}</td>
                    <td className="num">{r.cpm !== null ? Math.round(r.cpm) : "—"}</td>
                    <td className="num">{r.ctr !== null ? r.ctr.toFixed(2) + " %" : "—"}</td>
                    <td className="num">{r.cpc !== null ? r.cpc.toFixed(1) : "—"}</td>
                    <td className="num">{fmtNum(r.purchases)}</td>
                    <td className="num">{r.cpa !== null ? fmtMAD(r.cpa, { suffix: false }) : "—"}</td>
                    <td className="num">{r.revenue ? fmtMAD(r.revenue, { suffix: false }) : "—"}</td>
                    <td className={`num font-medium ${r.roas !== null && r.roas >= 3 ? "text-green" : r.roas !== null && r.roas < 1 ? "text-red" : ""}`}>{r.roas !== null ? r.roas.toFixed(2) + "×" : "—"}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>
    </>
  );
}
