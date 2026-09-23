import { sql } from "drizzle-orm";
import { db } from "@/db";
import { selloutSumSql } from "./sellout";

/*
 * `animatricePerformance()` a été supprimée le 7/09/2026.
 *
 * C'était un SECOND moteur de score animatrice (CA 40 % · productivité 25 % · progression
 * 15 % · qualité du reporting 20 %), valorisant le sell-out au prix COMANET (PPH) alors que
 * le moteur vivant le valorise au prix public (TTC). Elle n'était importée par aucun fichier
 * — vérifié sur les imports statiques, les server actions, les routes, les pages, les tests
 * et les exports publics : aucune référence hors de sa propre définition.
 *
 * La seule source de vérité du score animatrice est `animatriceScores()` dans
 * `src/lib/animations.ts` ; sa documentation figure en tête de cette fonction.
 */

/**
 * Impact d'une animation : sell-in du client sur la marque 30 j avant / après, et sell-out du jour.
 *
 * Deux valorisations, volontairement distinctes et étiquetées comme telles à l'écran :
 *  · `during_revenue` — valorisation au prix COMANET → point de vente (PPH). C'est le chiffre
 *    d'affaires que COMANET facturerait pour ces unités ; il sert au ROI de l'animation.
 *  · `during_retail`  — CA SELL-OUT officiel, TTC au prix public, calculé par
 *    `selloutSumSql()` (voir `src/lib/sellout.ts`). C'est le seul chiffre qui doit être
 *    appelé « sell-out ». L'ancienne formule inventait un prix public à partir du prix
 *    COMANET × 1,6 quand il manquait : ce coefficient a été retiré, une valeur inconnue
 *    n'est plus remplacée par une valeur fabriquée.
 */
export async function animationImpact(animationId: string) {
  const r = await db.execute(sql`
    with a as (select * from animations where id = ${animationId}::uuid)
    select
      (select coalesce(sum(s.quantity),0)::float8 from sales s join products p on p.id = s.product_id, a where s.client_id = a.client_id and (a.brand_id is null or p.brand_id = a.brand_id) and s.date >= coalesce(a.start_date, a.date) - 30 and s.date < coalesce(a.start_date, a.date)) as before_qty,
      (select coalesce(sum(s.quantity),0)::float8 from sales s join products p on p.id = s.product_id, a where s.client_id = a.client_id and (a.brand_id is null or p.brand_id = a.brand_id) and s.date > a.date and s.date <= a.date + 30) as after_qty,
      (select coalesce(sum(s.amount),0)::float8 from sales s join products p on p.id = s.product_id, a where s.client_id = a.client_id and (a.brand_id is null or p.brand_id = a.brand_id) and s.date >= coalesce(a.start_date, a.date) - 30 and s.date < coalesce(a.start_date, a.date)) as before_amount,
      (select coalesce(sum(s.amount),0)::float8 from sales s join products p on p.id = s.product_id, a where s.client_id = a.client_id and (a.brand_id is null or p.brand_id = a.brand_id) and s.date > a.date and s.date <= a.date + 30) as after_amount,
      (select coalesce(sum(al.quantity_sold),0)::float8 from animation_lines al where al.animation_id = ${animationId}::uuid) as during_qty,
      (select coalesce(sum(al.quantity_sold * coalesce(p.price_wholesale,0)),0)::float8 from animation_lines al join products p on p.id = al.product_id where al.animation_id = ${animationId}::uuid) as during_revenue,
      (select ${selloutSumSql("al", "p")} from animation_lines al join products p on p.id = al.product_id where al.animation_id = ${animationId}::uuid) as during_retail`);
  return r.rows[0] as { before_qty: number; after_qty: number; before_amount: number; after_amount: number; during_qty: number; during_revenue: number; during_retail: number };
}
