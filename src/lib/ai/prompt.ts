/**
 * Chargement du system prompt versionné (`prompts/copilot.md`) et construction des blocs `system`.
 *
 * Deux blocs : le premier (rôle, métier, principes, format) est stable et porte `cache_control` ;
 * le second (date, personne, portée, page courante) change à chaque requête et vient APRÈS pour ne pas
 * invalider le cache. Aucun contenu venant de la base n'entre jamais dans le system prompt.
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { fmtDateLong } from "@/lib/format";
import type { ToolAccess } from "./tools/types";

const PROMPT_PATH = path.join(process.cwd(), "src/lib/ai/prompts/copilot.md");

let cached: string | null = null;

export function loadSystemPrompt(): string {
  if (cached && process.env.NODE_ENV === "production") return cached;
  cached = fs.readFileSync(PROMPT_PATH, "utf8");
  return cached;
}

export type PromptContext = {
  access: ToolAccess;
  /** Date réelle du jour. */
  now: Date;
  /** Date de référence des ventes Sage (dernier import). */
  refDate: Date;
  /** Chemin de la page d'où la question est posée (ex. « /terrain »). */
  contextPath?: string | null;
  /** Consigne propre à la surface (explication de carte, brief, plan, rapport). */
  surfaceInstructions?: string | null;
  maxToolCalls: number;
};

/** Le bloc variable : injecté après le bloc mis en cache. */
export function dynamicBlock(ctx: PromptContext): string {
  const scope = ctx.access.brandIds ? `marques assignées uniquement (${ctx.access.brandIds.length})` : ctx.access.ownOnly ? "ses propres données uniquement" : "toutes marques, tous clients";
  return [
    `Date du jour : ${fmtDateLong(ctx.now)}. Données de vente Sage arrêtées au ${fmtDateLong(ctx.refDate)} (dernier import) : « mois en cours » pour les ventes = le mois de cette date.`,
    `Personne connectée : ${ctx.access.userName}. Portée des données : ${scope}. Nombre maximal d'appels d'outils pour cette question : ${ctx.maxToolCalls}.`,
    ctx.contextPath ? `Page d'où la question est posée : ${ctx.contextPath}.` : null,
    ctx.surfaceInstructions ? `\nConsigne de la surface :\n${ctx.surfaceInstructions}` : null,
  ].filter(Boolean).join("\n");
}

export function systemBlocks(ctx: PromptContext): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: loadSystemPrompt(), cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicBlock(ctx) },
  ];
}
