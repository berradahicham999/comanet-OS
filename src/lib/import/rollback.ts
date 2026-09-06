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
    case "MEDECINS": return "Cet import met à jour le référentiel médecins. Les fiches modifiées ne peuvent pas revenir à leur état précédent automatiquement : corrigez-les depuis la fiche médecin.";
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

/** Exécute l'annulation. Renvoie le nombre d'enregistrements retirés. */
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
