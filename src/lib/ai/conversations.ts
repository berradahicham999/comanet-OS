/** Persistance des conversations et messages du copilote (`ai_conversations`, `ai_messages`). */
import "server-only";
import { and, desc, eq, notInArray } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { aiConversations, aiMessages } from "@/db/schema";

export type ConversationSummary = { id: string; title: string | null; contextPath: string | null; updatedAt: string };

/** Surfaces automatiques : leurs conversations servent au suivi des coûts, pas à l'historique du panneau. */
export const HIDDEN_CONTEXT_MODULES = ["explain", "brief", "plan", "report"];
export type StoredMessage = { id: string; role: "user" | "assistant"; content: string; toolCalls: unknown; createdAt: string; model: string | null; latencyMs: number | null };

export async function listConversations(userId: string, limit = 20): Promise<ConversationSummary[]> {
  const rows = await db.select({ id: aiConversations.id, title: aiConversations.title, contextPath: aiConversations.contextPath, updatedAt: aiConversations.updatedAt })
    .from(aiConversations).where(and(eq(aiConversations.userId, userId), notInArray(aiConversations.contextModule, HIDDEN_CONTEXT_MODULES))).orderBy(desc(aiConversations.updatedAt)).limit(limit);
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export async function getConversation(userId: string, id: string): Promise<{ id: string; title: string | null; messages: StoredMessage[] } | null> {
  const [c] = await db.select().from(aiConversations).where(and(eq(aiConversations.id, id), eq(aiConversations.userId, userId)));
  if (!c) return null;
  const rows = await db.select().from(aiMessages).where(eq(aiMessages.conversationId, id)).orderBy(aiMessages.createdAt);
  return { id: c.id, title: c.title, messages: rows.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content, toolCalls: m.toolCalls, createdAt: m.createdAt.toISOString(), model: m.model, latencyMs: m.latencyMs })) };
}

export async function createConversation(userId: string, input: { title: string; contextModule?: string | null; contextPath?: string | null }): Promise<string> {
  const [row] = await db.insert(aiConversations).values({ userId, title: input.title.slice(0, 120), contextModule: input.contextModule ?? null, contextPath: input.contextPath ?? null }).returning({ id: aiConversations.id });
  return row.id;
}

export async function appendMessage(conversationId: string, m: { role: "user" | "assistant"; content: string; toolCalls?: unknown; tokensIn?: number; tokensOut?: number; cacheReadTokens?: number; model?: string | null; latencyMs?: number | null; surface?: string }): Promise<string> {
  const [row] = await db.insert(aiMessages).values({
    conversationId, role: m.role, content: m.content, toolCalls: m.toolCalls ?? null, tokensIn: m.tokensIn ?? 0, tokensOut: m.tokensOut ?? 0, cacheReadTokens: m.cacheReadTokens ?? 0,
    model: m.model ?? null, latencyMs: m.latencyMs ?? null, surface: m.surface ?? "chat",
  }).returning({ id: aiMessages.id });
  await db.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, conversationId));
  return row.id;
}

/**
 * Historique à renvoyer au modèle : texte seulement (les appels d'outils passés ne sont pas rejoués, leurs
 * chiffres figurent déjà dans les réponses). Limité aux derniers échanges pour contenir le coût.
 */
export function historyFromStored(messages: StoredMessage[], maxTurns = 8): Anthropic.MessageParam[] {
  const tail = messages.slice(-maxTurns * 2);
  const out: Anthropic.MessageParam[] = [];
  for (const m of tail) {
    if (!m.content.trim()) continue;
    if (out.length && out[out.length - 1].role === m.role) { out[out.length - 1] = { role: m.role, content: `${out[out.length - 1].content}\n\n${m.content}` }; continue; }
    out.push({ role: m.role, content: m.content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export async function deleteConversation(userId: string, id: string): Promise<void> {
  await db.delete(aiConversations).where(and(eq(aiConversations.id, id), eq(aiConversations.userId, userId)));
}
