/**
 * BUDGET MARKETING CONSOMMÉ — définition officielle et unique.
 *
 * Quatre calculs différents coexistaient (cockpit, /marketing, /marketing/budgets et la règle
 * `budget-overrun`) : une même marque pouvait être à 130 % sur un écran et à 70 % sur un autre.
 * Ce module est désormais la seule source ; tout écran ou règle qui parle de budget consommé
 * appelle `budgetConsumption()` ou `budgetConsumptionByBrand()`.
 *
 * ── Définition ──────────────────────────────────────────────────────────────
 *   consommé  = dépenses ENGAGÉES (statut COMMITTED + SPENT)  +  dépense publicitaire officielle
 *   restant   = budget annuel − consommé
 *   taux      = consommé ÷ budget annuel        (null s'il n'y a pas de budget : pas 0 %)
 *
 * ── Traitement de chaque cas ────────────────────────────────────────────────
 *  · `marketing_expenses` **COMMITTED** : comptée. Un engagement pris est un budget parti.
 *  · `marketing_expenses` **SPENT** : comptée (et incluse dans COMMITTED, jamais deux fois).
 *  · `marketing_expenses` **PLANNED** : PAS comptée dans le consommé. Exposée à part
 *    (`planned`) : c'est un projet, pas un engagement.
 *  · **Dépenses Ads** : la régie (`ad_metrics`) est la source officielle dès qu'elle a une
 *    journée close sur le périmètre (voir `src/lib/ad-spend.ts`). Dans ce cas les dépenses
 *    média saisies à la main (catégories META / TIKTOK / GOOGLE / DIGITAL) sont **retirées**
 *    du consommé pour ne pas compter deux fois la même campagne ; leur montant reste visible
 *    dans `manualAdIgnored`. Sans donnée de régie, ce sont elles qui font foi.
 *  · **Autres dépenses** (influence, trade, événement, création…) : comptées telles quelles.
 *  · **Échantillons médicaux** remis en visite (`sample_movements` SORTIE_VISITE) : valorisés au
 *    prix d'achat, sinon au prix COMANET, et comptés dans le consommé de la marque du produit
 *    (`samplesValue`). Une unité sans prix n'est pas estimée : elle n'entre pas dans le total.
 *  · **Dépenses annulées / remboursées** : le modèle ne connaît que PLANNED / COMMITTED /
 *    SPENT. Une annulation se traduit aujourd'hui par la suppression de la ligne ou par un
 *    montant négatif, qui est alors compté tel quel (il diminue le consommé). Aucun statut
 *    n'est inventé ici.
 *  · **Dépense sans marque** : impossible — `marketing_expenses.brand_id` est NOT NULL.
 *  · **Dépense sans campagne** : comptée. Le rattachement à une campagne est facultatif et
 *    n'a jamais conditionné la consommation du budget.
 *  · **Dépense hors période** : exclue, filtrage sur l'année civile de `date`.
 *  · **Dépense sans budget associé** : comptée dans le consommé ; `hasBudget = false`,
 *    `consumedPct = null`, `remaining = null`. On ne divise pas par zéro et on n'affiche
 *    pas « 0 % » là où la réponse est « pas de budget défini ».
 *  · **Budget négatif** : traité comme absent (`hasBudget = false`) — un budget négatif n'a
 *    pas de sens et produirait un pourcentage inversé.
 *
 * ── Conventions ─────────────────────────────────────────────────────────────
 *  · Devise : MAD partout. Aucune conversion à ce niveau.
 *  · Période : l'année civile (`extract(year from date)`), en date civile, sans fuseau.
 *  · Arrondi : aucun ici. Les pourcentages sont arrondis à l'affichage uniquement.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { pgArray } from "@/lib/sql-array";
import { AD_EXPENSE_CATEGORIES, AD_SPEND_SOURCE_LABEL, type AdSpendSource } from "./ad-spend";

export type BudgetConsumption = {
  /** `null` = tous périmètres confondus. */
  brandId: string | null;
  hasBudget: boolean;
  annual: number;
  /** Dépenses au statut PLANNED — hors consommé. */
  planned: number;
  /** COMMITTED + SPENT, hors média saisi quand la régie fait foi. */
  committed: number;
  /** SPENT seul, même exclusion. */
  spent: number;
  /** Dépense publicitaire retenue, selon la règle de priorité de `ad-spend.ts`. */
  adSpend: number;
  adSource: AdSpendSource;
  /** Média saisi à la main mais écarté du total parce que la régie fait foi. */
  manualAdIgnored: number;
  /** Échantillons médicaux remis en visite, valorisés (voir `src/lib/medical/samples.ts`). */
  samplesValue: number;
  consumed: number;
  remaining: number | null;
  consumedPct: number | null;
};

