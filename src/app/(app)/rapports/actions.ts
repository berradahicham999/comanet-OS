"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { generateReport, setReportStatus, type ReportType } from "@/lib/ai/reports";

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

export async function validateReportAction(formData: FormData) {
  await requirePermission("rapports", "validate");
  const id = str(formData, "id");
  if (id) await setReportStatus(id, "VALIDATED");
  revalidatePath("/rapports"); revalidatePath(`/rapports/${id}`);
}

export async function archiveReportAction(formData: FormData) {
  await requirePermission("rapports", "edit");
  const id = str(formData, "id");
  if (id) await setReportStatus(id, "ARCHIVED");
  revalidatePath("/rapports"); revalidatePath(`/rapports/${id}`);
}
