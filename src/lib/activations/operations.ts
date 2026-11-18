import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pgArray } from "@/lib/sql-array";
import {
  activations, activationBrands, activationProducts, activationClients, activationContributors, activationBudgetLines,
  activationChecklistItems, activationStatusHistory, activationMaterials, clients,
} from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { activationRefs, defaultActivationStatusKey } from "./refs";
import { syncActivationExpenses } from "./budget";
import { transitionActivation } from "./workflow";
import { consumeMaterial } from "./inventory";
import { cleanPlannedMaterials, closeTarget, operationLaunchTarget, requalifyTarget, type ActivationRefs } from "./shared";

/**
 * Opérations de terrain (décision d'Hicham, 18/11/2026). Une opération EST une activation : même table, même workflow,
 * même budget par poste, même matériel. Ce module ajoute seulement ce que le terrain exige :
 *  - `createOperation()` : création en un geste (type, client, marques, produits, date, offre, goodies prévus, budget
 *    facultatif), puis départ immédiat par `transitionActivation()` — « Planifiée » sous le seuil, « à valider » au-dessus ;
 *  - `requalifyAfterBudgetChange()` : une opération partie seule dont le budget passe le seuil retourne à la direction ;
 *  - `reportOperation()` : compte rendu (pharmacies touchées, commandes DÉCLARÉES, goodies réellement utilisés, remarque)
 *    et clôture. Les goodies sortent du stock par `consumeMaterial()`, sans nouvelle dépense (charge à l'achat).
 * `insertActivation()` et `setActivationLinks()` sont aussi la création et les liaisons du bureau : une seule écriture.
 */
export type Actor = { id: string; name: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Links = { brandIds: string[]; productIds: string[]; clientIds: string[]; contributorIds?: string[] };

/** Liaisons N-N : la liste complète, et le premier élément comme « principal » sur la ligne. */
export async function setActivationLinks(id: string, l: Links, tx?: Tx) {
  const run = async (t: Tx) => {
    await t.delete(activationBrands).where(eq(activationBrands.activationId, id));
    if (l.brandIds.length) await t.insert(activationBrands).values(l.brandIds.map((brandId) => ({ activationId: id, brandId })));
    await t.delete(activationProducts).where(eq(activationProducts.activationId, id));
    if (l.productIds.length) await t.insert(activationProducts).values(l.productIds.map((productId) => ({ activationId: id, productId })));
    await t.delete(activationClients).where(eq(activationClients.activationId, id));
    if (l.clientIds.length) await t.insert(activationClients).values(l.clientIds.map((clientId) => ({ activationId: id, clientId })));
    if (l.contributorIds) {
      await t.delete(activationContributors).where(eq(activationContributors.activationId, id));
      if (l.contributorIds.length) await t.insert(activationContributors).values(l.contributorIds.map((userId) => ({ activationId: id, userId })));
    }
    await t.update(activations).set({ brandId: l.brandIds[0] ?? null, productId: l.productIds[0] ?? null, clientId: l.clientIds[0] ?? null }).where(eq(activations.id, id));
  };
  return tx ? run(tx) : db.transaction(run);
}

type ActivationValues = typeof activations.$inferInsert;

/**
 * Création d'une activation, statut initial du référentiel : ligne, liaisons, postes prévus, checklist et historique dans
 * une transaction, puis reflet budgétaire. Utilisée par le formulaire du bureau et par la création de terrain.
 */
export async function insertActivation(input: {
  values: Omit<ActivationValues, "status" | "createdById">;
  links: Links;
  budgetLines?: { costItemKey: string; label: string; planned: number; brandId: string | null; sort: number }[];
  checklist?: { label: string; sort: number }[];
  historyComment: string;
}, actor: Actor): Promise<{ id: string; status: string }> {
  const status = await defaultActivationStatusKey();
  const id = await db.transaction(async (tx) => {
    const [row] = await tx.insert(activations).values({ ...input.values, status, createdById: actor.id }).returning({ id: activations.id });
    await setActivationLinks(row.id, input.links, tx);
    const lines = (input.budgetLines ?? []).filter((l) => l.planned > 0 || l.label);
    if (lines.length) await tx.insert(activationBudgetLines).values(lines.map((l) => ({ activationId: row.id, costItemKey: l.costItemKey, label: l.label, planned: String(l.planned), brandId: l.brandId, sort: l.sort })));
    if (input.checklist?.length) await tx.insert(activationChecklistItems).values(input.checklist.map((c) => ({ activationId: row.id, label: c.label, sort: c.sort })));
    await tx.insert(activationStatusHistory).values({ activationId: row.id, fromStatus: null, toStatus: status, userId: actor.id, comment: input.historyComment });
    return row.id;
  });
  await syncActivationExpenses(id);
  return { id, status };
}

/** Poste d'un budget saisi d'un seul montant : le premier poste reflété de la catégorie par défaut du type, sinon « Autre ». */
export function defaultCostItemKey(refs: Pick<ActivationRefs, "types" | "costItems">, typeKey: string): string | null {
  const cat = refs.types.find((t) => t.key === typeKey)?.defaultBudgetCategory;
  const usable = refs.costItems.filter((c) => c.active && c.reflectsExpense !== false);
  return usable.find((c) => c.budgetCategory === cat)?.key ?? usable.find((c) => c.key === "AUTRE")?.key ?? usable[0]?.key ?? null;
}

/** Poste « Offre / UG » : le poste actif qui n'est pas reflété en dépense. */
export function offerCostItemKey(refs: Pick<ActivationRefs, "costItems">): string | null {
  return refs.costItems.find((c) => c.active && c.reflectsExpense === false)?.key ?? null;
}

export type OperationInput = {
  typeKey: string;
  clientId: string | null;
  brandIds: string[];
  productIds: string[];
  date: string;
  endDate?: string | null;
  offerLabel?: string | null;
  plannedMaterials?: unknown;
  /** Budget prévu hors offre (MAD), facultatif. */
  budget?: number | null;
  /** Coût de l'offre / UG (MAD), facultatif : chiffré au budget, compté dans le seuil, jamais reflété en dépense. */
  offerCost?: number | null;
  name?: string | null;
  notes?: string | null;
};

export class OperationError extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const money = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };

