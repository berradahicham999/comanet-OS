import { SignJWT, jwtVerify } from "jose";
import { RENEW_AFTER_S, SESSION_DAYS } from "./sessions-shared";

/**
 * Jeton de session, sans dépendance serveur : il est lu aussi par `src/proxy.ts`.
 * Cookie et signature restent ceux de `src/lib/auth.ts` ; ce module ne porte que l'émission et le renouvellement.
 */
export type TokenClaims = { sub: string; name: string; email: string; role: string; sid?: string };

export async function signSessionToken(claims: TokenClaims, secret: Uint8Array): Promise<string> {
  const { sub, ...rest } = claims;
  return new SignJWT(rest).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime(`${SESSION_DAYS}d`).sign(secret);
}

/**
 * Jeton prolongé de 30 jours si le précédent a plus d'un jour, `null` sinon.
 * Un jeton sans `sid` (émis avant la migration 0055) n'est jamais prolongé : il ne serait pas révocable.
 * La révocation reste vérifiée à chaque requête par `getSession()` ; prolonger un jeton révoqué ne lui rend aucun accès.
 */
export async function renewedToken(token: string, secret: Uint8Array, nowS = Math.floor(Date.now() / 1000)): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub || typeof payload.sid !== "string" || typeof payload.iat !== "number") return null;
    if (nowS - payload.iat < RENEW_AFTER_S) return null;
    return signSessionToken({ sub: payload.sub, name: String(payload.name ?? ""), email: String(payload.email ?? ""), role: String(payload.role ?? ""), sid: payload.sid }, secret);
  } catch {
    return null;
  }
}
