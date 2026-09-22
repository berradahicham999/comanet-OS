import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { clientFilter } from "@/lib/access";
import { sortPointsOfSale, type PointOfSale } from "./points-of-sale-sort";

export { sortPointsOfSale, type PointOfSale };

/**
 * Points de vente proposés à la saisie terrain (saisie rapide, saisie complète, correction).
 * Source unique : les trois écrans utilisaient chacun `type <> 'GROSSISTE'`, ce qui cachait un
 * grossiste pourtant assigné à l'animatrice (ex. SABEM pour Meriem Ayoub) et faisait perdre le
 * point de vente à la correction d'une animation déjà saisie chez lui.
 *
 * Règle : clients actifs ; un grossiste n'apparaît que s'il est assigné à quelqu'un, s'il a déjà
 * une animation, ou s'il est dans `include` (animation en cours de correction). Les clients du
 * périmètre de la personne (assignés un à un ou par ville) passent en tête, marqués `mine`.
 */
export async function pointsOfSale(opts: { include?: string[] } = {}): Promise<PointOfSale[]> {
  const include = (opts.include ?? []).filter(Boolean);
  const [rows, scope] = await Promise.all([
    db.execute<{ id: string; name: string; city: string | null }>(sql`
      select c.id, c.name, c.city from clients c
      where (c.active and (c.type <> 'GROSSISTE'
          or exists (select 1 from user_client_assignments a where a.client_id = c.id)
          or exists (select 1 from animations an where an.client_id = c.id)))
        ${include.length ? sql`or c.id in (${sql.join(include.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``}
      order by c.name`),
    clientFilter(),
  ]);
  return sortPointsOfSale(rows.rows, scope);
}
