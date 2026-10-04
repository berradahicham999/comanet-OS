/**
 * Bibliothèque d'actions — logique PURE partagée (formulaire, import Excel, tests) : validation d'un modèle, syntaxe
 * texte des postes / étapes / contenus / KPI (une ligne par élément, champs séparés par « ; »), conversion depuis une
 * action réalisée ou une activation. Aucune base.
 */
import { z } from "zod";
import type { BudgetCategory } from "@/db/schema";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import { AXES, AXIS_KEYS, OBJECTIVE_KEYS, ROLE_LABELS, TARGET_KEYS } from "./catalog";
import { dayLabel } from "./engine";
import type { ActionProposal, ActionTemplate, AxisKey, ExtraKpi, ObjectiveKey, StepRole, TargetKey, TemplateContent, TemplateLine, TemplateStep } from "./types";

export const TEMPLATE_SOURCES = { SYSTEME: "Livré", EQUIPE: "Équipe", IMPORT: "Import Excel", ACTION: "Depuis une action", ACTIVATION: "Depuis une activation" } as const;
export type TemplateSource = keyof typeof TEMPLATE_SOURCES;

export const COST_ITEMS: Record<string, BudgetCategory> = { LIEU: "EVENEMENT", TRAITEUR: "EVENEMENT", MATERIEL: "EVENEMENT", IMPRESSION: "PLV", TRANSPORT: "AUTRES", CACHET: "PRESCRIPTEURS", ECHANTILLONS: "ECHANTILLONS", GOODIES: "GOODIES", HOTESSES: "ANIMATION", SPONSORING: "SPONSORING", COMMUNICATION: "DIGITAL", AGENCE: "AGENCE", AUTRE: "AUTRES" };
export const ACTIVATION_TYPE_KEYS = ["EVENEMENT", "SPONSORING", "SALON", "PLV", "SAMPLING", "GOODIES", "OPERATION_PHARMACIE", "RP", "COLLABORATION", "AUTRE"] as const;
export const CAMPAIGN_CHANNELS = ["META", "TIKTOK", "GOOGLE", "INFLUENCE", "TRADE", "EVENEMENT", "AUTRE"] as const;
export const FORMATS = ["POST", "REEL", "STORY", "CARROUSEL", "VIDEO", "UGC", "VISUEL_PHARMACIE", "LIVE", "NEWSLETTER"] as const;
const ROLE_KEYS = Object.keys(ROLE_LABELS) as StepRole[];

const lineSchema = z.object({ label: z.string().min(1), category: z.enum(BUDGET_CATEGORIES as [BudgetCategory, ...BudgetCategory[]]), costItem: z.string().optional(), share: z.number().positive().max(1) });

