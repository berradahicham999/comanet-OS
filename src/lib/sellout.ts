/**
 * CA SELL-OUT — définition officielle et unique.
 *
 * Le sell-out est ce que le consommateur final paie en rayon pendant une animation.
 * Il est donc **TTC, au prix public (PPV)**, en MAD, et n'a rien à voir avec le prix
 * COMANET → point de vente (PPH), qui relève du sell-in.
 *
 * ── Source du montant, par ordre de priorité ────────────────────────────────
 *  1. `animation_lines.amount`      — montant porté par la ligne (fichier d'animation).
 *  2. `quantity_sold × animation_lines.unit_price` — prix unitaire porté par la ligne.
 *  3. `quantity_sold × products.price_retail`      — prix public du référentiel produit.
 *  4. **Non mesurable** → `null`. Jamais 0 : une valeur inconnue n'est pas une vente nulle.
 *
 * ── Règles ──────────────────────────────────────────────────────────────────
 *  · Devise : MAD. Aucune conversion (le terrain encaisse en dirhams).
 *  · Arrondi : 2 décimales, à l'écriture comme à la lecture (`SELLOUT_SCALE`).
 *  · Quantité absente ou nulle → montant 0 (une ligne à 0 unité vaut 0 MAD, ce n'est pas
 *    une donnée manquante). Quantité négative : refusée à l'écriture (voir `parseQuantity`).
 *  · Prix négatif ou nul : refusé — un prix public de 0 n'existe pas, c'est une donnée absente.
 *  · Pas d'avoirs ni de remboursements sur le sell-out terrain : `animation_lines` ne porte
 *    que des ventes constatées. Si cela change, ce fichier est le seul endroit à modifier.
 *  · Données historiques : les lignes déjà chargées portent `amount` (import) ou `null`
 *    (saisies manuelles antérieures au 7 septembre 2026). La priorité 3 les rattrape à la
 *    lecture sans réécrire quoi que ce soit ; aucune donnée n'est modifiée rétroactivement.
 *
 * ── Portée ──────────────────────────────────────────────────────────────────
 *  Toute agrégation de CA sell-out — par animation, période, marque, produit, ville,
 *  animatrice, ou dans une règle de l'Action Center — passe par `selloutAmountSql()`
 *  côté SQL ou par `lineSellout()` côté TypeScript. Aucune autre formule n'est admise.
 */
import { sql, type SQL } from "drizzle-orm";

/** Nombre de décimales conservées sur un montant de sell-out. */
export const SELLOUT_SCALE = 2;

/** Devise du sell-out terrain. Les prix publics COMANET sont en dirhams. */
export const SELLOUT_CURRENCY = "MAD";

export function roundAmount(v: number): number {
  const f = 10 ** SELLOUT_SCALE;
  return Math.round(v * f) / f;
}

/** Un nombre exploitable, ou `null`. Ni NaN, ni Infinity, ni chaîne vide. */
export function toFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Prix unitaire public retenu pour une ligne, selon la priorité officielle.
 * Un prix ≤ 0 est traité comme absent : il n'est jamais retenu.
 */
export function resolveUnitPrice(input: {
  unitPrice?: unknown;
  productPriceRetail?: unknown;
}): { price: number | null; source: "LIGNE" | "PRODUIT" | "AUCUN" } {
  const line = toFiniteNumber(input.unitPrice);
  if (line !== null && line > 0) return { price: roundAmount(line), source: "LIGNE" };
  const product = toFiniteNumber(input.productPriceRetail);
  if (product !== null && product > 0) return { price: roundAmount(product), source: "PRODUIT" };
  return { price: null, source: "AUCUN" };
}

export type SelloutLine = {
  quantitySold: unknown;
  /** Montant déjà porté par la ligne (priorité 1). */
  amount?: unknown;
  /** Prix unitaire porté par la ligne (priorité 2). */
  unitPrice?: unknown;
  /** Prix public du référentiel produit (priorité 3). */
  productPriceRetail?: unknown;
};

export type SelloutResult = {
  /** Montant TTC en MAD, ou `null` quand aucun prix fiable n'est disponible. */
  amount: number | null;
  /** Prix unitaire retenu, ou `null`. */
  unitPrice: number | null;
  /** D'où vient le montant — sert aux messages d'erreur et à l'audit. */
  source: "MONTANT_LIGNE" | "PRIX_LIGNE" | "PRIX_PRODUIT" | "NON_MESURABLE";
};

/** Valorisation officielle d'une ligne de sell-out. Ne renvoie jamais 0 pour « inconnu ». */
export function lineSellout(line: SelloutLine): SelloutResult {
  const qty = toFiniteNumber(line.quantitySold);
  const amount = toFiniteNumber(line.amount);
  const { price, source: priceSource } = resolveUnitPrice(line);

  if (amount !== null) {
    return {
      amount: roundAmount(amount),
      unitPrice: price ?? (qty && qty !== 0 ? roundAmount(amount / qty) : null),
      source: "MONTANT_LIGNE",
    };
  }
  if (qty === null) return { amount: null, unitPrice: price, source: "NON_MESURABLE" };
  if (qty === 0) return { amount: 0, unitPrice: price, source: price === null ? "NON_MESURABLE" : priceSource === "LIGNE" ? "PRIX_LIGNE" : "PRIX_PRODUIT" };
  if (price === null) return { amount: null, unitPrice: null, source: "NON_MESURABLE" };
  return {
    amount: roundAmount(qty * price),
    unitPrice: price,
    source: priceSource === "LIGNE" ? "PRIX_LIGNE" : "PRIX_PRODUIT",
  };
}

/**
 * Cohérence d'un montant saisi avec sa quantité et son prix.
 * Tolérance d'un centime par unité, pour absorber les arrondis du classeur.
 */
export function amountMatchesQuantity(amount: number, quantity: number, unitPrice: number): boolean {
  const expected = quantity * unitPrice;
  return Math.abs(amount - expected) <= Math.max(0.01, Math.abs(quantity) * 0.01);
}

/**
 * Fragment SQL de la valorisation officielle, à utiliser dans toute agrégation.
 *
 * @param lines alias de `animation_lines` dans la requête (ex. `al`)
 * @param products alias de `products` — la jointure est OBLIGATOIRE pour la priorité 3
 *
 * Renvoie `null` quand aucun prix n'est connu : une somme SQL ignore alors la ligne
 * (`sum()` ignore les `null`) au lieu de la compter pour zéro.
 */
export function selloutAmountSql(lines = "al", products = "p"): SQL {
  const al = sql.raw(lines);
  const p = sql.raw(products);
  return sql`coalesce(${al}.amount, ${al}.quantity_sold * ${al}.unit_price, ${al}.quantity_sold * ${p}.price_retail)`;
}

/** Somme du sell-out sur un ensemble de lignes, en MAD TTC. `coalesce(..., 0)` au total seulement. */
export function selloutSumSql(lines = "al", products = "p"): SQL {
  return sql`coalesce(sum(${selloutAmountSql(lines, products)}), 0)::float8`;
}
