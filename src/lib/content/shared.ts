/**
 * Planning éditorial — logique pure (sans base, sans serveur), partagée entre serveur,
 * composants client et tests.
 *
 * Les statuts, transitions, plateformes et formats sont des données (tables de référence) :
 * ce module ne connaît AUCUN nom de statut. Il raisonne sur les drapeaux portés par les
 * lignes (`isPublished`, `awaitingValidation`, `requiresValidator`…).
 */
import type { Tone } from "@/components/ui";

export type StatusRef = {
  key: string; label: string; tone: string; sort: number; active: boolean;
  isPublished: boolean; isArchived: boolean; awaitingValidation: boolean; inProduction: boolean;
};
export type TransitionRef = { fromKey: string; toKey: string; requiresValidator: boolean; requiresComment: boolean; label: string | null };
export type PlatformRef = { key: string; label: string; icon: string | null; sort: number; active: boolean; specs: { ratios?: string[]; maxDurationSec?: number; notes?: string } };
export type FormatRef = { key: string; label: string; sort: number; active: boolean; defaultDeliverable: string | null };
export type ObjectiveRef = { key: string; label: string; sort: number; active: boolean };

export type ContentRefs = {
  statuses: StatusRef[];
  transitions: TransitionRef[];
  platforms: PlatformRef[];
  formats: FormatRef[];
  objectives: ObjectiveRef[];
};

const TONES: Tone[] = ["red", "orange", "yellow", "green", "blue", "purple", "gray", "accent"];
/** Un `tone` saisi en base qui n'existe pas dans le design system retombe sur gris. */
export function safeTone(t: string | null | undefined): Tone {
  return TONES.includes(t as Tone) ? (t as Tone) : "gray";
}

/** Classes Tailwind d'un badge selon le `tone` d'un statut (mêmes couleurs que `Badge` du design system). */
const TONE_CLASS: Record<Tone, string> = {
  red: "bg-red-soft text-red", orange: "bg-orange-soft text-orange", yellow: "bg-yellow-soft text-yellow", green: "bg-green-soft text-green",
  blue: "bg-blue-soft text-blue", purple: "bg-purple-soft text-purple", gray: "bg-black/5 text-ink-2", accent: "bg-accent-soft text-accent-2",
};
export function toneClass(t: string | null | undefined): string {
  return TONE_CLASS[safeTone(t)];
}

/** Clé technique dérivée d'un libellé saisi (« Visuel pharmacie » → VISUEL_PHARMACIE). */
export function refKey(label: string): string {
  return label
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

/**
 * Une transition est-elle permise ? Définition unique, utilisée par l'action serveur ET
 * par l'affichage des boutons. `isValidator` : la personne peut valider pour la marque.
 */
export function checkTransition(
  transitions: TransitionRef[],
  from: string,
  to: string,
  ctx: { isValidator: boolean; comment?: string | null },
): TransitionCheck {
  if (from === to) return { ok: false, reason: "Le contenu est déjà dans ce statut." };
  const t = transitions.find((x) => x.fromKey === from && x.toKey === to);
  if (!t) return { ok: false, reason: "Cette transition n'est pas autorisée depuis le statut actuel." };
  if (t.requiresValidator && !ctx.isValidator) return { ok: false, reason: "Seul un validateur (Administration, droit « Valider » sur Marketing, ou validateur de la marque) peut effectuer cette étape." };
  if (t.requiresComment && !(ctx.comment ?? "").trim()) return { ok: false, reason: "Un commentaire est obligatoire pour cette étape." };
  return { ok: true };
}

/**
 * Transitions proposées depuis un statut, avec leur disponibilité pour la personne.
 * Générique sur le référentiel de statuts : sert au planning éditorial et aux activations.
 */
export function nextTransitions<S extends { key: string; sort: number; active: boolean }>(refs: { statuses: S[]; transitions: TransitionRef[] }, from: string, isValidator: boolean) {
  const order = new Map(refs.statuses.map((s) => [s.key, s.sort]));
  return refs.transitions
    .filter((t) => t.fromKey === from && refs.statuses.some((s) => s.key === t.toKey && s.active))
    .map((t) => ({ ...t, allowed: !t.requiresValidator || isValidator, target: refs.statuses.find((s) => s.key === t.toKey)! }))
    .sort((a, b) => (order.get(a.toKey) ?? 0) - (order.get(b.toKey) ?? 0));
}

export type LatenessInput = { date: string; deadline: string | null; status: string; hasDeliverable: boolean };

/**
 * Retard d'un contenu, à une date donnée (ISO `YYYY-MM-DD`).
 *  - `LIVRABLE` : deadline dépassée sans livrable déposé, contenu ni publié ni archivé.
 *  - `PUBLICATION` : date de publication passée sans passage au statut « publié ».
 */
export function lateness(item: LatenessInput, statuses: StatusRef[], todayIso: string): "LIVRABLE" | "PUBLICATION" | null {
  const st = statuses.find((s) => s.key === item.status);
  if (!st || st.isPublished || st.isArchived) return null;
  if (item.date < todayIso) return "PUBLICATION";
  if (item.deadline && item.deadline < todayIso && !item.hasDeliverable) return "LIVRABLE";
  return null;
}

/** Champs du brief qu'un template peut pré-remplir. */
export const BRIEF_FIELDS = ["keyMessage", "angle", "hook", "caption", "hashtags", "cta", "constraints", "mandatoryMentions", "forbiddenClaims", "deliverables"] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];

