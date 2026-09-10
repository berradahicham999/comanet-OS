/**
 * « Expliquer » une carte : explication courte au format Donnée / Analyse / Hypothèse / Recommandation,
 * modèle rapide, au plus trois appels d'outils, lecture seule, mise en cache `settings.ai.explainCacheMinutes`
 * par combinaison (carte + valeurs + période + filtres) ET par droits de la personne : deux profils aux
 * portées différentes ne partagent jamais une explication.
 */
import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiCache } from "@/db/schema";
import { getAccess } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { isAiConfigured } from "./client";
import { askCopilot, copilotAllowed, CopilotError } from "./service";
import type { ExplainContext, ExplainResult } from "./explain-shared";

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

export function explainCacheKey(ctx: ExplainContext, rights: unknown): string {
  return `explain:${ctx.surface}:${ctx.card}:${hash({ values: ctx.values, period: ctx.period ?? null, filters: ctx.filters ?? null })}:${hash(rights)}`;
}

const INSTRUCTIONS = `Explication courte d'une carte de tableau de bord. Contrainte de longueur : 120 mots au total, quatre blocs (### Donnée, ### Analyse, ### Hypothèse, ### Recommandation) d'une à deux phrases chacun, listes à puces autorisées dans Donnée. Relis la donnée par les outils avant d'écrire (au plus trois appels) ; les valeurs affichées sur la carte sont un repère à confronter, pas une source. Une seule recommandation, la plus utile, avec responsable et échéance. Aucune écriture (pas de propose_task).`;

function question(ctx: ExplainContext): string {
  const values = ctx.values.map((v) => `- ${v.label} : ${v.value}`).join("\n");
  const period = ctx.period ? `Période affichée : ${ctx.period.label}${ctx.period.start ? ` (${ctx.period.start} → ${ctx.period.end ?? "?"})` : ""}.` : "";
  const filters = ctx.filters && Object.keys(ctx.filters).length ? `Filtres actifs : ${Object.entries(ctx.filters).map(([k, v]) => `${k} = ${v}`).join(", ")}.` : "";
  const tools = ctx.tools?.length ? `Outils pertinents : ${ctx.tools.join(", ")}.` : "";
  return [`Explique la carte « ${ctx.title} » de l'écran ${ctx.surface}.`, "Valeurs affichées :", values, period, filters, tools].filter(Boolean).join("\n");
}

export async function explainCard(ctx: ExplainContext, opts: { force?: boolean } = {}): Promise<ExplainResult> {
  if (!isAiConfigured()) return { ok: false, error: "Copilote non configuré (ANTHROPIC_API_KEY absente).", configured: false };
  const access = await getAccess();
  if (!access) return { ok: false, error: "Non connecté.", configured: true };
  if (!copilotAllowed(access)) return { ok: false, error: "Le copilote n'est pas ouvert à ce profil.", configured: true };
  const settings = await getSettings();
  const rights = { perms: access.perms, scope: access.scope, brandIds: access.brandIds, clientIds: access.clientIds };
  const key = explainCacheKey(ctx, rights);

  if (!opts.force) {
    const [hit] = await db.select().from(aiCache).where(eq(aiCache.key, key));
    if (hit && hit.expiresAt.getTime() > Date.now()) return { ok: true, text: hit.content, cached: true, model: hit.model ?? "", generatedAt: hit.createdAt.toISOString() };
  }
  try {
    const out = await askCopilot({
      question: question(ctx), contextPath: `/${ctx.surface === "cockpit" ? "" : ctx.surface}`, tier: "fast", surface: "explain", contextModule: "explain",
      surfaceInstructions: INSTRUCTIONS, allowWrites: false, automatic: true, maxToolCalls: 3,
    });
    const expiresAt = new Date(Date.now() + settings.ai.explainCacheMinutes * 60_000);
    await db.insert(aiCache).values({ key, surface: "explain", content: out.text, model: out.model, tokensIn: out.usage.inputTokens, tokensOut: out.usage.outputTokens, expiresAt })
      .onConflictDoUpdate({ target: aiCache.key, set: { content: out.text, model: out.model, tokensIn: out.usage.inputTokens, tokensOut: out.usage.outputTokens, expiresAt, createdAt: new Date() } });
    return { ok: true, text: out.text, cached: false, model: out.model, generatedAt: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e instanceof CopilotError ? e.message : "Le copilote n'a pas pu produire d'explication.", configured: true };
  }
}
