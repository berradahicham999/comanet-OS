/**
 * `propose_task` et `propose_report` — les DEUX seules écritures du copilote.
 * Une tâche proposée naît au statut PROPOSED (source AI) : elle n'entre dans aucun compteur tant qu'une
 * personne ne l'a pas acceptée d'un clic. Un rapport naît en brouillon (DRAFT) à valider par la direction.
 */
import { z } from "zod";
import { MODULE_KEYS } from "@/lib/access-shared";
import type { AiTool, ToolResult } from "./types";
import { resolveBrand, scopeLabel, unavailable } from "./shared";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const taskSchema = z.object({
  title: z.string().min(5).max(200).describe("Titre court et actionnable (ex. « Relancer Pharmacie Atlas — 92 j sans commande »)."),
  description: z.string().min(10).max(4000).describe("Pourquoi (la donnée qui motive) puis quoi faire, résultat attendu et comment le mesurer."),
  assignee: z.string().optional().describe("Nom de la personne à qui proposer la tâche (optionnel)."),
  assignee_role: z.string().optional().describe("Rôle suggéré si la personne n'est pas connue (ex. « commercial », « responsable réglementaire »)."),
  due_date: z.string().regex(ISO_DATE).describe("Échéance AAAA-MM-JJ."),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  module: z.enum(MODULE_KEYS).describe("Module concerné (ventes, clients, stock, reglementaire, marketing, terrain, budgets…)."),
  brand: z.string().optional().describe("Marque concernée (nom)."),
  source_insight: z.string().min(5).max(2000).describe("La donnée exacte (outil, période, chiffres) à l'origine de la proposition."),
  expected_impact: z.string().max(500).optional().describe("Résultat attendu, mesurable."),
});

export const proposeTask: AiTool<typeof taskSchema> = {
  name: "propose_task",
  description:
    "Propose une tâche dans l'Action Center. Elle est créée au statut « proposée par le copilote » et n'est active qu'après acceptation par une personne. À n'utiliser que lorsque l'utilisateur demande explicitement une tâche ou un plan d'action, jamais pour une simple question.",
  module: "taches",
  action: "create",
  writes: true,
  schema: taskSchema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access } = ctx;
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    const due = new Date(input.due_date + "T12:00:00Z");
    if (Number.isNaN(due.getTime())) return unavailable("Échéance invalide.", "Fournir une date AAAA-MM-JJ.");
    if (due.getTime() < ctx.now.getTime() - 86_400_000) return unavailable("L'échéance est déjà passée.", "Proposer une date à venir.");
    let assigneeId: string | null = null, assigneeName: string | null = null;
    if (input.assignee) {
      const u = await deps.findUser(input.assignee);
      if (u) { assigneeId = u.id; assigneeName = u.name; }
    }
    const description = [
      input.description.trim(),
      "",
      `Donnée à l'origine : ${input.source_insight.trim()}`,
      !assigneeId && input.assignee_role ? `Responsable suggéré : ${input.assignee_role}` : null,
      `Proposée par le copilote IA pour ${access.userName}.`,
    ].filter((l) => l !== null).join("\n");
    const { id } = await deps.insertProposedTask({
      title: input.title.trim(), description, priority: input.priority, dueDate: input.due_date, brandId: brand?.id ?? null,
      assigneeId, entityType: null, entityId: null, expectedImpact: input.expected_impact?.trim() ?? null, createdById: access.userId,
    });
    return {
      available: true,
      source: "Tâches COMANET OS",
      scope: scopeLabel(access, [brand ? `marque ${brand.name}` : null]),
      data: { task_id: id, status: "PROPOSED", title: input.title, due_date: input.due_date, priority: input.priority, assignee: assigneeName, assignee_role: assigneeName ? null : input.assignee_role ?? null, next_step: "La tâche apparaît dans Tâches → « Proposées par le copilote » ; elle devient active après acceptation." },
      rowCount: 1,
      links: [{ label: "Voir la tâche proposée", href: `/taches/${id}` }],
    };
  },
};

const reportSchema = z.object({
  type: z.enum(["WEEKLY", "MONTHLY_BRAND_REVIEW"]).describe("WEEKLY = COMANET WEEKLY ; MONTHLY_BRAND_REVIEW = revue mensuelle d'une marque (brand obligatoire)."),
  brand: z.string().optional().describe("Marque (obligatoire pour MONTHLY_BRAND_REVIEW)."),
  period_start: z.string().regex(ISO_DATE).describe("Début de la période couverte (AAAA-MM-JJ)."),
  period_end: z.string().regex(ISO_DATE).describe("Fin exclue (AAAA-MM-JJ)."),
  title: z.string().min(5).max(200),
  content_md: z.string().min(50).max(60_000).describe("Rapport en Markdown : chaque section indique sa source (outil) et sa période ; uniquement des chiffres issus des outils."),
  sources: z.array(z.object({ tool: z.string(), period: z.string().optional(), scope: z.string().optional() })).optional().describe("Outils appelés pour produire le rapport."),
});

export const proposeReport: AiTool<typeof reportSchema> = {
  name: "propose_report",
  description: "Enregistre un brouillon de rapport (COMANET WEEKLY ou MONTHLY BRAND REVIEW) que la direction validera. Le contenu ne doit contenir que des chiffres obtenus par les outils, avec source et période par section.",
  module: "rapports",
  action: "create",
  writes: true,
  schema: reportSchema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access } = ctx;
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    if (input.type === "MONTHLY_BRAND_REVIEW" && !brand) return unavailable("Une revue mensuelle porte sur une marque.", "Préciser la marque (paramètre brand).");
    if (input.period_end <= input.period_start) return unavailable("Période invalide (fin ≤ début).", "Fournir period_start < period_end.");
    const { id } = await deps.insertReportDraft({
      type: input.type, brandId: brand?.id ?? null, periodStart: input.period_start, periodEnd: input.period_end, title: input.title.trim(),
      contentMd: input.content_md, sources: input.sources ?? [], createdById: access.userId, model: null,
    });
    return {
      available: true,
      source: "Rapports COMANET OS",
      scope: scopeLabel(access, [brand ? `marque ${brand.name}` : null]),
      data: { report_id: id, status: "DRAFT", type: input.type, title: input.title, period: { start: input.period_start, end: input.period_end }, next_step: "Brouillon à valider dans Rapports." },
      rowCount: 1,
      links: [{ label: "Ouvrir le brouillon", href: `/rapports/${id}` }],
    };
  },
};
