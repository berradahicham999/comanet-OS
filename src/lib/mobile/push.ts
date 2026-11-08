import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { deviceLabel } from "@/lib/sessions-shared";
import { pushMessage, subscriptionGone, validEndpoint } from "./push-shared";

/**
 * Web Push : seule écriture de `push_subscriptions`, seul envoi. Branché dans `notify()`, donc toute notification de
 * l'application arrive aussi sur le téléphone. Sans clés VAPID, rien ne part et l'écran n'offre pas l'activation.
 * La clé privée reste en variable d'environnement, jamais en base (DEPLOY_MOBILE.md).
 */
export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? process.env.VAPID_PUBLIC_KEY : null;
}

let configured = false;
function configure(): boolean {
  if (!pushPublicKey()) return false;
  if (!configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:contact@comanet.ma", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    configured = true;
  }
  return true;
}

export type IncomingSubscription = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

/** Un navigateur = un abonnement, celui de la personne connectée à cet instant : un téléphone partagé change de propriétaire. */
export async function saveSubscription(userId: string, sessionId: string | null, s: IncomingSubscription, userAgent: string | null): Promise<boolean> {
  const { endpoint, keys } = s;
  if (!validEndpoint(endpoint) || typeof keys?.p256dh !== "string" || typeof keys.auth !== "string") return false;
  const values = { userId, sessionId, p256dh: keys.p256dh.slice(0, 200), auth: keys.auth.slice(0, 100), deviceLabel: deviceLabel(userAgent) };
  await db.insert(pushSubscriptions).values({ endpoint, ...values }).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
  return true;
}

export async function removeSubscription(userId: string, endpoint: string) {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

/** Tolérant : une notification doit s'enregistrer même si la migration n'est pas appliquée ou si l'envoi échoue. */
export async function sendPush(userIds: string[], input: { title: string; body?: string | null; href?: string | null }): Promise<number> {
  if (!userIds.length || !configure()) return 0;
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds)).catch(() => []);
  if (!subs.length) return 0;
  const payload = JSON.stringify(pushMessage(input));
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, timeout: 4000 });
      sent++;
      await db.update(pushSubscriptions).set({ lastSuccessAt: new Date() }).where(eq(pushSubscriptions.id, s.id)).catch(() => {});
    } catch (e) {
      if (subscriptionGone((e as { statusCode?: number }).statusCode)) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).catch(() => {});
      else console.error("web-push", (e as Error).message);
    }
  }));
  return sent;
}

export async function pushCount(userId: string): Promise<number> {
  const r = await db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).catch(() => [{ n: 0 }]);
  return r[0]?.n ?? 0;
}
