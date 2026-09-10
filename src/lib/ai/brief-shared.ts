/** Brief du matin — types et analyse de la réponse, partagés client / serveur (logique pure, testée). */
import { MODULE_KEYS } from "@/lib/access-shared";

export type BriefAction = {
  title: string;
  /** La donnée qui motive l'action. */
  why: string;
  /** Rôle suggéré (« commercial », « responsable réglementaire »…). */
  assignee_role: string;
  due_in_days: number;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  /** Module de la matrice (ventes, stock, reglementaire…). */
  module: string;
  /** Résultat attendu et comment le mesurer. */
  expected: string;
};

export type MorningBrief = {
  /** Texte du brief (5 à 7 lignes, Markdown réduit), sans le bloc d'actions. */
  text: string;
  actions: BriefAction[];
  generatedAt: string;
  model: string;
  /** Tâches déjà créées depuis ce brief (index des actions). */
  createdTaskIds: Record<number, string>;
};

export type BriefResult = { ok: true; brief: MorningBrief; cached: boolean } | { ok: false; error: string; configured: boolean };

/** Sépare le texte du bloc JSON final ; un JSON absent ou invalide donne un brief sans actions, jamais une erreur. */
export function parseBrief(raw: string): { text: string; actions: BriefAction[] } {
  const m = raw.match(/```json\s*([\s\S]*?)```\s*$/i) ?? raw.match(/```json\s*([\s\S]*?)```/i);
  let actions: BriefAction[] = [];
  if (m) {
    try {
      const parsed = JSON.parse(m[1]) as { actions?: Partial<BriefAction>[] };
      actions = (parsed.actions ?? []).slice(0, 3).map((a) => ({
        title: String(a.title ?? "").slice(0, 200),
        why: String(a.why ?? "").slice(0, 600),
        assignee_role: String(a.assignee_role ?? "").slice(0, 80),
        due_in_days: Math.max(0, Math.min(90, Number(a.due_in_days ?? 3) || 3)),
        priority: (["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).includes(a.priority as BriefAction["priority"]) ? (a.priority as BriefAction["priority"]) : "MEDIUM",
        module: (MODULE_KEYS as readonly string[]).includes(String(a.module)) ? String(a.module) : "taches",
        expected: String(a.expected ?? "").slice(0, 600),
      })).filter((a) => a.title);
    } catch { actions = []; }
  }
  const text = (m ? raw.replace(m[0], "") : raw).trim();
  return { text, actions };
}
