/**
 * DÉPENSE PUBLICITAIRE — source officielle et règle de priorité unique.
 *
 * Trois sources cohabitaient dans l'application et donnaient trois chiffres différents pour
 * la même marque le même jour :
 *   1. `ad_metrics.spend`                                   (régie : import ou API Meta)
 *   2. `marketing_expenses` catégories META/TIKTOK/GOOGLE/DIGITAL  (saisie manuelle)
 *   3. `marketing_expenses` filtrées sur une campagne              (repli de la règle Ads)
 *
 * ── Règle de priorité (unique) ──────────────────────────────────────────────
 *  Pour un périmètre donné (période × marque), la **régie est la source officielle** dès
 *  qu'elle contient au moins une journée close : elle est datée, détaillée et non
 *  ressaisie. Les dépenses publicitaires saisies à la main sont alors ignorées du total,
 *  pour ne pas compter deux fois la même campagne. Sans aucune donnée de régie sur le
 *  périmètre, on retombe sur la saisie manuelle — c'est le seul chiffre disponible.
 *  La source retenue est toujours renvoyée (`source`) pour pouvoir l'afficher.
 *
 * ── Conventions ─────────────────────────────────────────────────────────────
 *  · Devise : MAD. `ad_metrics.spend` et `revenue` sont convertis à l'import/synchro avec le
 *    taux saisi en Paramètres (`fx_rate`) ; les montants d'origine restent en trace d'audit.
 *  · Journées partielles (`is_partial = true`) EXCLUES : leur dépense est déjà là mais leurs
 *    conversions arrivent après — les inclure ferait exploser le CPA sans raison.
 *  · Fuseau : `ad_metrics.date` est la journée du compte publicitaire, découpée dans le
 *    fuseau du compte (`ad_accounts.timezone`), pas en Africa/Casablanca. Aucune conversion
 *    n'est tentée : décaler les journées inventerait des chiffres.
 *  · Valeurs négatives (remboursements de régie) : conservées telles quelles, elles font
 *    partie de la dépense nette.
 *  · Une dépense sans marque n'entre dans aucun total filtré par marque, mais compte dans
 *    le total global (`brandId` non fourni).
 *
 * ── Ce qui est officiel pour quoi ───────────────────────────────────────────
 *  spend, impressions, clics, conversions, CA attribué, ROAS, CPA : cette fonction.
 *  Budget quotidien / état de diffusion d'une campagne : `ad_campaign_states` (instantané),
 *  jamais `ad_metrics`, qui est un journal de dépense et ne dit pas ce qui tourne encore.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";

export type AdSpendRange = { start: string; end: string };

/** Catégories de `marketing_expenses` qui décrivent de l'achat média — le repli de la régie. */
export const AD_EXPENSE_CATEGORIES = ["META", "TIKTOK", "GOOGLE", "DIGITAL"] as const;

export type AdSpendSource = "REGIE" | "SAISIE" | "AUCUNE";

export type AdSpendTotals = {
  /** D'où viennent les chiffres ci-dessous. */
  source: AdSpendSource;
  spend: number;
  revenue: number;
  conversions: number;
  impressions: number;
  clicks: number;
  roas: number | null;
  cpa: number | null;
  /** Dépense publicitaire saisie à la main, ignorée du total quand `source = "REGIE"`. */
  manualIgnored: number;
};

const brandFilter = (col: SQL, brandId?: string | null) =>
  brandId ? sql` and ${col} = ${brandId}::uuid` : sql``;

/**
 * Dépense publicitaire et indicateurs dérivés sur une période, pour une marque ou toutes.
 * Journées closes uniquement. Voir l'en-tête pour la règle de priorité.
 */
export async function adSpend(range: AdSpendRange, brandId?: string | null): Promise<AdSpendTotals> {
  const [regie, manual] = await Promise.all([
    db.execute(sql`
      select count(*)::int as rows,
             coalesce(sum(spend), 0)::float8 as spend,
             coalesce(sum(revenue), 0)::float8 as revenue,
             coalesce(sum(purchases), 0)::float8 as conversions,
             coalesce(sum(impressions), 0)::float8 as impressions,
             coalesce(sum(case when link_clicks > 0 then link_clicks else clicks end), 0)::float8 as clicks
      from ad_metrics
      where date >= ${range.start}::date and date < ${range.end}::date and is_partial = false
        ${brandFilter(sql`brand_id`, brandId)}`),
    db.execute(sql`
      select coalesce(sum(amount), 0)::float8 as spend,
             coalesce(sum(attributed_revenue), 0)::float8 as revenue,
             coalesce(sum(conversions), 0)::float8 as conversions
      from marketing_expenses
      where status <> 'PLANNED' and date >= ${range.start}::date and date < ${range.end}::date
        and category in (${sql.join(AD_EXPENSE_CATEGORIES.map((c) => sql`${c}`), sql`, `)})
        ${brandFilter(sql`brand_id`, brandId)}`),
  ]);

  const r = regie.rows[0] as { rows: number; spend: number; revenue: number; conversions: number; impressions: number; clicks: number };
  const m = manual.rows[0] as { spend: number; revenue: number; conversions: number };

  if (Number(r.rows) > 0) {
    return finish("REGIE", Number(r.spend), Number(r.revenue), Number(r.conversions), Number(r.impressions), Number(r.clicks), Number(m.spend));
  }
  if (Number(m.spend) !== 0 || Number(m.conversions) !== 0 || Number(m.revenue) !== 0) {
    return finish("SAISIE", Number(m.spend), Number(m.revenue), Number(m.conversions), 0, 0, 0);
  }
  return finish("AUCUNE", 0, 0, 0, 0, 0, 0);
}

function finish(
  source: AdSpendSource, spend: number, revenue: number, conversions: number,
  impressions: number, clicks: number, manualIgnored: number,
): AdSpendTotals {
  return {
    source, spend, revenue, conversions, impressions, clicks, manualIgnored,
    roas: spend > 0 ? revenue / spend : null,
    cpa: conversions > 0 ? spend / conversions : null,
  };
}

/** Libellé de la source, pour l'afficher à côté du chiffre. */
export const AD_SPEND_SOURCE_LABEL: Record<AdSpendSource, string> = {
  REGIE: "régie publicitaire",
  SAISIE: "dépenses saisies",
  AUCUNE: "aucune donnée",
};
