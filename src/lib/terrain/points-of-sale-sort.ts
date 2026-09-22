export type PointOfSale = { id: string; name: string; city: string | null; mine: boolean };

/** Les points de vente du périmètre de la personne d'abord, puis les autres ; ordre alphabétique dans chaque groupe. */
export function sortPointsOfSale(rows: { id: string; name: string; city: string | null }[], scope: string[] | null): PointOfSale[] {
  const mine = new Set(scope ?? []);
  return rows
    .map((r) => ({ ...r, mine: mine.has(r.id) }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name, "fr"));
}