/**
 * Création d'une opération de terrain et départ immédiat : « Planifiée » si le budget prévu (offre comprise) ne dépasse
 * pas `settings.activations.autoApproveMax`, sinon en attente de la direction. La personne en est la pilote.
 */
export async function createOperation(input: OperationInput, actor: Actor, opts: { isValidator: boolean }): Promise<{ id: string; status: string; needsValidation: boolean }> {
  const refs = await activationRefs();
  const type = refs.types.find((t) => t.key === input.typeKey && t.active);
  if (!type) throw new OperationError("Type d'opération inconnu.");
  if (!ISO_DATE.test(input.date)) throw new OperationError("Date invalide.");
  if (!input.brandIds.length) throw new OperationError("Choisissez au moins une marque.");
  const client = input.clientId ? (await db.select({ id: clients.id, name: clients.name, city: clients.city }).from(clients).where(eq(clients.id, input.clientId)))[0] : null;
  if (input.clientId && !client) throw new OperationError("Client introuvable.");

  const budget = money(input.budget), offerCost = money(input.offerCost);
  const lines: { costItemKey: string; label: string; planned: number; brandId: string | null; sort: number }[] = [];
  if (budget > 0) {
    const key = defaultCostItemKey(refs, type.key);
    if (!key) throw new OperationError("Aucun poste budgétaire actif : à créer dans Paramètres → Opérations.");
    lines.push({ costItemKey: key, label: refs.costItems.find((c) => c.key === key)!.label, planned: budget, brandId: input.brandIds[0], sort: 0 });
  }
  if (offerCost > 0) {
    const key = offerCostItemKey(refs);
    if (!key) throw new OperationError("Le poste « Offre / UG » est introuvable ou désactivé (Paramètres → Opérations).");
    lines.push({ costItemKey: key, label: input.offerLabel?.trim() ? `Offre : ${input.offerLabel.trim()}`.slice(0, 120) : refs.costItems.find((c) => c.key === key)!.label, planned: offerCost, brandId: input.brandIds[0], sort: lines.length });
  }

  const name = input.name?.trim() || `${type.label}${client ? ` — ${client.name}` : ""}`;
  const { id, status } = await insertActivation({
    values: {
      name: name.slice(0, 200), type: type.key, date: input.date, endDate: input.endDate && ISO_DATE.test(input.endDate) && input.endDate >= input.date ? input.endDate : null,
      city: client?.city ?? null, place: client?.name ?? null, responsibleId: actor.id, notes: input.notes?.trim() || null,
      offerLabel: input.offerLabel?.trim().slice(0, 200) || null, plannedMaterials: cleanPlannedMaterials(input.plannedMaterials),
    },
    links: { brandIds: input.brandIds, productIds: input.productIds, clientIds: client ? [client.id] : [] },
    budgetLines: lines,
    checklist: type.defaultChecklist.map((label, i) => ({ label, sort: i })),
    historyComment: "Création depuis le terrain",
  }, actor);

  const settings = await getSettings();
  const planned = lines.reduce((a, l) => a + l.planned, 0);
  const target = operationLaunchTarget(refs, status, planned, settings.activations.autoApproveMax);
  if (!target) return { id, status, needsValidation: false };
  const res = await transitionActivation(id, target.to, actor, target.needsValidation ? `Budget prévu ${Math.round(planned)} MAD, au-dessus du seuil de ${Math.round(settings.activations.autoApproveMax)} MAD : validation de la direction demandée.` : null, opts);
  if (!res.ok) throw new OperationError(res.reason);
  return { id, status: target.to, needsValidation: target.needsValidation };
}

