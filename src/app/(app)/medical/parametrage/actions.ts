"use server";

import { revalidatePath } from "next/cache";
import { requireAccess, canDo } from "@/lib/access";
import { getSettings, saveSettings, type ComanetSettings, type MedicalFieldSettings } from "@/lib/settings";
import { audit, changedFields } from "@/lib/audit";

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

/** Seuils du chrono, du contrôle GPS et des analyses d'ordonnances (bornés, jamais négatifs). Tracé dans l'audit. */
export async function updateMedicalFieldSettings(formData: FormData) {
  const user = await requireAccess("medical");
  if (!(await canDo("medical", "validate"))) return;
  const cur = await getSettings();
  const c = cur.medicalField;
  type NumKey = Exclude<keyof MedicalFieldSettings, "workDays" | "tourWeights">;
  const pos = (k: NumKey, min = 0, max = Number.POSITIVE_INFINITY) => Math.min(max, Math.max(min, num(formData, k, c[k])));
  const int = (k: NumKey, min = 1, max = Number.POSITIVE_INFINITY) => Math.round(pos(k, min, max));
  const next: MedicalFieldSettings = {
    radiusM: int("radiusM", 10, 5000),
    maxAccuracyM: int("maxAccuracyM", 5, 5000),
    maxStartStopM: int("maxStartStopM", 10, 50000),
    minDurationMin: int("minDurationMin", 0, 600),
    maxDurationMin: int("maxDurationMin", 1, 1440),
    lateSyncHours: pos("lateSyncHours", 0.25, 72),
    clockSkewMin: int("clockSkewMin", 1, 1440),
    maxSpeedKmh: int("maxSpeedKmh", 5, 1000),
    autoCloseHours: pos("autoCloseHours", 0.5, 24),
    gpsTimeoutS: int("gpsTimeoutS", 5, 120),
    matchAutoScore: pos("matchAutoScore", 0.5, 1),
    matchSuggestScore: pos("matchSuggestScore", 0.3, 1),
    potentialMonths: int("potentialMonths", 1, 60),
    potentialTopAPct: int("potentialTopAPct", 1, 100),
    potentialTopBPct: int("potentialTopBPct", 1, 100),
    potentialMinPrescriptions: int("potentialMinPrescriptions", 1, 1000),
    trendMonths: int("trendMonths", 1, 12),
    trendPct: int("trendPct", 1, 500),
    recoMinPeers: int("recoMinPeers", 1, 1000),
    recoMinSupport: int("recoMinSupport", 1, 1000),
    recoTopN: int("recoTopN", 1, 10),
    impactWindowDays: int("impactWindowDays", 7, 365),
    tourWeights: {
      A: Math.max(0, num(formData, "tourWeightA", c.tourWeights.A)),
      B: Math.max(0, num(formData, "tourWeightB", c.tourWeights.B)),
      C: Math.max(0, num(formData, "tourWeightC", c.tourWeights.C)),
      none: Math.max(0, num(formData, "tourWeightNone", c.tourWeights.none)),
    },
    tourSize: int("tourSize", 5, 300),
    workDays: [...new Set(String(formData.get("workDays") ?? c.workDays.join(",")).split(/[^0-9]+/).map(Number).filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b),
  };
  if (next.potentialTopBPct < next.potentialTopAPct) next.potentialTopBPct = next.potentialTopAPct;
  if (next.matchSuggestScore > next.matchAutoScore) next.matchSuggestScore = next.matchAutoScore;
  const diff = changedFields(c as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
  await saveSettings({ ...cur, medicalField: next });
  if (diff) await audit({ actor: { id: user.id, name: user.name }, action: "SETTINGS", module: "medical", entity: "settings", label: "Réglages médicaux : chrono, GPS, ordonnances", before: diff.before, after: diff.after });
  revalidatePath("/medical", "layout");
}
