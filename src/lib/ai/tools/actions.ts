/** `get_action_center` et `get_tasks` — recommandations ouvertes (règles) et tâches. */
import { z } from "zod";
import { CATEGORY_META, CATEGORY_MODULES, type RecCategory } from "@/lib/rules/types";

export { CATEGORY_MODULES };
import { can } from "@/lib/permissions-shared";
import type { AiTool, ToolResult } from "./types";
import { fold, inBrandScope, limitOf, scopeLabel, unavailable } from "./shared";


const actionSchema = z.object({
  category: z.enum(Object.keys(CATEGORY_META) as [RecCategory, ...RecCategory[]]).optional().describe("Catégorie : STOCK, MARKETING, REGLEMENTAIRE, TERRAIN, COMMERCIAL, BUDGET, EXECUTION, DATA, MEDICAL, GESTION."),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  brand: z.string().optional().describe("Ne garder que les recommandations liées à cette marque (nom)."),
  include_with_task: z.boolean().default(false).describe("Inclure les recommandations déjà transformées en tâche ouverte."),
  limit: z.number().int().min(1).max(50).optional().describe("Nombre de recommandations (défaut 15, triées par priorité puis enjeu)."),
});

const PRIORITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

export const getActionCenter: AiTool<typeof actionSchema> = {
  name: "get_action_center",
  description:
    "Action Center : recommandations produites par les règles métier (stock, réglementaire, marketing, terrain, clients, budget…), chacune avec la règle d'origine, le POURQUOI (diagnostic chiffré), le QUOI FAIRE, l'impact attendu, la tâche proposée et l'éventuelle tâche déjà créée. Filtré aux modules visibles par la personne.",
  module: "any",
  action: "view",
  schema: actionSchema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access } = ctx;
    const all = await deps.recommendations();
    let recs = all.filter((r) => (CATEGORY_MODULES[r.category] ?? []).some((m) => can(access.perms, m, "view")));
    recs = inBrandScope(recs, access, (r) => r.brandId);
    if (!input.include_with_task) recs = recs.filter((r) => !r.existingTask);
    if (input.category) recs = recs.filter((r) => r.category === input.category);
    if (input.priority) recs = recs.filter((r) => r.priority === input.priority);
    if (input.brand) { const k = fold(input.brand); recs = recs.filter((r) => fold(r.title).includes(k) || fold(r.subtitle ?? "").includes(k)); }
    const counts: Record<string, number> = {};
    for (const r of recs) counts[r.priority] = (counts[r.priority] ?? 0) + 1;
    if (!recs.length) return unavailable("Aucune recommandation ouverte dans ce périmètre.", "Rien à corriger : les règles n'ont rien détecté sur les modules visibles, ou tout est déjà transformé en tâche (include_with_task).", "Action Center");
    const rows = [...recs].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (b.score ?? 0) - (a.score ?? 0)).slice(0, limitOf(input.limit, 15));
    return {
      available: true,
      source: "Action Center — règles métier évaluées à la lecture sur les données importées",
      scope: scopeLabel(access, [input.category ? `catégorie ${CATEGORY_META[input.category].label}` : null]),
      data: {
        open_recommendations: recs.length,
        by_priority: counts,
        rows: rows.map((r) => ({
          key: r.key, rule: r.rule, category: r.category, priority: r.priority, title: r.title, subtitle: r.subtitle ?? null,
          facts: r.facts, why: r.why, action: r.action, impact: r.impact ?? null, stake_mad: r.score ?? null,
          suggested_task: { title: r.task.title, due_in_days: r.task.dueInDays, role: r.task.role },
          existing_task: r.existingTask ? { id: r.existingTask.id, status: r.existingTask.status, assignee: r.existingTask.assignee } : null,
          href: r.entity?.href ?? "/actions",
        })),
      },
      rowCount: rows.length,
      links: [{ label: "Ouvrir l'Action Center", href: `/actions${input.category ? `?cat=${input.category}` : ""}` }],
    };
  },
};

const taskSchema = z.object({
  assignee: z.string().optional().describe("Nom de la personne assignée ; « moi » pour l'utilisateur connecté."),
  status: z.enum(["open", "overdue", "done", "proposed"]).default("open").describe("open = à faire / en cours ; overdue = en retard ; done = terminées (14 derniers jours) ; proposed = proposées par le copilote en attente d'acceptation."),
  limit: z.number().int().min(1).max(50).optional().describe("Nombre de tâches (défaut 20)."),
});

export const getTasks: AiTool<typeof taskSchema> = {
  name: "get_tasks",
  description: "Tâches : titre, statut, priorité, échéance, assigné, marque, source (manuelle, Action Center, copilote…). Portée : tout le monde, ou seulement ses propres tâches pour une personne en portée OWN.",
  module: "taches",
  action: "view",
  schema: taskSchema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access } = ctx;
    let assigneeId: string | undefined;
    let who: string | null = null;
    if (access.ownOnly) { assigneeId = access.userId; who = "mes tâches"; }
    else if (input.assignee) {
      if (fold(input.assignee) === "moi") { assigneeId = access.userId; who = "mes tâches"; }
      else {
        const u = await deps.findUser(input.assignee);
        if (!u) return unavailable(`Personne « ${input.assignee} » introuvable.`, "Vérifier le nom dans Paramètres → Utilisateurs.");
        assigneeId = u.id; who = `assigné ${u.name}`;
      }
    }
    const rows = await deps.listTasks({ assigneeId, brandIds: access.brandIds, overdue: input.status === "overdue", includeDone: input.status === "done" || input.status === "proposed" });
    const now = ctx.now.toISOString().slice(0, 10);
    let list = rows;
    if (input.status === "open") list = rows.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
    else if (input.status === "done") list = rows.filter((t) => t.status === "DONE");
    else if (input.status === "proposed") list = rows.filter((t) => t.status === "PROPOSED");
    else list = rows.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
    const out = list.slice(0, limitOf(input.limit, 20));
    if (!list.length) return unavailable(`Aucune tâche (${input.status})${who ? ` — ${who}` : ""}.`, "Créer une tâche dans Tâches ou depuis une recommandation de l'Action Center.", "Tâches");
    return {
      available: true,
      source: "Tâches COMANET OS",
      scope: scopeLabel(access, [who, `statut ${input.status}`]),
      data: {
        count: list.length,
        overdue: list.filter((t) => t.dueDate && t.dueDate < now && (t.status === "TODO" || t.status === "IN_PROGRESS")).length,
        rows: out.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.dueDate, overdue: !!t.dueDate && t.dueDate < now && t.status !== "DONE", assignee: t.assignee, brand: t.brand, source: t.source, href: `/taches/${t.id}` })),
      },
      rowCount: out.length,
      links: [{ label: "Ouvrir Tâches", href: "/taches" }],
    };
  },
};
