/**
 * Aides communes aux outils : période, périmètre, arrondis, réponses « donnée indisponible ».
 * Logique pure, testée sans base.
 */
import { z } from "zod";
import { resolvePeriod, type PeriodParam } from "@/lib/periods";
import { MARKETING_PERIOD_KEYS } from "@/lib/marketing-intel/build";
import { gatesFor } from "@/lib/marketing-intel/gates";
import type { IntelContext } from "@/lib/marketing-intel/types";
import type { ToolAccess, ToolContext, ToolResult } from "./types";

/** Nombre maximal de lignes renvoyées au modèle : il a besoin d'agrégats et d'un top N, pas d'un export. */
export const MAX_ROWS = 50;

export const PERIOD_KEYS = ["month", "prevMonth", "quarter", "ytd", "year", "last30", "last90", "last12m", "custom"] as const;

export const periodSchema = z
  .enum(PERIOD_KEYS)
  .default("month")
  .describe("Période : month (mois en cours), prevMonth, quarter, ytd, year, last30, last90, last12m, ou custom avec period_start/period_end (AAAA-MM-JJ, fin exclue).");

export const customPeriodFields = {
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Début (AAAA-MM-JJ) si period = custom."),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fin exclue (AAAA-MM-JJ) si period = custom."),
};

/** Résout la période demandée sur la date de référence choisie (ventes : dernier import ; terrain : aujourd'hui). */
export function periodOf(input: { period?: PeriodParam; period_start?: string; period_end?: string }, ref: Date) {
  const p = resolvePeriod(input.period ?? "month", ref, { start: input.period_start, end: input.period_end });
  return { key: p.key, start: p.start, end: p.end, label: p.label, prev: p.prev, n1: p.n1, days: p.days };
}

export function round(v: number | null | undefined, digits = 0): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return round(((cur - prev) / prev) * 100, 1);
}

export function unavailable(reason: string, howToFix: string, source?: string): ToolResult {
  return { available: false, reason, howToFix, source };
}

/** Une marque demandée hors des marques assignées à la personne : refus explicite, jamais un résultat vide silencieux. */
export function brandOutOfScope(name: string): ToolResult {
  return unavailable(
    `La marque « ${name} » n'est pas dans votre périmètre.`,
    "Demander à un administrateur d'ajouter la marque à vos marques assignées (Paramètres → Utilisateurs).",
  );
}

/** Marques effectivement interrogeables : la marque demandée croisée avec la portée. */
export async function resolveBrand(ctx: ToolContext, brandQuery: string | undefined): Promise<{ brand: { id: string; name: string } | null; error?: ToolResult }> {
  if (!brandQuery) return { brand: null };
  const brand = await ctx.deps.findBrand(brandQuery);
  if (!brand) return { brand: null, error: unavailable(`Marque « ${brandQuery} » introuvable dans COMANET OS.`, "Vérifier l'orthographe ou utiliser search_entities pour retrouver le nom exact.") };
  if (ctx.access.brandIds && !ctx.access.brandIds.includes(brand.id)) return { brand: null, error: brandOutOfScope(brand.name) };
  return { brand };
}

/** Texte du périmètre appliqué, à renvoyer dans chaque résultat. */
export function scopeLabel(access: ToolAccess, parts: (string | null | undefined)[] = []): string {
  const bits = parts.filter((p): p is string => !!p);
  if (access.brandIds) bits.push(`marques assignées (${access.brandIds.length})`);
  if (access.clientIds) bits.push(`clients assignés (${access.clientIds.length})`);
  if (access.ownOnly) bits.push("mes données uniquement");
  return bits.length ? bits.join(" · ") : "toutes marques, tous clients";
}

/** Un mot recherché est-il contenu dans un libellé (sans accents ni casse) ? */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function limitOf(v: number | undefined, fallback = 10): number {
  return Math.min(MAX_ROWS, Math.max(1, v ?? fallback));
}

/** Filtre les lignes d'un tableau à la portée « marques assignées » (id de marque sur la ligne). */
export function inBrandScope<T>(rows: T[], access: ToolAccess, brandIdOf: (r: T) => string | null | undefined): T[] {
  if (!access.brandIds) return rows;
  const set = new Set(access.brandIds);
  return rows.filter((r) => {
    const id = brandIdOf(r);
    return id ? set.has(id) : true;
  });
}

/* ------------------------------ Agent marketing ------------------------------ */

/** Périodes des outils marketing : 7d / 30d / 90d / ytd et les périodes calendaires ; comparaison = période précédente de même longueur. */
export const marketingPeriodSchema = z
  .enum(MARKETING_PERIOD_KEYS)
  .default("30d")
  .describe("Période : 7d, 30d (défaut), 90d, ytd (année en cours), month (mois en cours à date), prevMonth, quarter, last12m, ou custom avec period_start/period_end (AAAA-MM-JJ, fin exclue). Comparaison : période précédente de même longueur.");

/** Contexte de la couche Marketing Intelligence pour la personne connectée : mêmes dépendances, portes déduites de ses droits. */
export function intelContext(ctx: ToolContext): IntelContext {
  return {
    deps: ctx.deps, settings: ctx.settings, refDate: ctx.refDate, now: ctx.now,
    gates: gatesFor(ctx.access.perms, ctx.access.seeInternalCosts),
    scopeBrandIds: ctx.access.brandIds, scopeClientIds: ctx.access.clientIds,
  };
}

/** Nombre de jours entre la date de référence des ventes et aujourd'hui (retard d'import). */
export function staleDays(ctx: ToolContext): number {
  return Math.max(0, Math.round((ctx.now.getTime() - ctx.refDate.getTime()) / 86_400_000));
}

/** Note de fraîcheur à répéter dans chaque réponse de l'agent marketing. */
export function freshnessNotes(ctx: ToolContext, stockDate?: string | null): string[] {
  const d = ctx.refDate.toISOString().slice(0, 10);
  const stale = staleDays(ctx);
  const notes = [stale > 0 ? `Données de vente Sage à jour au ${d} (${stale} jour(s) de retard sur aujourd'hui).` : `Données de vente Sage à jour au ${d}.`];
  if (stockDate !== undefined) notes.push(stockDate ? `Photo de stock du ${stockDate}.` : "Aucune photo de stock : couverture non mesurable.");
  return notes;
}

/** Légende des étiquettes de fiabilité, jointe aux résultats de l'agent marketing. */
export const DATA_TAGS_LEGEND = { CONFIRMED: "lu tel quel (facture, photo de stock, objectif saisi)", CALCULATED: "formule officielle (couverture, croissance, contribution, run-rate)", INFERRED: "interprétation (profil, catégorie, décision)", MISSING: "absent — jamais estimé" } as const;
