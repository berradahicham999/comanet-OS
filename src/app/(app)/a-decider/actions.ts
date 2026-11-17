"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { decideValidation, VALIDATION_PATHS } from "@/lib/validations/queue";
import { readDecision, type DecisionResult } from "@/lib/validations/shared";

/**
 * Une décision prise depuis le Cockpit ou la page « À décider ». Même chemin que le téléphone (`/api/m/validations`) :
 * `decideValidation()`, qui repasse par le contrôle de droits de chaque file. La prévisualisation reste en lecture seule.
 */
export async function decideValidationAction(raw: unknown): Promise<DecisionResult> {
  try {
    const access = await getAccess();
    if (!access) return { ok: false, error: "Session expirée : reconnectez-vous." };
    if (access.preview) return { ok: false, error: "Prévisualisation : lecture seule." };
    const d = readDecision(raw);
    if (!d) return { ok: false, error: "Décision illisible." };
    const r = await decideValidation(access, d);
    for (const path of VALIDATION_PATHS) revalidatePath(path);
    return r;
  } catch (e) {
    console.error("À décider : décision en erreur", e);
    return { ok: false, error: e instanceof Error && e.message ? e.message : "Décision impossible." };
  }
}
