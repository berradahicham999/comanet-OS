/**
 * Rapports automatiques : COMANET WEEKLY et MONTHLY BRAND REVIEW, en Markdown structuré, générés à la demande
 * par le copilote (modèle avancé, lecture seule, huit outils au plus) et enregistrés en brouillon dans
 * `ai_reports`. La direction valide (module Rapports, Valider) ; le rapport ne contient que des chiffres issus
 * des outils et chaque section indique sa source et sa période.
 */
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiReports, brands } from "@/db/schema";
import { getAccess } from "@/lib/permissions";
import { can, isAdmin } from "@/lib/permissions-shared";
import { usersWithPermission } from "@/lib/users";
import { notify } from "@/lib/content/notify";
import { fmtDateLong, fmtMonth } from "@/lib/format";
import { isAiConfigured } from "./client";
import { askCopilot, CopilotError } from "./service";

export type ReportType = "WEEKLY" | "MONTHLY_BRAND_REVIEW";
export const REPORT_TYPE_LABEL: Record<ReportType, string> = { WEEKLY: "COMANET WEEKLY", MONTHLY_BRAND_REVIEW: "MONTHLY BRAND REVIEW" };
export type ReportStatus = "DRAFT" | "VALIDATED" | "ARCHIVED";
export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = { DRAFT: "Brouillon", VALIDATED: "Validé", ARCHIVED: "Archivé" };

export type ReportRow = {
  id: string; type: ReportType; brandId: string | null; brandName: string | null; periodStart: string; periodEnd: string; title: string;
  contentMd: string; sources: unknown; status: ReportStatus; model: string | null; createdById: string | null; validatedById: string | null; validatedAt: string | null; createdAt: string;
};

const WEEKLY_INSTRUCTIONS = `Rédige le COMANET WEEKLY : rapport hebdomadaire de direction en Markdown. Structure imposée (titres de niveau 2), chaque section commençant par une ligne en italique « _Source : … · Période : …_ » :
## Résumé de la semaine — cinq puces maximum, les faits saillants chiffrés.
## Ventes sell-in — CA de la semaine et du mois à date vs période précédente et N-1, objectif du mois, top marques et top produits (get_sales_summary).
## Terrain sell-out — unités et CA TTC, atteinte des objectifs par ville, animatrices sous objectif (get_terrain_summary).
## Clients — segments, clients à risque et retards de commande à traiter (get_client_intelligence).
## Stock — références en rupture ou en tension, commandes conseillées (get_stock_coverage).
## Marketing — budget consommé, campagnes en STOP / OPTIMIZE / SCALE (get_marketing_budget, get_ads_performance).
## Réglementaire — dossiers critiques et à redéposer (get_regulatory_alerts).
## Exécution — recommandations ouvertes et tâches en retard (get_action_center, get_tasks).
## Décisions proposées — trois à cinq actions avec responsable, échéance, résultat attendu et mesure.
Une section dont la donnée est indisponible dit « donnée non disponible dans COMANET OS » et l'import à faire ; elle n'est jamais inventée. Ne mélange jamais sell-in et sell-out. Aucune écriture : le rapport est enregistré par l'application.`;

const MONTHLY_INSTRUCTIONS = `Rédige le MONTHLY BRAND REVIEW d'une marque : revue mensuelle en Markdown. Structure imposée (titres de niveau 2), chaque section commençant par une ligne en italique « _Source : … · Période : …_ » :
## Synthèse — cinq puces maximum.
## Sell-in — CA du mois vs M-1 et N-1, objectif, top produits, clients actifs (get_sales_summary avec brand).
## Sell-out terrain — unités, CA TTC, objectif, palmarès produits (get_terrain_summary avec brand).
## Clients de la marque — segments, à risque, fort potentiel (get_client_intelligence avec brand).
## Stock — couverture par référence, ruptures prévisibles, surstock (get_stock_coverage avec brand).
## Marketing — budget prévu / engagé / dépensé par catégorie, campagnes et verdicts (get_marketing_budget, get_ads_performance avec brand).
## Réglementaire — dossiers de la marque à échéance (get_regulatory_alerts avec brand).
## Lecture — ce que les chiffres montrent, en séparant ce qui est mesuré de ce qui est une corrélation observée.
## Décisions proposées — trois à cinq actions avec responsable, échéance, budget si pertinent, résultat attendu et mesure.
Une section dont la donnée est indisponible le dit et indique l'import à faire ; rien n'est inventé. Aucune écriture : le rapport est enregistré par l'application.`;

function labelPeriod(type: ReportType, start: string, end: string): string {
  if (type === "MONTHLY_BRAND_REVIEW") return fmtMonth(start);
  const endIncl = new Date(end + "T12:00:00Z"); endIncl.setUTCDate(endIncl.getUTCDate() - 1);
  return `semaine du ${fmtDateLong(start)} au ${fmtDateLong(endIncl)}`;
}

export type GenerateInput = { type: ReportType; brandId?: string | null; periodStart: string; periodEnd: string };

