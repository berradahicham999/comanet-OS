/**
 * Bibliothèque d'actions (serveur) — seule écriture de `action_templates` et `brand_marketing_playbooks`.
 *
 * Bibliothèque effective = modèles livrés (`TEMPLATES`, code) + changements de l'équipe (base) : une ligne de même
 * clé qu'un modèle livré le remplace (modifié) ou le retire (désactivé) ; les autres lignes s'ajoutent (créés,
 * importés, repris d'une action ou d'une activation réussie). Toute écriture laisse une trace `audit()`.
 */
import "server-only";
import { cache } from "react";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { actionTemplates, brandMarketingPlaybooks } from "@/db/schema";
import { audit, type AuditActor } from "@/lib/audit";
import { TEMPLATES } from "./catalog";
import { validateTemplate, type TemplateSource } from "./library-shared";
import type { ActionTemplate, AxisKey, BrandPlaybook } from "./types";

export type LibraryEntry = { template: ActionTemplate; source: TemplateSource; active: boolean; modified: boolean; system: boolean; updatedAt: string | null; originActionId: string | null; originActivationId: string | null; invalid: string[] | null };

const SYSTEM_KEYS = new Set(TEMPLATES.map((t) => t.key));

/** Toute la bibliothèque, y compris les modèles désactivés (page Bibliothèque). */
export const listLibrary = cache(async (): Promise<LibraryEntry[]> => {
  const rows = await db.select().from(actionTemplates).catch((e) => { console.error("Bibliothèque d'actions illisible (migration 0047 ?)", e); return [] as (typeof actionTemplates.$inferSelect)[]; });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out: LibraryEntry[] = [];
  for (const t of TEMPLATES) {
    const r = byKey.get(t.key);
    const v = r ? validateTemplate({ ...r.data, key: t.key }) : null;
    out.push({ template: v && v.ok ? v.template : t, source: "SYSTEME", active: r ? r.active : true, modified: !!r && !!v?.ok, system: true, updatedAt: r ? r.updatedAt.toISOString() : null, originActionId: null, originActivationId: null, invalid: v && !v.ok ? v.errors : null });
  }
  for (const r of rows) {
    if (SYSTEM_KEYS.has(r.key)) continue;
    const v = validateTemplate({ ...r.data, key: r.key });
    out.push({ template: v.ok ? v.template : ({ ...(r.data as object), key: r.key } as ActionTemplate), source: (r.source as TemplateSource) ?? "EQUIPE", active: r.active && v.ok, modified: false, system: false, updatedAt: r.updatedAt.toISOString(), originActionId: r.originActionId, originActivationId: r.originActivationId, invalid: v.ok ? null : v.errors });
  }
  return out;
});

/** Modèles actifs et valides : ce que le générateur utilise. */
export async function loadLibrary(): Promise<ActionTemplate[]> {
  return (await listLibrary()).filter((e) => e.active && !e.invalid).map((e) => e.template);
}

export async function libraryTemplate(key: string): Promise<LibraryEntry | null> {
  return (await listLibrary()).find((e) => e.template.key === key) ?? null;
}

export async function saveTemplate(raw: unknown, actor: AuditActor, o: { source?: TemplateSource; originActionId?: string | null; originActivationId?: string | null } = {}): Promise<{ ok: true; key: string } | { ok: false; errors: string[] }> {
  const v = validateTemplate(raw);
  if (!v.ok) return v;
  const t = v.template;
  const system = SYSTEM_KEYS.has(t.key);
  await db.transaction(async (tx) => {
    const before = await tx.query.actionTemplates.findFirst({ where: eq(actionTemplates.key, t.key) });
    const source = system ? "SYSTEME" : o.source ?? (before?.source as TemplateSource | undefined) ?? "EQUIPE";
    await tx.insert(actionTemplates).values({ key: t.key, data: t as unknown as Record<string, unknown>, source, active: before?.active ?? true, originActionId: o.originActionId ?? before?.originActionId ?? null, originActivationId: o.originActivationId ?? before?.originActivationId ?? null, createdById: actor.id, updatedById: actor.id })
      .onConflictDoUpdate({ target: actionTemplates.key, set: { data: t as unknown as Record<string, unknown>, updatedById: actor.id, updatedAt: new Date() } });
    await audit({ actor, action: before ? "UPDATE" : "CREATE", module: "marketing", entity: "action_template", label: `${t.family} — ${t.name}`, after: { key: t.key, source, system } }, tx);
  });
  return { ok: true, key: t.key };
}

