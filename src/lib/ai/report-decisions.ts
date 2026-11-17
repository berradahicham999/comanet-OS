/**
 * Décisions d'agents portées par un rapport (`ai_reports.sources.decisions[]`) — lecture de la file et SEULE écriture
 * de `sources.outcomes`. Le contrat et la bascule du rapport sont dans `report-decisions-shared.ts` (pur, testé).
 *
 * Trancher une décision verrouille la ligne du rapport : deux écrans (téléphone et bureau) ne peuvent pas trancher
 * deux fois la même décision ; le second reçoit « déjà tranchée ». Valider crée la tâche par `createTask()`, dans
 * la même transaction que le sort de la décision et sa trace d'audit. Le rapport passe VALIDATED quand tout est tranché.
 */
import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiReports, brands } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getAccess } from "@/lib/permissions";
import { can, isAdmin } from "@/lib/permissions-shared";
import { listUsers } from "@/lib/users";
import { createTask, notifyTaskAssigned } from "@/lib/tasks";
import { fmtDate } from "@/lib/format";
import {
  decisionStates, normalizeReportStatus, reportTypeLabel, resolveOwner, withOutcome,
  type AgentDecision, type AgentOutcome,
} from "./report-decisions-shared";

export type DraftReport = {
  id: string; type: string; typeLabel: string; title: string; brandId: string | null; brandName: string | null; createdAt: string;
  /** Le rapport porte au moins une décision lisible. */
  hasDecisions: boolean;
  pending: AgentDecision[];
  ignored: number;
};

/** Clé de la tâche née d'une décision d'agent : une seule tâche par décision. */
export const reportTaskKey = (reportId: string, decisionId: string) => `rapport:${reportId}:${decisionId}`;

/** Rapports en brouillon du périmètre, du plus récent au plus ancien, avec leurs décisions encore à trancher. */
export async function draftReports(brandIds: string[] | null, limit = 200): Promise<DraftReport[]> {
  const rows = await db
    .select({ id: aiReports.id, type: aiReports.type, title: aiReports.title, brandId: aiReports.brandId, brandName: brands.name, sources: aiReports.sources, createdAt: aiReports.createdAt })
    .from(aiReports).leftJoin(brands, eq(brands.id, aiReports.brandId))
    .where(sql`upper(${aiReports.status}) = 'DRAFT'`).orderBy(desc(aiReports.createdAt)).limit(limit);
  return rows.filter((r) => !brandIds || !r.brandId || brandIds.includes(r.brandId)).map((r) => {
    const state = decisionStates(r.sources);
    return {
      id: r.id, type: r.type, typeLabel: reportTypeLabel(r.type), title: r.title, brandId: r.brandId, brandName: r.brandName, createdAt: r.createdAt.toISOString(),
      hasDecisions: state.decisions.length > 0,
      // Une décision sur une marque hors du périmètre de la personne ne lui est pas proposée.
      pending: state.decisions.filter((d) => !d.outcome && (!brandIds || !d.brandId || brandIds.includes(d.brandId))),
      ignored: state.ignored,
    };
  });
}

export type ReportDecisionResult = { ok: true; taskId: string | null; reportValidated: boolean } | { ok: false; error: string; stale?: boolean };

/**
 * Trancher une décision d'agent. Droit : « Valider » sur Rapports (ou administrateur), comme la validation d'un rapport,
 * et marque de la décision dans le périmètre. Un refus exige un motif.
 */
