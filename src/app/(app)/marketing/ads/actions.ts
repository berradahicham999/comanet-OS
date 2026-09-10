"use server";

/**
 * Actions serveur du Ads Command Center. Lecture + analyse + recommandation : aucune écriture
 * vers Meta. « Appliquer une recommandation » n'existe pas encore ; quand ce sera le cas, ce
 * sera ici, derrière une confirmation humaine explicite.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requirePermission } from "@/lib/permissions";
import { hasMetaToken } from "@/lib/meta/client";
import { syncAll } from "@/lib/meta/sync";
import { backfillAll, catalogAll } from "@/lib/meta/backfill";
import { rematchEntities } from "@/lib/meta/entities";
import { entityDetail, searchHistory, type HistorySearch } from "@/lib/ads-intel/command-center";
import type { EntityDetail, EntityLevel, EntityPerf } from "@/lib/ads-intel/types";

export async function loadEntityDetail(level: EntityLevel, externalId: string, periodKey: string, custom?: { start?: string; end?: string }): Promise<EntityDetail | null> {
  await requirePermission("marketing", "view");
  return entityDetail(level, externalId, periodKey, custom);
}

export async function searchAdsHistory(q: HistorySearch): Promise<EntityPerf[]> {
  await requirePermission("marketing", "view");
  return searchHistory({ ...q, limit: Math.min(50, q.limit ?? 30) });
}

export type SyncNowResult = { ok: boolean; message: string };

/** Synchronisation immédiate (fenêtre glissante complète), tous comptes activés. */
export async function syncMetaNow(): Promise<SyncNowResult> {
  await requirePermission("marketing", "edit");
  if (!hasMetaToken()) return { ok: false, message: "Aucun jeton Meta configuré (META_ACCESS_TOKEN)." };
  const results = await syncAll({ mode: "full" });
  revalidatePath("/marketing/ads");
  const errors = results.filter((r) => !r.ok);
  if (!results.length) return { ok: false, message: "Aucun compte activé pour la synchronisation." };
  if (errors.length) return { ok: false, message: errors.map((e) => `${e.accountName} : ${e.error}`).join(" · ") };
  return { ok: true, message: `${results.reduce((a, r) => a + r.rows, 0)} lignes relues sur ${results.length} compte(s).` };
}

/** Un passage de rattrapage historique (quelques mois par compte), reprenable. */
export async function runBackfillNow(formData: FormData): Promise<void> {
  await requirePermission("marketing", "edit");
  if (!hasMetaToken()) return;
  const months = Number(formData.get("months")) || 6;
  await backfillAll({ monthsPerRun: Math.min(12, Math.max(1, months)) });
  revalidatePath("/marketing/ads/comptes");
  revalidatePath("/marketing/ads");
}

/** Recataloguer campagnes / ensembles / publicités / créatives (sans relire les insights). */
export async function runCatalogNow(): Promise<void> {
  await requirePermission("marketing", "edit");
  if (!hasMetaToken()) return;
  await catalogAll();
  revalidatePath("/marketing/ads/comptes");
  revalidatePath("/marketing/ads");
}

/** Recalcule produits et étiquettes depuis le catalogue déjà en base (aucun appel Meta). */
export async function rematchNow(): Promise<void> {
  await requirePermission("marketing", "edit");
  await rematchEntities();
  revalidatePath("/marketing/ads");
}

/** Relance le rattrapage d'un compte depuis le début (le curseur repart de `metaHistoryStart`). */
export async function restartBackfill(formData: FormData): Promise<void> {
  await requirePermission("marketing", "edit");
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await db.execute(sql`update ad_accounts set backfill_cursor = null, backfill_status = 'IDLE', backfill_error = null, backfill_gaps = '[]'::jsonb where id = ${id}::uuid`);
  revalidatePath("/marketing/ads/comptes");
}

/** Corrige à la main le produit d'une publicité ou d'une créative : jamais écrasé par le catalogage. */
export async function setEntityProduct(formData: FormData): Promise<void> {
  await requirePermission("marketing", "edit");
  const id = String(formData.get("id") ?? "");
  const productId = String(formData.get("productId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await db.execute(sql`
    update ad_entities set product_id = ${productId || null}::uuid, product_source = 'MANUAL' where id = ${id}::uuid`);
  revalidatePath("/marketing/ads");
}