export const templateSchema = z.object({
  key: z.string().regex(/^[A-Z0-9_]{3,60}$/, "clé : majuscules, chiffres et _"),
  axis: z.enum(AXIS_KEYS as [AxisKey, ...AxisKey[]]),
  family: z.string().min(2).max(80),
  name: z.string().min(3).max(140),
  concept: z.string().min(30).max(2000),
  objectives: z.partialRecord(z.enum(OBJECTIVE_KEYS as [ObjectiveKey, ...ObjectiveKey[]]), z.number().min(0).max(1)).refine((o) => Object.values(o).some((v) => v > 0), "au moins un objectif"),
  targets: z.array(z.enum(TARGET_KEYS as [TargetKey, ...TargetKey[]])).min(1, "au moins une cible"),
  productKinds: z.union([z.literal("ANY"), z.array(z.enum(["DERMO", "COMPLEMENT", "SOLAIRE"])).min(1)]),
  channels: z.array(z.string().min(1)).min(1, "au moins un canal"),
  budget: z.object({ min: z.number().positive(), typical: z.number().positive(), max: z.number().positive() }).refine((b) => b.min <= b.typical && b.typical <= b.max, "budget : minimum ≤ idéal ≤ maximum"),
  lines: z.array(lineSchema).min(1, "au moins un poste").refine((l) => Math.abs(l.reduce((s, x) => s + x.share, 0) - 1) < 0.005, "les parts des postes doivent faire 100 %"),
  reach: z.object({ contactLabel: z.string().min(2), costPerContact: z.number().positive(), trialRate: z.number().min(0).max(1), conversionRate: z.number().min(0).max(1), unitsPerBuyer: z.number().positive(), usesAdsCost: z.boolean().optional() }),
  steps: z.array(z.object({ offset: z.number().int().min(-365).max(365), label: z.string().min(2), role: z.enum(ROLE_KEYS as [StepRole, ...StepRole[]]) })).min(1, "au moins une étape"),
  contents: z.array(z.object({ format: z.enum(FORMATS), count: z.number().int().positive(), title: z.string().min(1), offset: z.number().int() })),
  extraKpis: z.array(z.object({ label: z.string().min(1), value: z.union([z.string(), z.number()]).optional(), per: z.number().positive().optional(), factor: z.number().positive().optional() })),
  complexity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  prepDays: z.number().int().min(0).max(365),
  durationDays: z.number().int().min(1).max(365),
  cooldownDays: z.number().int().min(0).max(730),
  execution: z.union([z.object({ kind: z.literal("ACTIVATION"), activationType: z.enum(ACTIVATION_TYPE_KEYS) }), z.object({ kind: z.literal("CAMPAIGN"), campaignType: z.string().min(2), channel: z.enum(CAMPAIGN_CHANNELS) })]),
  seasons: z.record(z.string(), z.union([z.literal(1), z.literal(-1)])),
  cityBased: z.boolean(), posBased: z.boolean(), influencerBased: z.boolean(),
  compliance: z.string().max(600).optional(),
  onlyWhen: z.object({ seasons: z.array(z.string()).optional(), months: z.array(z.number().int().min(1).max(12)).optional(), label: z.string().min(2) }).optional(),
}).superRefine((t, ctx) => {
  if (t.execution.kind === "ACTIVATION") for (const l of t.lines) if (!l.costItem || !COST_ITEMS[l.costItem]) ctx.addIssue({ code: "custom", message: `poste « ${l.label} » : une exécution en activation exige un poste d'activation (${Object.keys(COST_ITEMS).join(", ")})` });
  if (Math.min(...t.steps.map((s) => s.offset)) < -t.prepDays) ctx.addIssue({ code: "custom", message: "une étape commence avant le délai de préparation" });
});

export type ValidTemplate = z.infer<typeof templateSchema>;

