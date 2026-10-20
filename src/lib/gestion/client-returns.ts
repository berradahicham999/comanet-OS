import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Ce que l'éditeur d'un avoir libre propose pour un client (lecture seule) :
 * - le dernier prix et la dernière remise de chaque produit sur ses BL et factures validés (simulation comprise) ;
 * - les lots qui lui ont été livrés, pour désigner le lot rendu (une saisie libre reste possible).
 * Sans pièce validée pour un produit, l'éditeur repart du PPH HT moins la remise du client, comme un BL.
 */
export type ClientLastPrice = { unitPriceHt: string; discountPct: string; number: string | null; date: string };
export type ClientDeliveredLot = { lotNumber: string; expiryDate: string | null; lastDate: string };
export type ClientReturnContext = { lastPrices: Record<string, ClientLastPrice>; lots: Record<string, ClientDeliveredLot[]> };

export async function clientReturnContext(clientId: string): Promise<ClientReturnContext> {
  const [prices, lots] = await Promise.all([
    db.execute<{ product_id: string; unit_price_ht: string; discount_pct: string; number: string | null; date: string }>(sql`
      select distinct on (l.product_id) l.product_id, l.unit_price_ht::text, l.discount_pct::text, d.number, d.date::text as date
      from sales_document_lines l join sales_documents d on d.id = l.document_id
      where d.client_id = ${clientId}::uuid and d.type in ('BL', 'FACTURE') and d.status not in ('BROUILLON', 'ANNULE')
        and l.product_id is not null and l.unit_price_ht > 0
      order by l.product_id, d.date desc, d.validated_at desc nulls last`),
    db.execute<{ product_id: string; lot: string; expiry: string | null; last_date: string }>(sql`
      select l.product_id, a->>'lotNumber' as lot, a->>'expiryDate' as expiry, max(d.date)::text as last_date
      from sales_document_lines l join sales_documents d on d.id = l.document_id cross join lateral jsonb_array_elements(l.lot_allocations) a
      where d.client_id = ${clientId}::uuid and d.type = 'BL' and d.status not in ('BROUILLON', 'ANNULE') and l.product_id is not null and a->>'lotNumber' is not null
      group by 1, 2, 3 order by max(d.date) desc`),
  ]);
  const lastPrices: Record<string, ClientLastPrice> = {};
  for (const r of prices.rows) lastPrices[r.product_id] = { unitPriceHt: r.unit_price_ht, discountPct: r.discount_pct, number: r.number, date: r.date };
  const byProduct: Record<string, ClientDeliveredLot[]> = {};
  for (const r of lots.rows) (byProduct[r.product_id] ??= []).push({ lotNumber: r.lot, expiryDate: r.expiry, lastDate: r.last_date });
  return { lastPrices, lots: byProduct };
}
