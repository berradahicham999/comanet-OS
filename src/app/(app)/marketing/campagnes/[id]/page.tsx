import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { listBrands, listUsers } from "@/lib/users";
import { PageHeader, Card, Badge, BrandDot, Progress, Section, Empty, Facts, Kpi } from "@/components/ui";
import { fmtMAD, fmtNum, fmtPct, fmtDate, fmtDateShort, delta } from "@/lib/format";
import { CAMPAIGN_TYPES, CAMPAIGN_STATUS, campaignTypeLabel } from "@/lib/marketing-shared";
import { campaignSales, campaignStock } from "@/lib/marketing";
import { kpis, type AdRow } from "@/lib/ads";
import { saveCampaign, deleteCampaign, setCampaignStatus, saveExpense, deleteExpense, linkAdCampaigns, unlinkAdCampaign } from "../../actions";
import { linkedAdCampaigns, linkCandidates } from "@/lib/meta/links";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const r = await db.execute(sql`select name from campaigns where id = ${id}::uuid`);
  const name = (r.rows[0] as { name: string } | undefined)?.name;
  return { title: name ? `Campagne — ${name}` : "Campagne" };
}

type Campaign = {
  id: string; name: string; type: string; status: string; channel: string;
  start_date: string | null; end_date: string | null; budget: number | null;
  brand_id: string; brand: string; brand_color: string;
  objective: string | null; audience: string | null; message: string | null; offer: string | null;
  kpi_target: string | null; kpi_actual: string | null; responsible_id: string | null; notes: string | null;
};