/** Valide un modèle ; renvoie la liste des erreurs en français. */
export function validateTemplate(raw: unknown): { ok: true; template: ActionTemplate } | { ok: false; errors: string[] } {
  const r = templateSchema.safeParse(raw);
  if (r.success) return { ok: true, template: r.data as unknown as ActionTemplate };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "modèle"} : ${i.message}`) };
}

/* ------------------------------ Syntaxe texte (formulaire et Excel) ------------------------------ */

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const num = (s: string) => Number(s.replace(/[\s  %]/g, "").replace(",", "."));
const splitLines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const fields = (line: string) => line.split(";").map((f) => f.trim());

function categoryOf(s: string): BudgetCategory | null {
  const k = s.toUpperCase().replace(/\s+/g, "_");
  if ((BUDGET_CATEGORIES as string[]).includes(k)) return k as BudgetCategory;
  const hit = (Object.entries(BUDGET_CATEGORY_LABELS) as [BudgetCategory, string][]).find(([, l]) => norm(l) === norm(s));
  return hit ? hit[0] : null;
}
function roleOf(s: string): StepRole | null {
  const k = s.toUpperCase();
  if ((ROLE_KEYS as string[]).includes(k)) return k as StepRole;
  const hit = (Object.entries(ROLE_LABELS) as [StepRole, string][]).find(([, l]) => norm(l).startsWith(norm(s)) || norm(s).startsWith(norm(l).split(" ")[0]));
  return hit ? hit[0] : null;
}
/** « J-30 », « J », « J+7 », « -30 », « 7 » → décalage en jours. */
export function parseOffset(s: string): number | null {
  const t = s.replace(/\s/g, "").toUpperCase();
  if (t === "J" || t === "0") return 0;
  const m = t.match(/^J?([+-]?\d+)$/);
  return m ? Number(m[1]) : null;
}

type Parsed<T> = { value: T; errors: string[] };

/** Postes : « Libellé ; catégorie ; part % ; poste d'activation (facultatif) ». Les parts sont ramenées à 100 % si la somme est proche. */
export function parseLines(text: string): Parsed<TemplateLine[]> {
  const errors: string[] = [], value: TemplateLine[] = [];
  splitLines(text).forEach((l, i) => {
    const [label, cat, share, item] = fields(l);
    const category = cat ? categoryOf(cat) : null;
    const pct = share ? num(share) : NaN;
    if (!label || !category || !(pct > 0)) { errors.push(`poste ligne ${i + 1} : « ${l} » (attendu : libellé ; catégorie ; part %)`); return; }
    const costItem = item ? item.toUpperCase() : undefined;
    if (costItem && !COST_ITEMS[costItem]) { errors.push(`poste ligne ${i + 1} : poste d'activation inconnu « ${item} »`); return; }
    value.push({ label, category, share: pct / 100, ...(costItem ? { costItem } : {}) });
  });
  const sum = value.reduce((s, l) => s + l.share, 0);
  if (value.length && Math.abs(sum - 1) > 0.005 && Math.abs(sum - 1) <= 0.03) for (const l of value) l.share = Math.round((l.share / sum) * 10000) / 10000;
  return { value, errors };
}
export function formatLines(lines: TemplateLine[]): string {
  return lines.map((l) => [l.label, l.category, `${Math.round(l.share * 1000) / 10}`, l.costItem ?? ""].join(" ; ").replace(/ ; $/, "")).join("\n");
}

/** Étapes : « J-30 ; libellé ; rôle ». */
export function parseSteps(text: string): Parsed<TemplateStep[]> {
  const errors: string[] = [], value: TemplateStep[] = [];
  splitLines(text).forEach((l, i) => {
    const [when, label, role] = fields(l);
    const offset = when ? parseOffset(when) : null;
    const r = role ? roleOf(role) : "MARKETING";
    if (offset === null || !label || !r) { errors.push(`étape ligne ${i + 1} : « ${l} » (attendu : J-30 ; libellé ; rôle)`); return; }
    value.push({ offset, label, role: r });
  });
  return { value: value.sort((a, b) => a.offset - b.offset), errors };
}
export function formatSteps(steps: TemplateStep[]): string {
  return steps.map((s) => `${dayLabel(s.offset)} ; ${s.label} ; ${ROLE_LABELS[s.role]}`).join("\n");
}

/** Contenus : « J-7 ; format ; nombre ; titre ». */
export function parseContents(text: string): Parsed<TemplateContent[]> {
  const errors: string[] = [], value: TemplateContent[] = [];
  splitLines(text).forEach((l, i) => {
    const [when, format, count, title] = fields(l);
    const offset = when ? parseOffset(when) : null;
    const f = (format ?? "").toUpperCase().replace(/\s+/g, "_").replace("RÉEL", "REEL");
    const n = count ? Math.round(num(count)) : NaN;
    if (offset === null || !(FORMATS as readonly string[]).includes(f) || !(n > 0) || !title) { errors.push(`contenu ligne ${i + 1} : « ${l} » (attendu : J-7 ; ${FORMATS.join("/")} ; nombre ; titre)`); return; }
    value.push({ offset, format: f as TemplateContent["format"], count: n, title });
  });
  return { value, errors };
}
export function formatContents(contents: TemplateContent[]): string {
  return contents.map((c) => `${dayLabel(c.offset)} ; ${c.format} ; ${c.count} ; ${c.title}`).join("\n");
}