/**
 * Après une modification du budget par quelqu'un qui ne valide pas : une opération partie seule et désormais au-dessus du
 * seuil repart en validation. Renvoie le nouveau statut, ou `null` si rien ne change.
 */
export async function requalifyAfterBudgetChange(id: string, actor: Actor, opts: { isValidator: boolean }): Promise<string | null> {
  if (opts.isValidator) return null;
  const [a] = await db.select({ status: activations.status }).from(activations).where(eq(activations.id, id));
  if (!a) return null;
  const [{ planned }] = (await db.execute<{ planned: number }>(sql`select coalesce(sum(planned), 0)::float8 as planned from activation_budget_lines where activation_id = ${id}::uuid`)).rows;
  const max = (await getSettings()).activations.autoApproveMax;
  const to = requalifyTarget(await activationRefs(), a.status, planned, max);
  if (!to) return null;
  const res = await transitionActivation(id, to, actor, `Budget prévu porté à ${Math.round(planned)} MAD, au-dessus du seuil de ${Math.round(max)} MAD : validation de la direction demandée.`, opts);
  return res.ok ? to : null;
}

export type OperationReport = {
  pharmaciesReached?: number | null;
  ordersOnSite?: number | null;
  ordersAmount?: number | null;
  remark?: string | null;
  /** Goodies réellement utilisés ; obligatoire (même vide, « 0 ») quand des goodies étaient prévus. */
  materialsUsed?: { itemId: string; quantity: number }[] | null;
  close?: boolean;
};

const intOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null);

/**
 * Compte rendu d'une opération : résultats DÉCLARÉS (jamais présentés comme des ventes mesurées), goodies sortis du stock
 * (`consumeMaterial()` : mouvement + ligne valorisée, aucune dépense), puis clôture si demandée. Rien n'est obligatoire,
 * sauf les goodies utilisés quand des goodies étaient prévus. Les goodies ne se déclarent qu'une fois par compte rendu :
 * une correction se fait depuis la fiche (retour en stock).
 */
