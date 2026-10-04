/**
 * Statut effectif d'une décision — logique pure (testée sans base), partagée par `store.ts` et les écrans.
 * Approuvée + tâche terminée = exécutée ; approuvée + tâche annulée = refusée ; approuvée dont la date de
 * revue est passée sans exécution = expirée. Les autres statuts sont ceux enregistrés.
 */
import type { MarketingDecisionStatus } from "@/db/schema";
import type { DecisionState } from "./types";

export function effectiveStatus(s: DecisionState, todayIso: string): MarketingDecisionStatus {
  if (s.status === "APPROVED") {
    if (s.taskStatus === "DONE") return "EXECUTED";
    if (s.taskStatus === "CANCELLED") return "REJECTED";
    if (s.expectedReviewDate && s.expectedReviewDate < todayIso) return "EXPIRED";
  }
  return s.status;
}
