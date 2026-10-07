import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contentItems, contentProducts, contentComments } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { isAiConfigured } from "@/lib/ai/client";
import { runStage, creativeErrorMessage } from "@/lib/creative/llm";
import { contentRefs } from "./refs";
import { readAsset, assetMeta } from "./assets";
import { mergeImportedBrief, BRIEF_FIELDS, type BriefState, type ImportedBrief } from "./shared";

/**
 * Brief PDF d'un contenu éditorial : la direction dépose le document (fichier `BRIEF`, versionné dans
 * `content_assets`), le modèle le lit et le formulaire du brief se remplit. Le PDF reste la référence que la
 * personne qui produit télécharge. Seule écriture du brief depuis un document ; sans clé IA, le fichier est
 * gardé et téléchargeable, le formulaire reste à remplir à la main.
 */
export const BRIEF_MIMES = ["application/pdf", "text/plain", "text/markdown"];

const txt = (d: string) => z.string().nullable().describe(d);
export const importedBriefSchema = z.object({
  summary: z.string().describe("Résumé fidèle du besoin, 3 à 8 lignes"),
  keyMessage: txt("Message clé"),
  angle: txt("Angle"),
  hook: txt("Accroche, mot pour mot"),
  caption: txt("Légende prête à publier, mot pour mot"),
  hashtags: txt("Hashtags, mot pour mot"),
  cta: txt("Appel à l'action"),
  constraints: txt("Contraintes : charte, ton, technique, à faire / à éviter"),
  mandatoryMentions: txt("Mentions obligatoires, mot pour mot"),
  forbiddenClaims: txt("Allégations ou mots interdits"),
  deliverables: txt("Livrables attendus : nombre, format, ratio, durée"),
  references: z.array(z.object({ url: z.string(), label: z.string().nullable() })).describe("Liens http(s) présents dans le document"),
  platform: txt("Clé de plateforme (liste des DONNÉES) ou null"),
  format: txt("Clé de format (liste des DONNÉES) ou null"),
  objective: txt("Clé d'objectif (liste des DONNÉES) ou null"),
  deadline: txt("Date de remise du livrable AAAA-MM-JJ, ou null"),
  products: z.array(z.string()).describe("Produits cités"),
  missing: z.array(z.string()).describe("Ce qui manque pour produire sans revenir vers la direction"),
});

export type BriefImportResult = { ok: true; changed: string[]; missing: string[] } | { ok: false; error: string };

type Actor = { id: string; name: string };

/** Lit le brief déposé (`assetId`) et met à jour la fiche du contenu. */
export async function importBriefFromAsset(assetId: string, actor: Actor, opts: { isAdmin: boolean }): Promise<BriefImportResult> {
  const meta = await assetMeta(assetId);
  if (!meta?.contentId || meta.kind !== "BRIEF") return { ok: false, error: "Brief introuvable." };
  if (!BRIEF_MIMES.includes(meta.mime)) return { ok: false, error: "Format non lu automatiquement : déposer le brief en PDF." };
  if (!isAiConfigured()) return { ok: false, error: "Brief enregistré et téléchargeable. Lecture automatique indisponible (clé IA absente sur le serveur) : remplir le formulaire à la main." };
  const file = await readAsset(assetId);
  if (!file) return { ok: false, error: "Brief introuvable." };
  const contentId = meta.contentId;

  const c = (await db.select().from(contentItems).where(eq(contentItems.id, contentId)))[0];
  if (!c) return { ok: false, error: "Contenu introuvable." };
  const [refs, settings, brand, products] = await Promise.all([
    contentRefs(), getSettings(),
    db.execute<{ name: string }>(sql`select name from brands where id = ${c.brandId}::uuid`).then((r) => r.rows[0]?.name ?? ""),
    db.execute<{ name: string }>(sql`select name from products where active and brand_id = ${c.brandId}::uuid order by name`).then((r) => r.rows),
  ]);

  let data: z.infer<typeof importedBriefSchema>;
  try {
    const res = await runStage("brief-import", {
      tier: "fast", schema: importedBriefSchema, effort: "low", maxTokens: 6000,
      documents: [{ mime: meta.mime === "application/pdf" ? "application/pdf" : "text/plain", data: file.data, name: meta.name }],
      context: {
        contenu: { titre: c.title, marque: brand, datePublication: c.date, plateforme: c.platform, format: c.format, objectif: c.objective },
        plateformes: refs.platforms.filter((p) => p.active).map((p) => ({ cle: p.key, libelle: p.label })),
        formats: refs.formats.filter((f) => f.active).map((f) => ({ cle: f.key, libelle: f.label })),
        objectifs: refs.objectives.filter((o) => o.active).map((o) => ({ cle: o.key, libelle: o.label })),
        produitsDeLaMarque: products.map((p) => p.name),
      },
      instruction: "Lis le brief joint et reporte-le dans les champs du formulaire, sans rien inventer.",
      run: { userId: actor.id, isAdmin: opts.isAdmin, ai: settings.ai, conversationId: null, title: `Brief PDF — ${c.title}`, contextPath: `/marketing/planning/${contentId}` },
    });
    data = res.data;
  } catch (e) {
    return { ok: false, error: `Brief enregistré et téléchargeable, mais non lu : ${creativeErrorMessage(e).replace(/^Le studio n'a pas pu générer/, "lecture impossible")}` };
  }

  return applyImportedBrief(contentId, data, actor, `${meta.name} (v${meta.version})`);
}

