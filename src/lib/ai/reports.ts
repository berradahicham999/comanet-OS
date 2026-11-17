/**
 * Rapports automatiques : COMANET WEEKLY et MONTHLY BRAND REVIEW, en Markdown structuré, générés à la demande
 * par le copilote (modèle avancé, lecture seule, huit outils au plus) et enregistrés en brouillon dans
 * `ai_reports`. La direction valide (module Rapports, Valider) ; le rapport ne contient que des chiffres issus
 * des outils et chaque section indique sa source et sa période.
 */
import "server-only";
import { and, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiReports, brands } from "@/db/schema";
import { getAccess } from "@/lib/permissions";
import { can, isAdmin } from "@/lib/permissions-shared";
import { notify } from "@/lib/content/notify";
import { fmtDateLong, fmtMonth } from "@/lib/format";
import { isAiConfigured } from "./client";
import { askCopilot, CopilotError } from "./service";
import { getSettings } from "@/lib/settings";
import { hiddenRuleIds, hiddenTools } from "@/lib/rules/visibility";
import { decisionStates, isSettled, normalizeReportStatus, parseAgentDecisions, reportMove, reportTypeLabel, type ReportMove, type ReportStatus } from "./report-decisions-shared";

/** Types générés par l'application. Les agents externes écrivent les leurs (`comanet_cmo_monthly`, `mbr_monthly`…). */
export type ReportType = "WEEKLY" | "MONTHLY_BRAND_REVIEW";
export const REPORT_TYPE_LABEL: Record<ReportType, string> = { WEEKLY: reportTypeLabel("WEEKLY"), MONTHLY_BRAND_REVIEW: reportTypeLabel("MONTHLY_BRAND_REVIEW") };
export { reportTypeLabel, type ReportMove, type ReportStatus };
export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = { DRAFT: "Brouillon", VALIDATED: "Validé", ARCHIVED: "Archivé" };

export type ReportRow = {
  /** `type` : WEEKLY, MONTHLY_BRAND_REVIEW, ou le type libre d'un agent externe. `status` : normalisé (`draft` → DRAFT). */
  id: string; type: string; brandId: string | null; brandName: string | null; periodStart: string; periodEnd: string; title: string;
  contentMd: string; sources: unknown; status: ReportStatus; model: string | null; createdById: string | null; validatedById: string | null; validatedAt: string | null; createdAt: string;
};

const NO_REGULATORY = "Le réglementaire est suivi dans son module et ne fait pas partie de ce rapport : n'en parle pas.";

const weeklyInstructions = (regulatory: boolean) => `Rédige le COMANET WEEKLY : rapport hebdomadaire de direction en Markdown. Structure imposée (titres de niveau 2), chaque section commençant par une ligne en italique « _Source : … · Période : …_ » :
## Résumé de la semaine — cinq puces maximum, les faits saillants chiffrés.
## Ventes sell-in — CA de la semaine et du mois à date vs période précédente et N-1, objectif du mois, top marques et top produits (get_sales_summary).
## Terrain sell-out — unités et CA TTC, atteinte des objectifs par ville, animatrices sous objectif (get_terrain_summary).
## Clients — segments, clients à risque et retards de commande à traiter (get_client_intelligence).
## Stock — références en rupture ou en tension, commandes conseillées (get_stock_coverage).
## Marketing — budget consommé, campagnes en STOP / OPTIMIZE / SCALE (get_marketing_budget, get_ads_performance).
${regulatory ? "## Réglementaire — dossiers critiques et à redéposer (get_regulatory_alerts).\n" : ""}## Exécution — recommandations ouvertes et tâches en retard (get_action_center, get_tasks).
## Décisions proposées — trois à cinq actions avec responsable, échéance, résultat attendu et mesure.
Une section dont la donnée est indisponible dit « donnée non disponible dans COMANET OS » et l'import à faire ; elle n'est jamais inventée. Ne mélange jamais sell-in et sell-out. Aucune écriture : le rapport est enregistré par l'application.${regulatory ? "" : ` ${NO_REGULATORY}`}`;