/** KPI propres : « libellé ; valeur » ou « libellé ; /110 » (budget ÷ 110) ou « libellé ; /20 × 0,6 ». */
export function parseKpis(text: string): Parsed<ExtraKpi[]> {
  const errors: string[] = [], value: ExtraKpi[] = [];
  splitLines(text).forEach((l, i) => {
    const [label, v] = fields(l);
    if (!label || !v) { errors.push(`KPI ligne ${i + 1} : « ${l} » (attendu : libellé ; valeur)`); return; }
    const m = v.replace(/\s/g, "").match(/^\/([\d.,]+)(?:[x×*]([\d.,]+))?$/);
    if (m) value.push({ label, per: num(m[1]), ...(m[2] ? { factor: num(m[2]) } : {}) });
    else value.push({ label, value: /^[\d.,]+$/.test(v.replace(/\s/g, "")) ? num(v) : v });
  });
  return { value, errors };
}
export function formatKpis(k: ExtraKpi[]): string {
  return k.map((x) => `${x.label} ; ${x.value !== undefined ? x.value : `/${x.per}${x.factor ? ` × ${x.factor}` : ""}`}`).join("\n");
}

/** Objectifs : « SELL_OUT:90, NOTORIETE:60 » (affinité en %). */
export function parseObjectives(text: string): Parsed<Partial<Record<ObjectiveKey, number>>> {
  const errors: string[] = [], value: Partial<Record<ObjectiveKey, number>> = {};
  for (const part of text.split(/[,\n]/).map((p) => p.trim()).filter(Boolean)) {
    const [k, v] = part.split(":").map((x) => x.trim());
    const key = k.toUpperCase() as ObjectiveKey;
    if (!(OBJECTIVE_KEYS as string[]).includes(key)) { errors.push(`objectif inconnu « ${k} »`); continue; }
    const n = v ? num(v) : 80;
    value[key] = Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
  }
  return { value, errors };
}
export const formatObjectives = (o: Partial<Record<ObjectiveKey, number>>) => Object.entries(o).map(([k, v]) => `${k}:${Math.round((v ?? 0) * 100)}`).join(", ");

/** Saisons : « ramadan:+1, rentree:-1 ». */
export function parseSeasons(text: string): Record<string, 1 | -1> {
  const out: Record<string, 1 | -1> = {};
  for (const part of text.split(/[,\n]/).map((p) => p.trim()).filter(Boolean)) { const [k, v] = part.split(":").map((x) => x.trim()); if (k) out[k] = v && v.startsWith("-") ? -1 : 1; }
  return out;
}
export const formatSeasons = (s: Record<string, 1 | -1>) => Object.entries(s).map(([k, v]) => `${k}:${v > 0 ? "+1" : "-1"}`).join(", ");

export const listOf = (text: string) => text.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

/* ------------------------------ Conversion depuis le réel ------------------------------ */

export function slugKey(prefix: string, name: string, salt: string): string {
  const base = norm(name).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase().slice(0, 32) || "MODELE";
  return `${prefix}_${base}_${salt.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase()}`;
}

/** Remplace les valeurs propres à l'action (produit, mot-héros, marque, ville) par les variables du modèle. */
export function generalize(text: string, v: { product?: string | null; hero?: string | null; brand?: string | null; city?: string | null }): string {
  let out = text;
  if (v.product) out = out.split(v.product).join("{produit}");
  if (v.hero && v.hero.length >= 4) out = out.split(v.hero).join("{heros}");
  if (v.brand) out = out.split(v.brand).join("{marque}");
  if (v.city) out = out.split(v.city).join("{ville|la ville cible}");
  return out;
}

