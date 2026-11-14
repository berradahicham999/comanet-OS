import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { brandFilter, isAdmin, type Access } from "@/lib/access";
import { activationScope, canValidateActivation } from "@/lib/activations/access";
import { activationRefs } from "@/lib/activations/refs";
import { activationValidationQueue } from "@/lib/activations/queries";
import { activationValidationKeys } from "@/lib/activations/shared";
import { transitionActivation } from "@/lib/activations/workflow";
import { contentRefs } from "@/lib/content/refs";
import { validationQueue } from "@/lib/content/queries";
import { contentValidationKeys } from "@/lib/content/shared";
import { canValidateBrand, transition } from "@/lib/content/workflow";
import { DOC_TYPE_LABELS, moduleOfType, type DocType } from "@/lib/gestion/documents-shared";
import { CommercialBlockError, declineApproval, documentIssues, getDocument } from "@/lib/gestion/documents";
import { validateAndRender } from "@/lib/gestion/validate-render";
import { can } from "@/lib/permissions-shared";
import { decideReportDecision, draftReports } from "@/lib/ai/report-decisions";
import { setReportStatus } from "@/lib/ai/reports";
import { buildUnifiedDecisions, findDecision } from "@/lib/decisions/build";
import { decisionScopeFor } from "@/lib/decisions/server";
import { approveDecision, rejectDecision } from "@/lib/decisions/store";
import { DECISION_STATUS, DOMAIN_LABELS } from "@/lib/decisions/types";
import { addDays, fmtDate, iso } from "@/lib/format";
import { oneLine, sortValidations, splitAgentId, type DecisionResult, type ValidationDecision, type ValidationItem } from "./shared";

/**
 * File unique « À décider » de la direction, lue par le téléphone (/m/validations) ET le Cockpit. Elle ne décide de rien :
 * elle rassemble les files existantes et passe par les seules écritures autorisées, qui revérifient chacune les droits —
 * `transition()` (contenu), `transitionActivation()` (dépense), `validateAndRender()` (pièce bloquée),
 * `decideReportDecision()` / `setReportStatus()` (rapport d'agent), `approveDecision()` / `rejectDecision()` (décision marketing).
 * Les dépenses se valident par leur activation : c'est elle qui engage le budget, poste par poste (migration 0044, Activations).
 */
