/**
 * Annulation d'un import.
 *
 * Seuls les imports « par ligne » sont annulables : chaque ligne créée porte l'identifiant
 * de son import, on sait donc exactement quoi retirer. Les imports qui mettent à jour le
 * référentiel (produits, clients, objectifs, budgets, dossiers réglementaires) écrasent des
 * valeurs existantes : les annuler ne restaurerait pas l'état d'avant, on ne le propose donc
 * pas plutôt que de donner une fausse sécurité.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { ImportType } from "./fields";

export type RollbackPlan = {
  /** Ce que l'annulation retirerait, prêt à afficher. */
  label: string;
  /** Nombre d'enregistrements concernés (0 = rien à retirer). */
  count: number;
  /** Détail secondaire (lignes de vente d'animation, par ex.). */
  detail?: string;
};

const REVERSIBLE: ImportType[] = ["SALES", "STOCK", "ANIMATIONS", "ADS"];

export function isReversible(type: string): boolean {
  return REVERSIBLE.includes(type as ImportType);
}

/** Pourquoi un import n'est pas annulable — message affiché à la place du bouton. */
export function irreversibleReason(type: string): string {
  switch (type) {
    case "PRODUCTS": return "Cet import met à jour le référentiel produits (désignations, prix, marques). Les fiches modifiées ne peuvent pas revenir à leur état précédent automatiquement : corrigez-les depuis la fiche produit.";
    case "CLIENTS": return "Cet import met à jour le référentiel clients. Les fiches modifiées ne peuvent pas revenir à leur état précédent automatiquement : corrigez-les depuis la fiche client.";
    case "OBJECTIVES": return "Les objectifs sont remplacés, pas ajoutés : recharger le bon fichier d'objectifs écrase simplement ceux-ci.";
    case "ANIM_OBJECTIVES": return "Les objectifs d'animation sont remplacés, pas ajoutés : recharger le bon fichier écrase simplement ceux-ci.";
    case "BUDGETS": return "Les budgets et lignes de plan sont remplacés, pas ajoutés : recharger le bon fichier écrase simplement ceux-ci. Les lignes se corrigent aussi une par une depuis Marketing → Budgets.";
    case "REGULATORY": return "Un dossier réglementaire peut avoir été créé par un import antérieur puis mis à jour par celui-ci : le supprimer effacerait aussi l'historique et les corrections saisies dans l'application. Recharger le bon fichier corrige les données ; un dossier isolé se supprime depuis sa fiche.";
    case "INVENTORY": return "L'inventaire importé crée des articles et des mouvements d'entrée ou d'ajustement, qui ont pu être suivis de sorties vers des activations : on ne revient pas en arrière automatiquement. Recharger le bon fichier ajuste les stocks ; un article isolé se corrige ou se désactive depuis sa fiche.";
    case "MEDECINS": return "Cet import met à jour le référentiel médecins. Les fiches modifiées ne peuvent pas revenir à leur état précédent automatiquement : corrigez-les depuis la fiche médecin.";
    case "INFLUENCERS": return "Cet import met à jour le répertoire influenceuses. Les fiches modifiées ne peuvent pas revenir à leur état précédent automatiquement : corrigez-les depuis Marketing → Influence.";
    default: return "Ce type d'import ne peut pas être annulé automatiquement.";
  }
}

/** Ce que l'annulation retirerait, sans rien modifier. */
export async function rollbackPlan(importId: string, type: string): Promise<RollbackPlan | null> {
  const n = async (q: ReturnType<typeof sql>) => Number((((await db.execute(q)).rows[0] ?? {}) as { n?: number }).n ?? 0);
  switch (type) {
    case "SALES": {
      const count = await n(sql`select count(*)::int as n from sales where import_id = ${importId}::uuid`);
      const amount = Number((((await db.execute(sql`select coalesce(sum(amount),0)::float8 as n from sales where import_id = ${importId}::uuid`)).rows[0] ?? {}) as { n?: number }).n ?? 0);
      return { label: "lignes de vente", count, detail: count ? `${Math.round(amount).toLocaleString("fr-FR")} MAD HT` : undefined };
    }
    case "STOCK": {
      const count = await n(sql`select count(*)::int as n from stock_snapshots where import_id = ${importId}::uuid`);
      return { label: "photos de stock", count };
    }
    case "ANIMATIONS": {
      const count = await n(sql`select count(*)::int as n from animations where import_id = ${importId}::uuid`);
      const lines = await n(sql`select count(*)::int as n from animation_lines al join animations a on a.id = al.animation_id where a.import_id = ${importId}::uuid`);
      return { label: "journées d'animation", count, detail: lines ? `${lines.toLocaleString("fr-FR")} ligne(s) de vente terrain` : undefined };
    }
    case "ADS": {
      const count = await n(sql`select count(*)::int as n from ad_metrics where import_id = ${importId}::uuid`);
      const spend = Number((((await db.execute(sql`select coalesce(sum(spend),0)::float8 as n from ad_metrics where import_id = ${importId}::uuid`)).rows[0] ?? {}) as { n?: number }).n ?? 0);
      return { label: "lignes de régie publicitaire", count, detail: count ? `${Math.round(spend).toLocaleString("fr-FR")} MAD de dépense` : undefined };
    }
    default:
      return null;
  }
}

