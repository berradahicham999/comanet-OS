/**
 * Registre des outils du copilote, filtrage par permissions, exécution journalisée.
 *
 * - `TOOLS` est trié par nom : la liste envoyée au modèle est stable, donc mise en cache.
 * - `toolsFor(access)` ne garde que les outils dont le module et l'action sont accordés à la personne :
 *   un utilisateur qui ne voit pas Ventes ne reçoit même pas la définition de `get_sales_summary`.
 * - `executeTool()` valide les paramètres, mesure la durée, journalise (utilisateur, outil, paramètres,
 *   durée, nombre de lignes, erreur) et ne laisse jamais remonter une exception au modèle : une erreur
 *   devient un résultat `available: false`.
 */
import { z } from "zod";
import { can, hasAnyModule } from "@/lib/permissions-shared";
import type { AiTool, ToolAccess, ToolContext, ToolResult } from "./types";
import { getSalesSummary } from "./sales";
import { getClientIntelligence } from "./clients";
import { getTerrainSummary } from "./terrain";
import { getStockCoverage } from "./stock";
import { getMarketingBudget } from "./budget";
import { getAdsPerformance } from "./ads";
import { getAdsIntelligence } from "./ads-intel";
import { getRegulatoryAlerts } from "./regulatory";
import { getActionCenter, getTasks } from "./actions";
import { searchEntities } from "./search";
import { proposeReport, proposeTask } from "./propose";

export type { AiTool, ToolAccess, ToolContext, ToolDeps, ToolResult, ToolCallLog } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: AiTool<any>[] = [
  getActionCenter, getAdsIntelligence, getAdsPerformance, getClientIntelligence, getMarketingBudget, getRegulatoryAlerts, getSalesSummary,
  getStockCoverage, getTasks, getTerrainSummary, proposeReport, proposeTask, searchEntities,
].sort((a, b) => a.name.localeCompare(b.name));

export const TOOL_NAMES = TOOLS.map((t) => t.name);

/** Un outil est accordé si la personne a l'action demandée sur l'un des modules de l'outil. */
export function isToolAllowed(tool: AiTool, access: ToolAccess): boolean {
  if (tool.module === "any") return hasAnyModule(access.perms);
  const modules = Array.isArray(tool.module) ? tool.module : [tool.module];
  return modules.some((m) => can(access.perms, m, tool.action));
}

export function toolsFor(access: ToolAccess, opts: { allowWrites?: boolean } = {}): AiTool[] {
  return TOOLS.filter((t) => isToolAllowed(t, access) && (opts.allowWrites !== false || !t.writes));
}

/** Schéma JSON (draft 2020-12) attendu par l'API : sans `$schema`, objet fermé. */
export function toolInputSchema(tool: AiTool): { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false } {
  const js = z.toJSONSchema(tool.schema, { io: "input" }) as Record<string, unknown>;
  delete js.$schema;
  return { ...(js as { properties: Record<string, unknown>; required?: string[] }), type: "object", additionalProperties: false };
}

/** Définitions à envoyer au modèle (`tools` de l'API Messages). */
export function toolDefinitions(tools: AiTool[]) {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: toolInputSchema(t) }));
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Exécute un outil pour la personne du contexte. Refuse (résultat indisponible) un outil hors registre
 * ou hors permissions ; le refus est journalisé comme une erreur.
 */
export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
  const started = Date.now();
  const log = (rowCount: number, error: string | null) =>
    ctx.deps.logToolCall({ userId: ctx.access.userId, tool: name, params: rawInput ?? {}, durationMs: Date.now() - started, rowCount, error, messageId: ctx.messageId ?? null }).catch(() => undefined);
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) { await log(0, "outil inconnu"); return { available: false, reason: `Outil « ${name} » inconnu.`, howToFix: "Utiliser un des outils fournis." }; }
  if (!isToolAllowed(tool, ctx.access)) { await log(0, "refusé : permissions"); return { available: false, reason: `Vous n'avez pas accès aux données de l'outil « ${name} » (module ${Array.isArray(tool.module) ? tool.module.join(" ou ") : tool.module}).`, howToFix: "Demander le droit correspondant à un administrateur (Paramètres → Utilisateurs)." }; }
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) { const msg = parsed.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.join(".") || "(racine)"} : ${i.message}`).join(" ; "); await log(0, `paramètres invalides : ${msg}`); return { available: false, reason: `Paramètres invalides — ${msg}`, howToFix: "Corriger les paramètres selon le schéma de l'outil." }; }
  try {
    const result = await tool.run(parsed.data, ctx);
    await log(result.available ? result.rowCount : 0, result.available ? null : `indisponible : ${result.reason}`);
    return result;
  } catch (e) {
    const msg = errorMessage(e);
    await log(0, msg);
    return { available: false, reason: `Erreur technique en lisant la donnée (${msg}).`, howToFix: "Réessayer ; si l'erreur persiste, la signaler à l'administrateur." };
  }
}
