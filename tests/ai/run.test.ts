/**
 * Boucle agentique du copilote, avec un modèle factice : plafond d'appels d'outils, délai global,
 * outils hors permissions ou inconnus, résultats passés comme données, journalisation, usage cumulé.
 * Aucun appel API.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { noPermissions } from "@/lib/permissions-shared";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { runCopilot, type CallModel, type ModelParams, type RunEvent } from "@/lib/ai/run";
import { suggestionsFor } from "@/lib/ai/suggestions-shared";
import { estimateCostUsd } from "@/lib/ai/cost";
import type { ToolContext, ToolDeps, ToolCallLog } from "@/lib/ai/tools";

function msg(content: Anthropic.ContentBlock[], stop: Anthropic.Message["stop_reason"]): Anthropic.Message {
  return { id: "m", type: "message", role: "assistant", model: "fake", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 } } as unknown as Anthropic.Message;
}
const text = (t: string): Anthropic.TextBlock => ({ type: "text", text: t, citations: null }) as Anthropic.TextBlock;
const toolUse = (id: string, name: string, input: unknown): Anthropic.ToolUseBlock => ({ type: "tool_use", id, name, input }) as Anthropic.ToolUseBlock;

/** Contexte minimal : seul `get_tasks` a une doublure ; le reste lève pour prouver qu'il n'est pas appelé. */
function ctx(logs: ToolCallLog[], perms = (() => { const p = noPermissions(); p.taches.view = true; p.ventes.view = true; return p; })()): ToolContext {
  const boom = () => { throw new Error("ne doit pas être appelé"); };
  const deps = new Proxy({} as ToolDeps, {
    get(_t, prop) {
      if (prop === "logToolCall") return async (e: ToolCallLog) => { logs.push(e); };
      if (prop === "listTasks") return async () => [{ id: "t1", title: "Relancer", status: "TODO", priority: "HIGH", dueDate: "2026-09-01", source: "MANUAL", assigneeId: null, assignee: null, brand: null, brandColor: null, entityType: null, entityId: null, comments: 0, createdAt: "2026-08-01" }];
      if (prop === "findUser") return async () => null;
      if (prop === "salesTotals") return async () => new Promise((r) => setTimeout(() => r({ amount: 1, quantity: 1, orders: 1, clients: 1, lines: 1 }), 200));
      return boom;
    },
  });
  return { access: { userId: "u1", userName: "Test", perms, scope: "ALL", brandIds: null, clientIds: null, ownOnly: false, seeInternalCosts: true }, refDate: new Date("2026-08-31T12:00:00Z"), now: new Date("2026-09-10T12:00:00Z"), settings: DEFAULT_SETTINGS, deps };
}

const base = { model: "fake", system: [], history: [], question: "Quelles tâches sont en retard ?", timeoutMs: 5000, allowWrites: false };