/** Modèle tiré d'une action générée réussie : on garde son modèle d'origine, remplacé par ce qui a été réellement fait. */
export function templateFromProposal(p: ActionProposal, source: ActionTemplate | null, o: { key: string; brand: string; hero: string | null; label?: string }): ActionTemplate {
  const base: ActionTemplate = source ?? fallbackTemplate(p.axis, p.family);
  const total = p.lines.reduce((s, l) => s + l.amount, 0) || 1;
  const lines = p.lines.map((l) => ({ label: l.label, category: l.category, share: Math.round((l.amount / total) * 10000) / 10000, ...(l.costItem ? { costItem: l.costItem } : {}) }));
  const fix = 1 - lines.reduce((s, l) => s + l.share, 0);
  if (lines.length) lines[0].share = Math.round((lines[0].share + fix) * 10000) / 10000;
  const j = p.eventDate;
  const off = (d: string) => Math.round((new Date(d + "T00:00:00Z").getTime() - new Date(j + "T00:00:00Z").getTime()) / 86_400_000);
  const g = (t: string) => generalize(t, { product: p.products[0] ?? null, hero: o.hero, brand: o.brand, city: p.suggestions.city });
  return {
    ...base, key: o.key, family: o.label ?? `${base.family} (réalisé)`, name: g(p.name), concept: g(p.concept),
    budget: { min: Math.round(p.budget * 0.6 / 100) * 100 || base.budget.min, typical: p.budget, max: Math.max(p.budget * 2, base.budget.max) },
    lines, steps: p.steps.map((s) => ({ offset: s.offset, label: s.label, role: s.role })),
    contents: p.contents.map((c) => ({ format: c.format as TemplateContent["format"], count: c.count, title: c.title, offset: off(c.date) })),
    execution: p.execution, compliance: p.compliance ?? base.compliance,
  };
}

/** Modèle tiré d'une activation réalisée (budget par poste, checklist datée). Le reste part d'un modèle générique du levier, à compléter. */
export function templateFromActivation(a: { name: string; type: string; description: string | null; date: string; endDate: string | null; city: string | null; brand: string | null; product: string | null }, budgetLines: { costItem: string; label: string; planned: number }[], checklist: { label: string; dueDate: string | null }[], key: string): ActionTemplate {
  const axis: AxisKey = a.type === "EVENEMENT" ? "EVENEMENTIEL" : a.type === "SPONSORING" ? "PARTENARIAT" : a.type === "COLLABORATION" || a.type === "SALON" ? "MEDICAL" : "TRADE";
  const base = fallbackTemplate(axis, a.type);
  const total = budgetLines.reduce((s, l) => s + l.planned, 0);
  const lines: TemplateLine[] = total > 0 ? budgetLines.filter((l) => l.planned > 0).map((l) => ({ label: l.label, category: COST_ITEMS[l.costItem] ?? "AUTRES", costItem: COST_ITEMS[l.costItem] ? l.costItem : "AUTRE", share: Math.round((l.planned / total) * 10000) / 10000 })) : base.lines;
  const fix = 1 - lines.reduce((s, l) => s + l.share, 0);
  if (lines.length && Math.abs(fix) > 0) lines[0].share = Math.round((lines[0].share + fix) * 10000) / 10000;
  const off = (d: string) => Math.round((new Date(d + "T00:00:00Z").getTime() - new Date(a.date + "T00:00:00Z").getTime()) / 86_400_000);
  const dated = checklist.filter((c) => c.dueDate).map((c) => ({ offset: off(c.dueDate!), label: c.label, role: "MARKETING" as StepRole }));
  const steps = dated.length ? dated : checklist.length ? checklist.map((c, i) => ({ offset: -14 + Math.round((14 * i) / Math.max(1, checklist.length - 1)), label: c.label, role: "MARKETING" as StepRole })) : base.steps;
  const g = (t: string) => generalize(t, { product: a.product, brand: a.brand, city: a.city });
  // La note ajoutée par le générateur à la description d'une activation n'est pas un concept.
  const description = (a.description ?? "").split(/\n\s*\n/).filter((para) => !/^Action générée par COMANET/i.test(para.trim())).join("\n\n").trim();
  const typeLabel = a.type.toLowerCase().replace(/_/g, " ");
  const typical = total > 0 ? Math.round(total / 100) * 100 : base.budget.typical;
  const prep = Math.max(base.prepDays, -Math.min(0, ...steps.map((s) => s.offset)));
  const duration = a.endDate ? Math.max(1, off(a.endDate) + 1) : 1;
  return {
    ...base, key, family: `${typeLabel.charAt(0).toUpperCase()}${typeLabel.slice(1)} (réalisé)`, name: g(a.name), concept: description.length >= 30 ? g(description) : `${g(a.name)} : action reprise d'une activation réalisée, concept à compléter dans la bibliothèque.`,
    budget: { min: Math.round(typical * 0.6 / 100) * 100 || 1000, typical, max: typical * 2 }, lines, steps: steps.sort((x, y) => x.offset - y.offset), prepDays: prep, durationDays: duration,
    execution: { kind: "ACTIVATION", activationType: (ACTIVATION_TYPE_KEYS as readonly string[]).includes(a.type) ? (a.type as (typeof ACTIVATION_TYPE_KEYS)[number]) : "AUTRE" },
    cityBased: !!a.city,
  };
}

