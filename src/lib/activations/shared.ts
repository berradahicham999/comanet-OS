/**
 * Activations — logique pure (sans base, sans serveur), partagée entre serveur, composants
 * client et tests.
 *
 * Types, statuts, transitions, postes budgétaires sont des données (tables de référence) :
 * ce module ne connaît AUCUN nom de statut. Il raisonne sur les drapeaux portés par les lignes
 * (`isValidated`, `isDone`, `awaitingValidation`…) et sur les réglages (`settings.activations`).
 *
 * Les transitions réutilisent la définition unique du planning éditorial
 * (`checkTransition`, `nextTransitions` de `src/lib/content/shared.ts`).
 */
import type { ActivationSettings } from "@/lib/settings";
import type { TransitionRef } from "@/lib/content/shared";
import { shiftIso } from "@/lib/content/shared";
export { checkTransition, nextTransitions, toneClass, safeTone, refKey, shiftIso } from "@/lib/content/shared";
export type { TransitionRef } from "@/lib/content/shared";

export type ActivationStatusRef = {
  key: string; label: string; tone: string; sort: number; active: boolean;
  awaitingValidation: boolean; isValidated: boolean; isRunning: boolean; isDone: boolean; isMeasured: boolean; isArchived: boolean; isCancelled: boolean;
};
export type ActivationTypeRef = {
  key: string; label: string; icon: string | null; sort: number; active: boolean;
  defaultModule: string; defaultBudgetCategory: string; defaultChecklist: string[];
};
export type SimpleRef = { key: string; label: string; sort: number; active: boolean };
export type CostItemRef = SimpleRef & { budgetCategory: string };
export type InventoryCategoryRef = SimpleRef & { budgetCategory: string };

export type ActivationRefs = {
  types: ActivationTypeRef[];
  statuses: ActivationStatusRef[];
  transitions: TransitionRef[];
  objectives: SimpleRef[];
  targets: SimpleRef[];
  costItems: CostItemRef[];
  inventoryCategories: InventoryCategoryRef[];
};

