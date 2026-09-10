/**
 * Limites d'usage du copilote : requêtes par personne et par heure, budget quotidien de tokens,
 * plafond mensuel de coût pour les surfaces automatiques. Les seuils vivent dans `settings.ai`.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { AiSettings } from "@/lib/settings";
import { estimateCostUsd } from "./cost";

export type LimitCheck = { ok: true } | { ok: false; reason: string };

export async function checkLimits(userId: string, ai: AiSettings, opts: { automatic?: boolean; isAdmin?: boolean } = {}): Promise<LimitCheck> {
  const r = await db.execute<{ hour_count: number; day_tokens: number }>(sql`
    select
      (select count(*) from ai_messages m join ai_conversations c on c.id = m.conversation_id where c.user_id = ${userId}::uuid and m.role = 'user' and m.created_at > now() - interval '1 hour')::int as hour_count,
      (select coalesce(sum(tokens_in + tokens_out), 0) from ai_messages where role = 'assistant' and created_at >= date_trunc('day', now() at time zone 'Africa/Casablanca') at time zone 'Africa/Casablanca')::float8 as day_tokens`);
  const row = r.rows[0];
  if (row && Number(row.hour_count) >= ai.requestsPerHour) return { ok: false, reason: `Limite atteinte : ${ai.requestsPerHour} questions par heure. Réessayer un peu plus tard.` };
  if (row && Number(row.day_tokens) >= ai.dailyTokenBudget) return { ok: false, reason: `Budget quotidien du copilote épuisé (${ai.dailyTokenBudget.toLocaleString("fr-FR")} tokens). Il se réinitialise à minuit ; un administrateur peut le relever dans Paramètres → Copilote IA.` };
  if (opts.automatic && !opts.isAdmin) {
    const monthly = await monthlyCostUsd();
    if (monthly >= ai.monthlyCostAlertUsd) return { ok: false, reason: `Plafond mensuel de coût atteint (${ai.monthlyCostAlertUsd} USD) : les résumés automatiques sont suspendus jusqu'au mois prochain.` };
  }
  return { ok: true };
}

/** Coût estimé du mois civil en cours (Casablanca), toutes surfaces confondues. */
export async function monthlyCostUsd(): Promise<number> {
  const r = await db.execute<{ model: string | null; tokens_in: number; tokens_out: number; cache_read: number }>(sql`
    select model, sum(tokens_in)::float8 as tokens_in, sum(tokens_out)::float8 as tokens_out, sum(cache_read_tokens)::float8 as cache_read
    from ai_messages where role = 'assistant' and created_at >= date_trunc('month', now() at time zone 'Africa/Casablanca') at time zone 'Africa/Casablanca'
    group by model`);
  return r.rows.reduce((s, x) => s + estimateCostUsd(x.model, { inputTokens: Number(x.tokens_in), outputTokens: Number(x.tokens_out), cacheReadTokens: Number(x.cache_read) }), 0);
}