/** Modèle générique d'un levier : base d'un modèle créé à la main ou repris du réel. */
export function fallbackTemplate(axis: AxisKey, family: string): ActionTemplate {
  const activation = axis === "EVENEMENTIEL" || axis === "TRADE" || axis === "MEDICAL" || axis === "PARTENARIAT";
  return {
    key: "NOUVEAU", axis, family, name: `{heros} — ${family}`, concept: "Décrire précisément ce qui est organisé, pour qui, où et comment l'offre renvoie vers les pharmacies partenaires.",
    objectives: { SELL_OUT: 0.8, NOTORIETE: 0.6 }, targets: ["FEMMES_25_45"], productKinds: "ANY", channels: [AXES[axis].label],
    budget: { min: 3000, typical: 8000, max: 20000 },
    lines: activation ? [{ label: "Poste principal", category: AXES[axis].mainCategory, costItem: axis === "MEDICAL" ? "CACHET" : axis === "PARTENARIAT" ? "SPONSORING" : axis === "TRADE" ? "HOTESSES" : "LIEU", share: 0.92 }, { label: "Imprévus", category: "AUTRES", costItem: "AUTRE", share: 0.08 }] : [{ label: "Poste principal", category: AXES[axis].mainCategory, share: 0.92 }, { label: "Imprévus", category: "AUTRES", share: 0.08 }],
    reach: { contactLabel: "personnes touchées", costPerContact: 50, trialRate: 0.5, conversionRate: 0.25, unitsPerBuyer: 1 },
    steps: [{ offset: -14, label: "Préparer l'action", role: "MARKETING" }, { offset: 0, label: "Lancement", role: "MARKETING" }, { offset: 14, label: "Bilan", role: "MARKETING" }],
    contents: [], extraKpis: [], complexity: "MEDIUM", prepDays: 14, durationDays: 1, cooldownDays: 90,
    execution: activation ? { kind: "ACTIVATION", activationType: axis === "EVENEMENTIEL" ? "EVENEMENT" : axis === "MEDICAL" ? "COLLABORATION" : axis === "PARTENARIAT" ? "SPONSORING" : "OPERATION_PHARMACIE" } : { kind: "CAMPAIGN", campaignType: axis === "INFLUENCE" ? "INFLUENCE" : "ACQUISITION", channel: axis === "INFLUENCE" ? "INFLUENCE" : "META" },
    seasons: {}, cityBased: false, posBased: false, influencerBased: axis === "INFLUENCE",
  };
}

/** Exemple de rendu d'un nom pour la liste de la bibliothèque. */
export const previewName = (pattern: string) => pattern.replace(/\{([a-z]+)(?:\|([^}]*))?\}/gi, (_, k: string, f?: string) => (k === "heros" ? "[Produit]" : k === "marque" ? "[Marque]" : f ?? `[${k}]`));

/* ------------------------------ Format commun formulaire / Excel ------------------------------ */

