/**
 * Source du service worker, servie à `/sw.js` (`src/app/sw.js/route.ts`).
 *
 * L'adresse reste `/sw.js` : les téléphones qui ont déjà l'ancien worker reçoivent celui-ci à leur prochaine visite.
 * Serwist a été essayé le 07/11/2026 (`docs/plan-mobile.md`) : il fonctionne sur Next 16, mais précharge 1,69 Mo
 * (tout le bureau) à chaque déploiement et sert le worker à une autre adresse.
 *
 * Trois règles :
 *  - la coquille `/m` ne contient aucune donnée : elle est servie du cache d'abord, de façon atomique avec ses fichiers ;
 *  - les pages authentifiées ne sont jamais en cache, sauf Ma journée et Ma tournée (réouverture sans réseau, en attendant
 *    leur passage sous `/m`), dans un cache vidé à la déconnexion (`clearUserCache()`) ;
 *  - `/api/*` et les server actions ne passent jamais par le worker : la file d'envoi vit dans IndexedDB.
 */
export const SHELL_PAGES = ["/m", "/m/saisie", "/m/stock", "/m/mois", "/m/a-corriger"];
export const USER_PAGES = ["/medical/journee", "/clients/tournee"];
export const USER_CACHE = "comanet-user";
const ASSETS = ["/icon.svg", "/icons/icon-192.png", "/manifest.webmanifest"];

export function swSource(version: string): string {
  return `/* COMANET OS — service worker, version ${version}. Généré par src/lib/mobile/sw-source.ts. */
const SHELL = ${JSON.stringify(`comanet-shell-${version}`)};
const USER = ${JSON.stringify(USER_CACHE)};
const PAGES = ${JSON.stringify(SHELL_PAGES)};
const USER_PAGES = ${JSON.stringify(USER_PAGES)};
const ASSETS = ${JSON.stringify(ASSETS)};

async function precache() {
  const cache = await caches.open(SHELL);
  const urls = new Set(ASSETS);
  for (const page of PAGES) {
    const res = await fetch(page, { cache: "no-store" });
    if (!res.ok || res.redirected) throw new Error("Coquille indisponible : " + page);
    const html = await res.clone().text();
    await cache.put(page, res);
    for (const m of html.matchAll(/\\/_next\\/static\\/[^"'\\\\\\s<>)]+/g)) urls.add(m[0]);
  }
  await cache.addAll([...urls]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("comanet-") && k !== SHELL && k !== USER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function fromShell(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function userPage(req, path) {
  const cache = await caches.open(USER);
  try {
    const res = await fetch(req);
    if (res.redirected) {
      // Session terminée : plus rien de cette personne ne doit rester lisible sur le téléphone.
      await caches.delete(USER);
      return res;
    }
    if (res.ok) await cache.put(path, res.clone());
    return res;
  } catch {
    return (await cache.match(path)) || Response.redirect("/m", 302);
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (path.startsWith("/_next/static/") || ASSETS.includes(path)) {
    event.respondWith(fromShell(req));
    return;
  }
  if (req.mode !== "navigate") return;
  if (PAGES.includes(path)) {
    event.respondWith(caches.open(SHELL).then((c) => c.match(path)).then((hit) => hit || fetch(req)));
    return;
  }
  if (USER_PAGES.includes(path)) {
    event.respondWith(userPage(req, path));
    return;
  }
  // Toute autre page : le réseau seul. Sans réseau, retour à la coquille plutôt qu'à l'erreur du navigateur.
  event.respondWith(fetch(req).catch(() => Response.redirect("/m", 302)));
});
`;
}