/** Statut « ouvert » : ni archivé ni annulé. */
export function isOpen(st: ActivationStatusRef | undefined): boolean {
  return !!st && !st.isArchived && !st.isCancelled;
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/** Durée en jours, bornes incluses (une activation d'un jour = 1). */
export function durationDays(start: string, end: string | null | undefined): number {
  if (!end || end < start) return 1;
  const a = new Date(start + "T12:00:00Z").getTime();
  const b = new Date(end + "T12:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Fenêtres de comparaison des ventes : avant / pendant / après, en ISO (fin exclusive). */
export function measurementWindows(start: string, end: string | null | undefined, s: Pick<ActivationSettings, "windowBeforeDays" | "windowAfterDays">) {
  const realEnd = end && end >= start ? end : start;
  return {
    before: { start: shiftIso(start, -s.windowBeforeDays), end: start },
    during: { start, end: shiftIso(realEnd, 1) },
    after: { start: shiftIso(realEnd, 1), end: shiftIso(realEnd, 1 + s.windowAfterDays) },
  };
}

/* ------------------------------------------------------------------ */
/* Budget                                                              */
/* ------------------------------------------------------------------ */

export type BudgetLineLike = { planned: number | string; committed: number | string; spent: number | string };
export type MaterialLike = { quantity: number; unitCost: number | string };

const num = (v: number | string | null | undefined) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };

export type BudgetTotals = {
  planned: number; committed: number; spent: number;
  /** Matériel consommé, valorisé au coût unitaire au moment de la sortie. */
  materials: number;
  /** Coût complet = dépensé + matériel. */
  fullCost: number;
  /** Reste = prévu − max(engagé, dépensé) − matériel. Négatif en cas de dépassement. */
  remaining: number;
  /** Engagé (ou dépensé si supérieur) au-delà du prévu, en %. 0 si dans le budget. */
  overrunPct: number;
};

/**
 * Totaux budgétaires d'une activation — LA définition.
 * L'engagé d'une ligne est le plus grand de « engagé » (devis) et « dépensé » (facture) : une
 * facture supérieure au devis engage davantage. Sur une activation VALIDÉE, une ligne sans devis
 * ni facture est engagée pour son prévu : c'est le sens de la validation (décision d'Hicham).
 */
export function budgetTotals(lines: BudgetLineLike[], materials: MaterialLike[] = [], opts: { validated?: boolean } = {}): BudgetTotals {
  const engagedOf = (l: BudgetLineLike) => {
    const e = Math.max(num(l.committed), num(l.spent));
    return e > 0 ? e : opts.validated ? num(l.planned) : 0;
  };
  const planned = lines.reduce((a, l) => a + num(l.planned), 0);
  const committed = lines.reduce((a, l) => a + engagedOf(l), 0);
  const spent = lines.reduce((a, l) => a + num(l.spent), 0);
  const mat = materials.reduce((a, m) => a + m.quantity * num(m.unitCost), 0);
  const engaged = committed + mat;
  return {
    planned, committed, spent, materials: mat,
    fullCost: spent + mat,
    remaining: planned - engaged,
    overrunPct: planned > 0 && engaged > planned ? ((engaged - planned) / planned) * 100 : 0,
  };
}

export type ExpenseRow = {
  ref: string; brandId: string; category: string; label: string;
  amount: number; status: "PLANNED" | "COMMITTED" | "SPENT"; date: string; productId: string | null;
};

/**
 * Reflet d'une activation dans `marketing_expenses` : une ligne par poste, une par catégorie
 * de matériel. Tant que l'activation n'est pas validée (drapeau `isValidated`), rien n'est
 * reflété : une idée ou une proposition n'engage aucun budget dans le Command Center.
 * Validée, chaque poste est ENGAGÉ (devis s'il existe, sinon le prévu) puis DÉPENSÉ à la facture.
 * Une activation annulée retire tout : seule une facture déjà saisie (dépensé > 0) reste,
 * car l'argent est sorti.
 */
export function expenseRowsFor(input: {
  status: ActivationStatusRef | undefined;
  brandId: string | null;
  productId: string | null;
  date: string;
  lines: (BudgetLineLike & { id: string; costItemKey: string; label: string; brandId: string | null; date: string | null })[];
  costItems: CostItemRef[];
  materials: (MaterialLike & { categoryKey: string; brandId: string | null })[];
  inventoryCategories: InventoryCategoryRef[];
}): ExpenseRow[] {
  const st = input.status;
  if (!st) return [];
  const validated = st.isValidated && !st.isCancelled;
  const out: ExpenseRow[] = [];
  const catOf = (k: string) => input.costItems.find((c) => c.key === k)?.budgetCategory ?? "AUTRES";
  for (const l of input.lines) {
    const brandId = l.brandId ?? input.brandId;
    if (!brandId) continue;
    const spent = num(l.spent), committed = num(l.committed), planned = num(l.planned);
    if (!validated && spent <= 0) continue;
    const amount = spent > 0 ? Math.max(spent, committed) : committed > 0 ? committed : planned;
    if (amount <= 0) continue;
    out.push({
      ref: `LINE:${l.id}`, brandId, category: catOf(l.costItemKey), label: l.label,
      amount, status: spent > 0 ? "SPENT" : "COMMITTED", date: l.date ?? input.date, productId: input.productId,
    });
  }
  // Matériel sorti : coût réel, dépensé au moment de la sortie, quel que soit le statut.
  const byCat = new Map<string, { brandId: string; amount: number }>();
  for (const m of input.materials) {
    const brandId = m.brandId ?? input.brandId;
    if (!brandId) continue;
    const cat = input.inventoryCategories.find((c) => c.key === m.categoryKey)?.budgetCategory ?? "PLV";
    const key = `${cat}|${brandId}`;
    const e = byCat.get(key) ?? { brandId, amount: 0 };
    e.amount += m.quantity * num(m.unitCost);
    byCat.set(key, e);
  }
  for (const [key, e] of byCat) {
    if (e.amount <= 0) continue;
    const cat = key.split("|")[0];
    out.push({ ref: `MATERIAL:${cat}:${e.brandId}`, brandId: e.brandId, category: cat, label: "Matériel consommé (inventaire)", amount: e.amount, status: "SPENT", date: input.date, productId: input.productId });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Retards et alertes                                                  */
/* ------------------------------------------------------------------ */

export type LatenessKind = "STATUT" | "RESULTATS" | "CHECKLIST" | "BUDGET";
export type LatenessInput = {
  date: string; endDate: string | null; status: string;
  hasResults: boolean; checklistTotal: number; checklistDone: number;
  totals: Pick<BudgetTotals, "planned" | "overrunPct">;
};

/**
 * Retards d'une activation à une date donnée (ISO `YYYY-MM-DD`). Plusieurs peuvent coexister.
 *  - `STATUT` : date passée sans passage au statut suivant (début passé et pas « en cours » ou
 *    plus ; fin passée et pas « terminée » ou plus).
 *  - `RESULTATS` : terminée depuis plus de `resultsDelayDays` jours sans résultats saisis.
 *  - `CHECKLIST` : début dans moins de `checklistAlertDays` jours (ou passé) avec des étapes non cochées.
 *  - `BUDGET` : engagé supérieur au prévu au-delà de `overrunAlertPct`.
 */
export function activationLateness(a: LatenessInput, statuses: ActivationStatusRef[], s: Pick<ActivationSettings, "resultsDelayDays" | "checklistAlertDays" | "overrunAlertPct">, todayIso: string): LatenessKind[] {
  const st = statuses.find((x) => x.key === a.status);
  if (!st || st.isArchived || st.isCancelled) return [];
  const out: LatenessKind[] = [];
  const end = a.endDate && a.endDate >= a.date ? a.endDate : a.date;
  const started = st.isRunning || st.isDone;
  if (st.isValidated && !started && a.date < todayIso) out.push("STATUT");
  else if (st.isValidated && st.isRunning && !st.isDone && end < todayIso) out.push("STATUT");
  if (st.isDone && !st.isMeasured && !a.hasResults && shiftIso(end, s.resultsDelayDays) < todayIso) out.push("RESULTATS");
  if (st.isValidated && !started && a.checklistTotal > a.checklistDone && shiftIso(a.date, -s.checklistAlertDays) <= todayIso) out.push("CHECKLIST");
  if (st.isValidated && a.totals.planned > 0 && a.totals.overrunPct > s.overrunAlertPct) out.push("BUDGET");
  return out;
}

export const LATENESS_LABELS: Record<LatenessKind, string> = {
  STATUT: "Statut non mis à jour", RESULTATS: "Résultats à saisir", CHECKLIST: "Checklist incomplète", BUDGET: "Budget dépassé",
};

/* ------------------------------------------------------------------ */
/* Modèles                                                             */
/* ------------------------------------------------------------------ */

export type TemplateDefaults = {
  objectiveKey?: string; targetKey?: string; description?: string; prepOffsetDays?: number; durationDays?: number;
  budgetLines?: { costItemKey: string; label?: string; planned?: number }[];
  checklist?: string[];
};

/**
 * Valeurs de création à partir d'un modèle et d'un type (anti-régression : ce que la personne
 * a déjà saisi n'est jamais écrasé). La checklist du modèle prime sur celle du type.
 */
export function applyActivationTemplate(current: { objectiveKey?: string | null; targetKey?: string | null; description?: string | null; date: string; endDate?: string | null; prepDate?: string | null }, tpl: TemplateDefaults | null, type: ActivationTypeRef | null) {
  const d = tpl ?? {};
  const endDate = current.endDate ?? (d.durationDays && d.durationDays > 1 ? shiftIso(current.date, d.durationDays - 1) : null);
  const prepDate = current.prepDate ?? (d.prepOffsetDays ? shiftIso(current.date, -d.prepOffsetDays) : null);
  return {
    objectiveKey: current.objectiveKey || d.objectiveKey || null,
    targetKey: current.targetKey || d.targetKey || null,
    description: (current.description ?? "").trim() || d.description || null,
    endDate, prepDate,
    budgetLines: (d.budgetLines ?? []).map((l, i) => ({ costItemKey: l.costItemKey, label: l.label ?? l.costItemKey, planned: Number(l.planned ?? 0), sort: i })),
    checklist: (d.checklist?.length ? d.checklist : type?.defaultChecklist ?? []).map((label, i) => ({ label, sort: i })),
  };
}

/* ------------------------------------------------------------------ */
/* Coûts unitaires                                                     */
/* ------------------------------------------------------------------ */

/** Coût par unité de résultat ; `null` quand le résultat n'est pas saisi (jamais estimé). */
export function unitCost(fullCost: number, count: number | null | undefined): number | null {
  return count && count > 0 ? fullCost / count : null;
}

/* ------------------------------------------------------------------ */
/* Inventaire                                                          */
/* ------------------------------------------------------------------ */

export type InventoryStatus = "RUPTURE" | "BAS" | "DORMANT" | "OK";
export const INVENTORY_STATUS_LABELS: Record<InventoryStatus, string> = { RUPTURE: "Rupture", BAS: "Stock bas", DORMANT: "Dormant", OK: "OK" };
export const INVENTORY_STATUS_TONES: Record<InventoryStatus, string> = { RUPTURE: "red", BAS: "orange", DORMANT: "yellow", OK: "green" };

/**
 * Statut d'un article — LA définition, partagée par l'inventaire, la fiche et l'Action Center.
 *  - `RUPTURE` : stock nul ;
 *  - `BAS` : stock inférieur ou égal au seuil d'alerte (quand il existe) ;
 *  - `DORMANT` : du stock, mais aucune sortie depuis `dormantDays` jours (ou jamais) ;
 *  - `OK` sinon. Sans seuil et sans sortie, un article récent n'est pas dormant : on attend `dormantDays`.
 */
export function inventoryStatus(item: { stock: number; alertThreshold: number | null; lastOutAt: string | null; createdAt: string | null }, todayIso: string, dormantDays: number): InventoryStatus {
  if (item.stock <= 0) return "RUPTURE";
  if (item.alertThreshold != null && item.stock <= item.alertThreshold) return "BAS";
  const ref = item.lastOutAt ?? item.createdAt;
  if (!ref || shiftIso(ref.slice(0, 10), dormantDays) < todayIso) return "DORMANT";
  return "OK";
}
