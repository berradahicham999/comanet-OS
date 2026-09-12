import Link from "next/link";
import { requireAccessContext } from "@/lib/permissions";
import { requireAccess, brandFilter } from "@/lib/access";
import { isAdmin } from "@/lib/permissions-shared";
import { listBrands } from "@/lib/users";
import { getRefDate } from "@/lib/ref-date";
import { getSettings } from "@/lib/settings";
import { byDim } from "@/lib/analytics";
import { addDays, iso, today, fmtMAD, fmtNum, fmtPct, fmtDate, fmtTime } from "@/lib/format";
import { intelContextFor } from "@/lib/marketing-intel/server";
import { buildBrandOverview, buildRecommendations, MARKETING_PERIOD_KEYS, type MarketingPeriodKey } from "@/lib/marketing-intel/build";
import { ACTION_LABELS, CONFIDENCE_LABELS } from "@/lib/marketing-intel/decisions";
import { CATEGORY_LABELS } from "@/lib/marketing-intel/performance";
import { STOCK_RISK_LABELS } from "@/lib/marketing-intel/inventory";
import type { Decision, DataTag } from "@/lib/marketing-intel/types";
import { isAiConfigured } from "@/lib/ai/client";
import { copilotAllowed } from "@/lib/ai/service";
import { suggestionsFor } from "@/lib/ai/suggestions-shared";
import { PageHeader, Card, Kpi, Badge, BrandDot, Section, Empty, type Tone } from "@/components/ui";
import { MarketingAgentChat } from "@/components/ai/marketing-agent-chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent marketing" };

const PERIODS: { key: MarketingPeriodKey; label: string }[] = [{ key: "7d", label: "7 jours" }, { key: "30d", label: "30 jours" }, { key: "90d", label: "90 jours" }, { key: "month", label: "Mois en cours" }, { key: "ytd", label: "Année" }];
const TAG_TONE: Record<DataTag, Tone> = { CONFIRMED: "green", CALCULATED: "blue", INFERRED: "purple", MISSING: "gray" };
const TAG_LABEL: Record<DataTag, string> = { CONFIRMED: "confirmé", CALCULATED: "calculé", INFERRED: "déduit", MISSING: "manquant" };
const ACTION_TONE: Partial<Record<Decision["action"], Tone>> = { PUSH: "green", BOOST_DIGITAL: "green", MAINTAIN: "blue", OPTIMIZE: "orange", RESTOCK: "red", DO_NOT_PROMOTE: "red", CREATE_PROMOTION: "purple", FOCUS_SELL_OUT: "purple", CREATE_CONTENT: "accent", ACTIVATE_INFLUENCER: "accent", REDUCE: "orange", STOP: "red" };
const CONF_TONE: Record<Decision["confidence"], Tone> = { HIGH: "green", MEDIUM: "yellow", LOW: "gray" };

const growth = (v: number | null) => (v === null ? "pas encore comparable" : fmtPct(v, 1, true));

