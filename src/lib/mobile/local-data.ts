"use client";

import { clearRefs, forgetUser, lastUser, rememberUser } from "./outbox";
import { disablePush } from "./push-client";

/** Même nom que `USER_CACHE` dans `sw-source.ts` : ce module reste côté client, sans importer la source du worker. */
const USER_CACHE = "comanet-user";

/** Efface les pages authentifiées gardées par le service worker. */
export async function clearUserCache() {
  if (typeof caches !== "undefined") await caches.delete(USER_CACHE).catch(() => false);
}

/**
 * Fin de session sur ce téléphone : pages en cache et référentiels effacés. Les saisies en attente restent, dans la base
 * du compte : elles partiront à sa prochaine connexion et ne seront jamais envoyées au nom de quelqu'un d'autre.
 */
export async function wipeSessionData() {
  const uid = lastUser();
  await disablePush().catch(() => {});
  await clearUserCache();
  if (uid) await clearRefs(uid).catch(() => {});
  forgetUser();
}

/** Appelé à chaque ouverture connectée : si le compte a changé, rien du précédent ne reste affichable. */
export async function syncLocalUser(userId: string) {
  const previous = lastUser();
  if (previous && previous !== userId) await wipeSessionData();
  rememberUser(userId);
}
