/**
 * File unique « À décider » : ce que les écrans (téléphone et Cockpit) affichent et ce qu'ils renvoient.
 * Logique pure, sans base : natures, tri, lecture d'une décision reçue, geste du téléphone.
 */
export type ValidationKind = "CONTENU" | "ACTIVATION" | "PIECE" | "DECISION_AGENT" | "DECISION" | "RAPPORT";

export const VALIDATION_KINDS: ValidationKind[] = ["PIECE", "ACTIVATION", "CONTENU", "DECISION_AGENT", "DECISION", "RAPPORT"];

/** Libellé et couleur d'une nature (pastille de la ligne). */
export const KIND_META: Record<ValidationKind, { label: string; tone: "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray" | "accent" }> = {
  PIECE: { label: "Pièce bloquée", tone: "red" },
  ACTIVATION: { label: "Dépense", tone: "yellow" },
  CONTENU: { label: "Contenu", tone: "purple" },
  DECISION_AGENT: { label: "Décision d'agent", tone: "blue" },
  DECISION: { label: "Décision marketing", tone: "accent" },
  RAPPORT: { label: "Rapport à lire", tone: "gray" },
};

export type ValidationItem = {
  kind: ValidationKind;
  /**
   * Identifiant de l'objet : UUID pour un contenu, une activation, une pièce ou un rapport ; `<rapport>:<décision>` pour une
   * décision d'agent ; clé stable du moteur pour une décision marketing.
   */
  id: string;
  title: string;
  context: string;
  /** Pourquoi cette décision est demandée, en une ligne. */
  why: string | null;
  detail: string | null;
  lines: string[];
  /** Montant engagé par la décision. `null` = absent : affiché « — », jamais estimé. */
  amountMad: number | null;
  /** Échéance (AAAA-MM-JJ), `null` si l'objet n'en porte pas. */
  dueDate: string | null;
  href: string;
  refuseLabel: string;
  /** Faux seulement quand le « non » n'est pas un refus (archiver un rapport lu). */
  needsReason: boolean;
};

export type ValidationDecision = { kind: ValidationKind; id: string; decision: "OK" | "KO"; comment?: string | null };

/** `stale` : l'objet a déjà été tranché, supprimé ou a changé depuis l'affichage ; l'écran doit se recharger. */
export type DecisionResult = { ok: true } | { ok: false; error: string; stale?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sépare `<rapport>:<décision>` ; `null` si la forme n'est pas celle-là. */
export function splitAgentId(id: string): { reportId: string; decisionId: string } | null {
  const at = id.indexOf(":");
  if (at < 0) return null;
  const reportId = id.slice(0, at), decisionId = id.slice(at + 1);
  return UUID.test(reportId) && decisionId ? { reportId, decisionId } : null;
}

/** Lit une décision envoyée par un écran. Tout ce qui n'a pas la forme attendue pour sa nature est rejeté (`null`). */
export function readDecision(raw: unknown): ValidationDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind as ValidationKind;
  if (!VALIDATION_KINDS.includes(kind) || typeof r.id !== "string" || (r.decision !== "OK" && r.decision !== "KO")) return null;
  const id = r.id.trim();
  if (!id || id.length > 400) return null;
  if (kind === "DECISION_AGENT") { if (!splitAgentId(id)) return null; }
  else if (kind !== "DECISION" && !UUID.test(id)) return null;
  const comment = typeof r.comment === "string" ? r.comment.trim().slice(0, 2000) || null : null;
  return { kind, id, decision: r.decision, comment };
}

/**
 * Ordre de la file : échéance la plus proche d'abord (sans échéance à la fin), puis montant le plus élevé
 * (sans montant à la fin), puis nature et titre pour un ordre stable d'un écran à l'autre.
 */
export function sortValidations<T extends Pick<ValidationItem, "kind" | "title" | "amountMad" | "dueDate">>(items: T[]): T[] {
  const rank = (k: ValidationKind) => VALIDATION_KINDS.indexOf(k);
  return [...items].sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    if (a.amountMad !== b.amountMad) {
      if (a.amountMad === null) return 1;
      if (b.amountMad === null) return -1;
      return b.amountMad - a.amountMad;
    }
    return rank(a.kind) - rank(b.kind) || a.title.localeCompare(b.title, "fr");
  });
}

/** Première ligne non vide d'un texte, bornée : le « pourquoi » d'une ligne tient sur une ligne. */
export function oneLine(text: string | null | undefined, max = 180): string | null {
  const line = (text ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** Distance à parcourir pour qu'un geste compte : assez longue pour qu'un défilement ne valide jamais rien. */
export const SWIPE_THRESHOLD_PX = 110;

/** Temps laissé pour annuler un geste, avant l'envoi : un swipe engage de l'argent ou une publication. */
export const UNDO_DELAY_MS = 5000;

/** Sens d'un geste relâché. Un mouvement surtout vertical est un défilement, jamais une décision. */
export function swipeDecision(dx: number, dy: number): "OK" | "KO" | null {
  if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < SWIPE_THRESHOLD_PX) return null;
  return dx > 0 ? "OK" : "KO";
}
