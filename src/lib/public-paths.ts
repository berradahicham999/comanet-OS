/**
 * Chemins accessibles sans cookie de session (`src/proxy.ts`). Testé dans `tests/mobile-socle.test.ts`.
 *
 * Tout passe par un segment entier : un simple préfixe `/m` ouvrirait `/marketing`, `/medical` et `/marques`.
 *
 * - `/api/cron` n'est pas ouvert pour autant : la route exige `Authorization: Bearer CRON_SECRET`. Vercel appelle ses
 *   crons avec cet en-tête et SANS cookie ; sans cette exception, la synchronisation ne tournerait jamais.
 * - `/m` : coquille statique de l'app mobile, sans aucune donnée. Le service worker doit pouvoir la précharger même
 *   déconnecté ; toutes les données viennent de `/api/m/*`.
 * - `/api/m` n'est pas ouvert non plus : chaque route vérifie la session et répond 401. L'app a besoin de ce 401 :
 *   une redirection vers `/login` lui rendrait une page HTML au lieu d'une réponse lisible.
 * - `/app`, `/downloads` : page d'installation et APK, à partager par simple lien.
 * - `/.well-known` : `assetlinks.json`, lu par Android pour retirer la barre d'adresse de l'APK.
 */
const SEGMENTS = ["/login", "/api/auth", "/api/health", "/api/cron", "/installation", "/d", "/sw.js", "/m", "/api/m", "/app", "/downloads", "/.well-known"];

export function isPublicPath(pathname: string): boolean {
  return SEGMENTS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
