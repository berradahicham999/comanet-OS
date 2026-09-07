"use server";

import { revalidatePath } from "next/cache";
import { requireAccess, canDo } from "@/lib/access";
import { getSettings, saveSettings, type ComanetSettings } from "@/lib/settings";

const num = (fd: FormData, k: string, fallback: number) => {
  const n = Number(String(fd.get(k) ?? "").replace(",", "."));
  return Number.isFinite(n) && String(fd.get(k) ?? "") !== "" ? n : fallback;
};

export async function updateMedicalSettings(formData: FormData) {
  await requireAccess("medical");
  if (!(await canDo("medical", "validate"))) return;
  const cur = await getSettings();
  const next: ComanetSettings = {
    ...cur,
    medicalDefaultVisitFrequencyDays: Math.max(1, Math.round(num(formData, "medicalDefaultVisitFrequencyDays", cur.medicalDefaultVisitFrequencyDays))),
    medicalOverdueVisitDays: Math.max(1, Math.round(num(formData, "medicalOverdueVisitDays", cur.medicalOverdueVisitDays))),
    medicalSamplesPerVisitDefault: Math.max(0, num(formData, "medicalSamplesPerVisitDefault", cur.medicalSamplesPerVisitDefault)),
  };
  await saveSettings(next);
  revalidatePath("/medical", "layout");
}
