"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { generateReport, moveReport, type ReportMove, type ReportType } from "@/lib/ai/reports";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function generateReportAction(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string }> {
  await requirePermission("rapports", "create");
  const type = str(formData, "type") as ReportType;
  if (type !== "WEEKLY" && type !== "MONTHLY_BRAND_REVIEW") return { error: "Type de rapport inconnu." };
  const [periodStart, periodEnd] = str(formData, "period").split("|");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd ?? "")) return { error: "Période invalide." };
  const r = await generateReport({ type, brandId: str(formData, "brandId") || null, periodStart, periodEnd });
  if (!r.ok) return { error: r.error };
  revalidatePath("/rapports");
  redirect(`/rapports/${r.id}`);
}

/**
 * Valider, archiver, annuler la validation ou désarchiver. Les droits sont vérifiés par `moveReport()` (administrateur
 * compris, comme l'écran) : l'ancienne garde `requirePermission()` ignorait l'administrateur et faisait planter la page.
 */
export async function moveReportAction(_prev: { error?: string; ok?: boolean } | null, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const id = str(formData, "id");
  const move = str(formData, "move") as ReportMove;
  if (!id || !["VALIDATE", "ARCHIVE", "REOPEN"].includes(move)) return { error: "Action inconnue." };
  const r = await moveReport(id, move);
  revalidatePath("/rapports"); revalidatePath(`/rapports/${id}`); revalidatePath("/"); revalidatePath("/a-decider");
  return r.ok ? { ok: true } : { error: r.error ?? "Rapport non modifié." };
}