const ISO = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const mad = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} MAD`;

async function contents(): Promise<ValidationItem[]> {
  const [refs, scope] = await Promise.all([contentRefs(), brandFilter()]);
  const keys = contentValidationKeys(refs);
  if (!keys.validate) return [];
  const items = await validationQueue(scope);
  const allowed = new Map<string, boolean>();
  for (const b of new Set(items.map((i) => i.brandId))) allowed.set(b, await canValidateBrand(b));
  return items.filter((i) => allowed.get(i.brandId)).map((i) => ({
    kind: "CONTENU", id: i.id, title: i.title, context: `Contenu · ${i.brand} · ${ISO(i.date)}`,
    why: `Publication prévue le ${ISO(i.date)}${i.platform ? ` sur ${i.platform}` : ""} : à valider avant diffusion.`,
    detail: i.caption?.slice(0, 400) ?? null, lines: [], amountMad: null, dueDate: i.date.slice(0, 10), href: `/marketing/planning/${i.id}`, refuseLabel: "À corriger", needsReason: true,
  }));
}

async function activations(): Promise<ValidationItem[]> {
  const [refs, scope] = await Promise.all([activationRefs(), activationScope()]);
  const keys = activationValidationKeys(refs);
  if (!keys.validate) return [];
  const items = await activationValidationQueue(scope);
  const canAll = await canValidateActivation(null);
  const allowed = new Map<string, boolean>();
  for (const b of new Set(items.map((i) => i.brandId).filter((x): x is string => !!x))) allowed.set(b, await canValidateActivation(b));
  return items.filter((i) => canAll || (i.brandId && allowed.get(i.brandId))).map((i) => ({
    kind: "ACTIVATION", id: i.id, title: i.name, context: `Dépense · activation · ${i.brand ?? "Sans marque"} · ${ISO(i.date)}${i.city ? ` · ${i.city}` : ""}`,
    why: oneLine(i.description) ?? `Valider engage ${i.lines.length} poste${i.lines.length > 1 ? "s" : ""} du budget pour leur montant prévu.`,
    detail: i.description?.slice(0, 400) ?? null, lines: i.lines.map((l) => `${l.label} : ${mad(Number(l.planned))}`),
    amountMad: Number(i.planned), dueDate: i.date.slice(0, 10), href: `/marketing/activations/${i.id}`, refuseLabel: "À corriger", needsReason: true,
  }));
}

async function pieces(access: Access): Promise<ValidationItem[]> {
  if (!access.flags.overrideCommercial) return [];
  const rows = await db.execute<{ id: string }>(sql`
    select id::text as id from sales_documents where status = 'BROUILLON' and approval_requested_at is not null order by approval_requested_at limit 30`);
  const out: ValidationItem[] = [];
  for (const { id } of rows.rows) {
    const d = await getDocument(id);
    if (!d || !can(access.perms, moduleOfType(d.type as DocType), d.type === "COMMANDE" ? "create" : "validate")) continue;
    const issues = await documentIssues(d);
    const detail = issues.map((i) => i.label).join(" ");
    out.push({
      kind: "PIECE", id, title: d.client.name, context: `${DOC_TYPE_LABELS[d.type as DocType].one} bloqué · ${ISO(d.date)}`,
      why: oneLine(detail), detail, lines: [], amountMad: Number(d.ttc), dueDate: d.date.slice(0, 10), href: `/gestion/pieces/${id}`, refuseLabel: "Refuser", needsReason: true,
    });
  }
  return out;
}

/**
 * Rapports d'agents en brouillon : une ligne par décision encore à trancher (`sources.decisions[]`), ou une seule ligne
 * « Rapport à lire » quand le rapport ne porte aucune décision lisible. Droit : « Valider » sur Rapports.
 */
async function agentReports(access: Access): Promise<ValidationItem[]> {
  if (!can(access.perms, "rapports", "validate") && !isAdmin(access.perms)) return [];
  const reports = await draftReports(await brandFilter());
  const out: ValidationItem[] = [];
  for (const r of reports) {
    const brand = r.brandName ?? "COMANET";
    if (!r.hasDecisions) {
      out.push({
        kind: "RAPPORT", id: r.id, title: r.title, context: `Rapport · ${r.typeLabel} · ${brand} · reçu le ${fmtDate(r.createdAt)}`,
        why: r.ignored > 0 ? `${r.ignored} décision${r.ignored > 1 ? "s" : ""} illisible${r.ignored > 1 ? "s" : ""} dans ce rapport (contrat non respecté) : à lire en entier.` : "Rapport sans décision structurée : à lire, puis valider ou archiver.",
        detail: null, lines: [], amountMad: null, dueDate: null, href: `/rapports/${r.id}`, refuseLabel: "Archiver", needsReason: false,
      });
      continue;
    }
    for (const d of r.pending) {
      out.push({
        kind: "DECISION_AGENT", id: `${r.id}:${d.id}`, title: d.title, context: `Décision d'agent · ${r.typeLabel} · ${brand}`,
        why: oneLine(d.why), detail: `Résultat attendu : ${d.expectedKpi}`,
        lines: [`Responsable proposé : ${d.ownerRole}`, `Revue le ${fmtDate(d.reviewDate)}`, `Rapport : ${r.title}`],
        amountMad: d.amountMad, dueDate: d.dueDate, href: `/rapports/${r.id}`, refuseLabel: "Refuser", needsReason: true,
      });
    }
  }
  return out;
}

/** Décisions unifiées encore proposées, de priorité critique ou haute. « Ne pas pousser » n'appelle pas d'action : hors file. */
async function marketingDecisions(access: Access): Promise<ValidationItem[]> {
  if (!can(access.perms, "marketing", "create")) return [];
  const scope = await decisionScopeFor(null);
  const set = await buildUnifiedDecisions(scope);
  return set.proposed.filter((d) => d.priority === "CRITICAL" || d.priority === "HIGH").map((d) => ({
    kind: "DECISION", id: d.id, title: d.title, context: `Décision marketing · ${DOMAIN_LABELS[d.domain]} · ${d.brandName ?? "Sans marque"}`,
    why: oneLine(d.why[0] ?? d.action), detail: d.action,
    lines: [d.impact ? `Impact attendu : ${d.impact}` : null, `Priorité : ${d.priority === "CRITICAL" ? "critique" : "haute"}`, `Revue le ${fmtDate(d.expectedReviewDate)}`].filter((l): l is string => !!l),
    amountMad: d.amount, dueDate: iso(addDays(scope.ctx.now, d.task.dueInDays)),
    href: `/marketing/priorites${d.brandId ? `?brand=${d.brandId}` : ""}`, refuseLabel: "Refuser", needsReason: true,
  }));
}

/** Une source en panne (connexion Meta, règle en erreur) ne vide pas la file : elle est journalisée et les autres restent. */
async function safe(label: string, load: () => Promise<ValidationItem[]>): Promise<ValidationItem[]> {
  try { return await load(); } catch (e) { console.error(`À décider : ${label} indisponible`, e); return []; }
}

