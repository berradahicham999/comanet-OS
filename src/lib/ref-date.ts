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
};

/**
 * Le cockpit se cale sur la dernière donnée disponible : si le dernier import s'arrête au 30 juillet,
 * « ce mois » = juillet, et un bandeau signale le retard de mise à jour.
 */
export const getRefDate = cache(async (): Promise<RefDate> => {
  const t = today();
  const r = await db.execute(sql`select max(date)::text as d from sales`);
  const d = (r.rows[0] as { d: string | null } | undefined)?.d;
  if (!d) return { ref: t, lastSale: null, staleDays: 0 };
  const last = new Date(d + "T12:00:00Z");
  const ref = last < t ? last : t;
  return { ref, lastSale: last, staleDays: Math.max(0, daysBetween(last, t)) };
});
