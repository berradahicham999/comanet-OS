import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type UserRole } from "@/db/schema";
import { cache } from "react";
import { checkSession, closeSession, openSession } from "@/lib/sessions";
import { SESSION_MAX_AGE_S } from "@/lib/sessions-shared";
import { signSessionToken } from "@/lib/session-token";

export const SESSION_COOKIE = "comanet_session";

export type SessionUser = { id: string; name: string; email: string; role: UserRole };

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET manquant ou trop court");
  return new TextEncoder().encode(s);
}

export async function createSession(user: SessionUser, device: { userAgent?: string | null; idleMinutes?: number | null } = {}) {
  const sid = await openSession(user.id, device);
  const token = await signSessionToken({ sub: user.id, name: user.name, email: user.email, role: user.role, ...(sid ? { sid } : {}) }, secret());
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
}

/** Identifiant de session du cookie courant : rattache un abonnement Web Push à cet appareil. */
export async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const sid = await jwtVerify(token, secret()).then((r) => r.payload.sid, () => null);
  return typeof sid === "string" ? sid : null;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const sid = await jwtVerify(token, secret()).then((r) => r.payload.sid, () => null);
    if (typeof sid === "string") await closeSession(sid);
  }
  jar.delete(SESSION_COOKIE);
}

/** Session courante (null si absente/invalide). Mise en cache par requête. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    // On revérifie que l'utilisateur est toujours actif (et on rafraîchit son rôle).
    // Colonnes explicites : `last_login_at` n'existe qu'après la migration 0012, un `select *` casserait la session avant.
    const u = (await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active }).from(users).where(eq(users.id, payload.sub)))[0];
    if (!u || !u.active) return null;
    // Révocation à distance et inactivité : un jeton sans `sid` date d'avant la migration 0055 et expire de lui-même.
    if (typeof payload.sid === "string" && !(await checkSession(payload.sid, u.id))) return null;
    return { id: u.id, name: u.name, email: u.email, role: u.role };
  } catch {
    return null;
  }
});

export async function requireUser(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
  const u = (await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, passwordHash: users.passwordHash }).from(users).where(eq(users.email, email.trim().toLowerCase())))[0];
  if (!u || !u.active) return null;
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return null;
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id)).catch(() => {});
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
