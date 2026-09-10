/**
 * Brief du matin : 5 à 7 lignes générées à la première ouverture du Cockpit de la journée, pour les
 * administrateurs (direction). Ce qui a bougé, ce qui est à risque (stock, réglementaire, clients, budget,
 * contenus en retard) et les trois actions du jour, chacune transformable en tâche d'un clic.
 * Cache quotidien par personne dans `ai_cache` (clé `brief:<user>:<date>`), modèle rapide, lecture seule.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { aiCache, tasks } from "@/db/schema";
import { getAccess } from "@/lib/permissions";
import { isAdmin } from "@/lib/permissions-shared";
import { MODULE_KEYS } from "@/lib/access-shared";
import { addDays, iso, today } from "@/lib/format";
import { isAiConfigured } from "./client";
import { askCopilot, CopilotError } from "./service";
import { parseBrief, type BriefResult, type MorningBrief } from "./brief-shared";

const INSTRUCTIONS = `Brief du matin pour la direction générale de COMANET. Format imposé, en Markdown réduit :
1. Cinq à sept lignes au total, chacune commençant par une puce « - », regroupées ainsi : ce qui a bougé (ventes sell-in du mois à date vs M-1, sell-out terrain 7 jours si disponible), ce qui est à risque (stock en rupture ou en tension, dossiers réglementaires critiques, clients à risque ou en retard de commande, budget au-delà du seuil d'alerte, tâches en retard), et une ligne « Actions du jour » qui annonce les trois actions.
2. Chaque ligne cite ses chiffres avec la source entre parenthèses (sell-in Sage, sell-out animatrices, stock, réglementaire…). Pas de bloc Donnée / Analyse / Hypothèse / Recommandation ici : le brief est une lecture rapide.
3. Termine OBLIGATOIREMENT par un bloc de code JSON (\`\`\`json … \`\`\`) et rien après, de la forme :
{"actions":[{"title":"…","why":"…","assignee_role":"…","due_in_days":3,"priority":"HIGH","module":"stock","expected":"…"}]}
avec exactement trois actions (ou moins si les données ne justifient pas trois actions), triées par urgence. \`module\` est l'un de : ${MODULE_KEYS.join(", ")}. \`priority\` est LOW, MEDIUM, HIGH ou CRITICAL. \`why\` cite la donnée exacte. \`expected\` dit le résultat attendu et comment le mesurer.
4. Appelle d'abord get_action_center, puis les outils nécessaires (au plus six) ; n'invente rien, une donnée absente se dit « non disponible ». Aucune écriture (pas de propose_task : la direction crée les tâches d'un clic depuis le brief).`;

const QUESTION = "Rédige le brief du matin : qu'est-ce qui a bougé, qu'est-ce qui est à risque, quelles sont les trois actions du jour ?";

export function briefCacheKey(userId: string, day: string) {
  return `brief:${userId}:${day}`;
}

function endOfDay(now: Date): Date {
  return new Date(iso(addDays(now, 1)) + "T00:00:00+01:00");
}

async function readCache(key: string): Promise<MorningBrief | null> {
  const [hit] = await db.select().from(aiCache).where(eq(aiCache.key, key));
  if (!hit || hit.expiresAt.getTime() <= Date.now()) return null;
  try { return JSON.parse(hit.content) as MorningBrief; } catch { return null; }
}

async function writeCache(key: string, brief: MorningBrief, model: string, tokensIn: number, tokensOut: number) {
  const expiresAt = endOfDay(today());
  await db.insert(aiCache).values({ key, surface: "brief", content: JSON.stringify(brief), model, tokensIn, tokensOut, expiresAt })
    .onConflictDoUpdate({ target: aiCache.key, set: { content: JSON.stringify(brief), model, tokensIn, tokensOut, expiresAt, createdAt: new Date() } });
}

/** Le brief est réservé aux administrateurs (direction) : la synthèse croise tous les modules. */
export async function briefAllowed(): Promise<{ ok: boolean; userId: string | null }> {
  const a = await getAccess();
  if (!a) return { ok: false, userId: null };
  return { ok: isAdmin(a.perms), userId: a.user.id };
}

export async function getMorningBrief(opts: { generate?: boolean; force?: boolean } = {}): Promise<BriefResult> {
  if (!isAiConfigured()) return { ok: false, error: "Copilote non configuré (ANTHROPIC_API_KEY absente).", configured: false };
  const who = await briefAllowed();
  if (!who.ok || !who.userId) return { ok: false, error: "Le brief du matin est réservé à la direction.", configured: true };
  const key = briefCacheKey(who.userId, iso(today()));
  if (!opts.force) {
    const cached = await readCache(key);
    if (cached) return { ok: true, brief: cached, cached: true };
  }
  if (!opts.generate) return { ok: false, error: "Brief non encore généré aujourd'hui.", configured: true };
  try {
    const out = await askCopilot({
      question: QUESTION, contextPath: "/", tier: "fast", surface: "brief", contextModule: "brief",
      surfaceInstructions: INSTRUCTIONS, allowWrites: false, automatic: true, maxToolCalls: 6,
    });
    const { text, actions } = parseBrief(out.text);
    const brief: MorningBrief = { text, actions, generatedAt: new Date().toISOString(), model: out.model, createdTaskIds: {} };
    await writeCache(key, brief, out.model, out.usage.inputTokens, out.usage.outputTokens);
    return { ok: true, brief, cached: false };
  } catch (e) {
    return { ok: false, error: e instanceof CopilotError ? e.message : "Le copilote n'a pas pu produire le brief.", configured: true };
  }
}

/**
 * « Créer la tâche » depuis le brief : le clic de la direction vaut validation, la tâche naît donc active (TODO),
 * source AI, sans assigné (le rôle suggéré figure dans la description). Une seule tâche par action du brief.
 */
export async function createTaskFromBrief(index: number): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> {
  const who = await briefAllowed();
  if (!who.ok || !who.userId) return { ok: false, error: "Réservé à la direction." };
  const key = briefCacheKey(who.userId, iso(today()));
  const brief = await readCache(key);
  const action = brief?.actions[index];
  if (!brief || !action) return { ok: false, error: "Action introuvable dans le brief du jour." };
  if (brief.createdTaskIds[index]) return { ok: true, taskId: brief.createdTaskIds[index] };
  const description = [action.why, "", `Résultat attendu : ${action.expected}`, action.assignee_role ? `Responsable suggéré : ${action.assignee_role}` : null, "Créée depuis le brief du matin du copilote IA."].filter((l) => l !== null).join("\n");
  const [row] = await db.insert(tasks).values({
    title: action.title, description, status: "TODO", priority: action.priority, dueDate: iso(addDays(today(), action.due_in_days)),
    source: "AI", expectedImpact: action.expected.slice(0, 500), createdById: who.userId,
  }).returning({ id: tasks.id });
  brief.createdTaskIds[index] = row.id;
  await db.update(aiCache).set({ content: JSON.stringify(brief) }).where(eq(aiCache.key, key));
  revalidatePath("/");
  revalidatePath("/taches");
  return { ok: true, taskId: row.id };
}