export default async function CampagneDetailPage(props: { params: Promise<{ id: string }> }) {
  await requireAccess("marketing");
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const cRes = await db.execute(sql`
    select c.id, c.name, c.type, c.status::text as status, c.channel::text as channel,
           c.start_date::text as start_date, c.end_date::text as end_date, c.budget::float8 as budget,
           c.brand_id, b.name as brand, b.color as brand_color,
           c.objective, c.audience, c.message, c.offer, c.kpi_target, c.kpi_actual, c.responsible_id, c.notes
    from campaigns c join brands b on b.id = c.brand_id where c.id = ${id}::uuid`);
  const c = cRes.rows[0] as Campaign | undefined;
  if (!c) notFound();

  const [expenseRes, adRes, adByAdRes, collabRes, contentRes, productRes, brandProducts, brands, users, sales, stock] = await Promise.all([
    db.execute(sql`select id, label, category::text as category, status::text as status, amount::float8 as amount, date::text as date, attributed_revenue::float8 as revenue, conversions from marketing_expenses where campaign_id = ${id}::uuid order by date desc`),
    db.execute(sql`
      select coalesce(sum(spend),0)::float8 as spend, coalesce(sum(impressions),0)::float8 as impressions, coalesce(sum(reach),0)::float8 as reach,
             coalesce(sum(clicks),0)::float8 as clicks, coalesce(sum(link_clicks),0)::float8 as link_clicks,
             coalesce(sum(landing_page_views),0)::float8 as landing_page_views, coalesce(sum(leads),0)::float8 as leads,
             coalesce(sum(purchases),0)::float8 as purchases, coalesce(sum(revenue),0)::float8 as revenue,
             min(date)::text as first_day, max(date)::text as last_day, count(*)::int as rows
      from ad_metrics where campaign_id = ${id}::uuid`),
    db.execute(sql`
      select coalesce(ad_name, campaign_name) as label, platform,
             coalesce(sum(spend),0)::float8 as spend, coalesce(sum(impressions),0)::float8 as impressions, coalesce(sum(reach),0)::float8 as reach,
             coalesce(sum(clicks),0)::float8 as clicks, coalesce(sum(link_clicks),0)::float8 as link_clicks,
             coalesce(sum(landing_page_views),0)::float8 as landing_page_views, coalesce(sum(leads),0)::float8 as leads,
             coalesce(sum(purchases),0)::float8 as purchases, coalesce(sum(revenue),0)::float8 as revenue
      from ad_metrics where campaign_id = ${id}::uuid group by 1, 2 order by 3 desc limit 12`),
    db.execute(sql`select co.id, co.date::text as date, i.name as influencer, co.status, (co.fee + co.product_value)::float8 as cost, co.reach, co.attributed_revenue::float8 as revenue, co.promo_code from collaborations co join influencers i on i.id = co.influencer_id where co.campaign_id = ${id}::uuid order by co.date desc`),
    db.execute(sql`select id, date::text as date, title, format, platform, status::text as status from content_items where campaign_id = ${id}::uuid order by date`),
    db.execute(sql`select p.id, p.name from campaign_products cp join products p on p.id = cp.product_id where cp.campaign_id = ${id}::uuid order by p.name`),
    db.execute(sql`select id, name from products where brand_id = ${c.brand_id}::uuid and active order by name limit 400`),
    listBrands(),
    listUsers(),
    campaignSales(id),
    campaignStock(id),
  ]);

  const [links, candidates] = await Promise.all([linkedAdCampaigns(id), linkCandidates(c.brand_id)]);

  type Expense = { id: string; label: string; category: string; status: string; amount: number; date: string; revenue: number | null; conversions: number | null };
  const expenses = expenseRes.rows as Expense[];
  const ad = adRes.rows[0] as Record<string, number | string | null>;
  const adRow: AdRow = {
    key: c.id, platform: c.channel, campaignName: c.name, campaignId: c.id,
    brandId: c.brand_id, brandName: c.brand, brandColor: c.brand_color,
    spend: Number(ad.spend), impressions: Number(ad.impressions), reach: Number(ad.reach),
    clicks: Number(ad.clicks), linkClicks: Number(ad.link_clicks), landingPageViews: Number(ad.landing_page_views),
    leads: Number(ad.leads), purchases: Number(ad.purchases), messagingStarted: 0, revenue: Number(ad.revenue), days: Number(ad.rows),
    objective: null,
  };
  const adK = kpis(adRow);
  const hasAds = Number(ad.rows) > 0;

  const collabs = collabRes.rows as { id: string; date: string; influencer: string; status: string; cost: number; reach: number | null; revenue: number | null; promo_code: string | null }[];
  const contents = contentRes.rows as { id: string; date: string; title: string; format: string | null; platform: string | null; status: string }[];
  const products = productRes.rows as { id: string; name: string }[];
  const allProducts = brandProducts.rows as { id: string; name: string }[];
  const selected = new Set(products.map((p) => p.id));

  const expenseSpend = expenses.filter((e) => e.status !== "PLANNED").reduce((a, e) => a + e.amount, 0);
  const collabCost = collabs.reduce((a, x) => a + x.cost, 0);
  const totalSpend = expenseSpend + adK.spend + collabCost;
  const measuredRevenue = adK.revenue + collabs.reduce((a, x) => a + (x.revenue ?? 0), 0) + expenses.reduce((a, e) => a + (e.revenue ?? 0), 0);
  const measuredRoas = totalSpend > 0 && measuredRevenue > 0 ? measuredRevenue / totalSpend : null;
  const budgetPct = c.budget ? (totalSpend / c.budget) * 100 : null;

  const meta = CAMPAIGN_STATUS[c.status] ?? { label: c.status, tone: "gray" as const };
  const tight = stock.filter((s) => s.coverage !== null && s.coverage < 1.5);

  const byAd = (adByAdRes.rows as Record<string, number | string>[]).map((r) => kpis({
    key: String(r.label) + String(r.platform), platform: String(r.platform), campaignName: String(r.label),
    campaignId: c.id, brandId: c.brand_id, brandName: c.brand, brandColor: c.brand_color,
    spend: Number(r.spend), impressions: Number(r.impressions), reach: Number(r.reach),
    clicks: Number(r.clicks), linkClicks: Number(r.link_clicks), landingPageViews: Number(r.landing_page_views),
    leads: Number(r.leads), purchases: Number(r.purchases), messagingStarted: 0, revenue: Number(r.revenue), days: 0,
    objective: null,
  }));

  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-1.5"><BrandDot color={c.brand_color} /><Link href={`/marketing/campagnes?brand=${c.brand_id}`} className="hover:underline">{c.brand}</Link> · Campagne 360</span>}
        title={c.name}
        subtitle={`${campaignTypeLabel(c.type)} · ${c.start_date ? `${fmtDate(c.start_date)}${c.end_date ? ` → ${fmtDate(c.end_date)}` : ""}` : "dates non renseignées"}${c.objective ? ` · ${c.objective}` : ""}`}
        actions={
          <>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <form action={setCampaignStatus} className="flex items-center gap-1">
              <input type="hidden" name="id" value={c.id} />
              <select name="status" defaultValue={c.status} className="select h-8 text-[12px] w-36">{Object.entries(CAMPAIGN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              <button className="btn-secondary btn-sm" type="submit">Changer</button>
            </form>
            <Link href="/marketing/campagnes" className="btn-ghost btn-sm">Toutes</Link>
          </>
        }
      >
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Kpi label="Budget" value={c.budget ? fmtMAD(c.budget, { compact: true }) : "—"} sub={budgetPct !== null ? `${Math.round(budgetPct)} % consommé` : "budget non défini"} tone={budgetPct !== null && budgetPct > 100 ? "red" : undefined} />
          <Kpi label="Dépense totale" value={fmtMAD(totalSpend, { compact: true })} sub={`régie ${fmtMAD(adK.spend, { compact: true, suffix: false })} · influence ${fmtMAD(collabCost, { compact: true, suffix: false })} · autres ${fmtMAD(expenseSpend, { compact: true, suffix: false })}`} />
          <Kpi label="CA attribué mesuré" value={measuredRevenue ? fmtMAD(measuredRevenue, { compact: true }) : "—"} sub="uniquement ce qui est traçable" />
          <Kpi label="ROAS mesuré" value={measuredRoas === null ? "—" : measuredRoas.toFixed(2) + "×"} tone={measuredRoas !== null && measuredRoas < 1 ? "red" : measuredRoas !== null && measuredRoas >= 3 ? "green" : undefined} sub={measuredRevenue ? "CA mesuré / dépense totale" : "aucune attribution disponible"} />
          <Kpi label="Rattachements" value={`${products.length} / ${contents.length} / ${collabs.length}`} sub="produits · contenus · collaborations" />
        </div>
        {budgetPct !== null && <Progress value={budgetPct} tone={budgetPct > 100 ? "red" : budgetPct > 85 ? "orange" : "accent"} className="mt-3" />}
      </PageHeader>

      {/* ---------------------------- Ventes autour de la campagne --------------------------- */}
      <Section title="Ventes facturées autour de la campagne" description={products.length ? `Périmètre : les ${products.length} produit(s) rattaché(s) à la campagne.` : `Aucun produit rattaché — périmètre : toute la marque ${c.brand}.`}>
        {!sales ? (
          <Card><Empty title="Dates de campagne manquantes" hint="Renseignez au moins une date de début pour comparer les ventes avant / pendant / après." /></Card>
        ) : (
          <Card>
            <div className="grid sm:grid-cols-3 gap-3">
              {([
                { label: "Avant", value: sales.before, days: sales.beforeDays, elapsed: sales.beforeDays },
                { label: "Pendant", value: sales.during, days: sales.duringDays, elapsed: sales.duringElapsed },
                { label: "Après", value: sales.after, days: sales.afterDays, elapsed: sales.afterElapsed },
              ] as const).map((w) => {
                // Une fenêtre encore en cours n'est pas comparable à une fenêtre complète :
                // on annonce l'avancement au lieu d'afficher un écart trompeur.
                const partial = w.elapsed < w.days;
                const d = sales.before > 0 && !partial ? delta(w.value, sales.before) : null;
                return (
                  <div key={w.label} className="rounded-xl border border-line p-3">
                    <div className="label">{w.label} <span className="text-faint">({w.days} j)</span></div>
                    <div className="kpi mt-1.5">{fmtMAD(w.value, { compact: true })}</div>
                    {w.label !== "Avant" && (
                      partial
                        ? <div className="text-[12px] mt-1 text-muted">{w.elapsed === 0 ? "fenêtre à venir — pas encore comparable" : `${w.elapsed} j sur ${w.days} écoulés — comparaison prématurée`}</div>
                        : d !== null
                          ? <div className="text-[12px] mt-1">vs avant : <b className={w.value >= sales.before ? "text-green" : "text-red"}>{fmtPct(d, 0, true)}</b></div>
                          : <div className="text-[12px] mt-1 text-faint">pas de référence avant campagne</div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">
              <b>Corrélation observée</b>, pas une causalité : ces montants sont le sell-in facturé aux pharmacies sur trois fenêtres de même durée. Ils peuvent bouger pour d&apos;autres raisons (référencement, remises, saisonnalité, réassort). Seule la ligne « CA attribué mesuré » ci-dessus provient d&apos;une attribution réelle.
            </p>
          </Card>
        )}
      </Section>

      {/* ------------------------------------ Publicité ------------------------------------- */}
      <Section title="Publicité (régie)" description={hasAds ? `${fmtNum(Number(ad.rows))} lignes importées, du ${fmtDate(String(ad.first_day))} au ${fmtDate(String(ad.last_day))}.` : "Aucune donnée de régie rattachée à cette campagne."} action={<Link href="/marketing/ads" className="btn-secondary btn-sm">Digital Ads</Link>}>
        {!hasAds ? (
          <Card><Empty title="Pas de données publicitaires" hint={<>Rattachez ci-dessous les campagnes de régie qui portent cette opération, ou importez un export depuis <Link href="/imports?type=ADS" className="text-accent">Imports</Link>. Si aucun compte n&apos;est encore connecté, commencez par <Link href="/marketing/ads/comptes" className="text-accent">Comptes publicitaires</Link>.</>} /></Card>
        ) : (
          <Card>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-[12.5px]">
              {([["Dépense", fmtMAD(adK.spend, { compact: true })], ["Impressions", fmtNum(adK.impressions)], ["Couverture", adK.reach ? fmtNum(adK.reach) : "—"], ["CPM", adK.cpm !== null ? fmtMAD(adK.cpm) : "—"], ["CTR", adK.ctr !== null ? fmtPct(adK.ctr, 2) : "—"], ["CPC", adK.cpc !== null ? fmtMAD(adK.cpc) : "—"], ["CPA", adK.cpa !== null ? fmtMAD(adK.cpa) : "—"], ["ROAS", adK.roas !== null ? adK.roas.toFixed(2) + "×" : "—"]] as const).map(([l, v]) => (
                <div key={l}><div className="text-muted">{l}</div><div className="font-semibold text-[15px]">{v}</div></div>
              ))}
            </div>
            {byAd.length > 1 && (
              <div className="overflow-x-auto mt-4">
                <table className="tbl text-[12.5px]">
                  <thead><tr><th>Publicité</th><th>Régie</th><th className="num">Dépense</th><th className="num">CPM</th><th className="num">CTR</th><th className="num">CPC</th><th className="num">Achats</th><th className="num">CPA</th><th className="num">ROAS</th></tr></thead>
                  <tbody>
                    {byAd.map((a) => (
                      <tr key={a.key}>
                        <td className="max-w-[260px] truncate">{a.campaignName}</td>
                        <td className="text-muted">{a.platform}</td>
                        <td className="num font-medium">{fmtMAD(a.spend, { suffix: false })}</td>
                        <td className="num">{a.cpm !== null ? Math.round(a.cpm) : "—"}</td>
                        <td className="num">{a.ctr !== null ? a.ctr.toFixed(2) + " %" : "—"}</td>
                        <td className="num">{a.cpc !== null ? a.cpc.toFixed(1) : "—"}</td>
                        <td className="num">{fmtNum(a.purchases)}</td>
                        <td className="num">{a.cpa !== null ? fmtMAD(a.cpa, { suffix: false }) : "—"}</td>
                        <td className={`num font-medium ${a.roas !== null && a.roas >= 3 ? "text-green" : a.roas !== null && a.roas < 1 ? "text-red" : ""}`}>{a.roas !== null ? a.roas.toFixed(2) + "×" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </Section>

      {/* ------------------------- Rattachement aux campagnes de régie ---------------------- */}
      <Section
        title="Campagnes de régie rattachées"
        description="Le rattachement porte sur l'identifiant de la campagne dans la régie : renommer la campagne côté Meta ne le casse pas. Une campagne de régie n'appartient qu'à une seule campagne COMANET."
        action={<Link href="/marketing/ads/comptes" className="btn-ghost btn-sm">Comptes publicitaires</Link>}
      >
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title={`Rattachées (${links.length})`}>
            {links.length === 0 ? (
              <Empty title="Aucune campagne de régie rattachée" hint="Cochez à droite les campagnes Meta qui portent cette opération. Les chiffres déjà en base leur seront réappliqués immédiatement." />
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl text-[12.5px]">
                  <thead><tr><th>Campagne de régie</th><th>Compte</th><th className="num">Dépense</th><th className="num">Achats</th><th>Période</th><th /></tr></thead>
                  <tbody>
                    {links.map((l) => (
                      <tr key={l.linkId}>
                        <td className="max-w-[240px]">
                          <div className="truncate font-medium">{l.name}</div>
                          <div className="text-[11px] text-faint">{l.externalCampaignId ? `ID ${l.externalCampaignId}` : "rattachée par nom — sensible au renommage"}</div>
                        </td>
                        <td className="text-muted">{l.accountName ?? "—"}</td>
                        <td className="num font-medium">{l.rows ? fmtMAD(l.spend, { suffix: false }) : "—"}</td>
                        <td className="num">{l.rows ? fmtNum(l.purchases) : "—"}</td>
                        <td className="text-muted text-[11.5px]">{l.firstDay ? `${fmtDateShort(l.firstDay)} → ${fmtDateShort(l.lastDay!)}` : "aucune donnée"}</td>
                        <td className="num">
                          <form action={unlinkAdCampaign}>
                            <input type="hidden" name="linkId" value={l.linkId} />
                            <input type="hidden" name="campaignId" value={c.id} />
                            <button className="btn-ghost btn-sm text-red" type="submit">Détacher</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="À rattacher">
            {candidates.length === 0 ? (
              <Empty
                title="Aucune campagne de régie disponible"
                hint={<>Toutes les campagnes connues sont déjà rattachées, ou aucune donnée publicitaire n&apos;est encore en base. Connectez un compte depuis <Link href="/marketing/ads/comptes" className="text-accent">Comptes publicitaires</Link>.</>}
              />
            ) : (
              <form action={linkAdCampaigns} className="space-y-2">
                <input type="hidden" name="campaignId" value={c.id} />
                <p className="text-[11.5px] text-faint">
                  Les campagnes dont la marque correspond à {c.brand} sont proposées en premier. Les publications boostées (« Post: … ») n&apos;ont pas de marque dans leur nom : à rattacher à la main.
                </p>
                <div className="max-h-[420px] overflow-y-auto divide-y divide-line rounded-xl border border-line">
                  {candidates.map((k) => (
                    <label key={`${k.platform}|${k.externalCampaignId ?? k.name}`} className="flex items-start gap-2 px-3 py-2 hover:bg-accent-soft/20 cursor-pointer">
                      <input type="checkbox" name="pick" value={`${k.platform}|${k.externalCampaignId ?? ""}|${k.name}`} className="mt-1" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-medium truncate">{k.name}</span>
                        <span className="block text-[11px] text-muted">
                          {k.accountName ?? k.platform}
                          {k.brandName ? ` · ${k.brandName}` : " · marque non identifiée"}
                          {k.lastDay ? ` · dernier jour ${fmtDateShort(k.lastDay)}` : ""}
                        </span>
                      </span>
                      <span className="text-[12px] font-medium whitespace-nowrap">{fmtMAD(k.spend, { compact: true })}</span>
                      {k.suggested && <Badge tone="green">suggérée</Badge>}
                    </label>
                  ))}
                </div>
                <button className="btn-primary w-full" type="submit">Rattacher la sélection</button>
              </form>
            )}
          </Card>
        </div>
      </Section>

      {/* ------------------------------- Stock : garde-fou ---------------------------------- */}
      {stock.length > 0 && (
        <Section title="Stock des produits poussés" description="Avant d'augmenter un budget, vérifier que la marchandise suit.">
          <Card>
            {tight.length > 0 && (
              <div className="rounded-xl border border-orange/40 bg-orange-soft/30 px-3 py-2 text-[12.5px] mb-3">
                <b>{tight.length} produit(s) sous 1,5 mois de couverture</b> — augmenter la pression publicitaire sur cette campagne risque de créer une rupture : {tight.slice(0, 4).map((s) => s.name).join(", ")}{tight.length > 4 ? "…" : ""}.
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="tbl text-[12.5px]">
                <thead><tr><th>Produit</th><th className="num">Stock</th><th className="num">Ventes / mois</th><th className="num">Couverture</th></tr></thead>
                <tbody>
                  {stock.slice(0, 15).map((s) => (
                    <tr key={s.id}>
                      <td><Link href={`/produits/${s.id}`} className="hover:underline">{s.name}</Link></td>
                      <td className="num">{fmtNum(s.qty)}</td>
                      <td className="num">{fmtNum(s.monthly, 1)}</td>
                      <td className="num">{s.coverage === null ? "—" : <Badge tone={s.coverage < 1 ? "red" : s.coverage < 1.5 ? "orange" : s.coverage > 6 ? "yellow" : "green"}>{s.coverage.toFixed(1)} mois</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Section>
      )}

      {/* ---------------------- Influence / contenus / dépenses ----------------------------- */}
      <div className="grid lg:grid-cols-2 gap-4 mt-6">
        <Card className="min-w-0" title={`Collaborations influence (${collabs.length})`} action={<Link href="/marketing/influence" className="text-[12px] text-accent">Influence Center</Link>}>
          {collabs.length === 0 ? <Empty title="Aucune collaboration rattachée" hint="Rattachez une collaboration à cette campagne depuis l'Influence Center." /> : (
            <div className="overflow-x-auto"><table className="tbl text-[12.5px]">
              <thead><tr><th>Date</th><th>Influenceuse</th><th className="num">Coût</th><th className="num">Reach</th><th className="num">CA mesuré</th></tr></thead>
              <tbody>{collabs.map((x) => (
                <tr key={x.id}><td className="whitespace-nowrap">{fmtDateShort(x.date)}</td><td>{x.influencer}{x.promo_code && <span className="text-faint"> · {x.promo_code}</span>}</td><td className="num">{fmtMAD(x.cost, { suffix: false })}</td><td className="num">{x.reach ? fmtNum(x.reach) : "—"}</td><td className="num">{x.revenue ? fmtMAD(x.revenue, { suffix: false }) : "—"}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>

        <Card className="min-w-0" title={`Contenus (${contents.length})`} action={<Link href="/marketing/planning" className="text-[12px] text-accent">Planning éditorial</Link>}>
          {contents.length === 0 ? <Empty title="Aucun contenu rattaché" hint="Reliez les publications de cette campagne depuis le planning éditorial." /> : (
            <ul className="divide-y divide-line">
              {contents.map((x) => (
                <li key={x.id} className="flex items-center gap-2 py-2 text-[12.5px]">
                  <span className="text-muted w-14 shrink-0">{fmtDateShort(x.date)}</span>
                  <span className="flex-1 truncate">{x.title}</span>
                  {x.format && <Badge tone="gray">{x.format}</Badge>}
                  <Badge tone={x.status === "PUBLIE" ? "green" : x.status === "VALIDE" ? "blue" : "gray"}>{x.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Section title={`Dépenses rattachées (${expenses.length})`} description="Toutes les lignes de dépense associées à cette campagne, quel que soit le canal.">
        <Card>
          <div className="overflow-x-auto">
            <table className="tbl text-[12.5px]">
              <thead><tr><th>Date</th><th>Libellé</th><th>Catégorie</th><th>Statut</th><th className="num">Montant</th><th className="num">CA saisi</th><th></th></tr></thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDateShort(e.date)}</td>
                    <td>{e.label}</td>
                    <td className="text-muted">{BUDGET_CATEGORY_LABELS[e.category as keyof typeof BUDGET_CATEGORY_LABELS] ?? e.category}</td>
                    <td><Badge tone={e.status === "SPENT" ? "green" : e.status === "COMMITTED" ? "blue" : "gray"}>{e.status === "SPENT" ? "Dépensé" : e.status === "COMMITTED" ? "Engagé" : "Prévu"}</Badge></td>
                    <td className="num font-medium">{fmtMAD(e.amount, { suffix: false })}</td>
                    <td className="num">{e.revenue ? fmtMAD(e.revenue, { suffix: false }) : "—"}</td>
                    <td><form action={deleteExpense}><input type="hidden" name="id" value={e.id} /><button className="text-faint hover:text-red" type="submit" title="Supprimer">×</button></form></td>
                  </tr>
                ))}
                {expenses.length === 0 && <tr><td colSpan={7} className="text-muted text-center py-3">Aucune dépense rattachée.</td></tr>}
              </tbody>
            </table>
          </div>
          <details className="mt-3"><summary className="cursor-pointer text-[12.5px] text-accent font-medium">+ Ajouter une dépense à cette campagne</summary>
            <form action={saveExpense} className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-1.5 text-[12px]">
              <input type="hidden" name="brandId" value={c.brand_id} />
              <input type="hidden" name="campaignId" value={c.id} />
              <input name="label" placeholder="Libellé" className="input h-8 col-span-2" required />
              <input type="date" name="date" className="input h-8" required />
              <input name="amount" placeholder="Montant MAD" className="input h-8" required />
              <select name="category" className="select h-8"><option value="">Catégorie auto</option>{BUDGET_CATEGORIES.map((x) => <option key={x} value={x}>{BUDGET_CATEGORY_LABELS[x]}</option>)}</select>
              <select name="status" className="select h-8"><option value="COMMITTED">Engagé</option><option value="SPENT">Dépensé</option><option value="PLANNED">Prévu</option></select>
              <input name="attributedRevenue" placeholder="CA attribué (si mesuré)" className="input h-8" />
              <button className="btn-secondary btn-sm" type="submit">Enregistrer</button>
            </form>
          </details>
        </Card>
      </Section>

      {/* ------------------------------------- Fiche ---------------------------------------- */}
      <Section title="Fiche campagne" description="Brief, cible, offre, produits poussés et KPI cible.">
        <div className="grid lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 min-w-0" title="Modifier">
            <form action={saveCampaign} className="grid sm:grid-cols-2 gap-2 text-[13px]">
              <input type="hidden" name="id" value={c.id} />
              <label className="block"><span className="label block mb-1">Nom</span><input name="name" defaultValue={c.name} className="input h-9" required /></label>
              <label className="block"><span className="label block mb-1">Marque</span>
                <select name="brandId" defaultValue={c.brand_id} className="select h-9">{brands.filter((b) => b.active || b.id === c.brand_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              </label>
              <label className="block"><span className="label block mb-1">Type</span>
                <select name="type" defaultValue={c.type} className="select h-9">{Object.entries(CAMPAIGN_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <label className="block"><span className="label block mb-1">Canal principal</span>
                <select name="channel" defaultValue={c.channel} className="select h-9"><option value="META">Meta</option><option value="TIKTOK">TikTok</option><option value="GOOGLE">Google</option><option value="INFLUENCE">Influence</option><option value="TRADE">Trade</option><option value="EVENEMENT">Événement</option><option value="AUTRE">Autre</option></select>
              </label>
              <label className="block"><span className="label block mb-1">Début</span><input type="date" name="startDate" defaultValue={c.start_date ?? ""} className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">Fin</span><input type="date" name="endDate" defaultValue={c.end_date ?? ""} className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">Budget (MAD)</span><input name="budget" defaultValue={c.budget ?? ""} className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">Statut</span>
                <select name="status" defaultValue={c.status} className="select h-9">{Object.entries(CAMPAIGN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              </label>
              <label className="block sm:col-span-2"><span className="label block mb-1">Objectif</span><input name="objective" defaultValue={c.objective ?? ""} className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">Cible</span><input name="audience" defaultValue={c.audience ?? ""} className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">Offre / promotion</span><input name="offer" defaultValue={c.offer ?? ""} className="input h-9" /></label>
              <label className="block sm:col-span-2"><span className="label block mb-1">Message clé</span><input name="message" defaultValue={c.message ?? ""} className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">KPI cible</span><input name="kpiTarget" defaultValue={c.kpi_target ?? ""} className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">KPI atteint (bilan)</span><input name="kpiActual" defaultValue={c.kpi_actual ?? ""} className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">Responsable</span>
                <select name="responsibleId" defaultValue={c.responsible_id ?? ""} className="select h-9"><option value="">— non assigné —</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              </label>
              <label className="block sm:col-span-2"><span className="label block mb-1">Notes / bilan</span><textarea name="notes" defaultValue={c.notes ?? ""} className="input min-h-20 py-2" /></label>
              <div className="sm:col-span-2">
                <span className="label block mb-1">Produits poussés ({products.length} sélectionné(s))</span>
                <div className="max-h-52 overflow-y-auto rounded-xl border border-line p-2 grid sm:grid-cols-2 gap-x-3 gap-y-1">
                  {allProducts.map((p) => (
                    <label key={p.id} className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" name="productIds" value={p.id} defaultChecked={selected.has(p.id)} /> <span className="truncate">{p.name}</span></label>
                  ))}
                  {allProducts.length === 0 && <span className="text-[12px] text-muted">Aucun produit actif pour cette marque.</span>}
                </div>
                <p className="text-[11.5px] text-faint mt-1">Les produits poussés définissent le périmètre des ventes et du stock analysés ci-dessus.</p>
              </div>
              <button className="btn-primary sm:col-span-2" type="submit">Enregistrer</button>
            </form>
          </Card>

          <div className="space-y-4">
            <Card title="Résumé">
              <Facts items={[
                { label: "Marque", value: c.brand },
                { label: "Type", value: campaignTypeLabel(c.type) },
                { label: "Canal", value: c.channel },
                { label: "Cible", value: c.audience ?? "—" },
                { label: "Message", value: c.message ?? "—" },
                { label: "Offre", value: c.offer ?? "—" },
                { label: "KPI cible", value: c.kpi_target ?? "—" },
                { label: "KPI atteint", value: c.kpi_actual ?? "—" },
              ]} cols={2} />
            </Card>
            <Card title="Supprimer">
              <p className="text-[12.5px] text-ink-2 mb-2">La suppression détache les dépenses, contenus et collaborations sans les effacer.</p>
              <form action={deleteCampaign}><input type="hidden" name="id" value={c.id} /><button className="btn-secondary btn-sm text-red" type="submit">Supprimer la campagne</button></form>
            </Card>
          </div>
        </div>
      </Section>
    </>
  );
}
