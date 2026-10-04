/**
 * Persistance du studio créatif — SEULE écriture de `creative_concepts` et `creative_packages` (serveur).
 *
 * Un concept naît PROPOSED ; la personne l'approuve, l'écarte (motif), construit son package (BUILT), l'envoie au
 * planning éditorial (SENT, lien `content_item_id`) ou l'archive. Chaque décision laisse une trace `audit_logs`.
 * Les opportunités ne sont jamais stockées ; la mémoire de performance se lit dans les modules existants.
 */
import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { creativeConcepts, creativePackages } from "@/db/schema";
import { audit, type AuditActor } from "@/lib/audit";
import { pgArray } from "@/lib/sql-array";
import type { ConceptReview, ConceptStatus, ContentPackage, CreativeConcept, FunnelStage, ObjectiveKey, RecentConcept, StoredConcept, TerritoryKey, VariationSet } from "./types";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ConceptInsert = { brandId: string; productId: string | null; opportunityKey: string; objective: ObjectiveKey; concept: CreativeConcept; model: string | null };

export async function saveConcepts(rows: ConceptInsert[], actor: AuditActor): Promise<string[]> {
  if (!rows.length) return [];
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(creativeConcepts).values(rows.map((r) => ({
      brandId: r.brandId, productId: r.productId, opportunityKey: r.opportunityKey, fingerprint: r.concept.fingerprint, territory: r.concept.creativeTerritory, mechanic: r.concept.mechanic,
      tensionKey: r.concept.tensionKey, hookType: r.concept.hookType, format: r.concept.recommendedFormat, funnelStage: r.concept.funnelStage, objective: r.objective, title: r.concept.title,
      concept: r.concept as unknown as Record<string, unknown>, score: r.concept.scores.overall, status: "PROPOSED", generatedBy: r.concept.generatedBy, model: r.model, createdById: actor.id,
    }))).returning({ id: creativeConcepts.id, title: creativeConcepts.title });
    for (const row of inserted) await audit({ actor, action: "CREATE", module: "marketing", entity: "creative_concept", entityId: row.id, label: row.title, after: { opportunityKey: rows[0].opportunityKey } }, tx);
    return inserted.map((r) => r.id);
  });
}

type Row = typeof creativeConcepts.$inferSelect & { brand_name?: string; product_name?: string | null; has_package?: boolean };

function toStored(r: Row, brandName: string, productName: string | null, hasPackage: boolean): StoredConcept {
  return {
    id: r.id, brandId: r.brandId, brandName, productId: r.productId, productName, opportunityKey: r.opportunityKey, status: r.status as ConceptStatus, score: r.score,
    concept: r.concept as unknown as CreativeConcept, contentItemId: r.contentItemId, rejectReason: r.rejectReason, model: r.model, createdAt: r.createdAt.toISOString(), hasPackage,
  };
}

export type ConceptFilter = { brandIds?: string[] | null; opportunityKey?: string | null; statuses?: ConceptStatus[] | null; productId?: string | null; limit?: number };

export async function listConcepts(f: ConceptFilter = {}): Promise<StoredConcept[]> {
  const r = await db.execute<Row & { brand_name: string; product_name: string | null; has_package: boolean; created_at: string }>(sql`
    select c.*, b.name as brand_name, p.name as product_name, exists (select 1 from creative_packages k where k.concept_id = c.id) as has_package
    from creative_concepts c join brands b on b.id = c.brand_id left join products p on p.id = c.product_id
    where true
      ${f.brandIds ? sql`and c.brand_id = any(${pgArray(f.brandIds)})` : sql``}
      ${f.opportunityKey ? sql`and c.opportunity_key = ${f.opportunityKey}` : sql``}
      ${f.statuses?.length ? sql`and c.status = any(${pgArray(f.statuses, "text")})` : sql``}
      ${f.productId ? sql`and c.product_id = ${f.productId}::uuid` : sql``}
    order by c.created_at desc, c.score desc limit ${f.limit ?? 50}`);
  return r.rows.map((x) => {
    const row = x as unknown as Record<string, unknown>;
    return toStored({
      ...(x as unknown as Row), id: String(row.id), brandId: String(row.brand_id), productId: (row.product_id as string | null) ?? null, opportunityKey: String(row.opportunity_key), status: String(row.status) as ConceptStatus,
      score: Number(row.score), concept: row.concept as Record<string, unknown>, contentItemId: (row.content_item_id as string | null) ?? null, rejectReason: (row.reject_reason as string | null) ?? null, model: (row.model as string | null) ?? null,
      createdAt: new Date(String(row.created_at)),
    } as Row, String(row.brand_name), (row.product_name as string | null) ?? null, !!row.has_package);
  });
}

