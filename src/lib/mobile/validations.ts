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
import type { ValidationDecision, ValidationItem } from "./validations-shared";

/**
 * File unique de validation du téléphone de la direction. Elle ne décide de rien : elle rassemble les trois files existantes et
 * passe par les seules écritures autorisées (`transition()`, `transitionActivation()`, `validateDocument()`), qui revérifient chacune les droits.
 * Les dépenses se valident par leur activation : c'est elle qui engage le budget, poste par poste (migration 0044, Activations).
 */
const ISO = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

async function contents(): Promise<ValidationItem[]> {
  const [refs, scope] = await Promise.all([contentRefs(), brandFilter()]);
  const keys = contentValidationKeys(refs);
  if (!keys.validate) return [];
  const items = await validationQueue(scope);
  const allowed = new Map<string, boolean>();
  for (const b of new Set(items.map((i) => i.brandId))) allowed.set(b, await canValidateBrand(b));
  return items.filter((i) => allowed.get(i.brandId)).map((i) => ({
    kind: "CONTENU", id: i.id, title: i.title, context: `Contenu · ${i.brand} · ${ISO(i.date)}`,
    detail: i.caption?.slice(0, 400) ?? null, lines: [], amountMad: null, href: `/marketing/planning/${i.id}`, refuseLabel: "À corriger",
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
    detail: i.description?.slice(0, 400) ?? null, lines: i.lines.map((l) => `${l.label} : ${Math.round(Number(l.planned)).toLocaleString("fr-FR")} MAD`),
    amountMad: Number(i.planned), href: `/marketing/activations/${i.id}`, refuseLabel: "À corriger",
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
    out.push({
      kind: "PIECE", id, title: d.client.name, context: `${DOC_TYPE_LABELS[d.type as DocType].one} bloqué · ${ISO(d.date)}`,
      detail: issues.map((i) => i.label).join(" "), lines: [], amountMad: Number(d.ttc), href: `/gestion/pieces/${id}`, refuseLabel: "Refuser",
    });
  }
  return out;
}

export async function listValidations(access: Access): Promise<ValidationItem[]> {
  const [c, a, p] = await Promise.all([contents(), activations(), pieces(access)]);
  return [...p, ...a, ...c];
}

export type DecisionResult = { ok: true } | { ok: false; error: string };

export async function decideValidation(access: Access, d: ValidationDecision): Promise<DecisionResult> {
  const actor = access.user;
  const comment = d.comment?.trim() || null;
  if (d.decision === "KO" && !comment) return { ok: false, error: "Un motif est obligatoire." };

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
    if (!doc) return { ok: false, error: "Pièce introuvable." };
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
  return { ok: false, error: "Type inconnu." };
}
