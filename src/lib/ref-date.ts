import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { daysBetween, today } from "./format";

export type RefDate = {
  /** Date de référence des analyses : aujourd'hui, ou la dernière date de vente importée si elle est antérieure. */
  ref: Date;
  /** Dernière date de vente présente en base. */
  lastSale: Date | null;
  /** Nombre de jours de retard des données par rapport à aujourd'hui. */
  staleDays: number;
  /**
   * Repère des périodes affichées (« mois en cours » de Ventes) : la vente la plus récente, BL saisis dans
   * COMANET OS compris, plafonnée à aujourd'hui. Les moyennes et le stock restent calés sur `ref` (les imports),
   * sinon un import en retard ferait chuter la rotation des marques importées.
   */
  periodRef: Date;
};

/**
 * Le cockpit se cale sur la dernière donnée disponible : si le dernier import s'arrête au 30 juillet,
 * « ce mois » = juillet, et un bandeau signale le retard de mise à jour.
 */
export const getRefDate = cache(async (): Promise<RefDate> => {
  const t = today();
  // Les ventes projetées par COMANET OS sont à jour par construction : la fraîcheur se lit sur les imports.
  const r = await db.execute(sql`select coalesce(max(date) filter (where source <> 'COMANET_OS'), max(date))::text as d, max(date)::text as latest from sales`);
  const row = r.rows[0] as { d: string | null; latest: string | null } | undefined;
  if (!row?.d) return { ref: t, lastSale: null, staleDays: 0, periodRef: t };
  const last = new Date(row.d + "T12:00:00Z");
  const latest = new Date((row.latest ?? row.d) + "T12:00:00Z");
  const ref = last < t ? last : t;
  return { ref, lastSale: last, staleDays: Math.max(0, daysBetween(last, t)), periodRef: latest < t ? latest : t };
});
