/**
 * « Détailler » une recommandation de l'Action Center : plan d'exécution (étapes, responsable, échéance,
 * budget, résultat attendu, indicateur de mesure), stocké sur la recommandation par sa clé stable
 * (`ai_action_plans.rec_key`). Modèle avancé, lecture seule, au plus quatre appels d'outils.
 */
import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { aiActionPlans } from "@/db/schema";
import { getAccess } from "@/lib/permissions";
import { isAiConfigured } from "./client";
import { askCopilot, copilotAllowed, CopilotError } from "./service";
import type { PlanResult, RecSummary, StoredPlan } from "./plans-shared";

const INSTRUCTIONS = `Plan d'exécution d'une recommandation de l'Action Center. Relis d'abord la donnée par les outils (au plus quatre appels) pour confirmer le diagnostic, puis rends le plan en Markdown réduit, 250 mots au plus, avec exactement ces sections de niveau 3 :
### Pourquoi — la donnée qui motive (chiffres, source, période), en deux phrases.
### Étapes — liste numérotée de 3 à 6 étapes concrètes, chacune avec [responsable suggéré · échéance].
### Budget — montant en MAD si une dépense est nécessaire, sinon « aucun ».
### Résultat attendu — le changement visé, chiffré quand la donnée le permet.
### Mesure — l'indicateur à suivre, l'écran de COMANET OS où le lire, et la date du point de contrôle.
Pas de bloc Donnée / Analyse / Hypothèse / Recommandation ici. Aucune écriture (pas de propose_task : la personne crée la tâche depuis la carte).`;

function question(rec: RecSummary): string {
  return [
    `Détaille un plan d'exécution pour cette recommandation (règle « ${rec.rule} », catégorie ${rec.category}, priorité ${rec.priority}) :`,
    `Titre : ${rec.title}${rec.subtitle ? ` — ${rec.subtitle}` : ""}`,
    rec.facts.length ? `Faits : ${rec.facts.map((f) => `${f.label} = ${f.value}`).join(" ; ")}` : null,
    `Pourquoi (diagnostic de la règle) : ${rec.why}`,
    `Action recommandée : ${rec.action}`,
    rec.impact ? `Impact attendu : ${rec.impact}` : null,
    `Tâche suggérée : « ${rec.taskTitle} », sous ${rec.dueInDays} jours.`,
  ].filter(Boolean).join("\n");
}

export async function listPlans(keys: string[]): Promise<Map<string, StoredPlan>> {
  if (!keys.length) return new Map();
  const rows = await db.select().from(aiActionPlans).where(inArray(aiActionPlans.recKey, keys));
  return new Map(rows.map((r) => [r.recKey, { recKey: r.recKey, contentMd: r.contentMd, model: r.model, updatedAt: r.updatedAt.toISOString() }]));
}

export async function getPlan(recKey: string): Promise<StoredPlan | null> {
  return (await listPlans([recKey])).get(recKey) ?? null;
}

export async function detailRecommendation(rec: RecSummary, opts: { force?: boolean } = {}): Promise<PlanResult> {
  if (!isAiConfigured()) return { ok: false, error: "Copilote non configuré (ANTHROPIC_API_KEY absente).", configured: false };
  const access = await getAccess();
  if (!access) return { ok: false, error: "Non connecté.", configured: true };
  if (!copilotAllowed(access)) return { ok: false, error: "Le copilote n'est pas ouvert à ce profil.", configured: true };
  if (!opts.force) {
    const existing = await getPlan(rec.key);
    if (existing) return { ok: true, plan: existing, cached: true };
  }
  try {
    const out = await askCopilot({
      question: question(rec), contextPath: "/actions", tier: "advanced", surface: "plan", contextModule: "plan",
      surfaceInstructions: INSTRUCTIONS, allowWrites: false, maxToolCalls: 4,
    });
    const now = new Date();
    await db.insert(aiActionPlans).values({ recKey: rec.key, contentMd: out.text, model: out.model, createdById: access.user.id, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: aiActionPlans.recKey, set: { contentMd: out.text, model: out.model, createdById: access.user.id, updatedAt: now } });
    return { ok: true, plan: { recKey: rec.key, contentMd: out.text, model: out.model, updatedAt: now.toISOString() }, cached: false };
  } catch (e) {
    return { ok: false, error: e instanceof CopilotError ? e.message : "Le copilote n'a pas pu produire le plan.", configured: true };
  }
}

export async function deletePlan(recKey: string): Promise<void> {
  await db.delete(aiActionPlans).where(eq(aiActionPlans.recKey, recKey));
}
