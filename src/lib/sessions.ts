import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions, userSessions } from "@/db/schema";
import { audit } from "@/lib/audit";
import { pgArray } from "@/lib/sql-array";
import { deviceLabel, sessionVerdict, touchDue } from "./sessions-shared";

/**
 * Sessions par appareil (table `user_sessions`, migration 0055) : seule écriture de cette table.
 * Le jeton porte l'identifiant de session (`sid`) ; `checkSession()` est appelée par `getSession()` à chaque requête.
 *
 * Tolérance : tant que la migration n'est pas appliquée, la table n'existe pas. La connexion doit rester possible,
 * sinon personne ne pourrait ouvrir /installation pour l'appliquer. Le jeton est alors émis sans `sid`.
 */
function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; cause?: { code?: string } };
  return (x?.code ?? x?.cause?.code) === "42P01";
}

export async function openSession(userId: string, device: { userAgent?: string | null; idleMinutes?: number | null }): Promise<string | null> {
  try {
    const [row] = await db.insert(userSessions).values({
      userId,
      deviceLabel: deviceLabel(device.userAgent),
      userAgent: device.userAgent?.slice(0, 300) ?? null,
      idleMinutes: device.idleMinutes || null,
    }).returning({ id: userSessions.id });
    return row.id;
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

/** La session est-elle encore valable ? Met à jour le dernier passage et clôt une session inactive. */
export async function checkSession(sid: string, userId: string): Promise<boolean> {
  try {
    const row = (await db.select({ revokedAt: userSessions.revokedAt, lastSeenAt: userSessions.lastSeenAt, idleMinutes: userSessions.idleMinutes })
      .from(userSessions).where(and(eq(userSessions.id, sid), eq(userSessions.userId, userId))))[0];
    if (!row) return false;
    const now = new Date();
    const verdict = sessionVerdict(row, now);
    if (verdict === "REVOKED") return false;
    if (verdict === "IDLE") {
      await db.update(userSessions).set({ revokedAt: now, revokedReason: "INACTIVITE" }).where(eq(userSessions.id, sid));
      return false;
    }
    if (touchDue(row, now)) await db.update(userSessions).set({ lastSeenAt: now }).where(eq(userSessions.id, sid)).catch(() => {});
    return true;
  } catch (e) {
    if (isMissingTable(e)) return true;
    throw e;
  }
}

/** Déconnexion volontaire de l'appareil courant. */
export async function closeSession(sid: string): Promise<void> {
  await db.update(userSessions).set({ revokedAt: new Date(), revokedReason: "DECONNEXION" })
    .where(and(eq(userSessions.id, sid), isNull(userSessions.revokedAt))).catch(() => {});
}

export type DeviceSession = { id: string; deviceLabel: string | null; createdAt: Date; lastSeenAt: Date; idleMinutes: number | null };

/** Appareils encore connectés d'un compte, du plus récent au plus ancien. */
export async function activeSessions(userId: string): Promise<DeviceSession[]> {
  try {
    return await db.select({ id: userSessions.id, deviceLabel: userSessions.deviceLabel, createdAt: userSessions.createdAt, lastSeenAt: userSessions.lastSeenAt, idleMinutes: userSessions.idleMinutes })
      .from(userSessions).where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt))).orderBy(desc(userSessions.lastSeenAt)).limit(30);
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

/** Révocation à distance par un administrateur : un appareil (`sessionId`) ou tous. Tracée dans `audit_logs`. */
export async function revokeSessions(actor: { id: string; name: string }, userId: string, sessionId?: string): Promise<number> {
  const where = sessionId
    ? and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId), isNull(userSessions.revokedAt))
    : and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt));
  return db.transaction(async (tx) => {
    const rows = await tx.update(userSessions).set({ revokedAt: new Date(), revokedById: actor.id, revokedReason: "ADMIN" }).where(where).returning({ id: userSessions.id, deviceLabel: userSessions.deviceLabel });
    if (rows.length) {
      await tx.delete(pushSubscriptions).where(sql`session_id = any(${pgArray(rows.map((r) => r.id))})`).catch(() => {});
      await audit({ actor, action: "REVOQUER_SESSION", module: "administration", entity: "user", entityId: userId, label: rows.map((r) => r.deviceLabel ?? "Appareil").join(", ") }, tx);
    }
    return rows.length;
  });
}