export async function generateReport(input: GenerateInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isAiConfigured()) return { ok: false, error: "Copilote non configuré (ANTHROPIC_API_KEY absente)." };
  const access = await getAccess();
  if (!access || !can(access.perms, "rapports", "create")) return { ok: false, error: "Droit « Créer » sur Rapports requis." };
  if (input.periodEnd <= input.periodStart) return { ok: false, error: "Période invalide." };
  let brandName: string | null = null;
  if (input.type === "MONTHLY_BRAND_REVIEW") {
    if (!input.brandId) return { ok: false, error: "Une revue mensuelle porte sur une marque." };
    const [b] = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, input.brandId));
    if (!b) return { ok: false, error: "Marque introuvable." };
    brandName = b.name;
  }
  const period = labelPeriod(input.type, input.periodStart, input.periodEnd);
  const title = input.type === "WEEKLY" ? `COMANET WEEKLY — ${period}` : `MONTHLY BRAND REVIEW — ${brandName} — ${period}`;
  const question = input.type === "WEEKLY"
    ? `Rédige le COMANET WEEKLY pour la ${period} (period = custom, period_start = ${input.periodStart}, period_end = ${input.periodEnd} sur les outils qui acceptent une période).`
    : `Rédige le MONTHLY BRAND REVIEW de la marque « ${brandName} » pour ${period} (period = custom, period_start = ${input.periodStart}, period_end = ${input.periodEnd} ; brand = « ${brandName} » sur chaque outil).`;
  try {
    const out = await askCopilot({
      question, contextPath: "/rapports", tier: "advanced", surface: "report", contextModule: "report",
      surfaceInstructions: input.type === "WEEKLY" ? WEEKLY_INSTRUCTIONS : MONTHLY_INSTRUCTIONS, allowWrites: false, maxToolCalls: 8,
    });
    const sources = out.toolCalls.map((t) => ({ tool: t.name, input: t.input, ok: t.ok, summary: t.summary }));
    const [row] = await db.insert(aiReports).values({
      type: input.type, brandId: input.brandId ?? null, periodStart: input.periodStart, periodEnd: input.periodEnd, title, contentMd: out.text || "(rapport vide)",
      sources, status: "DRAFT", model: out.model, createdById: access.user.id,
    }).returning({ id: aiReports.id });
    const validators = await usersWithPermission("rapports", "validate");
    await notify(validators.map((u) => u.id), { type: "REPORT_DRAFT", title: "Un rapport attend votre validation", body: title, href: `/rapports/${row.id}`, entityType: "report", entityId: row.id }, { except: access.user.id });
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof CopilotError ? e.message : "Le copilote n'a pas pu produire le rapport." };
  }
}

function toRow(r: typeof aiReports.$inferSelect & { brandName?: string | null }): ReportRow {
  return {
    id: r.id, type: r.type as ReportType, brandId: r.brandId, brandName: r.brandName ?? null, periodStart: r.periodStart, periodEnd: r.periodEnd, title: r.title, contentMd: r.contentMd,
    sources: r.sources, status: r.status as ReportStatus, model: r.model, createdById: r.createdById, validatedById: r.validatedById, validatedAt: r.validatedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
  };
}

export async function listReports(opts: { brandIds?: string[] | null; limit?: number } = {}): Promise<ReportRow[]> {
  const rows = await db.select({ r: aiReports, brandName: brands.name }).from(aiReports).leftJoin(brands, eq(brands.id, aiReports.brandId)).orderBy(desc(aiReports.createdAt)).limit(opts.limit ?? 100);
  return rows.map((x) => toRow({ ...x.r, brandName: x.brandName })).filter((r) => !opts.brandIds || !r.brandId || opts.brandIds.includes(r.brandId));
}

export async function getReport(id: string): Promise<ReportRow | null> {
  const [x] = await db.select({ r: aiReports, brandName: brands.name }).from(aiReports).leftJoin(brands, eq(brands.id, aiReports.brandId)).where(eq(aiReports.id, id));
  return x ? toRow({ ...x.r, brandName: x.brandName }) : null;
}

/** Valider = action irréversible réservée à Valider sur Rapports (ou administrateur). */
export async function setReportStatus(id: string, status: ReportStatus): Promise<{ ok: boolean; error?: string }> {
  const access = await getAccess();
  if (!access) return { ok: false, error: "Non connecté." };
  const allowed = status === "VALIDATED" ? can(access.perms, "rapports", "validate") || isAdmin(access.perms) : can(access.perms, "rapports", "edit") || isAdmin(access.perms);
  if (!allowed) return { ok: false, error: "Droit insuffisant sur Rapports." };
  await db.update(aiReports).set(status === "VALIDATED" ? { status, validatedById: access.user.id, validatedAt: new Date() } : { status }).where(and(eq(aiReports.id, id)));
  return { ok: true };
}

/** Périodes proposées : quatre dernières semaines complètes (lundi → lundi) et six derniers mois. */
export function reportPeriods(now: Date): { weeks: { start: string; end: string; label: string }[]; months: { start: string; end: string; label: string }[] } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const weeks = Array.from({ length: 4 }, (_, i) => {
    const end = new Date(monday); end.setUTCDate(end.getUTCDate() - 7 * i);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - 7);
    return { start: iso(start), end: iso(end), label: labelPeriod("WEEKLY", iso(start), iso(end)) };
  });
  const months = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return { start: iso(start), end: iso(end), label: fmtMonth(iso(start)) };
  });
  return { weeks, months };
}
