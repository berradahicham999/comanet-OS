"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activationTypes, activationStatuses, activationStatusTransitions, activationObjectives, activationTargets, activationCostItems,
  inventoryCategories, activationTemplates, type ActivationTemplateDefaults,
} from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { refKey } from "@/lib/activations/shared";
import { getSettings, saveSettings } from "@/lib/settings";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
const int = (fd: FormData, k: string, d = 0) => { const n = Number(str(fd, k)); return Number.isFinite(n) ? Math.round(n) : d; };
const num = (fd: FormData, k: string, d: number) => { const v = str(fd, k); const n = Number((v ?? "").replace(",", ".")); return v !== null && Number.isFinite(n) ? n : d; };
const PAGE = "/parametres/activations";
function done() { revalidatePath(PAGE); revalidatePath("/marketing/activations"); revalidatePath("/marketing/materiel"); }
function keyOf(fd: FormData) { const k = str(fd, "key"); const label = str(fd, "label"); return k ?? (label ? refKey(label) : null); }
const lines = (v: string | null) => (v ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

const BUDGET_CATEGORIES = ["META", "TIKTOK", "GOOGLE", "DIGITAL", "INFLUENCE", "UGC", "CREATION", "SHOOTING", "EVENEMENT", "SPONSORING", "TRADE", "PLV", "ANIMATION", "GOODIES", "ECHANTILLONS", "PRESCRIPTEURS", "CONGRES", "AGENCE", "AUTRES"] as const;
type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];
const budgetCat = (v: string | null, d: BudgetCategory): BudgetCategory => (BUDGET_CATEGORIES.includes(v as BudgetCategory) ? (v as BudgetCategory) : d);

export async function saveType(fd: FormData) {
  await requireAdmin();
  const key = keyOf(fd); const label = str(fd, "label"); if (!key || !label) return;
  const values = {
    label, icon: str(fd, "icon"), sort: int(fd, "sort"), active: fd.get("active") !== null,
    defaultModule: str(fd, "defaultModule") === "clients" ? "clients" : "marketing",
    defaultBudgetCategory: budgetCat(str(fd, "defaultBudgetCategory"), "AUTRES"),
    defaultChecklist: lines(str(fd, "defaultChecklist")),
  };
  await db.insert(activationTypes).values({ key, ...values }).onConflictDoUpdate({ target: activationTypes.key, set: values });
  done();
}

export async function saveStatus(fd: FormData) {
  await requireAdmin();
  const key = keyOf(fd); const label = str(fd, "label"); if (!key || !label) return;
  const flag = (k: string) => fd.get(k) !== null;
  const values = {
    label, tone: str(fd, "tone") ?? "gray", sort: int(fd, "sort"), active: flag("active"),
    awaitingValidation: flag("awaitingValidation"), isValidated: flag("isValidated"), isRunning: flag("isRunning"), isDone: flag("isDone"),
    isMeasured: flag("isMeasured"), isArchived: flag("isArchived"), isCancelled: flag("isCancelled"),
  };
  await db.insert(activationStatuses).values({ key, ...values }).onConflictDoUpdate({ target: activationStatuses.key, set: values });
  done();
}

export async function saveTransition(fd: FormData) {
  await requireAdmin();
  const fromKey = str(fd, "fromKey"); const toKey = str(fd, "toKey"); if (!fromKey || !toKey || fromKey === toKey) return;
  const values = { requiresValidator: fd.get("requiresValidator") !== null, requiresComment: fd.get("requiresComment") !== null, label: str(fd, "label") };
  await db.insert(activationStatusTransitions).values({ fromKey, toKey, ...values }).onConflictDoUpdate({ target: [activationStatusTransitions.fromKey, activationStatusTransitions.toKey], set: values });
  done();
}

export async function deleteTransition(fd: FormData) {
  await requireAdmin();
  const fromKey = str(fd, "fromKey"); const toKey = str(fd, "toKey"); if (!fromKey || !toKey) return;
  await db.delete(activationStatusTransitions).where(and(eq(activationStatusTransitions.fromKey, fromKey), eq(activationStatusTransitions.toKey, toKey)));
  done();
}

