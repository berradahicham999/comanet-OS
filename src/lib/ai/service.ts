/**
 * Orchestration d'une question au copilote : droits, limites, contexte d'outils, boucle agentique,
 * persistance, coût. Le streaming est exposé par `onEvent` ; la route `/api/ai/chat` le relaie en SSE.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { requireAccessContext } from "@/lib/permissions";
import { isAdmin } from "@/lib/permissions-shared";
import { getSettings } from "@/lib/settings";
import { anthropic, isAiConfigured, modelFor, type ModelTier } from "./client";
import { buildToolContext } from "./tools/context";
import { systemBlocks } from "./prompt";
import { runCopilot, type CallModel, type RunEvent, type RunResult } from "./run";
import { checkLimits } from "./limits";
import { appendMessage, createConversation, getConversation, historyFromStored } from "./conversations";
import { estimateCostUsd } from "./cost";
import { moduleForPath } from "./suggestions-shared";

/** Le copilote est ouvert à toute personne ayant un module hors portée OWN (V1 : pas les animatrices ni les délégués). */
export function copilotAllowed(a: { scope: string; perms: Parameters<typeof isAdmin>[0] }): boolean {
  return a.scope !== "OWN" || isAdmin(a.perms);
}

/** Liaison réelle : `client.messages.stream()` + `finalMessage()` ; les deltas de texte remontent via `onText`. */
export const callAnthropic: CallModel = async (p, onText) => {
  const stream = anthropic().messages.stream(
    {
      model: p.model,
      max_tokens: p.maxTokens,
      system: p.system,
      messages: p.messages,
      tools: p.tools.length ? p.tools : undefined,
      output_config: { effort: p.effort },
    },
    { signal: p.signal },
  );
  stream.on("text", onText);
  return stream.finalMessage();
};

export type AskInput = {
  question: string;
  conversationId?: string | null;
  contextPath?: string | null;
  tier?: ModelTier;
  surface?: string;
  surfaceInstructions?: string | null;
  allowWrites?: boolean;
  /** Surface automatique (explication de carte, brief) : soumise au plafond mensuel de coût. */
  automatic?: boolean;
  /** Plafond d'appels d'outils propre à la surface (≤ settings.ai.maxToolCalls). */
  maxToolCalls?: number;
  /** Module de contexte de la conversation (« explain », « brief »… sont masqués de l'historique du panneau). */
  contextModule?: string | null;
  onEvent?: (e: RunEvent) => void;
};

export type AskOutput = RunResult & { conversationId: string; messageId: string; model: string; costUsd: number };

export async function askCopilot(input: AskInput): Promise<AskOutput> {
  if (!isAiConfigured()) throw new CopilotError("Copilote non configuré : renseigner ANTHROPIC_API_KEY sur le serveur.", 503);
  const access = await requireAccessContext();
  if (!copilotAllowed(access)) throw new CopilotError("Le copilote n'est pas ouvert à ce profil.", 403);
  const settings = await getSettings();
  const limit = await checkLimits(access.user.id, settings.ai, { isAdmin: isAdmin(access.perms), automatic: input.automatic });
  if (!limit.ok) throw new CopilotError(limit.reason, 429);

  const question = input.question.trim().slice(0, 4000);
  if (!question) throw new CopilotError("Question vide.", 400);
  const toolCtx = await buildToolContext();
  const model = modelFor(input.tier ?? "advanced");

  let conversationId = input.conversationId ?? null;
  let history: Anthropic.MessageParam[] = [];
  if (conversationId) {
    const c = await getConversation(access.user.id, conversationId);
    if (!c) throw new CopilotError("Conversation introuvable.", 404);
    history = historyFromStored(c.messages);
  } else {
    conversationId = await createConversation(access.user.id, { title: question, contextModule: input.contextModule ?? moduleForPath(input.contextPath), contextPath: input.contextPath ?? null });
  }
  await appendMessage(conversationId, { role: "user", content: question, surface: input.surface ?? "chat" });

  const maxToolCalls = Math.max(1, Math.min(settings.ai.maxToolCalls, input.maxToolCalls ?? settings.ai.maxToolCalls));
  const system = systemBlocks({ access: toolCtx.access, now: toolCtx.now, refDate: toolCtx.refDate, contextPath: input.contextPath, surfaceInstructions: input.surfaceInstructions, maxToolCalls });
  const result = await runCopilot({
    model, system, history, question, toolCtx,
    maxToolCalls, timeoutMs: settings.ai.timeoutSeconds * 1000,
    allowWrites: input.allowWrites ?? true, effort: input.tier === "fast" ? "low" : "medium",
    callModel: callAnthropic, onEvent: input.onEvent,
  });
  const costUsd = estimateCostUsd(model, result.usage);
  const messageId = await appendMessage(conversationId, {
    role: "assistant", content: result.text || "(réponse vide)", toolCalls: result.toolCalls, tokensIn: result.usage.inputTokens, tokensOut: result.usage.outputTokens,
    cacheReadTokens: result.usage.cacheReadTokens, model, latencyMs: result.latencyMs, surface: input.surface ?? "chat",
  });
  return { ...result, conversationId, messageId, model, costUsd };
}

export class CopilotError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