function empty(brandId: string | null): BudgetConsumption {
  return {
    brandId, hasBudget: false, annual: 0, planned: 0, committed: 0, spent: 0,
    adSpend: 0, adSource: "AUCUNE", manualAdIgnored: 0, samplesValue: 0,
    consumed: 0, remaining: null, consumedPct: null,
  };
}

type Raw = {
  brand_id: string;
  annual: number;
  planned: number;
  committed_all: number;
  spent_all: number;
  manual_ad_committed: number;
  manual_ad_spent: number;
  regie_spend: number;
  regie_rows: number;
  samples_value: number;
};

/** Une seule requête : budgets, dépenses par statut, média saisi, et régie — groupés par marque. */
async function rawByBrand(year: number, brandId?: string | null): Promise<Raw[]> {
  const only = brandId ? sql` and b.id = ${brandId}::uuid` : sql``;
  const adCats = sql.join(AD_EXPENSE_CATEGORIES.map((c) => sql`${c}`), sql`, `);
  const r = await db.execute(sql`
    with bud as (
      select brand_id, coalesce(sum(amount), 0)::float8 as annual from budgets where year = ${year} group by brand_id
    ),
    exp as (
      select brand_id,
        coalesce(sum(amount) filter (where status = 'PLANNED'), 0)::float8 as planned,
        coalesce(sum(amount) filter (where status in ('COMMITTED','SPENT')), 0)::float8 as committed_all,
        coalesce(sum(amount) filter (where status = 'SPENT'), 0)::float8 as spent_all,
        coalesce(sum(amount) filter (where status in ('COMMITTED','SPENT') and category in (${adCats})), 0)::float8 as manual_ad_committed,
        coalesce(sum(amount) filter (where status = 'SPENT' and category in (${adCats})), 0)::float8 as manual_ad_spent
      from marketing_expenses where extract(year from date) = ${year} group by brand_id
    ),
    samples as (
      select p.brand_id,
        coalesce(sum(case when coalesce(p.cost_price, p.price_wholesale) is not null then -sm.quantity * coalesce(p.cost_price, p.price_wholesale) else 0 end), 0)::float8 as samples_value
      from sample_movements sm join products p on p.id = sm.product_id
      where sm.type = 'SORTIE_VISITE' and extract(year from sm.date) = ${year} and p.brand_id is not null
      group by p.brand_id
    ),
    regie as (
      select brand_id,
        coalesce(sum(spend), 0)::float8 as regie_spend,
        count(*)::int as regie_rows
      from ad_metrics
      where extract(year from date) = ${year} and is_partial = false and brand_id is not null
      group by brand_id
    )
    select b.id as brand_id,
      coalesce(bud.annual, 0) as annual,
      coalesce(exp.planned, 0) as planned,
      coalesce(exp.committed_all, 0) as committed_all,
      coalesce(exp.spent_all, 0) as spent_all,
      coalesce(exp.manual_ad_committed, 0) as manual_ad_committed,
      coalesce(exp.manual_ad_spent, 0) as manual_ad_spent,
      coalesce(regie.regie_spend, 0) as regie_spend,
      coalesce(regie.regie_rows, 0) as regie_rows,
      coalesce(samples.samples_value, 0) as samples_value
    from brands b
    left join bud on bud.brand_id = b.id
    left join exp on exp.brand_id = b.id
    left join regie on regie.brand_id = b.id
    left join samples on samples.brand_id = b.id
    where true ${only}`);
  return r.rows as Raw[];
}

/** Applique la définition officielle à une ligne brute. */
export function foldConsumption(brandId: string | null, raw: {
  annual: number; planned: number; committedAll: number; spentAll: number;
  manualAdCommitted: number; manualAdSpent: number; regieSpend: number; regieRows: number;
  /** Échantillons médicaux valorisés ; absent = 0 (compatibilité des appels existants). */
  samplesValue?: number;
}): BudgetConsumption {
  const regieOfficial = raw.regieRows > 0;
  const committed = raw.committedAll - (regieOfficial ? raw.manualAdCommitted : 0);
  const spent = raw.spentAll - (regieOfficial ? raw.manualAdSpent : 0);
  const adSpend = regieOfficial ? raw.regieSpend : raw.manualAdCommitted;
  const adSource: AdSpendSource = regieOfficial ? "REGIE" : raw.manualAdCommitted !== 0 ? "SAISIE" : "AUCUNE";
  // Sans régie, le média saisi est déjà dans `committed` : ne pas l'ajouter une seconde fois.
  const samplesValue = raw.samplesValue ?? 0;
  const consumed = (regieOfficial ? committed + adSpend : committed) + samplesValue;
  const hasBudget = raw.annual > 0;
  return {
    brandId, hasBudget, annual: raw.annual, planned: raw.planned, committed, spent,
    adSpend, adSource, manualAdIgnored: regieOfficial ? raw.manualAdCommitted : 0, samplesValue,
    consumed,
    remaining: hasBudget ? raw.annual - consumed : null,
    consumedPct: hasBudget ? (consumed / raw.annual) * 100 : null,
  };
}