/** Colonnes d'un modèle, dans l'ordre de l'export Excel ; les mêmes noms servent au formulaire d'édition. */
export const TEMPLATE_COLUMNS = [
  { key: "cle", label: "Clé" }, { key: "levier", label: "Levier" }, { key: "famille", label: "Famille" }, { key: "nom", label: "Nom" }, { key: "concept", label: "Concept" },
  { key: "objectifs", label: "Objectifs (clé:affinité %)" }, { key: "cibles", label: "Cibles" }, { key: "produits", label: "Types de produit" }, { key: "canaux", label: "Canaux" },
  { key: "budget_min", label: "Budget min" }, { key: "budget_ideal", label: "Budget idéal" }, { key: "budget_max", label: "Budget max" },
  { key: "postes", label: "Postes (libellé ; catégorie ; part % ; poste d'activation)" },
  { key: "portee", label: "Portée (contacts ; coût par contact ; essai % ; achat % ; unités ; meta)" },
  { key: "etapes", label: "Étapes (J-30 ; libellé ; rôle)" }, { key: "contenus", label: "Contenus (J-7 ; format ; nombre ; titre)" }, { key: "kpi", label: "KPI (libellé ; valeur ou /coût × facteur)" },
  { key: "complexite", label: "Complexité (LOW, MEDIUM, HIGH)" }, { key: "preparation", label: "Préparation (jours)" }, { key: "duree", label: "Durée (jours)" }, { key: "non_repetition", label: "Non-répétition (jours)" },
  { key: "execution", label: "Exécution (ACTIVATION:type ou CAMPAGNE:type:canal)" }, { key: "saisons", label: "Saisons (clé:+1 / -1)" }, { key: "reserve", label: "Réservé à (saisons | mois | libellé)" },
  { key: "ville", label: "Ville (oui/non)" }, { key: "pharmacies", label: "Pharmacies (oui/non)" }, { key: "influenceuses", label: "Influenceuses (oui/non)" },
  { key: "conformite", label: "Conformité" }, { key: "actif", label: "Actif (oui/non)" },
] as const;
export type TemplateFields = Record<(typeof TEMPLATE_COLUMNS)[number]["key"], string>;

const yes = (v: string | undefined) => /^(oui|o|yes|y|1|true|vrai|x)$/i.test((v ?? "").trim());
const yn = (b: boolean) => (b ? "oui" : "non");

export function templateToFields(t: ActionTemplate, active = true): TemplateFields {
  const r = t.reach;
  return {
    cle: t.key, levier: t.axis, famille: t.family, nom: t.name, concept: t.concept,
    objectifs: formatObjectives(t.objectives), cibles: t.targets.join(", "), produits: t.productKinds === "ANY" ? "ANY" : t.productKinds.join(", "), canaux: t.channels.join(", "),
    budget_min: String(t.budget.min), budget_ideal: String(t.budget.typical), budget_max: String(t.budget.max),
    postes: formatLines(t.lines), portee: `${r.contactLabel} ; ${r.costPerContact} ; ${Math.round(r.trialRate * 1000) / 10} ; ${Math.round(r.conversionRate * 1000) / 10} ; ${r.unitsPerBuyer}${r.usesAdsCost ? " ; meta" : ""}`,
    etapes: formatSteps(t.steps), contenus: formatContents(t.contents), kpi: formatKpis(t.extraKpis),
    complexite: t.complexity, preparation: String(t.prepDays), duree: String(t.durationDays), non_repetition: String(t.cooldownDays),
    execution: t.execution.kind === "ACTIVATION" ? `ACTIVATION:${t.execution.activationType}` : `CAMPAGNE:${t.execution.campaignType}:${t.execution.channel}`,
    saisons: formatSeasons(t.seasons), reserve: t.onlyWhen ? `${(t.onlyWhen.seasons ?? []).join(",")} | ${(t.onlyWhen.months ?? []).join(",")} | ${t.onlyWhen.label}` : "",
    ville: yn(t.cityBased), pharmacies: yn(t.posBased), influenceuses: yn(t.influencerBased), conformite: t.compliance ?? "", actif: yn(active),
  };
}

