/**
 * Décisions proposées par un agent dans un rapport — contrat de `ai_reports.sources.decisions[]` (docs/contrat-decisions-agents.md).
 *
 * Logique pure, sans base. L'agent écrit `sources.decisions[]` une fois, à la création du rapport ; l'application
 * n'y touche jamais et consigne le sort de chaque décision dans `sources.outcomes[<id>]` (qui, quand, motif, tâche).
 * Une ligne qui ne respecte pas le contrat est ignorée et comptée : elle ne fait jamais planter la lecture et
 * n'est jamais « réparée » (un montant illisible n'est pas deviné).
 */
import type { UserRole } from "@/db/schema";

export type AgentDecision = {
  id: string;
  title: string;
  why: string;
  /** `null` = pas de montant : affiché « — ». */
  amountMad: number | null;
  dueDate: string;
  ownerRole: string;
  brandId: string | null;
  expectedKpi: string;
  reviewDate: string;
};

export type AgentOutcome = {
  status: "APPROVED" | "REJECTED";
  at: string;
  byId: string | null;
  byName: string;
  reason: string | null;
  taskId: string | null;
};

export type AgentDecisionState = AgentDecision & { outcome: AgentOutcome | null };

export type ParsedDecisions = {
  /** Le rapport porte un tableau `sources.decisions` (même vide ou entièrement illisible). */
  declared: boolean;
  decisions: AgentDecision[];
  /** Lignes du tableau écartées parce qu'elles ne respectent pas le contrat. */
  ignored: number;
};

export type ReportStatus = "DRAFT" | "VALIDATED" | "ARCHIVED";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Date AAAA-MM-JJ qui existe au calendrier (le 31 février est refusé). */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Statut d'un rapport tel que l'application le comprend : les agents externes l'écrivent en minuscules (`draft`). */
export function normalizeReportStatus(v: unknown): ReportStatus {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "VALIDATED" || s === "ARCHIVED" ? s : "DRAFT";
}

function readLine(raw: unknown): AgentDecision | null {
  if (!isObject(raw)) return null;
  const id = typeof raw.id === "number" && Number.isFinite(raw.id) ? String(raw.id) : text(raw.id, 80);
  const title = text(raw.title, 200), why = text(raw.why, 600), ownerRole = text(raw.owner_role, 120), expectedKpi = text(raw.expected_kpi, 400);
  if (!id || !title || !why || !ownerRole || !expectedKpi) return null;
  if (!isIsoDate(raw.due_date) || !isIsoDate(raw.review_date)) return null;
  let amountMad: number | null = null;
  if (raw.amount_mad !== null && raw.amount_mad !== undefined) {
    if (typeof raw.amount_mad !== "number" || !Number.isFinite(raw.amount_mad) || raw.amount_mad < 0) return null;
    amountMad = raw.amount_mad;
  }
  let brandId: string | null = null;
  if (raw.brand_id !== null && raw.brand_id !== undefined) {
    if (typeof raw.brand_id !== "string" || !UUID.test(raw.brand_id)) return null;
    brandId = raw.brand_id.toLowerCase();
  }
  return { id, title, why, amountMad, dueDate: raw.due_date, ownerRole, brandId, expectedKpi, reviewDate: raw.review_date };
}

/** Lit `sources.decisions[]`. Un identifiant répété dans le même rapport est ignoré à partir de la deuxième ligne. */
export function parseAgentDecisions(sources: unknown): ParsedDecisions {
  if (!isObject(sources) || !Array.isArray(sources.decisions)) return { declared: false, decisions: [], ignored: 0 };
  const decisions: AgentDecision[] = [];
  const seen = new Set<string>();
  let ignored = 0;
  for (const raw of sources.decisions) {
    const d = readLine(raw);
    if (!d || seen.has(d.id)) { ignored++; continue; }
    seen.add(d.id);
    decisions.push(d);
  }
  return { declared: true, decisions, ignored };
}

/** Lit `sources.outcomes` : ce que la direction a déjà tranché. Une entrée illisible vaut « non tranchée ». */
export function parseOutcomes(sources: unknown): Record<string, AgentOutcome> {
  const out: Record<string, AgentOutcome> = {};
  if (!isObject(sources) || !isObject(sources.outcomes)) return out;
  for (const [id, raw] of Object.entries(sources.outcomes)) {
    if (!isObject(raw) || (raw.status !== "APPROVED" && raw.status !== "REJECTED")) continue;
    out[id] = {
      status: raw.status, at: typeof raw.at === "string" ? raw.at : "", byId: typeof raw.by_id === "string" ? raw.by_id : null,
      byName: typeof raw.by_name === "string" ? raw.by_name : "", reason: typeof raw.reason === "string" ? raw.reason : null,
      taskId: typeof raw.task_id === "string" ? raw.task_id : null,
    };
  }
  return out;
}