export async function listValidations(access: Access): Promise<ValidationItem[]> {
  const parts = await Promise.all([
    safe("pièces", () => pieces(access)), safe("activations", activations), safe("contenus", contents),
    safe("rapports d'agents", () => agentReports(access)), safe("décisions marketing", () => marketingDecisions(access)),
  ]);
  return sortValidations(parts.flat());
}

export type { DecisionResult };

async function decideMarketing(access: Access, d: ValidationDecision, comment: string | null): Promise<DecisionResult> {
  const actor = { id: access.user.id, name: access.user.name };
  if (!can(access.perms, "marketing", d.decision === "OK" ? "create" : "edit")) return { ok: false, error: "Accès refusé." };
  const scope = await decisionScopeFor(null);
  const dec = await findDecision(scope, d.id);
  if (!dec) return { ok: false, error: "Cette recommandation n'est plus d'actualité : les données ont changé depuis l'affichage.", stale: true };
  if (dec.status !== "PROPOSED") {
    const by = dec.state?.decidedBy ? ` par ${dec.state.decidedBy}` : "";
    return { ok: false, error: `Décision déjà ${DECISION_STATUS[dec.status].label.toLowerCase()}${by}.`, stale: true };
  }
  if (d.decision === "KO") { await rejectDecision(dec, comment, actor); return { ok: true }; }
  if (!dec.brandId) return { ok: false, error: "Cette décision ne porte pas sur une marque : ouvrez-la pour choisir la marque de l'action." };
  // Mêmes valeurs par défaut que le formulaire de Priorités : la tâche et le délai proposés par le moteur, aucun budget inventé.
  await approveDecision(dec, { title: dec.task.title, priority: dec.priority, dueDate: iso(addDays(scope.ctx.now, dec.task.dueInDays)), budgetPlanned: dec.amount ?? 0 }, actor);
  return { ok: true };
}

export async function decideValidation(access: Access, d: ValidationDecision): Promise<DecisionResult> {
  const actor = access.user;
  if (access.preview) return { ok: false, error: "Prévisualisation : lecture seule." };
  const comment = d.comment?.trim() || null;
  // Archiver un rapport lu n'est pas un refus : c'est le seul « non » sans motif.
  if (d.decision === "KO" && !comment && d.kind !== "RAPPORT") return { ok: false, error: "Un motif est obligatoire." };

  if (d.kind === "CONTENU") {
    const keys = contentValidationKeys(await contentRefs());
    const to = d.decision === "OK" ? keys.validate : keys.correct;
    if (!to) return { ok: false, error: "Transition non configurée." };
    const r = await transition(d.id, to, actor, comment);
    return r.ok ? { ok: true } : { ok: false, error: r.reason };
  }
  if (d.kind === "ACTIVATION") {
    const keys = activationValidationKeys(await activationRefs());
    const to = d.decision === "OK" ? keys.validate : keys.correct;
    if (!to) return { ok: false, error: "Transition non configurée." };
    const r = await transitionActivation(d.id, to, actor, comment);
    return r.ok ? { ok: true } : { ok: false, error: r.reason };
  }
  if (d.kind === "PIECE") {
    const doc = await getDocument(d.id);
    if (!doc) return { ok: false, error: "Pièce introuvable.", stale: true };
    try {
      if (d.decision === "OK") await validateAndRender(d.id, doc.type as DocType, true);
      else {
        if (!access.flags.overrideCommercial && !isAdmin(access.perms)) return { ok: false, error: "Accès refusé." };
        await declineApproval(d.id, comment!, { id: actor.id, name: actor.name });
      }
      return { ok: true };
    } catch (e) {
      if (e instanceof CommercialBlockError) return { ok: false, error: "Blocage commercial non levé." };
      return { ok: false, error: e instanceof Error ? e.message : "Validation impossible." };
    }
  }
  if (d.kind === "DECISION_AGENT") {
    const ref = splitAgentId(d.id);
    if (!ref) return { ok: false, error: "Décision illisible." };
    const r = await decideReportDecision({ reportId: ref.reportId, decisionId: ref.decisionId, approve: d.decision === "OK", reason: comment });
    return r.ok ? { ok: true } : { ok: false, error: r.error, stale: r.stale };
  }
  if (d.kind === "RAPPORT") {
    const r = await setReportStatus(d.id, d.decision === "OK" ? "VALIDATED" : "ARCHIVED");
    return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Rapport non modifié.", stale: r.stale };
  }
  if (d.kind === "DECISION") {
    try { return await decideMarketing(access, d, comment); }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Décision impossible." }; }
  }
  return { ok: false, error: "Type inconnu." };
}

/** Pages à rafraîchir après une décision, quel que soit l'écran qui l'a prise. */
export const VALIDATION_PATHS = ["/", "/a-decider", "/marketing/planning", "/marketing/activations", "/gestion/pieces", "/rapports", "/taches", "/marketing", "/marketing/priorites", "/actions"];
