/**
 * Rafraîchissement de la couche de faits — logique PURE (testée sans base).
 *
 * Tout ce qui décide d'un montant ou d'une quote-part vit ici :
 *  - répartition d'une dépense entre plusieurs produits (prorata des ventes ou parts égales) ;
 *  - lecture d'un statut de dépense en prévu / engagé / dépensé (même convention que `budget.ts` :
 *    dépensé ⊂ engagé ⊂ prévu) ;
 *  - coût d'une animation (saisi, sinon tarif journalier, sinon NON MESURABLE — jamais 0).
 */

export type ShareBasis = "PRORATA_SALES" | "EQUAL" | "DECLARED" | "NONE";
export type Split = { productId: string | null; share: number; basis: ShareBasis };

/**
 * Répartit une ligne entre des produits candidats.
 *  - aucun candidat → une seule part à 100 % sans produit (la dépense compte au niveau marque) ;
 *  - un candidat → 100 % sur lui ;
 *  - plusieurs : au prorata des poids (ventes récentes) si au moins un poids est > 0, sinon à parts égales.
 * Les parts somment à 1 (la dernière absorbe l'arrondi).
 */
export function splitShares(candidates: { productId: string; weight: number }[], mode: "PRORATA_SALES" | "EQUAL"): Split[] {
  const uniq = [...new Map(candidates.map((c) => [c.productId, c])).values()];
  if (!uniq.length) return [{ productId: null, share: 1, basis: "NONE" }];
  if (uniq.length === 1) return [{ productId: uniq[0].productId, share: 1, basis: "DECLARED" }];
  const total = uniq.reduce((s, c) => s + Math.max(0, c.weight || 0), 0);
  const prorata = mode === "PRORATA_SALES" && total > 0;
  const basis: ShareBasis = prorata ? "PRORATA_SALES" : "EQUAL";
  const raw = uniq.map((c) => (prorata ? Math.max(0, c.weight || 0) / total : 1 / uniq.length));
  const rounded = raw.map((r) => Math.round(r * 1e6) / 1e6);
  const drift = 1 - rounded.reduce((s, r) => s + r, 0);
  rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + drift) * 1e6) / 1e6;
  return uniq.map((c, i) => ({ productId: c.productId, share: rounded[i], basis }));
}

export type Amounts = { planned: number | null; committed: number | null; spent: number | null };

/** Statut d'une `marketing_expenses` → prévu / engagé / dépensé. SPENT est inclus dans COMMITTED, jamais compté deux fois. */
export function expenseAmounts(status: string, amount: number): Amounts {
  if (status === "SPENT") return { planned: amount, committed: amount, spent: amount };
  if (status === "COMMITTED") return { planned: amount, committed: amount, spent: null };
  return { planned: amount, committed: null, spent: null };
}

/**
 * Statut d'une collaboration influence → montants. Cachet + valeur produit remise.
 * Publié / analysé / terminé : dépensé. Confirmée ou contenu reçu : engagé. Avant : prévu.
 */
export function collaborationAmounts(status: string, fee: number, productValue: number): Amounts {
  const total = (fee || 0) + (productValue || 0);
  if (["PUBLIE", "ANALYSE", "TERMINE"].includes(status)) return { planned: total, committed: total, spent: total };
  if (["CONFIRMEE", "CONTENU_RECU"].includes(status)) return { planned: total, committed: total, spent: null };
  return { planned: total, committed: null, spent: null };
}

/** Budget d'un contenu éditorial : prévu tant qu'il n'est pas publié, dépensé ensuite. Sans budget : rien. */
export function contentAmounts(budget: number | null, published: boolean): Amounts {
  if (budget === null || budget === undefined || !Number.isFinite(budget)) return { planned: null, committed: null, spent: null };
  return published ? { planned: budget, committed: budget, spent: budget } : { planned: budget, committed: null, spent: null };
}

/**
 * Coût d'une animation : le coût saisi s'il est > 0, sinon le tarif journalier de Paramètres × jours,
 * sinon NULL avec le motif — jamais 0, qui ferait croire à une animation gratuite.
 */
export function animationCost(cost: number | null, days: number, dayCost: number | null): { spent: number | null; reason: string | null } {
  if (cost !== null && cost > 0) return { spent: cost, reason: null };
  if (dayCost !== null && dayCost > 0) return { spent: dayCost * Math.max(1, days || 1), reason: "TARIF_JOURNALIER" };
  return { spent: null, reason: "COUT_NON_MESURE" };
}

/** Valeur d'un échantillon remis : prix d'achat, sinon prix COMANET, sinon non mesurable. */
export function sampleValue(units: number, costPrice: number | null, wholesale: number | null): { spent: number | null; reason: string | null } {
  const unit = costPrice ?? wholesale;
  if (unit === null || !(units > 0)) return { spent: null, reason: "PRIX_INCONNU" };
  return { spent: Math.round(units * unit * 100) / 100, reason: costPrice === null ? "PRIX_COMANET" : null };
}

/** Applique une quote-part à des montants (null reste null). */
export function applyShare(a: Amounts, share: number): Amounts {
  const f = (v: number | null) => (v === null ? null : Math.round(v * share * 100) / 100);
  return { planned: f(a.planned), committed: f(a.committed), spent: f(a.spent) };
}

/**
 * Régie prioritaire : sur un mois où la régie a au moins une journée close pour la marque, une
 * dépense média saisie à la main (META / TIKTOK / GOOGLE / DIGITAL) décrirait la même campagne
 * une seconde fois. Elle est conservée à titre de trace, sans montant.
 * Même règle que `src/lib/ad-spend.ts`, appliquée à la maille marque × mois.
 */
export function regieOverrides(category: string, brandMonthHasRegie: boolean, adCategories: readonly string[]): boolean {
  return brandMonthHasRegie && adCategories.includes(category);
}
