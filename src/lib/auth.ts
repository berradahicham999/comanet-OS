import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type UserRole } from "@/db/schema";
import { cache } from "react";

export const SESSION_COOKIE = "comanet_session";
const SESSION_DAYS = 7;

export type SessionUser = { id: string; name: string; email: string; role: UserRole };

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET manquant ou trop court");
  return new TextEncoder().encode(s);
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ name: user.name, email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession() {
  const jar = await cookies();
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