export type ConceptDetail = StoredConcept & {
  objective: ObjectiveKey; funnelStage: FunnelStage; territory: TerritoryKey; brandColor: string;
  packageId: string | null; package: ContentPackage | null; variations: VariationSet | null; briefMd: string | null; packageReview: ConceptReview | null; packageModel: string | null; packageVersion: number;
};

export async function getConcept(id: string): Promise<ConceptDetail | null> {
  const [c] = await db.select().from(creativeConcepts).where(eq(creativeConcepts.id, id));
  if (!c) return null;
  const [meta, pkg] = await Promise.all([
    db.execute<{ brand_name: string; brand_color: string; product_name: string | null }>(sql`select b.name as brand_name, b.color as brand_color, p.name as product_name from brands b left join products p on p.id = ${c.productId ? sql`${c.productId}::uuid` : sql`null::uuid`} where b.id = ${c.brandId}::uuid`),
    db.select().from(creativePackages).where(eq(creativePackages.conceptId, id)).orderBy(desc(creativePackages.version)).limit(1),
  ]);
  const m = meta.rows[0];
  const k = pkg[0] ?? null;
  return {
    ...toStored(c, m?.brand_name ?? "", m?.product_name ?? null, !!k), objective: c.objective as ObjectiveKey, funnelStage: c.funnelStage as FunnelStage, territory: c.territory as TerritoryKey, brandColor: m?.brand_color ?? "#0f766e",
    packageId: k?.id ?? null, package: (k?.package as unknown as ContentPackage) ?? null, variations: (k?.variations as unknown as VariationSet | null) ?? null, briefMd: k?.briefMd ?? null,
    packageReview: (k?.review as unknown as ConceptReview | null) ?? null, packageModel: k?.model ?? null, packageVersion: k?.version ?? 0,
  };
}

/** Concepts récents d'une marque (fenêtre de fatigue), pour la non-répétition. */
export async function recentConceptsFor(brandId: string, sinceIso: string): Promise<RecentConcept[]> {
  const rows = await db.select({ id: creativeConcepts.id, fingerprint: creativeConcepts.fingerprint, title: creativeConcepts.title, createdAt: creativeConcepts.createdAt, status: creativeConcepts.status, mechanic: creativeConcepts.mechanic, territory: creativeConcepts.territory, tensionKey: creativeConcepts.tensionKey, hookType: creativeConcepts.hookType, productId: creativeConcepts.productId })
    .from(creativeConcepts).where(and(eq(creativeConcepts.brandId, brandId), sql`${creativeConcepts.createdAt} >= ${sinceIso}::date`, sql`${creativeConcepts.status} <> 'REJECTED'`)).orderBy(desc(creativeConcepts.createdAt)).limit(200);
  return rows.map((r) => ({ id: r.id, fingerprint: r.fingerprint, title: r.title, date: r.createdAt.toISOString().slice(0, 10), status: r.status, mechanic: r.mechanic, territory: r.territory as TerritoryKey, tensionKey: r.tensionKey, hookType: r.hookType as RecentConcept["hookType"], productId: r.productId }));
}

const ALLOWED: Record<ConceptStatus, ConceptStatus[]> = {
  PROPOSED: ["APPROVED", "REJECTED", "BUILT", "ARCHIVED"], APPROVED: ["BUILT", "REJECTED", "ARCHIVED", "PROPOSED"], BUILT: ["SENT", "REJECTED", "ARCHIVED", "APPROVED"],
  REJECTED: ["PROPOSED"], SENT: ["ARCHIVED"], ARCHIVED: ["PROPOSED"],
};

export async function setConceptStatus(id: string, status: ConceptStatus, actor: AuditActor, reason: string | null = null): Promise<void> {
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(creativeConcepts).where(eq(creativeConcepts.id, id));
    if (!cur) throw new Error("Concept introuvable.");
    if (cur.status !== status && !ALLOWED[cur.status as ConceptStatus].includes(status)) throw new Error(`Passage ${cur.status} → ${status} non autorisé.`);
    await tx.update(creativeConcepts).set({ status, rejectReason: status === "REJECTED" ? reason : cur.rejectReason, decidedById: actor.id, decidedAt: new Date(), updatedAt: new Date() }).where(eq(creativeConcepts.id, id));
    await audit({ actor, action: status === "REJECTED" ? "CANCEL" : status === "APPROVED" ? "VALIDATE" : "UPDATE", module: "marketing", entity: "creative_concept", entityId: id, label: cur.title, before: { status: cur.status }, after: { status, reason } }, tx);
  });
}

