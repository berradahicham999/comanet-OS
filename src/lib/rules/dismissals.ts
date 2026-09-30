import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { recommendationDismissals } from "@/db/schema";
import { audit, type AuditActor } from "@/lib/audit";
import type { Recommendation } from "./types";
import { DISMISS_DAYS, type Dismissal } from "./dismissals-shared";

/** Écarts enregistrés pour ces clés (y compris expirés : le filtre vit dans `isDismissed()`). */
export async function dismissalsFor(keys: string[]): Promise<Map<string, Dismissal>> {
  if (!keys.length) return new Map();
  // Migration 0035 pas encore appliquée : aucune recommandation écartée, l'Action Center reste lisible.
  const rows = await db.select().from(recommendationDismissals).where(inArray(recommendationDismissals.key, keys))
    .catch((e) => { console.error("Recommandations écartées illisibles (migration 0035 ?)", e); return []; });
  return new Map(rows.map((r) => [r.key, { priority: r.priority, until: r.until, by: r.dismissedByName, reason: r.reason, at: r.createdAt }]));
}

/** Écarte une recommandation (seule écriture de `recommendation_dismissals`), avec trace d'audit. */
export async function dismissRecommendation(rec: Recommendation, actor: AuditActor, reason: string | null, days = DISMISS_DAYS): Promise<void> {
  const until = new Date(Date.now() + days * 86_400_000);
  const values = { key: rec.key, rule: rec.rule, title: rec.title, priority: rec.priority, reason, until, dismissedById: actor.id, dismissedByName: actor.name, createdAt: new Date() };
  await db.transaction(async (tx) => {
    await tx.insert(recommendationDismissals).values(values)
      .onConflictDoUpdate({ target: recommendationDismissals.key, set: { ...values } });
    await audit({ actor, action: "DISMISS", entity: "recommendation", label: rec.title, after: { key: rec.key, priority: rec.priority, until: until.toISOString(), reason } }, tx);
  });
}

/** Fait revenir une recommandation écartée. */
export async function restoreRecommendation(key: string, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(recommendationDismissals).where(eq(recommendationDismissals.key, key)).returning();
    if (row) await audit({ actor, action: "RESTORE", entity: "recommendation", label: row.title, before: { key, priority: row.priority, until: row.until.toISOString(), reason: row.reason } }, tx);
  });
}