/** Applique un template sans écraser ce qui est déjà saisi (anti-régression). */
export function applyTemplate<T extends Partial<Record<BriefField, string | null>>>(current: T, defaults: Partial<Record<BriefField, string | undefined>>): T {
  const out = { ...current };
  for (const f of BRIEF_FIELDS) {
    if (!(out[f] ?? "").toString().trim() && defaults[f]) (out as Record<string, unknown>)[f] = defaults[f];
  }
  return out;
}

/** Date ISO décalée de `days` jours (calcul calendaire, sans fuseau). */
export function shiftIso(dateIso: string, days: number): string {
  const d = new Date(dateIso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------ Brief PDF importé ------------------------------ */

/** Libellés des champs du brief, tels qu'affichés dans le formulaire. */
export const BRIEF_FIELD_LABELS: Record<BriefField | "brief" | "references" | "platform" | "format" | "objective" | "deadline" | "products", string> = {
  keyMessage: "Message clé", angle: "Angle", hook: "Accroche", caption: "Légende", hashtags: "Hashtags", cta: "Appel à l'action",
  constraints: "Contraintes", mandatoryMentions: "Mentions obligatoires", forbiddenClaims: "Allégations interdites", deliverables: "Livrables attendus",
  brief: "Notes de brief (résumé)", references: "Références", platform: "Plateforme", format: "Format", objective: "Objectif", deadline: "Deadline du livrable", products: "Produits",
};

/** Ce que la lecture d'un brief PDF a relevé (champ absent du document = null, jamais deviné). */
export type ImportedBrief = Partial<Record<BriefField, string | null>> & {
  summary: string | null;
  missing?: string[];
  references?: { url: string; label?: string | null }[];
  platform?: string | null; format?: string | null; objective?: string | null;
  deadline?: string | null;
  products?: string[];
};

export type BriefState = Partial<Record<BriefField, string | null>> & {
  brief: string | null; references: { url: string; label?: string }[];
  platform: string | null; format: string | null; objective: string | null; deadline: string | null;
  productIds: string[];
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Fusion d'un brief PDF dans la fiche. Le PDF fait foi pour ce qu'il dit : un champ renseigné dans le document
 * remplace la valeur de la fiche ; un champ absent du document ne vide jamais la fiche (anti-régression).
 * Références et produits s'ajoutent. Plateforme, format et objectif ne sont pris que s'ils existent au
 * référentiel. La deadline n'est posée que si la fiche n'en a pas (la date de publication n'est jamais touchée :
 * c'est le calendrier qui la décide).
 */
export function mergeImportedBrief(
  current: BriefState,
  got: ImportedBrief,
  ctx: { platforms: string[]; formats: string[]; objectives: string[]; products: { id: string; name: string }[] },
): { patch: Partial<BriefState>; changed: string[] } {
  const patch: Partial<BriefState> = {};
  const changed: string[] = [];
  const clean = (v: string | null | undefined) => (v ?? "").trim() || null;
  const set = <K extends keyof BriefState>(k: K, v: BriefState[K], label: string) => {
    if (JSON.stringify(current[k] ?? null) === JSON.stringify(v ?? null)) return;
    patch[k] = v; changed.push(label);
  };
  for (const f of BRIEF_FIELDS) {
    const v = clean(got[f]);
    if (v) set(f, v, BRIEF_FIELD_LABELS[f]);
  }
  const summary = clean(got.summary);
  const missing = (got.missing ?? []).map((m) => m.trim()).filter(Boolean);
  if (summary) set("brief", missing.length ? `${summary}\n\nÀ préciser (absent du brief PDF) :\n${missing.map((m) => `- ${m}`).join("\n")}` : summary, BRIEF_FIELD_LABELS.brief);

  const refs = [...current.references];
  for (const r of got.references ?? []) {
    const url = r.url?.trim();
    if (url && /^https?:\/\//i.test(url) && !refs.some((x) => x.url === url)) refs.push({ url, label: r.label?.trim() || undefined });
  }
  if (refs.length !== current.references.length) set("references", refs, BRIEF_FIELD_LABELS.references);

  const pick = (v: string | null | undefined, keys: string[]) => (v && keys.includes(v) ? v : null);
  const platform = pick(got.platform, ctx.platforms), format = pick(got.format, ctx.formats), objective = pick(got.objective, ctx.objectives);
  if (platform) set("platform", platform, BRIEF_FIELD_LABELS.platform);
  if (format) set("format", format, BRIEF_FIELD_LABELS.format);
  if (objective) set("objective", objective, BRIEF_FIELD_LABELS.objective);
  if (!current.deadline && got.deadline && /^\d{4}-\d{2}-\d{2}$/.test(got.deadline)) set("deadline", got.deadline, BRIEF_FIELD_LABELS.deadline);

  const ids = [...current.productIds];
  for (const name of got.products ?? []) {
    const n = norm(name);
    const p = n ? ctx.products.find((x) => norm(x.name) === n) ?? ctx.products.find((x) => norm(x.name).includes(n) || n.includes(norm(x.name))) : undefined;
    if (p && !ids.includes(p.id)) ids.push(p.id);
  }
  if (ids.length !== current.productIds.length) set("productIds", ids, BRIEF_FIELD_LABELS.products);
  return { patch, changed };
}

/**
 * Brief complet en texte (Markdown), à coller tel quel dans un assistant IA par la personne qui produit le contenu.
 * Seulement ce qui est saisi : un champ vide est omis, jamais complété.
 */
export function briefMarkdown(b: {
  title: string; brand: string; platform: string | null; format: string | null; objective: string | null;
  date: string; publishTime: string | null; deadline: string | null; platformSpecs?: string | null;
  fields: Partial<Record<BriefField | "brief", string | null>>;
  references: { url: string; label?: string }[];
  products: { name: string; benefits?: string | null; claims?: string | null; actives?: string | null; marketingAngle?: string | null }[];
  briefPdf?: string | null;
}): string {
  const L: string[] = [`# Brief — ${b.title}`, ""];
  const line = (k: string, v: string | null | undefined) => { if (v && v.trim()) L.push(`- **${k}** : ${v.trim()}`); };
  line("Marque", b.brand); line("Plateforme", b.platform); line("Format", b.format); line("Objectif", b.objective);
  line("Publication", `${b.date}${b.publishTime ? ` à ${b.publishTime.slice(0, 5)}` : ""}`); line("Livrable attendu pour le", b.deadline);
  line("Contraintes de la plateforme", b.platformSpecs);
  if (b.briefPdf) line("Brief détaillé", `PDF joint (${b.briefPdf})`);
  const sec = (title: string, v: string | null | undefined) => { if (v && v.trim()) L.push("", `## ${title}`, v.trim()); };
  sec("Résumé du besoin", b.fields.brief);
  sec("Message clé", b.fields.keyMessage); sec("Angle", b.fields.angle); sec("Accroche proposée", b.fields.hook);
  sec("Légende (caption)", b.fields.caption); sec("Hashtags", b.fields.hashtags); sec("Appel à l'action", b.fields.cta);
  sec("Livrables attendus", b.fields.deliverables); sec("Contraintes (charte, technique)", b.fields.constraints);
  sec("Mentions obligatoires", b.fields.mandatoryMentions); sec("Allégations interdites", b.fields.forbiddenClaims);
  if (b.products.length) {
    L.push("", "## Produits");
    for (const p of b.products) {
      L.push(`### ${p.name}`);
      line("Bénéfices", p.benefits); line("Allégations autorisées", p.claims); line("Actifs", p.actives); line("Angle marketing", p.marketingAngle);
    }
  }
  if (b.references.length) { L.push("", "## Références"); for (const r of b.references) L.push(`- ${r.label ? `${r.label} : ` : ""}${r.url}`); }
  L.push("", "---", "Règles : ne rien inventer (ingrédient, chiffre, preuve, prix) au-delà de ce brief et des fiches produits ; respecter les allégations autorisées et les mentions obligatoires. Le livrable final est déposé dans COMANET OS (Planning éditorial → ce contenu → « Déposer le livrable ») pour validation.");
  return L.join("\n");
}
