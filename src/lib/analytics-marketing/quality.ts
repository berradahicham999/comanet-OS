/**
 * Qualité des données marketing : ce qui manque pour que les chiffres soient crédibles.
 *
 * Chaque manque a un compteur, un responsable (rôle) et un lien direct pour corriger.
 * La complétude globale (`DATA_COMPLETENESS`) est la moyenne des taux de complétude des
 * contrôles pondérables ; elle s'affiche à côté de chaque ROI.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { iso, today, startOfMonth } from "@/lib/format";
import { getSettings, animationDayCostOf } from "@/lib/settings";

export type QualityIssue = {
  key: string;
  label: string;
  /** Pourquoi ça compte. */
  why: string;
  count: number;
  /** Base du taux (null : contrôle « présent / absent »). */
  total: number | null;
  /** 0-1 : part conforme (null si non pondérable). */
  completeness: number | null;
  owner: string;
  href: string;
  /** Exemples (libellés) pour retrouver les lignes. */
  samples: string[];
  severity: "red" | "orange" | "yellow";
};

export type Coverage = { source: string; label: string; rows: number; firstDay: string | null; lastDay: string | null; href: string };

export type QualityReport = { issues: QualityIssue[]; completeness: number | null; coverage: Coverage[]; generatedAt: string };

const OWNER_MARKETING = "Responsable marketing";
const OWNER_ADMIN = "Administrateur (Paramètres)";
const OWNER_TERRAIN = "Équipe terrain";
const OWNER_SALES = "Direction commerciale (import Sage)";
const OWNER_PRODUCTS = "Responsable produits";
const OWNER_DIGITAL = "Responsable Digital Ads";

type Row = { n: number; total: number | null; samples: string[] | null };
const one = async (q: ReturnType<typeof sql>): Promise<Row> => {
  const r = await db.execute<Row>(q);
  const x = r.rows[0];
  return { n: Number(x?.n ?? 0), total: x?.total === null || x?.total === undefined ? null : Number(x.total), samples: x?.samples ?? [] };
};
const samplesSql = (expr: ReturnType<typeof sql>) => sql`(array_agg(distinct ${expr}))[1:5]`;