/** Régénérer : les concepts encore proposés de l'opportunité passent en ARCHIVED (rien n'est supprimé). */
export async function archiveProposed(opportunityKey: string, actor: AuditActor): Promise<number> {
  const rows = await db.update(creativeConcepts).set({ status: "ARCHIVED", decidedById: actor.id, decidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(creativeConcepts.opportunityKey, opportunityKey), eq(creativeConcepts.status, "PROPOSED"))).returning({ id: creativeConcepts.id, title: creativeConcepts.title });
  for (const r of rows) await audit({ actor, action: "ARCHIVE", module: "marketing", entity: "creative_concept", entityId: r.id, label: r.title, after: { reason: "régénération" } });
  return rows.length;
}

export async function savePackage(conceptId: string, input: { pkg: ContentPackage; briefMd: string; review: ConceptReview | null; model: string | null }, actor: AuditActor): Promise<string> {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(creativeConcepts).where(eq(creativeConcepts.id, conceptId));
    if (!cur) throw new Error("Concept introuvable.");
    const [last] = await tx.select({ version: creativePackages.version }).from(creativePackages).where(eq(creativePackages.conceptId, conceptId)).orderBy(desc(creativePackages.version)).limit(1);
    const [row] = await tx.insert(creativePackages).values({ conceptId, version: (last?.version ?? 0) + 1, package: input.pkg as unknown as Record<string, unknown>, briefMd: input.briefMd, review: (input.review as unknown as Record<string, unknown>) ?? null, model: input.model, createdById: actor.id }).returning({ id: creativePackages.id });
    if (cur.status === "PROPOSED" || cur.status === "APPROVED") await tx.update(creativeConcepts).set({ status: "BUILT", updatedAt: new Date() }).where(eq(creativeConcepts.id, conceptId));
    await audit({ actor, action: "CREATE", module: "marketing", entity: "creative_package", entityId: row.id, label: cur.title, after: { conceptId, version: (last?.version ?? 0) + 1, generatedBy: input.pkg.generatedBy } }, tx);
    return row.id;
  });
}

export async function saveVariations(packageId: string, variations: VariationSet): Promise<void> {
  await db.update(creativePackages).set({ variations: variations as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(creativePackages.id, packageId));
}

/** Envoi au planning : le concept pointe vers son contenu et passe SENT (dans la transaction de création du contenu). */
export async function markSent(conceptId: string, contentItemId: string, actor: AuditActor, tx: Tx): Promise<void> {
  const [cur] = await tx.select({ title: creativeConcepts.title, status: creativeConcepts.status }).from(creativeConcepts).where(eq(creativeConcepts.id, conceptId));
  await tx.update(creativeConcepts).set({ status: "SENT", contentItemId, decidedById: actor.id, decidedAt: new Date(), updatedAt: new Date() }).where(eq(creativeConcepts.id, conceptId));
  await audit({ actor, action: "VALIDATE", module: "marketing", entity: "creative_concept", entityId: conceptId, label: cur?.title ?? null, before: { status: cur?.status }, after: { status: "SENT", contentItemId } }, tx);
}

/** Instantané de performance d'un concept envoyé (mémoire créative), rafraîchi à la lecture de la fiche. */
export async function savePerformanceSnapshot(conceptId: string, snapshot: Record<string, unknown>): Promise<void> {
  await db.update(creativeConcepts).set({ performance: snapshot, performanceAt: new Date() }).where(eq(creativeConcepts.id, conceptId));
}

export async function studioCounters(brandIds: string[] | null): Promise<{ proposed: number; built: number; sent: number }> {
  const r = await db.select({ status: creativeConcepts.status, n: sql<number>`count(*)::int` }).from(creativeConcepts).where(brandIds ? inArray(creativeConcepts.brandId, brandIds.length ? brandIds : ["00000000-0000-0000-0000-000000000000"]) : sql`true`).groupBy(creativeConcepts.status);
  const by = new Map(r.map((x) => [x.status, Number(x.n)]));
  return { proposed: (by.get("PROPOSED") ?? 0) + (by.get("APPROVED") ?? 0), built: by.get("BUILT") ?? 0, sent: by.get("SENT") ?? 0 };
}
