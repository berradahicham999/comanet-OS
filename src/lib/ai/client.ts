/**
 * Client Anthropic et choix des modèles.
 *
 * La clé vit dans `ANTHROPIC_API_KEY` (jamais en base, jamais côté client). Sans clé, `isAiConfigured()`
 * renvoie false et chaque surface affiche « Copilote non configuré » : l'application ne dépend jamais de l'IA.
 * Deux niveaux de modèle : rapide (explications de cartes, brief) et avancé (questions libres, plans, rapports).
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_FAST_MODEL = "claude-sonnet-5";
export const DEFAULT_ADVANCED_MODEL = "claude-opus-5";

export type ModelTier = "fast" | "advanced";

export function isAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

export function modelFor(tier: ModelTier): string {
  return tier === "fast" ? process.env.AI_MODEL_FAST?.trim() || DEFAULT_FAST_MODEL : process.env.AI_MODEL_ADVANCED?.trim() || DEFAULT_ADVANCED_MODEL;
}

let client: Anthropic | null = null;

/** Instance partagée ; lève une erreur explicite si la clé manque (les appelants testent `isAiConfigured()` avant). */
export function anthropic(): Anthropic {
  if (!isAiConfigured()) throw new Error("Copilote non configuré : ANTHROPIC_API_KEY absente.");
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 55_000 });
  return client;
}
