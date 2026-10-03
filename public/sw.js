/*
 * COMANET OS — service worker minimal pour l'écran « Ma journée » des délégués médicaux.
 * Il permet de rouvrir l'écran sans réseau (cabinet en sous-sol) : la dernière version de la page et
 * ses fichiers statiques sont gardés en cache. Les actions (Démarrer, Terminer…) ne passent jamais par
 * ce cache : elles sont mises en file dans IndexedDB par la page et envoyées au retour du réseau.
 */
const CACHE = "comanet-medical-v1";
const PAGE = "/medical/journee";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("comanet-medical-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Fichiers statiques versionnés de Next : cache d'abord.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // L'écran « Ma journée » : réseau d'abord, dernière version en cache sans réseau.
  if (req.mode === "navigate" && url.pathname === PAGE) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) caches.open(CACHE).then((c) => c.put(PAGE, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(PAGE)) || new Response("Hors connexion : ouvrez « Ma journée » une première fois avec du réseau.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })),
    );
  }
});
