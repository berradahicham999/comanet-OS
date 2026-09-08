"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/access";
import { refreshMarketingFacts } from "@/lib/analytics-marketing/refresh";

/** Recalcule la couche de faits (toutes sources). Réservé aux comptes qui peuvent modifier le marketing. */
export async function recalculateAnalytics() {
  await requirePermission("marketing", "edit");
  await refreshMarketingFacts(undefined, "MANUAL");
  revalidatePath("/marketing/analytics");
  revalidatePath("/marketing/analytics/qualite");
}