/**
 * Fiches créées automatiquement par cet import et qui ne servent nulle part ailleurs.
 *
 * Un fichier mal qualifié (un reporting publicitaire chargé comme des ventes, par exemple) crée
 * des produits et des clients qui n'existent pas. Annuler l'import retire ses lignes, mais les
 * fiches resteraient et pollueraient le stock, la bibliothèque produits et les rapprochements
 * futurs. On ne retire qu'une fiche **sans aucune référence** : dès qu'une vente, une photo de
 * stock, une animation ou un objectif d'un autre import s'y rattache, elle est conservée.
 */
export type OrphanPlan = { products: number; clients: number; aliases: number };

const ORPHAN_PRODUCT_SQL = (importId: string) => sql`
  from products p where p.import_id = ${importId}::uuid
    and not exists (select 1 from sales where product_id = p.id)
    and not exists (select 1 from stock_snapshots where product_id = p.id)
    and not exists (select 1 from animation_lines where product_id = p.id)
    and not exists (select 1 from objectives where product_id = p.id)
    and not exists (select 1 from regulatory_files where product_id = p.id)
    and not exists (select 1 from campaign_products where product_id = p.id)
    and not exists (select 1 from sample_movements where product_id = p.id)
    and not exists (select 1 from visit_products where product_id = p.id)
    and not exists (select 1 from visit_samples where product_id = p.id)
    and not exists (select 1 from content_items where product_id = p.id)
    and not exists (select 1 from ad_creatives where product_id = p.id)
    and not exists (select 1 from collaborations where product_id = p.id)
    and not exists (select 1 from marketing_expenses where product_id = p.id)
    and not exists (select 1 from activations where product_id = p.id)`;

const ORPHAN_CLIENT_SQL = (importId: string) => sql`
  from clients c where c.import_id = ${importId}::uuid
    and not exists (select 1 from sales where client_id = c.id)
    and not exists (select 1 from animations where client_id = c.id)
    and not exists (select 1 from activations where client_id = c.id)
    and not exists (select 1 from user_client_assignments where client_id = c.id)`;

/** Ce que le nettoyage des fiches retirerait, sans rien modifier. */
export async function orphanPlan(importId: string): Promise<OrphanPlan> {
  const n = async (q: ReturnType<typeof sql>) => Number((((await db.execute(q)).rows[0] ?? {}) as { n?: number }).n ?? 0);
  const [products, clients, aliases] = await Promise.all([
    n(sql`select count(*)::int as n ${ORPHAN_PRODUCT_SQL(importId)}`),
    n(sql`select count(*)::int as n ${ORPHAN_CLIENT_SQL(importId)}`),
    n(sql`select (select count(*) from product_aliases where import_id = ${importId}::uuid)::int + (select count(*) from client_aliases where import_id = ${importId}::uuid)::int as n`),
  ]);
  return { products, clients, aliases };
}

/**
 * Retire les fiches et alias créés par cet import et devenus orphelins. À appeler APRÈS
 * `rollbackRows()` : c'est la suppression des lignes qui rend les fiches orphelines.
 */
export async function rollbackOrphans(importId: string): Promise<OrphanPlan> {
  const aliases = (await db.execute(sql`delete from product_aliases where import_id = ${importId}::uuid`)).rowCount ?? 0;
  const clientAliases = (await db.execute(sql`delete from client_aliases where import_id = ${importId}::uuid`)).rowCount ?? 0;
  const products = (await db.execute(sql`delete ${ORPHAN_PRODUCT_SQL(importId)}`)).rowCount ?? 0;
  const clients = (await db.execute(sql`delete ${ORPHAN_CLIENT_SQL(importId)}`)).rowCount ?? 0;
  return { products, clients, aliases: aliases + clientAliases };
}

/** Exécute l'annulation des lignes. Renvoie le nombre d'enregistrements retirés. */
export async function rollbackRows(importId: string, type: string): Promise<number> {
  switch (type) {
    case "SALES": {
      const r = await db.execute(sql`delete from sales where import_id = ${importId}::uuid`);
      return r.rowCount ?? 0;
    }
    case "STOCK": {
      const r = await db.execute(sql`delete from stock_snapshots where import_id = ${importId}::uuid`);
      return r.rowCount ?? 0;
    }
    case "ANIMATIONS": {
      // Les lignes partent avec l'animation (cascade), mais on les retire explicitement
      // pour rester correct même si la contrainte change.
      await db.execute(sql`delete from animation_lines where animation_id in (select id from animations where import_id = ${importId}::uuid)`);
      const r = await db.execute(sql`delete from animations where import_id = ${importId}::uuid`);
      return r.rowCount ?? 0;
    }
    case "ADS": {
      const r = await db.execute(sql`delete from ad_metrics where import_id = ${importId}::uuid`);
      return r.rowCount ?? 0;
    }
    default:
      return 0;
  }
}
