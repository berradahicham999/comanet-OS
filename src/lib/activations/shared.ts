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

/* ------------------------------------------------------------------ */
/* Mesure du retour (ROI)                                              */
/* ------------------------------------------------------------------ */

export type WindowSales = { days: number; qty: number; amount: number };

export type SalesComparison = {
  /** CA HT par jour sur chaque fenêtre ; null quand la fenêtre est vide (0 jour). */
  beforePerDay: number | null; duringPerDay: number | null; afterPerDay: number | null;
  /** Incrément de CA = (rythme pendant+après − rythme avant) × jours pendant+après. Jamais estimé sans fenêtre « avant ». */
  increment: number | null;
  /** Variation du rythme de vente (%) après vs avant. */
  upliftPct: number | null;
  /** La fenêtre « après » est-elle entièrement écoulée ? Sinon « pas encore comparable ». */
  comparable: boolean;
  /** Jours restants avant que la comparaison soit complète. */
  daysUntilComparable: number;
};

/**
 * Comparaison avant / pendant / après — LA définition. Raisonne en CA par jour pour que des
 * fenêtres de longueurs différentes restent comparables. Une fenêtre « après » non écoulée
 * rend le résultat « pas encore comparable » plutôt qu'un écart trompeur.
 */
export function compareSales(before: WindowSales, during: WindowSales, after: WindowSales, afterEndIso: string, todayIso: string): SalesComparison {
  const rate = (w: WindowSales) => (w.days > 0 ? w.amount / w.days : null);
  const beforePerDay = rate(before), duringPerDay = rate(during), afterPerDay = rate(after);
  const comparable = afterEndIso <= todayIso;
  // Aucune vente sur les trois fenêtres : rien à comparer (périmètre sans ventes importées), jamais « 0 % ».
  const noData = before.amount === 0 && during.amount === 0 && after.amount === 0;
  const daysUntilComparable = comparable ? 0 : Math.max(0, Math.round((new Date(afterEndIso + "T12:00:00Z").getTime() - new Date(todayIso + "T12:00:00Z").getTime()) / 86_400_000));
  const postDays = during.days + after.days;
  const postRate = postDays > 0 ? (during.amount + after.amount) / postDays : null;
  const increment = comparable && !noData && beforePerDay !== null && postRate !== null ? (postRate - beforePerDay) * postDays : null;
  const upliftPct = comparable && !noData && beforePerDay !== null && beforePerDay > 0 && afterPerDay !== null ? ((afterPerDay - beforePerDay) / beforePerDay) * 100 : null;
  return { beforePerDay, duringPerDay, afterPerDay, increment, upliftPct, comparable, daysUntilComparable };
}

export type Verdict = "REFAIRE" | "AJUSTER" | "ARRETER" | "PAS_ENCORE";
export const VERDICT_LABELS: Record<Verdict, string> = { REFAIRE: "Refaire", AJUSTER: "Ajuster", ARRETER: "Arrêter", PAS_ENCORE: "Pas encore mesurable" };
export const VERDICT_TONES: Record<Verdict, string> = { REFAIRE: "green", AJUSTER: "orange", ARRETER: "red", PAS_ENCORE: "gray" };

export type VerdictInput = {
  fullCost: number; comparison: SalesComparison | null; attributedRevenue: number | null;
  hasResults: boolean; hasSalesScope: boolean;
  unit: { contact: number | null; sample: number | null; pharmacy: number | null };
};
export type VerdictResult = {
  verdict: Verdict; roi: number | null;
  /** Ce qui est mesuré (Donnée), ce qu'on en lit (Analyse), ce qu'on suppose (Hypothèse), quoi faire (Recommandation). */
  data: string[]; analysis: string[]; hypotheses: string[]; recommendation: string;
};