/** Champs (formulaire ou ligne Excel) → modèle brut à valider, et erreurs de syntaxe. */
export function fieldsToTemplate(f: Partial<TemplateFields>): { raw: Record<string, unknown>; errors: string[]; active: boolean } {
  const errors: string[] = [];
  const g = (k: keyof TemplateFields) => String(f[k] ?? "").trim();
  const n = (k: keyof TemplateFields) => { const v = num(g(k)); if (!Number.isFinite(v)) errors.push(`${k} : nombre attendu`); return v; };
  const lines = parseLines(g("postes")), steps = parseSteps(g("etapes")), contents = parseContents(g("contenus")), kpis = parseKpis(g("kpi")), objectives = parseObjectives(g("objectifs"));
  errors.push(...lines.errors, ...steps.errors, ...contents.errors, ...kpis.errors, ...objectives.errors);
  const [cl, cpc, tr, cv, u, meta] = fields(g("portee"));
  const reach = { contactLabel: cl || "personnes touchées", costPerContact: num(cpc ?? ""), trialRate: num(tr ?? "") / 100, conversionRate: num(cv ?? "") / 100, unitsPerBuyer: num(u ?? "1") || 1, ...(meta && /meta/i.test(meta) ? { usesAdsCost: true } : {}) };
  if (!(reach.costPerContact > 0) || !(reach.trialRate >= 0) || !(reach.conversionRate >= 0)) errors.push("portée : « contacts ; coût par contact ; essai % ; achat % ; unités » attendu");
  const ex = g("execution").split(":").map((x) => x.trim());
  const execution = ex[0]?.toUpperCase().startsWith("ACTIV") ? { kind: "ACTIVATION", activationType: (ex[1] ?? "AUTRE").toUpperCase() } : { kind: "CAMPAIGN", campaignType: (ex[1] ?? "ACQUISITION").toUpperCase(), channel: (ex[2] ?? "META").toUpperCase() };
  const [rs, rm, rl] = g("reserve").split("|").map((x) => x.trim());
  const onlyWhen = g("reserve") ? { ...(rs ? { seasons: listOf(rs) } : {}), ...(rm ? { months: listOf(rm).map(Number).filter((x) => x >= 1 && x <= 12) } : {}), label: rl || "période réservée" } : undefined;
  const kinds = g("produits").toUpperCase();
  const raw = {
    key: g("cle").toUpperCase(), axis: g("levier").toUpperCase(), family: g("famille"), name: g("nom"), concept: g("concept"),
    objectives: objectives.value, targets: listOf(g("cibles")).map((x) => x.toUpperCase()), productKinds: !kinds || kinds === "ANY" ? "ANY" : listOf(kinds),
    channels: listOf(g("canaux")), budget: { min: n("budget_min"), typical: n("budget_ideal"), max: n("budget_max") },
    lines: lines.value, reach, steps: steps.value, contents: contents.value, extraKpis: kpis.value,
    complexity: (g("complexite") || "MEDIUM").toUpperCase(), prepDays: Math.round(n("preparation")), durationDays: Math.round(n("duree")), cooldownDays: Math.round(n("non_repetition")),
    execution, seasons: parseSeasons(g("saisons")), cityBased: yes(g("ville")), posBased: yes(g("pharmacies")), influencerBased: yes(g("influenceuses")),
    ...(g("conformite") ? { compliance: g("conformite") } : {}), ...(onlyWhen ? { onlyWhen } : {}),
  };
  return { raw, errors, active: g("actif") ? yes(g("actif")) : true };
}

/** Ligne d'un fichier Excel ou CSV → champs : en-têtes reconnus par libellé complet, libellé court (avant la parenthèse) ou clé. */
export function sheetRowToFields(row: Record<string, unknown>): Partial<TemplateFields> {
  const short = (h: string) => h.toLowerCase().split(" (")[0].trim();
  const out: Partial<TemplateFields> = {};
  for (const [h, v] of Object.entries(row)) {
    if (v === null || v === undefined) continue;
    const col = TEMPLATE_COLUMNS.find((c) => c.label.toLowerCase() === h.toLowerCase().trim() || short(c.label) === short(h) || c.key === h.trim());
    if (col) out[col.key] = String(v);
  }
  return out;
}

