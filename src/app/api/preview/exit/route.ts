import { NextResponse, type NextRequest } from "next/server";
import { PREVIEW_COOKIE } from "@/lib/access-shared";

export const dynamic = "force-dynamic";

/** Quitte la prévisualisation « en tant que » : supprime le cookie et revient à l'administration. */
export function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next");
  const url = new URL(next && next.startsWith("/") ? next : "/parametres/utilisateurs", request.url);
  const res = NextResponse.redirect(url);
  res.cookies.set(PREVIEW_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
