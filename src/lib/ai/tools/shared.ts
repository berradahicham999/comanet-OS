/**
 * Aides communes aux outils : période, périmètre, arrondis, réponses « donnée indisponible ».
 * Logique pure, testée sans base.
 */
import { z } from "zod";
import { resolvePeriod, type PeriodParam } from "@/lib/periods";
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