describe("boucle agentique", () => {
  test("question → appel d'outil → réponse ; le résultat est passé en tool_result JSON, l'usage est cumulé", async () => {
    const logs: ToolCallLog[] = [];
    const seen: ModelParams[] = [];
    const events: RunEvent[] = [];
    const callModel: CallModel = async (p, onText) => {
      seen.push({ ...p, messages: [...p.messages] });
      if (seen.length === 1) return msg([toolUse("tu1", "get_tasks", { status: "overdue" })], "tool_use");
      onText("### Donnée\n"); onText("1 tâche en retard.");
      return msg([text("### Donnée\n1 tâche en retard.")], "end_turn");
    };
    const r = await runCopilot({ ...base, toolCtx: ctx(logs), maxToolCalls: 8, callModel, onEvent: (e) => events.push(e) });
    assert.equal(r.text, "### Donnée\n1 tâche en retard.");
    assert.equal(r.toolCalls.length, 1);
    assert.equal(r.toolCalls[0].ok, true);
    assert.equal(r.usage.inputTokens, 200);
    assert.equal(r.usage.cacheReadTokens, 100);
    // Les outils envoyés au modèle sont filtrés : ventes + tâches + outils « any », pas de stock ni d'écriture.
    const names = seen[0].tools.map((t) => t.name);
    assert.ok(names.includes("get_tasks") && names.includes("get_sales_summary") && names.includes("get_action_center"));
    assert.ok(!names.includes("get_stock_coverage") && !names.includes("propose_task"));
    // Second tour : le résultat arrive dans un message user, sous forme de tool_result JSON.
    const last = seen[1].messages.at(-1)!;
    assert.equal(last.role, "user");
    const block = (last.content as Anthropic.ToolResultBlockParam[])[0];
    assert.equal(block.type, "tool_result");
    assert.equal(block.is_error, false);
    assert.equal(JSON.parse(block.content as string).available, true);
    assert.deepEqual(events.map((e) => e.type), ["tool_start", "tool_end", "text", "text"]);
    assert.equal(logs.length, 1);
    assert.equal(r.appended.length, 4);
  });

  test("plafond d'appels : au-delà, l'outil renvoie indisponible et le modèle perd la liste d'outils", async () => {
    let calls = 0;
    const seen: ModelParams[] = [];
    const callModel: CallModel = async (p) => {
      seen.push({ ...p, messages: [...p.messages] }); calls++;
      if (calls <= 3) return msg([toolUse(`t${calls}`, "get_tasks", {})], "tool_use");
      return msg([text("Conclusion.")], "end_turn");
    };
    const logs: ToolCallLog[] = [];
    const r = await runCopilot({ ...base, toolCtx: ctx(logs), maxToolCalls: 2, callModel });
    assert.equal(r.toolCalls.length, 3);
    assert.deepEqual(r.toolCalls.map((t) => t.ok), [true, true, false]);
    assert.match(r.toolCalls[2].summary, /maximal/);
    assert.equal(logs.length, 2, "le troisième appel n'atteint pas l'outil");
    assert.deepEqual(seen[2].tools, [], "plus d'outils proposés une fois le plafond atteint");
    assert.equal(r.text, "Conclusion.");
  });

  test("appels parallèles : tous les résultats d'un tour dans un seul message user", async () => {
    let n = 0;
    const seen: ModelParams[] = [];
    const callModel: CallModel = async (p) => { seen.push({ ...p, messages: [...p.messages] }); n++; return n === 1 ? msg([toolUse("a", "get_tasks", {}), toolUse("b", "get_tasks", { status: "done" })], "tool_use") : msg([text("ok")], "end_turn"); };
    await runCopilot({ ...base, toolCtx: ctx([]), maxToolCalls: 8, callModel });
    const last = seen[1].messages.at(-1)!;
    assert.equal((last.content as unknown[]).length, 2);
  });

  test("outil hors permissions ou inconnu : refus en tool_result is_error, jamais d'exception", async () => {
    let n = 0;
    const seen: ModelParams[] = [];
    const callModel: CallModel = async (p) => { seen.push({ ...p, messages: [...p.messages] }); n++; return n === 1 ? msg([toolUse("a", "get_stock_coverage", {}), toolUse("b", "run_sql", { q: "delete from sales" })], "tool_use") : msg([text("fin")], "end_turn"); };
    const r = await runCopilot({ ...base, toolCtx: ctx([]), maxToolCalls: 8, callModel });
    assert.deepEqual(r.toolCalls.map((t) => t.ok), [false, false]);
    const blocks = seen[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    assert.ok(blocks.every((b) => b.is_error));
    assert.match(JSON.parse(blocks[0].content as string).reason, /accès/);
    assert.match(JSON.parse(blocks[1].content as string).reason, /inconnu/);
  });

  test("délai global : l'appel d'outil après expiration est refusé et un avis est émis", async () => {
    let n = 0;
    const events: RunEvent[] = [];
    const callModel: CallModel = async (p) => {
      n++;
      if (n === 1) return msg([toolUse("a", "get_sales_summary", { compare_to: "none" })], "tool_use");
      if (p.signal?.aborted) throw new Error("aborted");
      return msg([text("fin")], "end_turn");
    };
    const r = await runCopilot({ ...base, toolCtx: ctx([]), maxToolCalls: 8, timeoutMs: 50, callModel, onEvent: (e) => events.push(e) });
    assert.ok(events.some((e) => e.type === "notice" && /Délai/.test(e.message)));
    assert.ok(r.latencyMs < 2000);
  });

  test("une erreur du modèle remonte (hors délai) pour être traitée par la route", async () => {
    const callModel: CallModel = async () => { throw new Error("API indisponible"); };
    await assert.rejects(runCopilot({ ...base, toolCtx: ctx([]), maxToolCalls: 8, callModel }), /API indisponible/);
  });
});

describe("suggestions et coût", () => {
  test("questions suggérées selon la page, défaut sur le cockpit", () => {
    assert.match(suggestionsFor("/terrain")[0], /animatrices/);
    assert.match(suggestionsFor("/marketing/budgets")[0], /budget/);
    assert.match(suggestionsFor("/marketing/ads/x")[0], /campagnes/i);
    assert.equal(suggestionsFor("/").length, 3);
  });
  test("coût estimé par modèle, prudent pour un modèle inconnu", () => {
    assert.equal(estimateCostUsd("claude-sonnet-5", { inputTokens: 1_000_000, outputTokens: 0 }), 2);
    assert.equal(estimateCostUsd("claude-opus-5", { inputTokens: 0, outputTokens: 100_000, cacheReadTokens: 1_000_000 }), 3);
    assert.ok(estimateCostUsd("modele-inconnu", { inputTokens: 1_000_000, outputTokens: 0 }) >= 10);
  });
});
