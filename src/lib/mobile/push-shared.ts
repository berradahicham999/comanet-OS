/**
 * Web Push — décisions pures (`tests/mobile-p2.test.ts`). L'envoi vit dans `push.ts`, le navigateur dans `push-client.ts`.
 */

/** Seuls les services de notification des navigateurs : sinon, un abonnement forgé ferait appeler n'importe quelle adresse au serveur. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.services\.mozilla\.com$/];

export function validEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export type PushMessage = { title: string; body: string; href: string };

/** Ce qui s'affiche sur l'écran verrouillé : court, et toujours un lien interne. */
export function pushMessage(input: { title: string; body?: string | null; href?: string | null }): PushMessage {
  const href = input.href && input.href.startsWith("/") && !input.href.startsWith("//") ? input.href : "/notifications";
  return { title: input.title.slice(0, 80), body: (input.body ?? "").slice(0, 140), href };
}

/** Abonnement expiré ou révoqué par le navigateur : il faut l'oublier. */
export const subscriptionGone = (status: number | undefined) => status === 404 || status === 410;

/** L'heure qu'il est à Casablanca : Vercel appelle le cron en UTC, et le Maroc change d'heure pendant le Ramadan. */
export function businessHour(now: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
}

export function isSundayIn(now: Date, timeZone: string): boolean {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(now) === "Sun";
}

/**
 * Faut-il relancer une animatrice ce soir ? Une animation prévue aujourd'hui, ou une habitude de saisie récente hors dimanche.
 * Le message reste une question : l'application ne sait pas si elle travaillait.
 */
export function reminderDue(a: { plannedToday: boolean; enteredToday: boolean; enteredRecently: boolean }, sunday: boolean): boolean {
  if (a.enteredToday) return false;
  return a.plannedToday || (a.enteredRecently && !sunday);
}

/** Une référence en tension n'est signalée qu'une fois par semaine : au-delà, personne ne lit plus les alertes. */
export const STOCK_ALERT_EVERY_DAYS = 7;

export function stockAlertDue(lastAlertAt: Date | string | null | undefined, now: Date): boolean {
  if (!lastAlertAt) return true;
  return now.getTime() - new Date(lastAlertAt).getTime() >= STOCK_ALERT_EVERY_DAYS * 86400000;
}

/** Une ligne de notification pour plusieurs références : le nom des trois premières, puis le nombre restant. */
export function stockAlertText(names: string[]): { title: string; body: string } {
  const n = names.length;
  const shown = names.slice(0, 3).join(", ");
  return { title: n > 1 ? `${n} références en tension de stock` : `Stock en tension : ${names[0]}`, body: n > 3 ? `${shown} et ${n - 3} autre${n - 3 > 1 ? "s" : ""}.` : shown };
}
