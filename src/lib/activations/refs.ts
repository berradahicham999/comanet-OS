import "server-only";
import { cache } from "react";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import {
  activationTypes, activationStatuses, activationStatusTransitions, activationObjectives, activationTargets,
  activationCostItems, inventoryCategories, activationTemplates,
} from "@/db/schema";
import type { ActivationRefs } from "./shared";

/** Référentiels du module Activations, chargés une fois par requête. */
export const activationRefs = cache(async (): Promise<ActivationRefs> => {
  const [types, statuses, transitions, objectives, targets, costItems, invCategories] = await Promise.all([
    db.select().from(activationTypes).orderBy(asc(activationTypes.sort), asc(activationTypes.label)),
    db.select().from(activationStatuses).orderBy(asc(activationStatuses.sort), asc(activationStatuses.label)),
    db.select().from(activationStatusTransitions),
    db.select().from(activationObjectives).orderBy(asc(activationObjectives.sort), asc(activationObjectives.label)),
    db.select().from(activationTargets).orderBy(asc(activationTargets.sort), asc(activationTargets.label)),
    db.select().from(activationCostItems).orderBy(asc(activationCostItems.sort), asc(activationCostItems.label)),
    db.select().from(inventoryCategories).orderBy(asc(inventoryCategories.sort), asc(inventoryCategories.label)),
  ]);
  return { types, statuses, transitions, objectives, targets, costItems, inventoryCategories: invCategories };
});

export const listActivationTemplates = cache(async () => db.select().from(activationTemplates).orderBy(asc(activationTemplates.name)));

/** Statut par défaut d'une nouvelle activation : le premier actif dans l'ordre. */
export async function defaultActivationStatusKey(): Promise<string> {
  const { statuses } = await activationRefs();
  return statuses.find((s) => s.active)?.key ?? "IDEE";
}
