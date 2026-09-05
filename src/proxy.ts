import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/api/auth", "/api/health", "/installation"];

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
