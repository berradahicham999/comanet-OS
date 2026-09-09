/**
 * Boucle agentique du copilote : question → appels d'outils (≤ N) → réponse, en streaming.
 *
 * Logique pure vis-à-vis du réseau : l'appel au modèle est injecté (`callModel`), ce qui permet de tester
 * la boucle sans clé ni appel API (`tests/ai/run.test.ts`). La liaison réelle vit dans `service.ts`.
 * Garde-fous : nombre maximal d'appels d'outils, délai global, outils filtrés par permissions,
 * résultats d'outils passés comme données (`tool_result`), jamais comme texte libre.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { executeTool, toolDefinitions, toolsFor } from "./tools";
import type { ToolContext, ToolResult } from "./tools/types";

export type RunEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; ok: boolean; summary: string; links?: { label: string; href: string }[] }
  | { type: "notice"; message: string };

export type ModelParams = {
  model: string;
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  maxTokens: number;
  effort: "low" | "medium" | "high";
  signal?: AbortSignal;
};

/** Appelle le modèle en streaming ; `onText` reçoit chaque delta de texte ; renvoie le message complet. */
export type CallModel = (params: ModelParams, onText: (delta: string) => void) => Promise<Anthropic.Message>;

export type RunOptions = {
  model: string;
  system: Anthropic.TextBlockParam[];
  history: Anthropic.MessageParam[];
  question: string;
  toolCtx: ToolContext;
  maxToolCalls: number;
  timeoutMs: number;
  allowWrites: boolean;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  callModel: CallModel;
  onEvent?: (e: RunEvent) => void;
};

export type ToolTrace = { id: string; name: string; input: unknown; ok: boolean; summary: string; rowCount: number };

export type RunResult = {
  text: string;
  toolCalls: ToolTrace[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  stopReason: string | null;
  latencyMs: number;
  /** Toutes les réponses d'outils (pour vérifier que les chiffres cités en proviennent). */
  toolResults: ToolResult[];
  /** Messages ajoutés à l'historique (pour la persistance). */
  appended: Anthropic.MessageParam[];
};

const summarize = (r: ToolResult): string => (r.available ? `${r.source} · ${r.scope} · ${r.rowCount} ligne(s)` : `indisponible : ${r.reason}`);

/** Un résultat d'outil devient un bloc `tool_result` : JSON compact, jamais interprété comme une instruction. */
function toolResultBlock(id: string, r: ToolResult): Anthropic.ToolResultBlockParam {
  return { type: "tool_result", tool_use_id: id, content: JSON.stringify(r), is_error: !r.available };
}

export async function runCopilot(o: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const emit = o.onEvent ?? (() => undefined);
  const allowed = toolsFor(o.toolCtx.access, { allowWrites: o.allowWrites });
  const tools = toolDefinitions(allowed) as Anthropic.Tool[];
  const messages: Anthropic.MessageParam[] = [...o.history, { role: "user", content: o.question }];
  const appended: Anthropic.MessageParam[] = [{ role: "user", content: o.question }];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs);
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const toolCalls: ToolTrace[] = [];
  const toolResults: ToolResult[] = [];
  let text = "";
  let stopReason: string | null = null;
  let toolBudget = o.maxToolCalls;

  try {
    for (let turn = 0; turn < o.maxToolCalls + 2; turn++) {
      if (controller.signal.aborted) { emit({ type: "notice", message: "Délai dépassé : réponse arrêtée avec les données déjà obtenues." }); break; }
      const msg = await o.callModel(
        { model: o.model, system: o.system, messages, tools: toolBudget > 0 ? tools : [], maxTokens: o.maxTokens ?? 4096, effort: o.effort ?? "medium", signal: controller.signal },
        (delta) => emit({ type: "text", delta }),
      );
      // Le texte conservé vient du message final (identique aux deltas diffusés) : fiable même sans streaming.
      for (const b of msg.content) if (b.type === "text" && b.text) text += (text ? "\n" : "") + b.text;
      usage.inputTokens += msg.usage.input_tokens;
      usage.outputTokens += msg.usage.output_tokens;
      usage.cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += msg.usage.cache_creation_input_tokens ?? 0;
      stopReason = msg.stop_reason;
      messages.push({ role: "assistant", content: msg.content });
      appended.push({ role: "assistant", content: msg.content });

      const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (msg.stop_reason !== "tool_use" || uses.length === 0) break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        emit({ type: "tool_start", id: u.id, name: u.name, input: u.input });
        let r: ToolResult;
        if (toolBudget <= 0) r = { available: false, reason: `Nombre maximal d'appels d'outils atteint (${o.maxToolCalls}).`, howToFix: "Répondre avec les données déjà obtenues et dire ce qui manque." };
        else if (controller.signal.aborted) r = { available: false, reason: "Délai dépassé.", howToFix: "Répondre avec les données déjà obtenues." };
        else { toolBudget--; r = await executeTool(u.name, u.input, o.toolCtx); }
        toolResults.push(r);
        toolCalls.push({ id: u.id, name: u.name, input: u.input, ok: r.available, summary: summarize(r), rowCount: r.available ? r.rowCount : 0 });
        emit({ type: "tool_end", id: u.id, name: u.name, ok: r.available, summary: summarize(r), links: r.available ? r.links : undefined });
        results.push(toolResultBlock(u.id, r));
      }
      // Tous les résultats d'un même tour dans un seul message utilisateur (appels parallèles).
      messages.push({ role: "user", content: results });
      appended.push({ role: "user", content: results });
      if (toolBudget <= 0) emit({ type: "notice", message: `Plafond de ${o.maxToolCalls} appels d'outils atteint : le copilote conclut avec les données obtenues.` });
    }
  } catch (e) {
    if (controller.signal.aborted) emit({ type: "notice", message: "Délai dépassé : réponse arrêtée avec les données déjà obtenues." });
    else throw e;
  } finally {
    clearTimeout(timer);
  }
  return { text, toolCalls, usage, stopReason, latencyMs: Date.now() - started, toolResults, appended };
}