function DecisionCard({ d, rank }: { d: Decision; rank: number | null }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {rank !== null && <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">Priorité {rank}</span>}
        <Badge tone={ACTION_TONE[d.action] ?? "gray"}>{d.action}</Badge>
        <span className="font-semibold text-[14px]">{d.productName ?? d.brandName}</span>
        <span className="text-[12.5px] text-muted">— {d.title}</span>
        <span className="flex-1" />
        <Badge tone={CONF_TONE[d.confidence]} dot>confiance {CONFIDENCE_LABELS[d.confidence]}</Badge>
      </div>
      <div className="grid md:grid-cols-2 gap-3 text-[13px]">
        <div>
          <div className="label mb-1">Pourquoi</div>
          <ul className="list-disc pl-4 space-y-0.5 text-ink-2">{d.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
        <div>
          <div className="label mb-1">Données</div>
          <ul className="space-y-0.5">{d.data.map((f, i) => <li key={i} className="flex items-center gap-2"><span className="text-ink-2">{f.label} :</span><b>{f.value}</b><Badge tone={TAG_TONE[f.tag]}>{TAG_LABEL[f.tag]}</Badge></li>)}</ul>
        </div>
      </div>
      <div className="text-[12.5px] text-ink-2"><b>Impact attendu :</b> {d.expectedImpact}</div>
      <div className="text-[11.5px] text-faint">{ACTION_LABELS[d.action]}{d.secondaryActions.length ? ` · ensuite : ${d.secondaryActions.map((a) => ACTION_LABELS[a]).join(", ")}` : ""} · {d.confidenceWhy.join(" ; ")}{d.productId && <> · <Link href={`/produits/${d.productId}`} className="underline">fiche produit</Link></>}</div>
    </div>
  );
}

export default async function MarketingAgentPage(props: { searchParams: Promise<{ brand?: string; period?: string }> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const [access, refDate, settings, scope, allBrands] = await Promise.all([requireAccessContext(), getRefDate(), getSettings(), brandFilter(), listBrands()]);
  const brands = allBrands.filter((b) => b.active && !b.mergedIntoId && (scope === null || scope.includes(b.id)));
  const periodKey = (MARKETING_PERIOD_KEYS as readonly string[]).includes(sp.period ?? "") ? (sp.period as MarketingPeriodKey) : "30d";
  const now = today();
  const ctx = intelContextFor({ perms: access.perms, seeInternalCosts: isAdmin(access.perms) || access.flags.seeInternalCosts, scopeBrandIds: scope, scopeClientIds: access.scope === "ASSIGNED" && !isAdmin(access.perms) && access.clientIds.length ? access.clientIds : null, settings, refDate: refDate.ref, now });

  // Marque par défaut : la plus vendue sur 30 jours dans la portée (aucune donnée n'est recopiée à la main).
  let brandId = sp.brand && brands.some((b) => b.id === sp.brand) ? sp.brand : null;
  if (!brandId && brands.length) {
    const top = await byDim("brand", iso(addDays(refDate.ref, -29)), iso(addDays(refDate.ref, 1)), scope ? { brandIds: scope } : {}, 50);
    brandId = top.find((r) => brands.some((b) => b.id === r.id))?.id ?? brands[0].id;
  }
  const brand = brands.find((b) => b.id === brandId) ?? null;
  // La vue lit la donnée une fois ; le moteur de décision réutilise ses résultats (aucune seconde lecture).
  const overview = brand ? await buildBrandOverview(ctx, { brandId: brand.id, brandName: brand.name, period: periodKey }) : null;
  const reco = brand && overview ? await buildRecommendations(ctx, { brandId: brand.id, brandName: brand.name, period: periodKey, performance: overview.performance, targets: overview.targets }) : null;
  const href = (b: string | null, p: string) => `/marketing/agent?${new URLSearchParams({ ...(b ? { brand: b } : {}), period: p }).toString()}`;
  const configured = isAiConfigured();
  const chatAllowed = copilotAllowed(access);
  const top = overview?.topProducts[0] ?? null;
  const first = reco?.set.decisions[0] ?? null;

  return (
    <>
      <PageHeader eyebrow="Marketing" title="Agent marketing" subtitle="Décider quoi pousser à partir de la situation commerciale réelle : ventes sell-in, stock, objectifs, marge et activité marketing sont lus dans COMANET OS au moment de la question, jamais recopiés.">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {brands.map((b) => <Link key={b.id} href={href(b.id, periodKey)} className={`inline-flex items-center gap-1.5 text-[12.5px] px-2.5 py-1 rounded-full border ${b.id === brandId ? "bg-ink text-white border-ink" : "border-line hover:border-line-2"}`}><BrandDot color={b.color} />{b.name}</Link>)}
          </div>
          <span className="text-faint text-[12px]">·</span>
          <div className="flex gap-1">
            {PERIODS.map((p) => <Link key={p.key} href={href(brandId, p.key)} className={`text-[12px] px-2 py-1 rounded-md border ${p.key === periodKey ? "bg-black/5 border-line-2" : "border-line hover:border-line-2"}`}>{p.label}</Link>)}
          </div>
        </div>
      </PageHeader>

      {!brand || !overview || !reco ? (
        <Empty title="Aucune marque dans votre périmètre" hint="Demander l'assignation d'une marque à un administrateur (Paramètres → Utilisateurs)." />
      ) : (
        <>
          <div className="text-[12px] text-muted mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Données à jour : ventes Sage au <b>{fmtDate(overview.freshness.salesRefDate)}</b>{refDate.staleDays > 0 && <span className="text-amber-800"> ({refDate.staleDays} j de retard d&apos;import)</span>}</span>
            <span>· stock {overview.freshness.stockDate ? <>photo du <b>{fmtDate(overview.freshness.stockDate)}</b></> : <span className="text-amber-800">aucune photo importée</span>}</span>
            <span>· calculé à {fmtTime(overview.freshness.computedAt)}</span>
            <span>· période : {overview.period.label}</span>
            {overview.notAccessible.length > 0 && <span className="text-amber-800">· non accessible avec vos droits : {overview.notAccessible.join(", ")}</span>}
          </div>

          <Section title="Contexte métier actuel" description={`${brand.name} — sell-in Sage HT, stock à la dernière photo, objectifs saisis. Croissance vs période précédente de même longueur.`}>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <Kpi label="Marque" value={brand.name} sub={`${fmtNum(overview.sales.orders)} commandes · ${fmtNum(overview.sales.clients)} clients`} />
              <Kpi label={`Ventes ${overview.period.label}`} value={fmtMAD(overview.sales.revenue, { compact: true })} sub={`${fmtNum(overview.sales.units)} unités · confirmé`} />
              <Kpi label="Croissance" value={growth(overview.sales.growthPct)} sub={overview.sales.comparable ? `vs ${fmtMAD(overview.sales.revenuePrev, { compact: true })} · calculé` : "période précédente vide"} tone={overview.sales.growthPct === null ? undefined : overview.sales.growthPct >= 0 ? "green" : "red"} />
              <Kpi label="Stock" value={overview.stock ? (overview.stock.avgDaysOfStock === null ? "—" : `${overview.stock.avgDaysOfStock} j`) : "non accessible"} sub={overview.stock ? `${fmtNum(overview.stock.totalUnits)} unités · ${overview.stock.known}/${overview.stock.products} réf. avec photo` : "module Stock"} />
              <Kpi label="Top SKU" value={top ? top.name : "—"} sub={top ? `${fmtMAD(top.revenue, { compact: true })} · ${growth(top.growthPct)}` : "aucune vente"} />
              <Kpi label="Produits à risque" value={overview.stock ? String(overview.stock.byRisk.RUPTURE_RISQUE) : "—"} sub={overview.stock ? `${overview.stock.byRisk.SURSTOCK} en surstock · ${overview.stock.byRisk.UNKNOWN} sans photo` : "module Stock"} tone={overview.stock && overview.stock.byRisk.RUPTURE_RISQUE > 0 ? "red" : undefined} />
              <Kpi label="Objectif du mois" value={overview.targets.monthly.pct === null ? "non renseigné" : fmtPct(overview.targets.monthly.pct, 0)} sub={overview.targets.monthly.objective === null ? "Paramètres → Objectifs" : `${fmtMAD(overview.targets.monthly.realized, { compact: true })} / ${fmtMAD(overview.targets.monthly.objective, { compact: true })} · projection ${fmtPct(overview.targets.monthly.forecastPct, 0)}`} tone={overview.targets.monthly.forecastPct === null ? undefined : overview.targets.monthly.forecastPct >= 100 ? "green" : "orange"} />
            </div>
            {overview.margin && overview.margin.weightedPct !== null && <p className="text-[12px] text-muted mt-2">Marge brute pondérée {fmtPct(overview.margin.weightedPct, 1)} (calculée sur {fmtPct(overview.margin.coveragePct, 0)} du CA, produits avec prix d&apos;achat connu).{overview.marketing ? ` · Marketing : ${overview.marketing.activeCampaigns} campagne(s) active(s), ${overview.marketing.upcomingContents} contenu(s) à venir, ${overview.marketing.runningActivations} activation(s) en cours.` : ""}{overview.ads ? ` · Ads 30 j : ${fmtMAD(overview.ads.spend, { compact: true })} sur ${overview.ads.campaigns} campagne(s).` : ""}</p>}
          </Section>

          <Section title="Recommandation" description="Moteur de décision : ventes × stock × marge × Ads, seuils Paramètres. L'agent recommande, vous validez." className="mt-6">
            {first ? (
              <div className="space-y-3">
                <DecisionCard d={first} rank={1} />
                {reco.set.decisions.slice(1).map((d, i) => <DecisionCard key={d.key} d={d} rank={i + 2} />)}
              </div>
            ) : (
              <Card><p className="text-[13px] text-ink-2">Aucune action à recommander sur {overview.period.label} : ventes stables et stock sain, ou données insuffisantes.</p></Card>
            )}
            {reco.set.doNotPush.length > 0 && (
              <div className="mt-4">
                <div className="label mb-2">À ne pas pousser</div>
                <div className="space-y-3">{reco.set.doNotPush.map((d) => <DecisionCard key={d.key} d={d} rank={null} />)}</div>
              </div>
            )}
            {reco.set.notes.length > 0 && <ul className="text-[12px] text-amber-800 mt-3 space-y-0.5">{reco.set.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          </Section>

          <Section title="Produits" description="Top 5 par CA, risques de rupture et surstocks. Catégories déduites des seuils Paramètres." className="mt-6">
            <Card pad={false}>
              <div className="overflow-x-auto">
                <table className="tbl text-[12.5px]">
                  <thead><tr><th>Produit</th><th>Catégorie</th><th className="num">CA</th><th className="num">Croissance</th><th className="num">Contribution</th><th className="num">Stock</th><th className="num">Couverture</th><th className="num">Marge</th></tr></thead>
                  <tbody>
                    {[...overview.topProducts, ...overview.riskProducts.filter((r) => !overview.topProducts.some((t) => t.productId === r.productId)), ...overview.overstockProducts.filter((r) => !overview.topProducts.some((t) => t.productId === r.productId) && !overview.riskProducts.some((t) => t.productId === r.productId))].map((p) => (
                      <tr key={p.productId}>
                        <td><Link href={`/produits/${p.productId}`} className="font-medium hover:underline">{p.name}</Link></td>
                        <td><Badge tone={p.category === "STOCK_RISK" ? "red" : p.category === "OVERSTOCK" ? "purple" : p.category === "STAR" ? "green" : p.category === "GROWTH" ? "green" : p.category === "UNDERPERFORMER" ? "orange" : "gray"}>{CATEGORY_LABELS[p.category]}</Badge></td>
                        <td className="num">{fmtMAD(p.revenue, { compact: true })}</td>
                        <td className="num">{growth(p.growthPct)}</td>
                        <td className="num">{p.contributionPct === null ? "—" : fmtPct(p.contributionPct, 1)}</td>
                        <td className="num">{p.stock?.stockKnown ? fmtNum(p.stock.stock) : <span className="text-muted">non renseigné</span>}</td>
                        <td className="num">{p.stock?.daysOfStock === null || p.stock?.daysOfStock === undefined ? "—" : <>{p.stock.daysOfStock} j <span className="text-muted">({STOCK_RISK_LABELS[p.stock.risk]})</span></>}</td>
                        <td className="num">{p.marginPct === null ? "—" : fmtPct(p.marginPct, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </Section>

          <Section title="Demander à l'agent" description="Même moteur que le Copilote (⌘K), avec la persona marketing et la marque sélectionnée. Chaque réponse cite ses outils et la fraîcheur des données." className="mt-6">
            <Card>
              {chatAllowed ? <MarketingAgentChat configured={configured} brandName={brand.name} periodKey={periodKey} suggestions={suggestionsFor("/marketing/agent")} /> : <p className="text-[13px] text-muted">Le copilote n&apos;est pas ouvert à ce profil.</p>}
            </Card>
          </Section>
        </>
      )}
    </>
  );
}
