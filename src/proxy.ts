import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/public-paths";
import { renewedToken } from "@/lib/session-token";
import { SESSION_MAX_AGE_S } from "@/lib/sessions-shared";

const COOKIE = "comanet_session";

/**
 * Contrôle optimiste : présence du cookie de session. La vérification réelle a lieu côté serveur.
 * Le jeton d'une personne active est prolongé (une fois par jour au plus) : la session de 30 jours est glissante.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) {
    const renewed = await renewedToken(token, new TextEncoder().encode(s));
    if (renewed) res.cookies.set(COOKIE, renewed, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE_S });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