const monthlyInstructions = (regulatory: boolean) => `Rédige le MONTHLY BRAND REVIEW d'une marque : revue mensuelle en Markdown. Structure imposée (titres de niveau 2), chaque section commençant par une ligne en italique « _Source : … · Période : …_ » :
## Synthèse — cinq puces maximum.
## Sell-in — CA du mois vs M-1 et N-1, objectif, top produits, clients actifs (get_sales_summary avec brand).
## Sell-out terrain — unités, CA TTC, objectif, palmarès produits (get_terrain_summary avec brand).
## Clients de la marque — segments, à risque, fort potentiel (get_client_intelligence avec brand).
## Stock — couverture par référence, ruptures prévisibles, surstock (get_stock_coverage avec brand).
## Marketing — budget prévu / engagé / dépensé par catégorie, campagnes et verdicts (get_marketing_budget, get_ads_performance avec brand).
${regulatory ? "## Réglementaire — dossiers de la marque à échéance (get_regulatory_alerts avec brand).\n" : ""}## Lecture — ce que les chiffres montrent, en séparant ce qui est mesuré de ce qui est une corrélation observée.
## Décisions proposées — trois à cinq actions avec responsable, échéance, budget si pertinent, résultat attendu et mesure.
Une section dont la donnée est indisponible le dit et indique l'import à faire ; rien n'est inventé. Aucune écriture : le rapport est enregistré par l'application.${regulatory ? "" : ` ${NO_REGULATORY}`}`;

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
    // Réglementaire hors du pilotage de direction (Paramètres → Cockpit) : la section, l'outil et la règle sortent du rapport.
    const settings = await getSettings();
    const regulatory = !settings.cockpit.hideRegulatory;
    const out = await askCopilot({
      question, contextPath: "/rapports", tier: "advanced", surface: "report", contextModule: "report",
      surfaceInstructions: (input.type === "WEEKLY" ? weeklyInstructions : monthlyInstructions)(regulatory), allowWrites: false, maxToolCalls: 8,
      hiddenRules: hiddenRuleIds(settings), hiddenTools: hiddenTools(settings),
    });
    const sources = out.toolCalls.map((t) => ({ tool: t.name, input: t.input, ok: t.ok, summary: t.summary }));
    const [row] = await db.insert(aiReports).values({
      type: input.type, brandId: input.brandId ?? null, periodStart: input.periodStart, periodEnd: input.periodEnd, title, contentMd: out.text || "(rapport vide)",
      sources, status: "DRAFT", model: out.model, createdById: access.user.id,
    }).returning({ id: aiReports.id });
    await notifyNewReports().catch((e) => console.error("rapports : notification", e));
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof CopilotError ? e.message : "Le copilote n'a pas pu produire le rapport." };
  }
}

/** Colonnes lues par les écrans, sans `notified_at` : les pages restent lisibles avant l'application de la migration 0057. */
const REPORT_COLUMNS = Object.fromEntries(Object.entries(getTableColumns(aiReports)).filter(([k]) => k !== "notifiedAt")) as Omit<ReturnType<typeof getTableColumns<typeof aiReports>>, "notifiedAt">;

function toRow(r: Omit<typeof aiReports.$inferSelect, "notifiedAt"> & { brandName?: string | null }): ReportRow {
  return {
    id: r.id, type: r.type, brandId: r.brandId, brandName: r.brandName ?? null, periodStart: r.periodStart, periodEnd: r.periodEnd, title: r.title, contentMd: r.contentMd,
    sources: r.sources, status: normalizeReportStatus(r.status), model: r.model, createdById: r.createdById, validatedById: r.validatedById, validatedAt: r.validatedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
  };
}

export async function listReports(opts: { brandIds?: string[] | null; limit?: number } = {}): Promise<ReportRow[]> {
  const rows = await db.select({ r: REPORT_COLUMNS, brandName: brands.name }).from(aiReports).leftJoin(brands, eq(brands.id, aiReports.brandId)).orderBy(desc(aiReports.createdAt)).limit(opts.limit ?? 100);
  return rows.map((x) => toRow({ ...x.r, brandName: x.brandName })).filter((r) => !opts.brandIds || !r.brandId || opts.brandIds.includes(r.brandId));
}

export async function getReport(id: string): Promise<ReportRow | null> {
  const [x] = await db.select({ r: REPORT_COLUMNS, brandName: brands.name }).from(aiReports).leftJoin(brands, eq(brands.id, aiReports.brandId)).where(eq(aiReports.id, id));
  return x ? toRow({ ...x.r, brandName: x.brandName }) : null;
}

/**
 * Change le statut d'un rapport selon `reportMove()` (seule règle du cycle). Un administrateur a tous les droits
 * du module, comme l'écran le laisse voir. Un rapport qui porte des décisions d'agent encore à trancher ne se valide
 * pas d'un bloc : il passe VALIDATED quand la dernière est tranchée (`decideReportDecision()`).
 * `stale` : le rapport a disparu ou a déjà changé de statut.
 */
