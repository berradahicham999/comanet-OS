/**
 * « Ajouter au plan » — seule écriture du générateur d'actions (serveur).
 *
 * IDEA → PLAN → EXECUTION → MEASUREMENT, dans UNE transaction :
 *  1. le plan marketing de la marque et de l'année (créé en brouillon s'il n'existe pas) ;
 *  2. le conteneur d'exécution : une ACTIVATION (événementiel, trade) avec ses lignes budgétaires par poste — son reflet
 *     dans `marketing_expenses` reste celui du module Activations, à la validation — ou une CAMPAGNE (digital,
 *     influence, contenu) avec ses produits et ses dépenses PRÉVUES (statut PLANNED, rattachées à l'action) ;
 *  3. l'action marketing (`createAction()`, source GENERATOR, fiche complète figée) et sa tâche principale ;
 *  4. une tâche par étape du rétroplanning, datée, avec le responsable proposé par rôle ;
 *  5. les contenus nécessaires dans le planning éditorial, au statut initial.
 * Puis, hors transaction : budget prévu de l'activation (`syncActivationExpenses`) et rafraîchissement de l'analytics.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activationBrands, activationBudgetLines, activationProducts, activations, activationTypes, campaignProducts, campaigns, contentItems,
  marketingExpenses, marketingPlans, tasks, type TaskPriority,
} from "@/db/schema";
import { audit, type AuditActor } from "@/lib/audit";
import { defaultActivationStatusKey } from "@/lib/activations/refs";
import { syncActivationExpenses } from "@/lib/activations/budget";
import { defaultStatusKey } from "@/lib/content/refs";
import { refreshAfterWrite } from "@/lib/analytics-marketing/refresh";
import { createAction } from "@/lib/marketing-plan/actions";
import { currentPlanFor } from "@/lib/marketing-plan/plan";
import { AXES } from "./catalog";
import { LEVEL_LABELS } from "./engine";
import type { ActionProposal, GeneratorInput } from "./types";

export type AddToPlanResult = { actionId: string; planId: string; planCreated: boolean; activationId: string | null; campaignId: string | null; tasks: number; contents: number; expenses: number };

const mad = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} MAD`;

export async function addProposalToPlan(p: ActionProposal, input: GeneratorInput, actor: AuditActor, opts: { planAxisId?: string | null; withPlannedExpenses: boolean; responsibleId?: string | null }): Promise<AddToPlanResult> {
  const year = Number(p.eventDate.slice(0, 4));
  const existingPlan = await currentPlanFor(input.brandId, year);
  const [activationStatus, contentStatus, typeRows] = await Promise.all([defaultActivationStatusKey(), defaultStatusKey(), db.select({ key: activationTypes.key }).from(activationTypes)]);
  const knownTypes = new Set(typeRows.map((t) => t.key));
  const actionId = randomUUID();
  const lead = p.steps.find((s) => s.role === "MARKETING")?.assigneeId ?? opts.responsibleId ?? null;
  const priority: TaskPriority = p.score >= 70 ? "HIGH" : "MEDIUM";
  const expected = `${p.estimate.trials.toLocaleString("fr-FR")} essais, ${p.estimate.buyers.toLocaleString("fr-FR")} ventes${p.estimate.revenue !== null ? `, ${mad(p.estimate.revenue)} de CA sell-out` : ""} (hypothèse du modèle ; impact ${LEVEL_LABELS[p.impact]}).`;

  const res = await db.transaction(async (tx) => {
    /* 1. Plan */
    let planId = existingPlan?.id ?? null, planCreated = false;
    if (!planId) {
      const [row] = await tx.insert(marketingPlans).values({ brandId: input.brandId, name: `Plan marketing ${year}`, periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`, year, status: "DRAFT", createdById: actor.id, notes: "Créé automatiquement à l'ajout d'une action générée." }).returning({ id: marketingPlans.id });
      planId = row.id; planCreated = true;
      await audit({ actor, action: "CREATE", module: "marketing", entity: "marketing_plan", entityId: planId, label: `Plan marketing ${year}`, after: { brandId: input.brandId, year, auto: true } }, tx);
    }

    /* 2. Conteneur d'exécution */
    let activationId: string | null = null, campaignId: string | null = null, expenses = 0;
    if (p.execution.kind === "ACTIVATION") {
      const type = knownTypes.has(p.execution.activationType) ? p.execution.activationType : "AUTRE";
      const prep = p.steps[0]?.date ?? null;
      const [a] = await tx.insert(activations).values({
        name: p.name, type, status: activationStatus, brandId: input.brandId, productId: input.productId, date: p.eventDate, endDate: p.endDate > p.eventDate ? p.endDate : null,
        prepDate: prep && prep < p.eventDate ? prep : null, city: p.suggestions.city, responsibleId: lead ?? actor.id, createdById: actor.id, axisId: opts.planAxisId ?? null,
        objective: p.objectiveText, description: `${p.concept}\n\nAction générée par COMANET (modèle « ${p.family} ») : rétroplanning, KPI et hypothèses dans Marketing → Priorités & actions.`,
      }).returning({ id: activations.id });
      activationId = a.id;
      await tx.insert(activationBrands).values({ activationId, brandId: input.brandId });
      if (input.productId) await tx.insert(activationProducts).values({ activationId, productId: input.productId });
      await tx.insert(activationBudgetLines).values(p.lines.map((l, i) => ({ activationId: activationId!, costItemKey: l.costItem ?? "AUTRE", brandId: input.brandId, label: l.label, planned: l.amount.toFixed(2), sort: i, date: p.eventDate })));
      await audit({ actor, action: "CREATE", module: "marketing", entity: "activation", entityId: activationId, label: p.name, after: { generated: p.templateKey, budget: p.budget } }, tx);
    } else {
      const [c] = await tx.insert(campaigns).values({
        brandId: input.brandId, name: p.name, type: p.execution.campaignType, channel: p.execution.channel, objective: p.objectiveText, startDate: p.eventDate, endDate: p.endDate,
        budget: p.budget.toFixed(2), status: "PLANNED", audience: p.target, message: p.concept.slice(0, 500), kpiTarget: p.kpis.slice(0, 3).map((k) => `${k.label} : ${k.target}`).join(" · "),
        responsibleId: lead, axisId: opts.planAxisId ?? null, notes: "Campagne créée par le générateur d'actions.",
      }).returning({ id: campaigns.id });
      campaignId = c.id;
      if (input.productId) await tx.insert(campaignProducts).values({ campaignId, productId: input.productId }).onConflictDoNothing();
      await audit({ actor, action: "CREATE", module: "marketing", entity: "campaign", entityId: campaignId, label: p.name, after: { generated: p.templateKey, budget: p.budget } }, tx);
    }

    /* 3. Action et tâche principale */
    await createAction({
      brandId: input.brandId, title: p.name, planId, axisId: opts.planAxisId ?? null, month: input.month, productId: input.productId, campaignId, category: AXES[p.axis].mainCategory,
      objective: p.objectiveText, why: p.why.join(" ; "), expectedResult: expected, budgetPlanned: p.budget, source: "GENERATOR", templateKey: p.templateKey,
      spec: p as unknown as Record<string, unknown>, activationId, eventDate: p.eventDate, priority, dueDate: p.endDate, assigneeId: lead,
    }, actor, tx, actionId);

    /* Dépenses prévues d'une campagne (PLANNED : hors consommé, visibles dans Budget & dépenses). */
    if (campaignId && opts.withPlannedExpenses) {
      await tx.insert(marketingExpenses).values(p.lines.map((l) => ({ brandId: input.brandId, campaignId, actionId, productId: input.productId, category: l.category, label: `${l.label} — ${p.name}`, amount: l.amount.toFixed(2), status: "PLANNED" as const, date: p.eventDate })));
      expenses = p.lines.length;
    }

    /* 4. Tâches du rétroplanning */
    if (p.steps.length) {
      await tx.insert(tasks).values(p.steps.map((s, i) => ({
        title: `${s.label} — ${p.name}`, description: `${s.dayLabel} (${s.date}) · rôle : ${s.role.toLowerCase()} · action « ${p.name} »`, priority, dueDate: s.date, assigneeId: s.assigneeId, brandId: input.brandId,
        source: "MARKETING" as const, sourceKey: `marketing-action:${actionId}:etape:${i + 1}`, entityType: "marketing_action", entityId: actionId, createdById: actor.id,
      })));
    }

    /* 5. Contenus nécessaires */
    if (p.contents.length) {
      await tx.insert(contentItems).values(p.contents.map((c) => ({
        date: c.date, brandId: input.brandId, productId: input.productId, title: `${c.title}${c.count > 1 ? ` (×${c.count})` : ""} — ${p.name}`, format: c.format, status: contentStatus,
        campaignId, activationId, axisId: opts.planAxisId ?? null, responsibleId: lead, createdById: actor.id, deliverables: `${c.count} × ${c.format.toLowerCase()}`, brief: p.concept,
        constraints: p.compliance,
      })));
    }
    return { planId, planCreated, activationId, campaignId, expenses };
  });

  if (res.activationId) await syncActivationExpenses(res.activationId).catch((e) => console.error("Budget prévu de l'activation non recalculé", e));
  await refreshAfterWrite(["EXPENSE", "CONTENT"]).catch(() => undefined);
  return { actionId, planId: res.planId, planCreated: res.planCreated, activationId: res.activationId, campaignId: res.campaignId, tasks: p.steps.length, contents: p.contents.length, expenses: res.expenses };
}

/** Lien de retour vers l'activation ou la campagne d'une action générée. */
export function executionHref(a: { activationId: string | null; campaignId: string | null }): string | null {
  return a.activationId ? `/marketing/activations/${a.activationId}` : a.campaignId ? `/marketing/campagnes/${a.campaignId}` : null;
}

export async function planName(id: string): Promise<string | null> {
  const r = await db.query.marketingPlans.findFirst({ where: eq(marketingPlans.id, id) });
  return r?.name ?? null;
}
