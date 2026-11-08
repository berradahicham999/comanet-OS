import "server-only";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { stockAlertLog } from "@/db/schema";
import { notify } from "@/lib/content/notify";
import { addDays, iso, today } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { productStocks } from "@/lib/stock";
import { isUnderTension } from "@/lib/stock-math";
import { ANIMATRICE_SQL } from "@/lib/users";
import { businessHour, isSundayIn, reminderDue, stockAlertDue, stockAlertText } from "./push-shared";

/** Relances planifiées. Le cron passe chaque heure ; chacune ne s'exécute qu'à l'heure réglée, dans le fuseau de l'entreprise. */
const TZ = process.env.BUSINESS_TZ ?? "Africa/Casablanca";

/** Animatrices sans saisie aujourd'hui, à l'heure de fin de journée. Une seule relance par jour. */
export async function remindMissingEntries(now = new Date()): Promise<number> {
  const day = iso(today());
  const since = iso(addDays(today(), -14));
  const rows = await db.execute<{ id: string; planned: boolean; entered_today: boolean; entered_recently: boolean; reminded: boolean }>(sql`
    select u.id::text as id,
      exists (select 1 from animations a where a.animatrice_id = u.id and a.status = 'PLANNED' and coalesce(a.start_date, a.date) <= ${day}::date and a.date >= ${day}::date) as planned,
      exists (select 1 from animations a where a.animatrice_id = u.id and a.status = 'DONE' and a.date = ${day}::date) as entered_today,
      exists (select 1 from animations a where a.animatrice_id = u.id and a.source = 'saisie' and a.date >= ${since}::date) as entered_recently,
      exists (select 1 from notifications n where n.user_id = u.id and n.type = 'SAISIE_REMINDER' and n.created_at >= ${day}::date) as reminded
    from users u where u.active and ${ANIMATRICE_SQL}`);
  const sunday = isSundayIn(now, TZ);
  const ids = rows.rows.filter((r) => !r.reminded && reminderDue({ plannedToday: r.planned, enteredToday: r.entered_today, enteredRecently: r.entered_recently }, sunday)).map((r) => r.id);
  if (ids.length) await notify(ids, { type: "SAISIE_REMINDER", title: "Pas encore de saisie aujourd'hui ?", body: "Pensez à enregistrer vos ventes de la journée.", href: "/m/saisie" });
  return ids.length;
}

/** Références passées en tension : une notification groupée, chaque référence une fois par semaine au plus. */
export async function alertStockTension(now = new Date()): Promise<number> {
  const [settings, stocks] = await Promise.all([getSettings(), productStocks()]);
  const tight = stocks.filter((p) => isUnderTension(p, settings));
  if (!tight.length) return 0;
  const logged = new Map((await db.select().from(stockAlertLog).where(inArray(stockAlertLog.productId, tight.map((p) => p.productId)))).map((r) => [r.productId, r.lastAlertAt]));
  const fresh = tight.filter((p) => stockAlertDue(logged.get(p.productId), now));
  if (!fresh.length) return 0;
  const recipients = await db.execute<{ id: string }>(sql`
    select distinct u.id::text as id from users u join user_permissions p on p.user_id = u.id
    where u.active and p.can_validate and p.module in ('stock', 'administration')`);
  await notify(recipients.rows.map((r) => r.id), { type: "STOCK_ALERT", ...stockAlertText(fresh.map((p) => p.name)), href: "/stock" });
  await db.insert(stockAlertLog).values(fresh.map((p) => ({ productId: p.productId, lastAlertAt: now })))
    .onConflictDoUpdate({ target: stockAlertLog.productId, set: { lastAlertAt: now } });
  return fresh.length;
}

export async function runMobileCron(now = new Date()) {
  const s = (await getSettings()).mobile;
  const hour = businessHour(now, TZ);
  return {
    hour,
    reminded: hour === s.reminderHour ? await remindMissingEntries(now) : null,
    stockAlerts: hour === s.stockAlertHour ? await alertStockTension(now) : null,
  };
}