export async function moveReport(id: string, move: ReportMove): Promise<{ ok: boolean; error?: string; stale?: boolean }> {
  const access = await getAccess();
  if (!access) return { ok: false, error: "Non connecté." };
  if (access.preview) return { ok: false, error: "Prévisualisation : lecture seule." };
  const admin = isAdmin(access.perms);
  const [cur] = await db.select({ status: aiReports.status, brandId: aiReports.brandId, sources: aiReports.sources, validatedAt: aiReports.validatedAt }).from(aiReports).where(eq(aiReports.id, id));
  if (!cur) return { ok: false, error: "Ce rapport a été supprimé.", stale: true };
  if (access.scope !== "ALL" && cur.brandId && !access.brandIds.includes(cur.brandId)) return { ok: false, error: "Rapport hors de votre périmètre." };
  const r = reportMove(normalizeReportStatus(cur.status), move, {
    canValidate: admin || can(access.perms, "rapports", "validate"),
    canEdit: admin || can(access.perms, "rapports", "edit"),
    wasValidated: cur.validatedAt !== null,
    openDecisions: parseAgentDecisions(cur.sources).decisions.length > 0 && !isSettled(cur.sources),
  });
  if (!r.ok) return r;
  const set = r.to === "VALIDATED" && move === "VALIDATE" ? { status: r.to, validatedById: access.user.id, validatedAt: new Date() }
    : r.to === "DRAFT" ? { status: r.to, validatedById: null, validatedAt: null }
    : { status: r.to };
  await db.update(aiReports).set(set).where(and(eq(aiReports.id, id)));
  return { ok: true };
}

/** Compatibilité (Cockpit « À décider ») : VALIDATED = Valider, ARCHIVED = Archiver. */
export async function setReportStatus(id: string, status: "VALIDATED" | "ARCHIVED") {
  return moveReport(id, status === "VALIDATED" ? "VALIDATE" : "ARCHIVE");
}

/**
 * Annonce chaque nouveau rapport (cloche + téléphone) aux administrateurs et aux personnes qui ont « Valider » sur
 * Rapports, dans leur périmètre de marques, sauf à son auteur. Couvre aussi les rapports que les agents externes
 * écrivent directement en base : appelé après une génération, par le cron horaire `/api/cron/mobile` et à l'ouverture
 * des pages (au plus une fois par minute et par serveur). L'UPDATE conditionnel réserve chaque rapport : jamais deux annonces.
 */
let lastSweep = 0;
export async function notifyNewReports(opts: { throttle?: boolean } = {}): Promise<number> {
  if (opts.throttle) {
    if (Date.now() - lastSweep < 60_000) return 0;
    lastSweep = Date.now();
  }
  // Réservation : seul l'UPDATE qui trouve encore `notified_at` vide renvoie la ligne (verrou de ligne + revérification).
  const pending = await db.select({ id: aiReports.id }).from(aiReports).where(isNull(aiReports.notifiedAt)).orderBy(aiReports.createdAt).limit(20);
  if (!pending.length) return 0;
  const claimed = await db.update(aiReports).set({ notifiedAt: new Date() })
    .where(and(inArray(aiReports.id, pending.map((p) => p.id)), isNull(aiReports.notifiedAt)))
    .returning({ id: aiReports.id, title: aiReports.title, brandId: aiReports.brandId, createdById: aiReports.createdById, sources: aiReports.sources });
  if (!claimed.length) return 0;
  const people = await db.execute<{ id: string; all_brands: boolean; brand_ids: string[] | null }>(sql`
    select u.id::text,
      (coalesce(s.scope::text, 'ALL') = 'ALL' or coalesce(s.all_brands, false) or bool_or(p.module = 'administration')) as all_brands,
      (select array_agg(a.brand_id::text) from user_brand_assignments a where a.user_id = u.id) as brand_ids
    from users u
    join user_permissions p on p.user_id = u.id and p.can_validate and p.module in ('administration', 'rapports')
    left join user_scope s on s.user_id = u.id
    where u.active
    group by u.id, s.scope, s.all_brands`);
  for (const r of claimed) {
    const to = people.rows.filter((u) => u.all_brands || !r.brandId || (u.brand_ids ?? []).includes(r.brandId)).map((u) => u.id);
    const open = decisionStates(r.sources).decisions.filter((d) => !d.outcome).length;
    await notify(to, {
      type: "REPORT_DRAFT",
      title: open > 0 ? `Nouveau rapport · ${open} décision${open > 1 ? "s" : ""} à trancher` : "Nouveau rapport à lire",
      body: r.title, href: `/rapports/${r.id}`, entityType: "report", entityId: r.id,
    }, { except: r.createdById });
  }
  return claimed.length;
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
