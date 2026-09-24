import { NextResponse, type NextRequest } from "next/server";

// `/api/cron` est public au niveau du filtre, mais pas ouvert : la route exige l'en-tête
// `Authorization: Bearer CRON_SECRET`. Vercel appelle ses crons avec cet en-tête et SANS
// cookie de session — sans cette exception, le cron serait redirigé vers /login et la
// synchronisation ne tournerait jamais, sans le moindre message.
const PUBLIC = ["/login", "/api/auth", "/api/health", "/api/cron", "/installation", "/d/"];

/** Contrôle optimiste : présence du cookie de session. La vérification réelle a lieu côté serveur. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  const hasSession = Boolean(request.cookies.get("comanet_session")?.value);
  if (!hasSession) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