export async function decideReportDecision(input: { reportId: string; decisionId: string; approve: boolean; reason: string | null }): Promise<ReportDecisionResult> {
  const access = await getAccess();
  if (!access) return { ok: false, error: "Non connecté." };
  if (access.preview) return { ok: false, error: "Prévisualisation : lecture seule." };
  if (!can(access.perms, "rapports", "validate") && !isAdmin(access.perms)) return { ok: false, error: "Droit « Valider » sur Rapports requis." };
  const reason = input.reason?.trim() || null;
  if (!input.approve && !reason) return { ok: false, error: "Un motif est obligatoire." };
  const brandIds = access.scope === "ALL" ? null : access.brandIds;
  const actor = { id: access.user.id, name: access.user.name };
  const users = await listUsers();

  let assigned: { assigneeId: string; title: string; taskId: string } | null = null;
  const result = await db.transaction(async (tx): Promise<ReportDecisionResult> => {
    const found = await tx.execute<{ id: string; title: string; status: string; brand_id: string | null; sources: unknown }>(
      sql`select id::text as id, title, status, brand_id::text as brand_id, sources from ai_reports where id = ${input.reportId}::uuid for update`);
    const report = found.rows[0];
    if (!report) return { ok: false, error: "Ce rapport a été supprimé : la décision n'existe plus.", stale: true };
    const status = normalizeReportStatus(report.status);
    if (status !== "DRAFT") return { ok: false, error: status === "VALIDATED" ? "Ce rapport est déjà validé." : "Ce rapport a été archivé.", stale: true };
    const decision = decisionStates(report.sources).decisions.find((d) => d.id === input.decisionId);
    if (!decision) return { ok: false, error: "Cette décision ne figure plus dans le rapport.", stale: true };
    if (decision.outcome) {
      const o = decision.outcome;
      return { ok: false, error: `Déjà ${o.status === "APPROVED" ? "validée" : "refusée"}${o.byName ? ` par ${o.byName}` : ""}${o.at ? ` le ${fmtDate(o.at)}` : ""}.`, stale: true };
    }
    const brandId = decision.brandId ?? report.brand_id;
    if (brandIds && brandId && !brandIds.includes(brandId)) return { ok: false, error: "Cette décision porte sur une marque hors de votre périmètre." };

    let taskId: string | null = null;
    if (input.approve) {
      const owner = resolveOwner(decision.ownerRole, users);
      const description = [
        decision.why, "", `Résultat attendu : ${decision.expectedKpi}`,
        decision.amountMad !== null ? `Montant : ${Math.round(decision.amountMad).toLocaleString("fr-FR")} MAD` : null,
        `Revue prévue le ${fmtDate(decision.reviewDate)}`,
        owner ? null : `Responsable demandé par l'agent : ${decision.ownerRole} (aucun compte correspondant, tâche à attribuer)`,
        `Décision validée depuis le rapport « ${report.title} ».`,
      ].filter((l) => l !== null).join("\n");
      const task = await createTask({
        title: decision.title, description, dueDate: decision.dueDate, assigneeId: owner?.id ?? null, brandId, priority: "HIGH",
        source: "AI", sourceKey: reportTaskKey(report.id, decision.id), entityType: "report", entityId: report.id,
        expectedImpact: decision.expectedKpi.slice(0, 500), createdById: actor.id,
      }, tx);
      taskId = task.id;
      if (owner) assigned = { assigneeId: owner.id, title: decision.title, taskId: task.id };
    }

    const outcome: AgentOutcome = { status: input.approve ? "APPROVED" : "REJECTED", at: new Date().toISOString(), byId: actor.id, byName: actor.name, reason, taskId };
    const next = withOutcome(report.sources, status, decision.id, outcome);
    if (!next) return { ok: false, error: "Cette décision ne peut plus être tranchée.", stale: true };
    const validated = next.status === "VALIDATED";
    await tx.update(aiReports)
      .set(validated ? { sources: next.sources, status: "VALIDATED", validatedById: actor.id, validatedAt: new Date() } : { sources: next.sources })
      .where(eq(aiReports.id, report.id));
    await audit({
      actor, action: input.approve ? "VALIDATE" : "REJECT", module: "rapports", entity: "report_decision", entityId: report.id, label: decision.title,
      after: { decision: decision.id, status: outcome.status, reason, taskId, reportValidated: validated },
    }, tx);
    return { ok: true, taskId, reportValidated: validated };
  });

  const toNotify = assigned as { assigneeId: string; title: string; taskId: string } | null;
  if (result.ok && toNotify) await notifyTaskAssigned(toNotify.assigneeId, toNotify.title, toNotify.taskId, actor.id).catch((e) => console.error("Tâche de décision : notification", e));
  return result;
}
