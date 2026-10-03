import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ORDER_KEY } from "@/lib/analytics";
import { addDays, iso, today } from "@/lib/format";

/**
 * Produits habituels d'un client, pour la saisie d'une commande sur le téléphone : ce qu'il a
 * commandé sur 12 mois (ventes Sage et pièces COMANET OS confondues), classé par nombre de
 * commandes, avec la quantité moyenne par commande en proposition. Lecture seule, sell-in.
 */
export type UsualClientProduct = { id: string; name: string; ref: string | null; brand: string | null; orders: number; avgQty: number; lastDate: string };

export async function usualProductsForClient(clientId: string, opts: { windowDays?: number; limit?: number } = {}): Promise<UsualClientProduct[]> {
  const start = iso(addDays(today(), -(opts.windowDays ?? 365)));
  const r = await db.execute<{ id: string; name: string; ref: string | null; brand: string | null; orders: number; avg_qty: string; last_date: string }>(sql`
    select p.id, p.name, coalesce(p.code, p.sku) as ref, b.name as brand,
      count(distinct ${ORDER_KEY})::int as orders,
      (sum(s.quantity) / nullif(count(distinct ${ORDER_KEY}), 0))::float8 as avg_qty,
      max(s.date)::text as last_date
    from sales s join products p on p.id = s.product_id left join brands b on b.id = p.brand_id
    where s.client_id = ${clientId}::uuid and s.date >= ${start}::date and s.quantity > 0 and p.active and p.kind = 'PRODUIT'
    group by p.id, p.name, p.code, p.sku, b.name
    order by orders desc, last_date desc limit ${opts.limit ?? 30}`);
  return r.rows.map((x) => ({ id: x.id, name: x.name, ref: x.ref, brand: x.brand, orders: Number(x.orders), avgQty: Math.max(1, Math.round(Number(x.avg_qty) || 1)), lastDate: x.last_date }));
}