/** Active ou désactive un modèle (livré : une ligne de désactivation est créée ; rien n'est supprimé). */
export async function setTemplateActive(key: string, active: boolean, actor: AuditActor): Promise<void> {
  const system = TEMPLATES.find((t) => t.key === key) ?? null;
  await db.transaction(async (tx) => {
    const before = await tx.query.actionTemplates.findFirst({ where: eq(actionTemplates.key, key) });
    if (!before && !system) throw new Error("Modèle introuvable.");
    if (before) await tx.update(actionTemplates).set({ active, updatedById: actor.id, updatedAt: new Date() }).where(eq(actionTemplates.key, key));
    else await tx.insert(actionTemplates).values({ key, data: system as unknown as Record<string, unknown>, source: "SYSTEME", active, createdById: actor.id, updatedById: actor.id });
    await audit({ actor, action: active ? "RESTORE" : "ARCHIVE", module: "marketing", entity: "action_template", label: key, before: { active: before?.active ?? true }, after: { active } }, tx);
  });
}

/** Modèle livré : revenir à la version d'origine (supprime la modification). Modèle de l'équipe : suppression. */
export async function resetOrDeleteTemplate(key: string, actor: AuditActor): Promise<"RESET" | "DELETED"> {
  return db.transaction(async (tx) => {
    const before = await tx.query.actionTemplates.findFirst({ where: eq(actionTemplates.key, key) });
    if (!before) throw new Error("Rien à supprimer.");
    await tx.delete(actionTemplates).where(eq(actionTemplates.key, key));
    const system = SYSTEM_KEYS.has(key);
    await audit({ actor, action: system ? "RESET" : "DELETE", module: "marketing", entity: "action_template", label: key, before: { source: before.source, active: before.active } }, tx);
    return system ? "RESET" : "DELETED";
  });
}

/** Import Excel : chaque ligne valide est créée ou remplace le modèle de même clé ; les lignes invalides sont rapportées. */
export async function importTemplates(rows: { line: number; raw: unknown }[], actor: AuditActor): Promise<{ saved: string[]; errors: string[] }> {
  const saved: string[] = [], errors: string[] = [];
  for (const r of rows) {
    const res = await saveTemplate(r.raw, actor, { source: "IMPORT" });
    if (res.ok) saved.push(res.key); else errors.push(`ligne ${r.line} : ${res.errors.slice(0, 3).join(" ; ")}`);
  }
  return { saved, errors };
}

/* ------------------------------ Ce qui marche par marque ------------------------------ */

export async function playbookFor(brandId: string): Promise<BrandPlaybook | null> {
  const r = await db.query.brandMarketingPlaybooks.findFirst({ where: eq(brandMarketingPlaybooks.brandId, brandId) }).catch(() => null);
  return r ? { levers: r.levers as Partial<Record<AxisKey, number>>, favorites: r.favorites, avoid: r.avoid, note: r.note } : null;
}

export async function listPlaybooks(brandIds: string[]): Promise<Map<string, BrandPlaybook & { updatedAt: string }>> {
  if (!brandIds.length) return new Map();
  const rows = await db.select().from(brandMarketingPlaybooks).where(inArray(brandMarketingPlaybooks.brandId, brandIds)).catch(() => []);
  return new Map(rows.map((r) => [r.brandId, { levers: r.levers as Partial<Record<AxisKey, number>>, favorites: r.favorites, avoid: r.avoid, note: r.note, updatedAt: r.updatedAt.toISOString() }]));
}

export async function savePlaybook(brandId: string, p: BrandPlaybook, actor: AuditActor): Promise<void> {
  const levers = Object.fromEntries(Object.entries(p.levers).filter(([, v]) => typeof v === "number" && v > 0).map(([k, v]) => [k, Math.max(0, Math.min(1, v as number))]));
  await db.transaction(async (tx) => {
    const before = await tx.query.brandMarketingPlaybooks.findFirst({ where: eq(brandMarketingPlaybooks.brandId, brandId) });
    await tx.insert(brandMarketingPlaybooks).values({ brandId, levers, favorites: p.favorites, avoid: p.avoid, note: p.note, updatedById: actor.id })
      .onConflictDoUpdate({ target: brandMarketingPlaybooks.brandId, set: { levers, favorites: p.favorites, avoid: p.avoid, note: p.note, updatedById: actor.id, updatedAt: sql`now()` } });
    await audit({ actor, action: before ? "UPDATE" : "CREATE", module: "marketing", entity: "brand_playbook", entityId: brandId, label: "Ce qui marche par marque", before: before ? { levers: before.levers, favorites: before.favorites, avoid: before.avoid, note: before.note } : undefined, after: { levers, favorites: p.favorites, avoid: p.avoid, note: p.note } }, tx);
  });
}
