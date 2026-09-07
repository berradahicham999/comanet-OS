import "server-only";
import { cache } from "react";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { contentStatuses, contentStatusTransitions, contentPlatforms, contentFormats, contentObjectives, briefTemplates } from "@/db/schema";
import type { ContentRefs } from "./shared";

/** Référentiels du planning éditorial, chargés une fois par requête. */
export const contentRefs = cache(async (): Promise<ContentRefs> => {
  const [statuses, transitions, platforms, formats, objectives] = await Promise.all([
    db.select().from(contentStatuses).orderBy(asc(contentStatuses.sort), asc(contentStatuses.label)),
    db.select().from(contentStatusTransitions),
    db.select().from(contentPlatforms).orderBy(asc(contentPlatforms.sort), asc(contentPlatforms.label)),
    db.select().from(contentFormats).orderBy(asc(contentFormats.sort), asc(contentFormats.label)),
    db.select().from(contentObjectives).orderBy(asc(contentObjectives.sort), asc(contentObjectives.label)),
  ]);
  return { statuses, transitions, platforms, formats, objectives };
});

export const listBriefTemplates = cache(async () => db.select().from(briefTemplates).orderBy(asc(briefTemplates.name)));

/** Statut par défaut d'un nouveau contenu : le premier actif dans l'ordre. */
export async function defaultStatusKey(): Promise<string> {
  const { statuses } = await contentRefs();
  return statuses.find((s) => s.active)?.key ?? "IDEE";
}
