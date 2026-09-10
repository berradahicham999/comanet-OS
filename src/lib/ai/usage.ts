/** Suivi d'usage et de coût du copilote (page /parametres/ia) : tokens et coût estimé par jour, par personne, par surface. */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { estimateCostUsd } from "./cost";

export type UsageRow = { key: string; label: string; requests: number; tokensIn: number; tokensOut: number; cacheRead: number; costUsd: number };

type Raw = { key: string; label: string; model: string | null; requests: number; tokens_in: number; tokens_out: number; cache_read: number };

function fold(rows: Raw[]): UsageRow[] {
  const map = new Map<string, UsageRow>();
  for (const r of rows) {
    const cur = map.get(r.key) ?? { key: r.key, label: r.label, requests: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, costUsd: 0 };
    cur.requests += Number(r.requests); cur.tokensIn += Number(r.tokens_in); cur.tokensOut += Number(r.tokens_out); cur.cacheRead += Number(r.cache_read);
    cur.costUsd += estimateCostUsd(r.model, { inputTokens: Number(r.tokens_in), outputTokens: Number(r.tokens_out), cacheReadTokens: Number(r.cache_read) });
    map.set(r.key, cur);
  }
  return [...map.values()];
}

const TZ = "Africa/Casablanca";

export async function usageByDay(days = 30): Promise<UsageRow[]> {
  const r = await db.execute<Raw>(sql`
    select to_char(created_at at time zone ${TZ}, 'YYYY-MM-DD') as key, to_char(created_at at time zone ${TZ}, 'YYYY-MM-DD') as label, model,
      count(*)::int as requests, sum(tokens_in)::float8 as tokens_in, sum(tokens_out)::float8 as tokens_out, sum(cache_read_tokens)::float8 as cache_read
    from ai_messages where role = 'assistant' and created_at >= now() - make_interval(days => ${days})
    group by 1, 2, 3 order by 1 desc`);
  return fold(r.rows).sort((a, b) => b.key.localeCompare(a.key));
}

export async function usageByUser(days = 30): Promise<UsageRow[]> {
  const r = await db.execute<Raw>(sql`
    select c.user_id::text as key, coalesce(u.name, '?') as label, m.model,
      count(*)::int as requests, sum(m.tokens_in)::float8 as tokens_in, sum(m.tokens_out)::float8 as tokens_out, sum(m.cache_read_tokens)::float8 as cache_read
    from ai_messages m join ai_conversations c on c.id = m.conversation_id left join users u on u.id = c.user_id
    where m.role = 'assistant' and m.created_at >= now() - make_interval(days => ${days})
    group by 1, 2, 3`);
  return fold(r.rows).sort((a, b) => b.costUsd - a.costUsd);
}

export const SURFACE_LABEL: Record<string, string> = { chat: "Panneau (questions libres)", explain: "Expliquer (cartes)", brief: "Brief du matin", plan: "Détailler (Action Center)", report: "Rapports" };

export async function usageBySurface(days = 30): Promise<UsageRow[]> {
  const r = await db.execute<Raw>(sql`
    select surface as key, surface as label, model, count(*)::int as requests, sum(tokens_in)::float8 as tokens_in, sum(tokens_out)::float8 as tokens_out, sum(cache_read_tokens)::float8 as cache_read
    from ai_messages where role = 'assistant' and created_at >= now() - make_interval(days => ${days})
    group by 1, 2, 3`);
  return fold(r.rows).map((x) => ({ ...x, label: SURFACE_LABEL[x.key] ?? x.key })).sort((a, b) => b.costUsd - a.costUsd);
}

export async function toolStats(days = 30): Promise<{ tool: string; calls: number; errors: number; avgMs: number; rows: number }[]> {
  const r = await db.execute<{ tool: string; calls: number; errors: number; avg_ms: number; rows: number }>(sql`
    select tool, count(*)::int as calls, count(*) filter (where error is not null)::int as errors, avg(duration_ms)::float8 as avg_ms, sum(row_count)::float8 as rows
    from ai_tool_calls where created_at >= now() - make_interval(days => ${days}) group by tool order by calls desc`);
  return r.rows.map((x) => ({ tool: x.tool, calls: Number(x.calls), errors: Number(x.errors), avgMs: Math.round(Number(x.avg_ms) || 0), rows: Number(x.rows) || 0 }));
}
