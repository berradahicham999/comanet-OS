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
