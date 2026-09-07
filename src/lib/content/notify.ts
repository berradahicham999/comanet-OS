import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";

export type NotificationType =
  | "BRIEF_ASSIGNED" | "DELIVERABLE_UPLOADED" | "VALIDATION_REQUESTED"
  | "CORRECTIONS_REQUESTED" | "CONTENT_VALIDATED" | "DEADLINE_PASSED" | "COMMENT";

export type NotifyInput = { type: NotificationType; title: string; body?: string | null; href?: string | null; entityType?: string; entityId?: string | null };

/** Notifie une liste de personnes (dédoublonnée, sans l'auteur de l'action). */
export async function notify(userIds: (string | null | undefined)[], input: NotifyInput, opts: { except?: string | null } = {}) {
  const ids = [...new Set(userIds.filter((u): u is string => !!u && u !== opts.except))];
  if (!ids.length) return;
  await db.insert(notifications).values(ids.map((userId) => ({
    userId, type: input.type, title: input.title, body: input.body ?? null, href: input.href ?? null,
    entityType: input.entityType ?? null, entityId: input.entityId ?? null,
  })));
}

export async function unreadCount(userId: string): Promise<number> {
  const r = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return r[0]?.n ?? 0;
}

export async function listNotifications(userId: string, limit = 30) {
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function markRead(userId: string, id?: string) {
  const where = id ? and(eq(notifications.userId, userId), eq(notifications.id, id)) : and(eq(notifications.userId, userId), isNull(notifications.readAt));
  await db.update(notifications).set({ readAt: new Date() }).where(where);
}
