"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/access";
import { dispatchEvent, processPending } from "@/lib/events/dispatch";

/**
 * Rattrapage manuel — même mécanique que le rejeu accroché au cron Meta (voir
 * `src/app/api/cron/meta/route.ts`), déclenchable depuis l'écran sans attendre le passage
 * suivant. Aucun nouveau planificateur.
 */
export async function replayOne(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await dispatchEvent(id);
  revalidatePath("/parametres/evenements");
}

export async function replayPending(formData: FormData) {
  await requireAdmin();
  const limit = Number(formData.get("limit") ?? 50) || 50;
  await processPending({ limit });
  revalidatePath("/parametres/evenements");
}