export async function reportOperation(id: string, r: OperationReport, actor: Actor, opts: { isValidator: boolean; date: string }): Promise<{ status: string; closed: boolean }> {
  const [a] = await db.select({ status: activations.status, planned: activations.plannedMaterials }).from(activations).where(eq(activations.id, id));
  if (!a) throw new OperationError("Opération introuvable.");
  const used = r.materialsUsed == null ? null : cleanPlannedMaterials(r.materialsUsed);
  if (a.planned.length > 0 && used === null) throw new OperationError("Indiquez les goodies réellement utilisés (0 si aucun).");
  if (used?.length) {
    const already = await db.select({ id: activationMaterials.id }).from(activationMaterials).where(eq(activationMaterials.activationId, id)).limit(1);
    if (already.length) throw new OperationError("Des goodies sont déjà déclarés pour cette opération : corrigez-les depuis la fiche.");
    for (const m of used) await consumeMaterial({ activationId: id, itemId: m.itemId, quantity: m.quantity, date: opts.date, userId: actor.id });
  }
  const amount = r.ordersAmount == null || !Number.isFinite(Number(r.ordersAmount)) || Number(r.ordersAmount) < 0 ? null : String(Math.round(Number(r.ordersAmount) * 100) / 100);
  const values = { pharmaciesReached: intOrNull(r.pharmaciesReached), ordersOnSite: intOrNull(r.ordersOnSite), ordersAmount: amount, results: r.remark?.trim().slice(0, 2000) || null };
  await db.update(activations).set({ ...values, resultsAt: new Date(), updatedAt: new Date() }).where(eq(activations.id, id));

  if (!r.close) return { status: a.status, closed: false };
  const refs = await activationRefs();
  if (refs.statuses.find((s) => s.key === a.status)?.isDone) return { status: a.status, closed: true };
  const to = closeTarget(refs, a.status);
  if (!to) throw new OperationError("Cette opération ne peut pas encore être clôturée : elle attend la validation de la direction, ou elle est annulée.");
  const res = await transitionActivation(id, to, actor, "Compte rendu de terrain", opts);
  if (!res.ok) throw new OperationError(res.reason);
  return { status: to, closed: true };
}

export type MyOperation = {
  id: string; name: string; type: string; typeLabel: string; date: string; endDate: string | null; status: string; statusLabel: string; tone: string;
  clientName: string | null; city: string | null; offerLabel: string | null; planned: number; awaitingValidation: boolean; validated: boolean; done: boolean;
  plannedMaterials: { itemId: string; quantity: number; name: string; unit: string }[]; hasReport: boolean; materialsDeclared: boolean;
};

/**
 * Les opérations d'une personne (pilote ou créatrice), ouvertes : à venir, et passées à clôturer. Pour l'accueil mobile.
 */
export async function myOperations(userId: string, todayIso: string): Promise<{ upcoming: MyOperation[]; toClose: MyOperation[] }> {
  const r = await db.execute<Omit<MyOperation, "plannedMaterials"> & { plannedMaterials: { itemId: string; quantity: number }[] }>(sql`
    select a.id, a.name, a.type, t.label as "typeLabel", a.date::text as date, a.end_date::text as "endDate", a.status, s.label as "statusLabel", s.tone,
      c.name as "clientName", a.city, a.offer_label as "offerLabel",
      coalesce((select sum(l.planned) from activation_budget_lines l where l.activation_id = a.id), 0)::float8 as planned,
      s.awaiting_validation as "awaitingValidation", s.is_validated as validated, s.is_done as done,
      a.planned_materials as "plannedMaterials", a.results_at is not null as "hasReport",
      exists (select 1 from activation_materials m where m.activation_id = a.id) as "materialsDeclared"
    from activations a join activation_statuses s on s.key = a.status join activation_types t on t.key = a.type
    left join clients c on c.id = a.client_id
    where (a.responsible_id = ${userId}::uuid or a.created_by_id = ${userId}::uuid)
      and not s.is_cancelled and not s.is_archived and not s.is_done
      and a.date >= ${todayIso}::date - 60
    order by a.date, a.created_at`);
  const ids = [...new Set(r.rows.flatMap((x) => x.plannedMaterials.map((m) => m.itemId)))];
  const items = ids.length ? new Map((await db.execute<{ id: string; name: string; unit: string }>(sql`select id::text, name, unit from inventory_items where id = any(${pgArray(ids)})`)).rows.map((i) => [i.id, i])) : new Map();
  const rows: MyOperation[] = r.rows.map((x) => ({ ...x, plannedMaterials: x.plannedMaterials.map((m) => ({ ...m, name: items.get(m.itemId)?.name ?? "Article retiré", unit: items.get(m.itemId)?.unit ?? "pièce" })) }));
  return {
    upcoming: rows.filter((x) => (x.endDate ?? x.date) >= todayIso),
    toClose: rows.filter((x) => (x.endDate ?? x.date) < todayIso),
  };
}