export async function qualityReport(): Promise<QualityReport> {
  const settings = await getSettings();
  const year = today().getUTCFullYear();
  const dayCost = animationDayCostOf(settings.analytics);
  const thisMonth = iso(startOfMonth(today())).slice(0, 7);

  const [
    spendNoProduct, adsNoCampaign, regieOverridden, animNoCost, animNoLines, contentNoPerf, activationsNoResults, collabNoPerf,
    monthsNoSales, brandsNoBudget, brandsNoObjective, productsNoCost, samplesNoPrice, stockAge, mergedBrands,
  ] = await Promise.all([
    one(sql`select count(*)::int as n, (select count(*) from fact_marketing_spend where is_partial = false and coalesce(spent, committed, planned, 0) > 0)::int as total,
             ${samplesSql(sql`s.source_label`)} as samples
             from fact_marketing_spend s where s.product_id is null and s.is_partial = false and coalesce(s.spent, s.committed, s.planned, 0) > 0`),
    one(sql`select count(distinct m.campaign_name)::int as n, (select count(distinct campaign_name) from ad_metrics)::int as total, ${samplesSql(sql`m.campaign_name`)} as samples
             from ad_metrics m where m.campaign_id is null`),
    one(sql`select count(*)::int as n, null::int as total, ${samplesSql(sql`s.source_label`)} as samples from fact_marketing_spend s where s.source_ref = 'REGIE_PRIORITAIRE'`),
    one(sql`select count(distinct s.source_id)::int as n, (select count(*) from animations where status <> 'CANCELLED')::int as total, null::text[] as samples
             from fact_marketing_spend s where s.source_kind = 'ANIMATION' and s.source_ref in ('COUT_NON_MESURE', 'TARIF_JOURNALIER')`),
    one(sql`select count(*)::int as n, (select count(*) from animations where status <> 'CANCELLED')::int as total, ${samplesSql(sql`a.date::text || ' · ' || coalesce(a.city, '?')`)} as samples
             from animations a where a.status <> 'CANCELLED' and a.brand_id is null and not exists (select 1 from animation_lines l where l.animation_id = a.id)`),
    one(sql`select count(*)::int as n, (select count(*) from content_items where published_at is not null)::int as total, ${samplesSql(sql`c.title`)} as samples
             from content_items c where c.published_at is not null and c.reach is null and c.engagement is null`),
    one(sql`select count(*)::int as n, (select count(*) from activations a join activation_statuses st on st.key = a.status where st.is_done or st.is_measured)::int as total, ${samplesSql(sql`a.name`)} as samples
             from activations a join activation_statuses st on st.key = a.status
             where (st.is_done or st.is_measured) and a.results_at is null and a.participants is null and a.leads is null and a.samples is null and a.orders_on_site is null and a.attributed_revenue is null`),
    one(sql`select count(*)::int as n, (select count(*) from collaborations where status in ('PUBLIE','ANALYSE','TERMINE'))::int as total, ${samplesSql(sql`i.name`)} as samples
             from collaborations c join influencers i on i.id = c.influencer_id where c.status in ('PUBLIE','ANALYSE','TERMINE') and c.reach is null and c.views is null and c.impressions is null`),
    one(sql`with months as (select distinct month from dim_period where day >= (select min(date) from sales) and month < ${thisMonth})
             select count(*)::int as n, (select count(*) from months)::int as total, ${samplesSql(sql`months.month`)} as samples
             from months where not exists (select 1 from sales s where to_char(s.date, 'YYYY-MM') = months.month)`),
    one(sql`select count(*)::int as n, (select count(*) from brands where active and merged_into_id is null)::int as total, ${samplesSql(sql`b.name`)} as samples
             from brands b where b.active and b.merged_into_id is null and not exists (select 1 from budgets bu where bu.brand_id = b.id and bu.year = ${year} and bu.amount > 0)`),
    one(sql`select count(*)::int as n, (select count(*) from brands where active and merged_into_id is null)::int as total, ${samplesSql(sql`b.name`)} as samples
             from brands b where b.active and b.merged_into_id is null and not exists (select 1 from objectives o where o.brand_id = b.id and o.year = ${year} and o.product_id is null)`),
    one(sql`select count(*)::int as n, (select count(*) from products where active)::int as total, ${samplesSql(sql`p.name`)} as samples from products p where p.active and p.cost_price is null`),
    one(sql`select count(*)::int as n, null::int as total, ${samplesSql(sql`s.source_label`)} as samples from fact_marketing_spend s where s.source_kind = 'SAMPLE' and s.source_ref = 'PRIX_INCONNU'`),
    one(sql`select coalesce((current_date - max(date))::int, 9999) as n, null::int as total, array[coalesce(max(date)::text, 'aucun instantané')] as samples from stock_snapshots`),
    one(sql`select count(*)::int as n, null::int as total, ${samplesSql(sql`b.name || ' → ' || t.name`)} as samples from brands b join brands t on t.id = b.merged_into_id`),
  ]);

  const pct = (r: Row) => (r.total === null || r.total === 0 ? null : 1 - r.n / r.total);
  const issues: QualityIssue[] = [];
  const push = (i: Omit<QualityIssue, "completeness" | "samples"> & { row: Row; completeness?: number | null }) => {
    const { row, ...rest } = i;
    issues.push({ ...rest, completeness: i.completeness === undefined ? pct(row) : i.completeness, samples: row.samples ?? [] });
  };

  push({ key: "spend-no-product", label: "Dépenses sans produit", why: "Sans produit, la dépense compte au niveau marque mais n'entre pas dans l'analyse par produit (4 cas).", count: spendNoProduct.n, total: spendNoProduct.total, owner: OWNER_MARKETING, href: "/marketing/budgets", severity: "orange", row: spendNoProduct });
  push({ key: "ads-no-campaign", label: "Campagnes de régie non rattachées à une campagne COMANET", why: "Sans rattachement, une dépense Ads n'a ni produit ni objectif : coût par résultat seulement.", count: adsNoCampaign.n, total: adsNoCampaign.total, owner: OWNER_DIGITAL, href: "/marketing/ads", severity: "orange", row: adsNoCampaign });
  push({ key: "regie-overridden", label: "Dépenses média saisies écartées (régie prioritaire)", why: "La régie couvre le même mois : la saisie manuelle est conservée sans montant pour ne pas compter deux fois.", count: regieOverridden.n, total: null, owner: OWNER_MARKETING, href: "/marketing/budgets", severity: "yellow", row: regieOverridden, completeness: null });
  push({ key: "anim-no-cost", label: dayCost ? "Animations sans coût (tarif journalier appliqué)" : "Animations sans coût : dépense terrain non mesurable", why: dayCost ? `Le tarif de ${dayCost} MAD/jour est appliqué à ces animations.` : "Sans coût saisi ni tarif journalier en Paramètres, le canal Animation affiche des résultats sans dépense : ni ROI ni coût par résultat.", count: animNoCost.n, total: animNoCost.total, owner: dayCost ? OWNER_TERRAIN : OWNER_ADMIN, href: dayCost ? "/terrain" : "/parametres/analytics", severity: dayCost ? "yellow" : "red", row: animNoCost, completeness: dayCost ? null : undefined });
  push({ key: "anim-no-lines", label: "Animations sans ligne produit ni marque", why: "La marque d'une animation se déduit de ses produits : sans ligne, elle n'entre dans aucune analyse.", count: animNoLines.n, total: animNoLines.total, owner: OWNER_TERRAIN, href: "/terrain", severity: "orange", row: animNoLines });
  push({ key: "content-no-perf", label: "Contenus publiés sans performance", why: "Portée et engagement saisis à la main sont les seuls résultats des canaux organiques.", count: contentNoPerf.n, total: contentNoPerf.total, owner: OWNER_MARKETING, href: "/marketing/planning", severity: "orange", row: contentNoPerf });
  push({ key: "activation-no-results", label: "Activations terminées sans résultats", why: "Sans participants, leads, échantillons ou commandes, l'activation a un coût et aucun retour.", count: activationsNoResults.n, total: activationsNoResults.total, owner: OWNER_MARKETING, href: "/marketing/activations?periode=tout", severity: "orange", row: activationsNoResults });
  push({ key: "collab-no-perf", label: "Collaborations publiées sans portée", why: "Sans portée ni vues, le coût par résultat de l'influence n'est pas calculable.", count: collabNoPerf.n, total: collabNoPerf.total, owner: OWNER_MARKETING, href: "/marketing/influence", severity: "orange", row: collabNoPerf });
  push({ key: "months-no-sales", label: "Mois sans import Sage", why: "Un mois sans vente importée fausse toute comparaison (période précédente, N-1, fenêtre après).", count: monthsNoSales.n, total: monthsNoSales.total, owner: OWNER_SALES, href: "/imports/nouveau?type=SALES", severity: "red", row: monthsNoSales });
  push({ key: "brands-no-budget", label: `Marques sans enveloppe ${year} (ou à 0 MAD)`, why: "Sans enveloppe, « dépense vs budget » affiche « pas de budget défini ».", count: brandsNoBudget.n, total: brandsNoBudget.total, owner: OWNER_ADMIN, href: "/marketing/budgets", severity: "orange", row: brandsNoBudget });
  push({ key: "brands-no-objective", label: `Marques sans objectif de vente ${year}`, why: "L'atteinte d'objectif et le score de santé en dépendent.", count: brandsNoObjective.n, total: brandsNoObjective.total, owner: "Direction (objectifs)", href: "/imports/nouveau?type=OBJECTIVES", severity: "orange", row: brandsNoObjective });
  push({ key: "products-no-cost", label: "Produits sans prix d'achat", why: "La marge n'est calculée que sur les produits dont le prix d'achat est connu.", count: productsNoCost.n, total: productsNoCost.total, owner: OWNER_PRODUCTS, href: "/produits", severity: "yellow", row: productsNoCost });
  push({ key: "samples-no-price", label: "Échantillons remis sans prix", why: "Un échantillon sans prix d'achat ni prix COMANET n'est pas valorisé.", count: samplesNoPrice.n, total: null, owner: OWNER_PRODUCTS, href: "/medical/echantillons", severity: "yellow", row: samplesNoPrice, completeness: null });
  push({ key: "stock-stale", label: stockAge.n >= 9999 ? "Aucun instantané de stock" : `Dernier instantané de stock il y a ${stockAge.n} jour${stockAge.n > 1 ? "s" : ""}`, why: "Le croisement produit × couverture de stock exige un instantané récent.", count: stockAge.n >= 9999 ? 1 : stockAge.n > 7 ? 1 : 0, total: null, owner: OWNER_SALES, href: "/imports/nouveau?type=STOCK", severity: stockAge.n >= 9999 ? "red" : "yellow", row: stockAge, completeness: stockAge.n >= 9999 ? 0 : stockAge.n > 7 ? 0.5 : 1 });
  if (mergedBrands.n) push({ key: "merged-brands", label: "Marques fusionnées (lues sous leur marque cible)", why: "Information : ces doublons de référentiel sont regroupés dans toutes les analyses.", count: mergedBrands.n, total: null, owner: OWNER_ADMIN, href: "/marques", severity: "yellow", row: mergedBrands, completeness: null });

  const weighted = issues.filter((i) => i.completeness !== null);
  const completeness = weighted.length ? weighted.reduce((s, i) => s + (i.completeness as number), 0) / weighted.length : null;

  const cov = await db.execute<{ source: string; rows: number; first_day: string | null; last_day: string | null }>(sql`
    select 'SALES' as source, count(*)::int as rows, min(date)::text as first_day, max(date)::text as last_day from sales
    union all select 'ANIMATIONS', count(*)::int, min(date)::text, max(date)::text from animations
    union all select 'AD_METRICS', count(*)::int, min(date)::text, max(date)::text from ad_metrics
    union all select 'EXPENSES', count(*)::int, min(date)::text, max(date)::text from marketing_expenses
    union all select 'COLLABORATIONS', count(*)::int, min(date)::text, max(date)::text from collaborations
    union all select 'CONTENTS', count(*)::int, min(date)::text, max(date)::text from content_items
    union all select 'ACTIVATIONS', count(*)::int, min(date)::text, max(date)::text from activations
    union all select 'STOCK', count(*)::int, min(date)::text, max(date)::text from stock_snapshots
    union all select 'SAMPLES', count(*)::int, min(date)::text, max(date)::text from sample_movements where type = 'SORTIE_VISITE'`);
  const LABELS: Record<string, { label: string; href: string }> = {
    SALES: { label: "Ventes Sage (sell-in)", href: "/ventes" }, ANIMATIONS: { label: "Animations terrain (sell-out)", href: "/terrain" },
    AD_METRICS: { label: "Régie publicitaire", href: "/marketing/ads" }, EXPENSES: { label: "Dépenses marketing", href: "/marketing/budgets" },
    COLLABORATIONS: { label: "Collaborations influence", href: "/marketing/influence" }, CONTENTS: { label: "Contenus éditoriaux", href: "/marketing/planning" },
    ACTIVATIONS: { label: "Activations", href: "/marketing/activations" }, STOCK: { label: "Instantanés de stock", href: "/stock" }, SAMPLES: { label: "Échantillons médicaux remis", href: "/medical/echantillons" },
  };
  const coverage: Coverage[] = cov.rows.map((c) => ({ source: c.source, label: LABELS[c.source]?.label ?? c.source, rows: Number(c.rows), firstDay: c.first_day, lastDay: c.last_day, href: LABELS[c.source]?.href ?? "/" }));

  return { issues: issues.sort((a, b) => sev(a.severity) - sev(b.severity) || b.count - a.count), completeness, coverage, generatedAt: new Date().toISOString() };
}

const sev = (s: QualityIssue["severity"]) => (s === "red" ? 0 : s === "orange" ? 1 : 2);

/** Complétude seule (pour les pages d'analyse et le score de santé), sans recalculer la couverture. */
export async function dataCompleteness(): Promise<number | null> {
  return (await qualityReport()).completeness;
}
