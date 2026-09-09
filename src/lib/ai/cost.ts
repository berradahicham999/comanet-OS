/**
 * Grille de prix par modèle (USD par million de tokens), versionnée dans le code.
 * Sert au suivi des coûts de /parametres/ia ; à mettre à jour quand Anthropic change ses tarifs.
 * Un modèle inconnu est facturé au tarif le plus élevé de la grille : le coût affiché est une estimation prudente.
 */
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const PRICES: Record<string, Price> = {
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
};

const FALLBACK: Price = PRICES["claude-fable-5-1"];

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };

export function priceFor(model: string | null | undefined): Price {
  if (!model) return FALLBACK;
  return PRICES[model] ?? Object.entries(PRICES).find(([k]) => model.startsWith(k))?.[1] ?? FALLBACK;
}

/** Coût estimé en USD. */
export function estimateCostUsd(model: string | null | undefined, u: Usage): number {
  const p = priceFor(model);
  const usd = (u.inputTokens * p.input + u.outputTokens * p.output + (u.cacheReadTokens ?? 0) * p.cacheRead + (u.cacheWriteTokens ?? 0) * p.cacheWrite) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
