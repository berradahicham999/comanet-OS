import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { addDays, iso, today } from "@/lib/format";
import { rankUsualProducts, type ProductFrequencyRow, type UsualProduct } from "./usual-products-rank";

export { rankUsualProducts, type ProductFrequencyRow, type UsualProduct };

/**
 * « SES PRODUITS » — ce qu'une animatrice voit d'abord en arrivant sur l'écran de saisie.
 *
 * Constat qui motive ce module (mesuré sur le fichier de centralisation, 1 381 journées) :
 * une animatrice vend entre 3 et 28 produits par journée (médiane 8), en piochant dans un
 * référentiel de 157 produits actifs — dont 80 seulement ont réellement été animés en un an,
 * et dont le top 15 d'une animatrice couvre 63 à 88 % de ses lignes selon son profil. Le
 * sélecteur alphabétique de `AnimationForm` fait défiler les 157 à chaque ligne ; ce module
 * remplace le défilement par une liste courte et personnelle.
 *
 * Aucune nouvelle définition de sell-out ni de score : ces fonctions ne lisent que la
 * fréquence et la récence, elles ne calculent ni CA ni couverture.
 */

/**
 * Les produits qu'une animatrice a le plus vendus sur les `windowDays` derniers jours,
 * classés par fréquence puis récence. Fenêtre glissante sur AUJOURD'HUI (donnée
 * opérationnelle, comme le reste du terrain) — pas sur la date de référence des ventes.
 */
export async function usualProductsForAnimatrice(animatriceId: string, opts: { windowDays?: number; limit?: number } = {}): Promise<UsualProduct[]> {
  const windowDays = opts.windowDays ?? 90;
  const limit = opts.limit ?? 20;
  const start = iso(addDays(today(), -windowDays));

  const r = await db.execute(sql`
    select p.id::text as id, p.name, p.brand_id::text as brand_id, b.name as brand_name,
           count(*)::int as count, max(a.date)::text as last_date
    from animation_lines al
    join animations a on a.id = al.animation_id
    join products p on p.id = al.product_id
    left join brands b on b.id = p.brand_id
    where a.animatrice_id = ${animatriceId}::uuid and a.status = 'DONE'
      and a.date >= ${start}::date and al.quantity_sold > 0 and p.active
    group by p.id, p.name, p.brand_id, b.name`);

  const rows = (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), name: String(x.name),
    brandId: x.brand_id ? String(x.brand_id) : null, brandName: x.brand_name ? String(x.brand_name) : null,
    count: Number(x.count), lastDate: String(x.last_date),
  }));
  return rankUsualProducts(rows, limit);
}

/**
 * Catalogue restreint aux produits RÉELLEMENT animés (toutes animatrices, 12 derniers mois),
 * pour la recherche « Ajouter un produit ». Remplace le référentiel complet (157 produits
 * actifs, dont la moitié n'a jamais été animée) par ce qui sert vraiment sur le terrain.
 */
export async function animatedProductCatalog(): Promise<UsualProduct[]> {
  const r = await db.execute(sql`
    select distinct p.id::text as id, p.name, p.brand_id::text as brand_id, b.name as brand_name
    from animation_lines al
    join animations a on a.id = al.animation_id
    join products p on p.id = al.product_id
    left join brands b on b.id = p.brand_id
    where a.date >= current_date - interval '365 days' and p.active
    order by p.name`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), name: String(x.name),
    brandId: x.brand_id ? String(x.brand_id) : null, brandName: x.brand_name ? String(x.brand_name) : null,
  }));
}

export type LastClient = { id: string; name: string; city: string | null };

/** Le point de vente de la dernière animation de cette animatrice — pré-remplissage du POS. */
export async function lastClientForAnimatrice(animatriceId: string): Promise<LastClient | null> {
  const r = await db.execute(sql`
    select c.id::text as id, c.name, c.city
    from animations a join clients c on c.id = a.client_id
    where a.animatrice_id = ${animatriceId}::uuid
    order by a.date desc, a.created_at desc limit 1`);
  const row = r.rows[0] as { id: string; name: string; city: string | null } | undefined;
  return row ? { id: row.id, name: row.name, city: row.city } : null;
}

/**
 * Adoption de la saisie mobile : saisie vs import, par semaine, pour une animatrice ou pour
 * toute l'équipe. Coût nul depuis `animations.source` (Phase 1, protection de la bascule) —
 * pas de nouvelle colonne, pas de nouveau calcul.
 */
export type AdoptionWeek = { weekStart: string; saisie: number; import_: number };

export async function adoptionByWeek(opts: { animatriceId?: string; weeks?: number } = {}): Promise<AdoptionWeek[]> {
  const weeks = opts.weeks ?? 8;
  const start = iso(addDays(today(), -7 * weeks));
  const r = await db.execute(sql`
    select date_trunc('week', a.date)::date::text as week_start,
           count(*) filter (where a.source = 'saisie')::int as saisie,
           count(*) filter (where a.source = 'import')::int as import_
    from animations a
    where a.date >= ${start}::date ${opts.animatriceId ? sql`and a.animatrice_id = ${opts.animatriceId}::uuid` : sql``}
    group by 1 order by 1`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    weekStart: String(x.week_start), saisie: Number(x.saisie), import_: Number(x.import_),
  }));
}

/** Par animatrice : part de ses journées venues de la saisie directe, sur `windowDays`. */
export type AdoptionByAnimatrice = { animatriceId: string; name: string; saisie: number; import_: number; pct: number | null };

export async function adoptionByAnimatrice(windowDays = 28): Promise<AdoptionByAnimatrice[]> {
  const start = iso(addDays(today(), -windowDays));
  const r = await db.execute(sql`
    select u.id::text as id, u.name,
           count(a.id) filter (where a.source = 'saisie')::int as saisie,
           count(a.id) filter (where a.source = 'import')::int as import_
    from users u
    left join animations a on a.animatrice_id = u.id and a.date >= ${start}::date
    where u.role = 'ANIMATRICE' and u.active
    group by u.id, u.name order by u.name`);
  return (r.rows as Record<string, unknown>[]).map((x) => {
    const saisie = Number(x.saisie), import_ = Number(x.import_);
    const total = saisie + import_;
    return { animatriceId: String(x.id), name: String(x.name), saisie, import_, pct: total > 0 ? (saisie / total) * 100 : null };
  });
}