function fold(brandId: string | null, r: Raw): BudgetConsumption {
  return foldConsumption(brandId, {
    annual: Number(r.annual), planned: Number(r.planned),
    committedAll: Number(r.committed_all), spentAll: Number(r.spent_all),
    manualAdCommitted: Number(r.manual_ad_committed), manualAdSpent: Number(r.manual_ad_spent),
    regieSpend: Number(r.regie_spend), regieRows: Number(r.regie_rows), samplesValue: Number(r.samples_value),
  });
}

/** Consommation par marque pour une année. Clé = `brands.id`. */
export async function budgetConsumptionByBrand(year: number): Promise<Map<string, BudgetConsumption>> {
  const rows = await rawByBrand(year);
  return new Map(rows.map((r) => [r.brand_id, fold(r.brand_id, r)]));
}

/**
 * Consommation d'une marque, ou de toutes marques confondues quand `brandId` est absent.
 * Le total « toutes marques » est la somme marque par marque : la règle de priorité
 * régie / saisie s'applique par marque, pas globalement.
 */
export async function budgetConsumption(year: number, brandId?: string | null): Promise<BudgetConsumption> {
  const rows = await rawByBrand(year, brandId);
  if (rows.length === 0) return empty(brandId ?? null);
  if (brandId) return fold(brandId, rows[0]);

  const parts = rows.map((r) => fold(r.brand_id, r));
  const sum = (pick: (c: BudgetConsumption) => number) => parts.reduce((a, c) => a + pick(c), 0);
  const annual = sum((c) => c.annual);
  const consumed = sum((c) => c.consumed);
  const hasBudget = annual > 0;
  const sources = new Set(parts.filter((p) => p.adSource !== "AUCUNE").map((p) => p.adSource));
  return {
    brandId: null, hasBudget, annual,
    planned: sum((c) => c.planned), committed: sum((c) => c.committed), spent: sum((c) => c.spent),
    adSpend: sum((c) => c.adSpend),
    adSource: sources.size === 1 ? [...sources][0] : sources.size === 0 ? "AUCUNE" : "REGIE",
    manualAdIgnored: sum((c) => c.manualAdIgnored),
    samplesValue: sum((c) => c.samplesValue),
    consumed,
    remaining: hasBudget ? annual - consumed : null,
    consumedPct: hasBudget ? (consumed / annual) * 100 : null,
  };
}

export { AD_SPEND_SOURCE_LABEL };

/* --------------------------- Répartition par catégorie --------------------------- */

export type BudgetCategoryRow = { category: string; planned: number; committed: number; spent: number };

/**
 * Enveloppe (`budget_lines`) et dépenses (`marketing_expenses`) par catégorie sur l'année, dans un périmètre
 * de marques. Même lecture des statuts que `foldConsumption` : engagé = COMMITTED + SPENT, dépensé = SPENT.
 * Sert au copilote IA (`get_marketing_budget`) ; la dépense de régie n'est pas ventilée ici, elle reste
 * portée par `budgetConsumption()` (règle de priorité régie / saisie par marque).
 */
export async function budgetByCategory(year: number, brandId?: string | null, brandIds?: string[] | null): Promise<BudgetCategoryRow[]> {
  const scope = brandId ? sql`and brand_id = ${brandId}::uuid` : brandIds ? sql`and brand_id = any(${pgArray(brandIds)})` : sql``;
  const r = await db.execute(sql`
    with lines as (
      select category::text as category, sum(amount)::float8 as planned from budget_lines where year = ${year} ${scope} group by 1
    ), exp as (
      select category::text as category,
        coalesce(sum(amount) filter (where status in ('COMMITTED','SPENT')), 0)::float8 as committed,
        coalesce(sum(amount) filter (where status = 'SPENT'), 0)::float8 as spent
      from marketing_expenses where extract(year from date) = ${year} ${scope} group by 1
    )
    select coalesce(l.category, e.category) as category, coalesce(l.planned, 0) as planned, coalesce(e.committed, 0) as committed, coalesce(e.spent, 0) as spent
    from lines l full outer join exp e on e.category = l.category
    order by coalesce(l.planned, 0) desc, coalesce(e.committed, 0) desc`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({ category: String(x.category), planned: Number(x.planned), committed: Number(x.committed), spent: Number(x.spent) }));
}
