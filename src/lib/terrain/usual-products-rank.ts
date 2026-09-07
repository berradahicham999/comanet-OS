/**
 * Classement des « produits habituels » d'une animatrice — pur, sans base.
 *
 * Séparé du reste de `usual-products.ts` (qui importe `server-only`) pour rester testable
 * par le test runner Node, comme `stock-math.ts` l'est pour `stock.ts`.
 */

export type UsualProduct = { id: string; name: string; brandId: string | null; brandName: string | null };

/** Une ligne brute : un produit animé, sa fréquence sur la fenêtre, et sa dernière occurrence. */
export type ProductFrequencyRow = UsualProduct & { count: number; lastDate: string };

/** Fréquence décroissante, puis récence. */
export function rankUsualProducts(rows: ProductFrequencyRow[], limit: number): UsualProduct[] {
  return [...rows]
    .sort((a, b) => b.count - a.count || (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0))
    .slice(0, limit)
    .map(({ id, name, brandId, brandName }) => ({ id, name, brandId, brandName }));
}