/**
 * Écrit dans la fiche ce que la lecture du brief a relevé (`mergeImportedBrief()`), dans une transaction :
 * champs, références, produits ajoutés, commentaire dans le fil du contenu et trace `audit_logs` (avant / après).
 */
export async function applyImportedBrief(contentId: string, data: ImportedBrief, actor: Actor, label: string): Promise<BriefImportResult> {
  const c = (await db.select().from(contentItems).where(eq(contentItems.id, contentId)))[0];
  if (!c) return { ok: false, error: "Contenu introuvable." };
  const [refs, products, linked] = await Promise.all([
    contentRefs(),
    db.execute<{ id: string; name: string }>(sql`select id, name from products where active and brand_id = ${c.brandId}::uuid order by name`).then((r) => r.rows),
    db.select({ productId: contentProducts.productId }).from(contentProducts).where(eq(contentProducts.contentId, contentId)),
  ]);
  const current: BriefState = {
    ...Object.fromEntries(BRIEF_FIELDS.map((f) => [f, c[f] ?? null])),
    brief: c.brief, references: c.references ?? [], platform: c.platform, format: c.format, objective: c.objective, deadline: c.deadline,
    productIds: linked.map((l) => l.productId),
  };
  const { patch, changed } = mergeImportedBrief(current, data, {
    platforms: refs.platforms.filter((p) => p.active).map((p) => p.key), formats: refs.formats.filter((f) => f.active).map((f) => f.key),
    objectives: refs.objectives.filter((o) => o.active).map((o) => o.key), products,
  });

  const { productIds, references, ...fields } = patch;
  await db.transaction(async (tx) => {
    await tx.update(contentItems).set({ ...fields, ...(references ? { references: references.map((r) => ({ url: r.url, ...(r.label ? { label: r.label } : {}) })) } : {}), updatedAt: new Date() }).where(eq(contentItems.id, contentId));
    if (productIds) {
      const added = productIds.filter((id) => !current.productIds.includes(id));
      if (added.length) await tx.insert(contentProducts).values(added.map((productId) => ({ contentId, productId }))).onConflictDoNothing();
      if (!c.productId && productIds[0]) await tx.update(contentItems).set({ productId: productIds[0] }).where(eq(contentItems.id, contentId));
    }
    await tx.insert(contentComments).values({
      contentId, userId: actor.id,
      body: changed.length ? `Brief PDF ${label} lu : ${changed.join(", ")} mis à jour.` : `Brief PDF ${label} lu : aucun changement dans le formulaire.`,
    });
    if (changed.length) {
      const before = Object.fromEntries(Object.keys(patch).map((k) => [k, current[k as keyof BriefState] ?? null]));
      await audit({ actor, action: "IMPORT", module: "marketing", entity: "content_item", entityId: contentId, label: `${c.title} — brief PDF ${label}`, before, after: patch }, tx);
    }
  });
  return { ok: true, changed, missing: data.missing ?? [] };
}