export function decisionStates(sources: unknown): { declared: boolean; ignored: number; decisions: AgentDecisionState[] } {
  const parsed = parseAgentDecisions(sources);
  const outcomes = parseOutcomes(sources);
  return { declared: parsed.declared, ignored: parsed.ignored, decisions: parsed.decisions.map((d) => ({ ...d, outcome: outcomes[d.id] ?? null })) };
}

export function pendingDecisions(sources: unknown): AgentDecision[] {
  return decisionStates(sources).decisions.filter((d) => !d.outcome);
}

/** Toutes les décisions lisibles du rapport sont tranchées (et il y en a au moins une). */
export function isSettled(sources: unknown): boolean {
  const { decisions } = decisionStates(sources);
  return decisions.length > 0 && decisions.every((d) => d.outcome);
}

/**
 * Consigne le sort d'une décision. Renvoie les nouvelles `sources` (l'objet reçu n'est pas modifié, `decisions[]`
 * reste tel que l'agent l'a écrit) et le statut que le rapport doit prendre : VALIDATED dès que tout est tranché,
 * sinon inchangé. `null` si la décision n'existe pas ou est déjà tranchée.
 */
export function withOutcome(sources: unknown, status: ReportStatus, decisionId: string, outcome: AgentOutcome): { sources: Record<string, unknown>; status: ReportStatus } | null {
  const state = decisionStates(sources).decisions.find((d) => d.id === decisionId);
  if (!state || state.outcome || !isObject(sources)) return null;
  const previous = isObject(sources.outcomes) ? sources.outcomes : {};
  const next = {
    ...sources,
    outcomes: { ...previous, [decisionId]: { status: outcome.status, at: outcome.at, by_id: outcome.byId, by_name: outcome.byName, reason: outcome.reason, task_id: outcome.taskId } },
  };
  return { sources: next, status: status === "DRAFT" && isSettled(next) ? "VALIDATED" : status };
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9@.]+/g, " ").trim();

/** Mots d'un `owner_role` → rôle de l'application. Sert seulement à proposer un responsable, jamais à décider d'un accès. */
const ROLE_WORDS: [UserRole, string[]][] = [
  ["MANAGER_MEDICAL", ["manager medical", "responsable medical"]],
  ["DELEGUE_MEDICAL", ["delegue medical", "deleguee medicale", "visiteur medical", "vm"]],
  ["REGLEMENTAIRE", ["reglementaire", "affaires reglementaires", "dmp"]],
  ["ANIMATRICE", ["animatrice", "animation"]],
  ["MARKETING", ["marketing", "cmo", "digital", "contenu", "ads"]],
  ["TRADE", ["trade", "commercial", "commerciale", "vente", "ventes", "supply", "achats", "logistique"]],
  ["ADMIN", ["admin", "direction", "dg", "gerant", "co gerant", "finance", "daf"]],
];

/**
 * Responsable d'une tâche à partir de `owner_role`, du plus précis au plus large : l'adresse e-mail d'un compte, le nom
 * d'un compte (nom complet, ou prénom porté par un seul compte : « Nasr », « Oumaima (DMP) »), sinon un rôle. Sans
 * correspondance, `null` : la tâche naît sans assigné et le responsable demandé figure dans sa description.
 */
export function resolveOwner<U extends { id: string; name: string; email: string; role: UserRole }>(ownerRole: string, users: U[]): U | null {
  const key = fold(ownerRole);
  if (key.includes("@")) return users.find((u) => u.email.toLowerCase() === key) ?? null;
  const full = users.filter((u) => fold(u.name) === key);
  if (full.length === 1) return full[0];
  const tokens = new Set(key.split(" "));
  const byFirst = users.filter((u) => { const first = fold(u.name).split(" ")[0]; return !!first && tokens.has(first); });
  if (byFirst.length === 1) return byFirst[0];
  const squashed = key.replace(/ /g, "_").toUpperCase();
  const role = ROLE_WORDS.find(([r]) => r === squashed)?.[0] ?? ROLE_WORDS.find(([, words]) => words.some((w) => ` ${key} `.includes(` ${w} `)))?.[0] ?? null;
  return role ? users.find((u) => u.role === role) ?? null : null;
}

/** Nom lisible d'un type de rapport : les deux types de l'application, sinon le type écrit par l'agent. */
export function reportTypeLabel(type: string): string {
  if (type === "WEEKLY") return "COMANET WEEKLY";
  if (type === "MONTHLY_BRAND_REVIEW") return "MONTHLY BRAND REVIEW";
  const words = type.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Rapport";
}