export async function saveSimple(fd: FormData) {
  await requireAdmin();
  const kind = str(fd, "kind"); const key = keyOf(fd); const label = str(fd, "label"); if (!kind || !key || !label) return;
  const base = { label, sort: int(fd, "sort"), active: fd.get("active") !== null };
  if (kind === "objective") await db.insert(activationObjectives).values({ key, ...base }).onConflictDoUpdate({ target: activationObjectives.key, set: base });
  else if (kind === "target") await db.insert(activationTargets).values({ key, ...base }).onConflictDoUpdate({ target: activationTargets.key, set: base });
  else if (kind === "cost") { const v = { ...base, budgetCategory: budgetCat(str(fd, "budgetCategory"), "AUTRES") }; await db.insert(activationCostItems).values({ key, ...v }).onConflictDoUpdate({ target: activationCostItems.key, set: v }); }
  else if (kind === "inventory") { const v = { ...base, budgetCategory: budgetCat(str(fd, "budgetCategory"), "PLV") }; await db.insert(inventoryCategories).values({ key, ...v }).onConflictDoUpdate({ target: inventoryCategories.key, set: v }); }
  done();
}

/** Supprimer, ou désactiver si la clé est encore référencée (clé étrangère). */
export async function deleteRef(fd: FormData) {
  await requireAdmin();
  const kind = str(fd, "kind"); const key = str(fd, "key"); if (!kind || !key) return;
  const tables = { type: activationTypes, status: activationStatuses, objective: activationObjectives, target: activationTargets, cost: activationCostItems, inventory: inventoryCategories } as const;
  const t = tables[kind as keyof typeof tables]; if (!t) return;
  try { await db.delete(t).where(eq(t.key, key)); }
  catch { await db.update(t).set({ active: false }).where(eq(t.key, key)); }
  done();
}

export async function saveTemplate(fd: FormData) {
  await requireAdmin();
  const id = str(fd, "id"); const name = str(fd, "name"); if (!name) return;
  const budgetLines = lines(str(fd, "budgetLines")).map((l) => {
    // « LIEU | Salle | 15000 » ou « LIEU 15000 »
    const parts = l.split("|").map((x) => x.trim());
    if (parts.length >= 2) return { costItemKey: refKey(parts[0]), label: parts[1] || undefined, planned: Number((parts[2] ?? "0").replace(/\s/g, "").replace(",", ".")) || 0 };
    const m = l.match(/^(\S+)\s+([\d\s.,]+)$/);
    return m ? { costItemKey: refKey(m[1]), planned: Number(m[2].replace(/\s/g, "").replace(",", ".")) || 0 } : { costItemKey: refKey(l), planned: 0 };
  });
  const defaults: ActivationTemplateDefaults = {
    objectiveKey: str(fd, "objectiveKey") ?? undefined, targetKey: str(fd, "targetKey") ?? undefined, description: str(fd, "description") ?? undefined,
    prepOffsetDays: int(fd, "prepOffsetDays", 0) || undefined, durationDays: int(fd, "durationDays", 1) || undefined,
    budgetLines, checklist: lines(str(fd, "checklist")),
  };
  const brandId = str(fd, "brandId"); const typeKey = str(fd, "typeKey");
  const values = { name, typeKey: typeKey || null, brandId: brandId && /^[0-9a-f-]{36}$/i.test(brandId) ? brandId : null, defaults, active: fd.get("active") !== null };
  if (id && /^[0-9a-f-]{36}$/i.test(id)) await db.update(activationTemplates).set(values).where(eq(activationTemplates.id, id));
  else await db.insert(activationTemplates).values(values);
  done();
}

export async function deleteTemplate(fd: FormData) {
  await requireAdmin();
  const id = str(fd, "id"); if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
  await db.delete(activationTemplates).where(eq(activationTemplates.id, id));
  done();
}

/** Fenêtres de mesure et délais : `settings.activations`, fusion profonde (rien d'autre n'est touché). */
export async function saveActivationSettings(fd: FormData) {
  await requireAdmin();
  const cur = await getSettings();
  const a = cur.activations;
  await saveSettings({ ...cur, activations: {
    windowBeforeDays: Math.max(1, int(fd, "windowBeforeDays", a.windowBeforeDays)), windowAfterDays: Math.max(1, int(fd, "windowAfterDays", a.windowAfterDays)),
    resultsDelayDays: Math.max(0, int(fd, "resultsDelayDays", a.resultsDelayDays)), checklistAlertDays: Math.max(0, int(fd, "checklistAlertDays", a.checklistAlertDays)),
    overrunAlertPct: Math.max(0, num(fd, "overrunAlertPct", a.overrunAlertPct)), roiRepeatMinUpliftPct: num(fd, "roiRepeatMinUpliftPct", a.roiRepeatMinUpliftPct),
    roiRepeatMin: num(fd, "roiRepeatMin", a.roiRepeatMin), inventoryDormantDays: Math.max(1, int(fd, "inventoryDormantDays", a.inventoryDormantDays)),
  } });
  revalidatePath("/", "layout");
}
