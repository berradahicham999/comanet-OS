"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/access";
import { runWebChecks, type WebCheckRun } from "@/lib/places/web-check";
import type { PlaceKind } from "@/lib/places/web-check-shared";

/**
 * « Vérifier maintenant » : un lot du contrôle Internet des positions (Google Maps), hors cron. Réservé à la
 * direction (administrateurs) : chaque recherche est facturée par Google.
 */
export async function runWebChecksAction(kind: PlaceKind): Promise<WebCheckRun> {
  const user = await requireAdmin();
  const res = await runWebChecks({ actorId: user.id, only: kind });
  revalidatePath(kind === "doctor" ? "/medical/suivi" : "/clients/visites");
  return res;
}