const mad = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} MAD`;

/**
 * Verdict d'une activation — LA définition. Le ROI est un incrément de CA sell-in HT observé
 * après l'activation rapporté au coût complet : une CORRÉLATION, jamais une causalité, et le texte
 * le dit. Seuils dans `settings.activations` (`roiRepeatMin`, `roiRepeatMinUpliftPct`).
 */
export function roiVerdict(i: VerdictInput, s: Pick<ActivationSettings, "roiRepeatMin" | "roiRepeatMinUpliftPct">): VerdictResult {
  const data: string[] = [], analysis: string[] = [], hypotheses: string[] = [];
  data.push(i.fullCost > 0 ? `Coût complet : ${mad(i.fullCost)} (dépensé + matériel valorisé).` : "Coût complet : aucune dépense ni matériel saisi.");
  if (i.attributedRevenue != null) data.push(`CA réellement mesuré : ${mad(i.attributedRevenue)} (commandes sur place, code promo).`);
  if (i.unit.contact != null) data.push(`Coût par contact : ${mad(i.unit.contact)}.`);
  if (i.unit.sample != null) data.push(`Coût par échantillon : ${mad(i.unit.sample)}.`);
  if (i.unit.pharmacy != null) data.push(`Coût par pharmacie touchée : ${mad(i.unit.pharmacy)}.`);
  const c = i.comparison;
  if (!i.hasSalesScope) hypotheses.push("Aucun point de vente ni ville rattaché : l'impact ventes ne peut pas être observé. Rattachez les pharmacies concernées.");
  if (c && !c.comparable) data.push(`Fenêtre « après » incomplète : comparable dans ${c.daysUntilComparable} jour${c.daysUntilComparable > 1 ? "s" : ""}.`);
  if (c && c.comparable && c.beforePerDay !== null) {
    data.push(`Sell-in HT par jour : ${mad(c.beforePerDay)} avant, ${c.duringPerDay != null ? mad(c.duringPerDay) : "—"} pendant, ${c.afterPerDay != null ? mad(c.afterPerDay) : "—"} après.`);
    if (c.increment != null) data.push(`Écart observé : ${c.increment >= 0 ? "+" : "−"}${mad(Math.abs(c.increment))} sur la période pendant + après.`);
  }
  if (!i.hasResults) hypotheses.push("Résultats non saisis (contacts, échantillons, pharmacies) : les coûts unitaires restent inconnus.");

  const roi = c?.comparable && c.increment != null && i.fullCost > 0 ? c.increment / i.fullCost : null;
  let verdict: Verdict;
  if (!c || !c.comparable || c.increment === null || i.fullCost <= 0) {
    verdict = "PAS_ENCORE";
    analysis.push(i.fullCost <= 0 ? "Sans coût, aucun retour ne peut être calculé." : c && c.comparable ? "Aucune vente Sage sur les points de vente et produits rattachés, avant comme après : rien à comparer. Vérifiez le rattachement ou l'import des ventes." : "La comparaison avant / après n'est pas encore complète.");
  } else {
    hypotheses.push("L'écart avant / après est une corrélation observée : d'autres facteurs (saison, promotion, visite du délégué) peuvent l'expliquer.");
    if (roi !== null && roi >= s.roiRepeatMin && (c.upliftPct ?? 0) >= s.roiRepeatMinUpliftPct) {
      verdict = "REFAIRE";
      analysis.push(`Le rythme de vente a progressé de ${Math.round(c.upliftPct ?? 0)} % et l'écart couvre ${roi.toFixed(1)} fois le coût complet.`);
    } else if (roi !== null && roi > 0) {
      verdict = "AJUSTER";
      analysis.push(`Le rythme de vente a bougé de ${Math.round(c.upliftPct ?? 0)} % : l'écart (${roi.toFixed(2)} fois le coût) ne couvre pas le seuil « refaire » (${s.roiRepeatMin} fois, +${s.roiRepeatMinUpliftPct} %).`);
    } else {
      verdict = "ARRETER";
      analysis.push("Aucune progression du rythme de vente après l'activation par rapport à la fenêtre avant.");
    }
  }
  const recommendation = verdict === "REFAIRE" ? "Reconduire ce format : même type, même cible, budget équivalent. Planifier la prochaine occurrence et réserver le matériel."
    : verdict === "AJUSTER" ? "Reconduire en réduisant le coût (matériel, lieu) ou en resserrant la cible sur les pharmacies qui ont progressé ; comparer au prochain passage."
    : verdict === "ARRETER" ? "Ne pas reconduire sous cette forme. Réaffecter le budget à un type d'activation qui a mieux performé pour cette marque (voir le comparatif)."
    : c && !c.comparable ? `Attendre la fin de la fenêtre « après » (${c.daysUntilComparable} j) puis revenir sur cette fiche.` : "Compléter la fiche : dépenses, résultats, points de vente concernés.";
  return { verdict, roi, data, analysis, hypotheses, recommendation };
}
