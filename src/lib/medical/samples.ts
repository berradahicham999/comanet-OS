import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSettings } from "@/lib/settings";
import { iso } from "@/lib/format";

export type SampleStockRow = {
  delegateId: string;
  delegateName: string;
  productId: string;
  productName: string;
  entries: number;
  distributed: number;
  current: number;
};

/** Stock d'échantillons courant par délégué × produit = somme des mouvements signés. */
export async function sampleStockByDelegate(delegateId?: string): Promise<SampleStockRow[]> {
  const r = await db.execute(sql`
    select u.id as delegate_id, u.name as delegate_name, p.id as product_id, p.name as product_name,
      coalesce(sum(case when sm.type = 'ENTREE' then sm.quantity else 0 end),0)::int as entries,
      coalesce(sum(case when sm.type = 'SORTIE_VISITE' then -sm.quantity else 0 end),0)::int as distributed,
      coalesce(sum(sm.quantity),0)::int as current
    from sample_movements sm
    join users u on u.id = sm.delegate_id
    join products p on p.id = sm.product_id
    where 1 = 1 ${delegateId ? sql`and sm.delegate_id = ${delegateId}::uuid` : sql``}
    group by u.id, u.name, p.id, p.name
    order by u.name, p.name`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    delegateId: String(x.delegate_id), delegateName: String(x.delegate_name),
    productId: String(x.product_id), productName: String(x.product_name),
    entries: Number(x.entries), distributed: Number(x.distributed), current: Number(x.current),
  }));
}

export type SampleForecastRow = {
  delegateId: string;
  delegateName: string;
  plannedVisits: number;
  samplesPerVisit: number;
  estimatedNeed: number;
  currentStock: number;
  deficit: number;
};

/** Besoin en échantillons = visites planifiées à venir × échantillons moyens/visite (réglage). */
export async function sampleForecast(ref: Date): Promise<SampleForecastRow[]> {
  const settings = await getSettings();
  const today = iso(ref);
  const [delegatesRes, stocks] = await Promise.all([
    db.execute(sql`
      select u.id, u.name,
        coalesce((select count(*) from doctor_visits v where v.delegate_id = u.id and v.status = 'PLANIFIEE' and v.date >= ${today}::date),0)::int as planned
      from users u where u.role = 'DELEGUE_MEDICAL' and u.active order by u.name`),
    sampleStockByDelegate(),
  ]);
  const stockTotals = new Map<string, number>();
  for (const s of stocks) stockTotals.set(s.delegateId, (stockTotals.get(s.delegateId) ?? 0) + s.current);
  return (delegatesRes.rows as Record<string, unknown>[]).map((x) => {
    const plannedVisits = Number(x.planned);
    const estimatedNeed = Math.round(plannedVisits * settings.medicalSamplesPerVisitDefault);
    const currentStock = stockTotals.get(String(x.id)) ?? 0;
    return {
      delegateId: String(x.id), delegateName: String(x.name), plannedVisits,
      samplesPerVisit: settings.medicalSamplesPerVisitDefault, estimatedNeed, currentStock,
      deficit: Math.max(0, estimatedNeed - currentStock),
    };
  });
}
