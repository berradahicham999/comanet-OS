import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { animations, clientStockReadings, doctorVisits, salesDocuments } from "@/db/schema";
import type { Access } from "@/lib/access";
import { can } from "@/lib/permissions-shared";
import { ANIMATION_ERRORS } from "@/lib/animations-shared";
import { parseAnimationInput } from "@/lib/terrain/animation-input";
import { saveAnimation } from "@/lib/terrain/save-animation";
import { canRecordReading, parseReadingLines } from "@/lib/client-stock-shared";
import { recordReadings } from "@/lib/client-stock";
import { iso, today } from "@/lib/format";
import { personaOf } from "./persona";
import { formDataFromPairs, readReport } from "@/lib/medical/report-input";
import { saveVisitReport } from "@/lib/medical/visits";
import { baseUnitPriceHt } from "@/lib/gestion/calc";
import { defaultDiscount } from "@/lib/gestion/documents-shared";
import { DuplicateOrderError, saveDraft } from "@/lib/gestion/documents";
import { editorData } from "@/lib/gestion/editor";
import { notify } from "@/lib/content/notify";
import { alignedDeviceTime, dateInWindow, gpsColumns, isUuid, rawLines } from "./mutations-shared";
import type { AnimationPayload, MutationCode, MutationResult, OrderDraftPayload, StockPayload, VisitReportPayload, WireEvent } from "./outbox-shared";

/**
 * Enregistrement des saisies de la file hors connexion. Ne décide de rien sur le métier : la validation reste
 * `parseAnimationInput()` et `parseReadingLines()`, l'écriture `saveAnimation()` et `recordReadings()`, comme depuis
 * le bureau. Ce module ajoute seulement ce qu'une file exige : rejouer une saisie ne crée jamais rien.
 *
 * Doublon ou conflit ? Même `client_event_id` = la même saisie renvoyée, c'est un succès. Même point de vente, même jour,
 * même animatrice sous un AUTRE identifiant = une autre saisie : c'est un conflit, que la personne tranche.
 */
const ko = (clientEventId: string, code: MutationCode, message: string, existingId?: string): MutationResult => ({ clientEventId, ok: false, code, message, existingId });

const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return (x?.code ?? x?.cause?.code) === "23505";
};

async function saveAnimationEvent(access: Access, e: WireEvent): Promise<{ result: MutationResult; eventId?: string | null }> {
  const id = e.clientEventId;
  if (!can(access.perms, "terrain", "create")) return { result: ko(id, "FORBIDDEN", "Vous n'avez plus le droit de saisir une animation.") };

  const replay = async () => (await db.select({ id: animations.id }).from(animations).where(eq(animations.clientEventId, id)))[0];
  const known = await replay();
  if (known) return { result: { clientEventId: id, ok: true, id: known.id, replayed: true } };

  const p = e.payload as AnimationPayload;
  if (!isUuid(p?.clientId)) return { result: ko(id, "INVALID", ANIMATION_ERRORS.client) };
  if (!dateInWindow(p.date, iso(today()))) return { result: ko(id, "INVALID", "Date de saisie trop ancienne ou dans le futur.") };

  const parsed = parseAnimationInput({
    clientId: p.clientId,
    date: p.date,
    startDate: p.startDate ?? "",
    days: "",
    status: "DONE",
    animatriceId: access.user.id,
    brandId: "",
    cost: "",
    durationHours: "",
    customersAdvised: String(p.customersAdvised ?? ""),
    samples: String(p.samples ?? ""),
    comment: String(p.comment ?? "").slice(0, 2000),
    photoUrl: "",
    lines: rawLines(p.lines),
  });
  if (!parsed.ok) return { result: ko(id, "INVALID", ANIMATION_ERRORS[parsed.error] ?? "Saisie invalide.") };

  try {
    const saved = await saveAnimation({
      id: null,
      parsed: parsed.value,
      actor: { id: access.user.id, name: access.user.name },
      mobile: { clientEventId: id, deviceTime: alignedDeviceTime(e.deviceTime, e.sentAt, new Date()), ...gpsColumns(e.gps) },
    });
    if (!saved.ok) {
      if (saved.error === "doublon") {
        // La clé métier est prise : par une autre saisie (conflit) ou par ce même envoi, arrivé juste avant sur le réseau.
        const same = await replay();
        if (same) return { result: { clientEventId: id, ok: true, id: same.id, replayed: true } };
        return { result: ko(id, "CONFLICT", "Une saisie existe déjà pour ce point de vente et ce jour.", saved.existingId) };
      }
      return { result: ko(id, "INVALID", ANIMATION_ERRORS[saved.error] ?? "Saisie invalide.") };
    }
    const warnings = [saved.missingPrice && "prix", saved.overlaps > 0 && "chevauchement"].filter((w): w is string => !!w);
    return { result: { clientEventId: id, ok: true, id: saved.animationId, warnings }, eventId: saved.eventId };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Deux envois simultanés de la même saisie (réseau instable) : le second perd la course, le premier a écrit.
    const again = await replay();
    if (again) return { result: { clientEventId: id, ok: true, id: again.id, replayed: true } };
    return { result: ko(id, "CONFLICT", "Une saisie existe déjà pour ce point de vente et ce jour.") };
  }
}

async function saveStockEvent(access: Access, e: WireEvent): Promise<{ result: MutationResult }> {
  const id = e.clientEventId;
  const p = e.payload as StockPayload;
  if (!isUuid(p?.clientId)) return { result: ko(id, "INVALID", "Point de vente manquant ou inconnu.") };
  // Même table, deux canaux : l'animatrice relève en animation, le commercial en tournée (droits propres à chaque canal).
  const channel = personaOf(access.perms, access.scope) === "ANIMATRICE" ? "ANIMATION" : "TOURNEE_COMMERCIALE";
  const allowed = canRecordReading(
    { userId: access.user.id, perms: access.perms, scope: access.scope, clientIds: access.clientIds },
    { channel, clientId: p.clientId, animatriceId: access.user.id },
  );
  if (!allowed) return { result: ko(id, "FORBIDDEN", "Vous n'avez plus le droit de relever ce stock.") };

  const known = await db.select({ n: sql<number>`count(*)::int` }).from(clientStockReadings).where(and(eq(clientStockReadings.clientEventId, id)));
  if ((known[0]?.n ?? 0) > 0) return { result: { clientEventId: id, ok: true, replayed: true } };

  if (!dateInWindow(p.date, iso(today()))) return { result: ko(id, "INVALID", "Date de relevé trop ancienne ou dans le futur.") };
  const parsed = parseReadingLines(rawLines(p.lines).map((l) => ({ productId: l.productId, qty: l.qty, changed: true })), true);
  if (!parsed.ok) return { result: ko(id, "INVALID", "Quantité invalide : un nombre entier positif ou nul.") };
  await recordReadings({
    clientId: p.clientId,
    userId: access.user.id,
    channel,
    readAt: p.date,
    comment: String(p.comment ?? "").trim().slice(0, 500) || null,
    clientEventId: id,
    lines: parsed.lines,
  });
  return { result: { clientEventId: id, ok: true } };
}

/**
 * Compte rendu rempli sans réseau. La visite peut ne pas être encore arrivée : son démarrage attend peut-être dans la file
 * des visites. On répond alors WAIT, et le compte rendu repart au prochain passage, sans jamais être perdu.
 */
async function saveReportEvent(access: Access, e: WireEvent): Promise<{ result: MutationResult }> {
  const id = e.clientEventId;
  if (!can(access.perms, "medical", "create")) return { result: ko(id, "FORBIDDEN", "Vous n'avez plus le droit de saisir un compte rendu.") };
  const done = await db.select({ id: doctorVisits.id }).from(doctorVisits).where(eq(doctorVisits.reportClientEventId, id));
  if (done[0]) return { result: { clientEventId: id, ok: true, id: done[0].id, replayed: true } };

  const p = e.payload as VisitReportPayload;
  let visitId = isUuid(p?.visitId) ? p.visitId : null;
  if (!visitId && p?.startRef) {
    const r = await db.execute<{ visit_id: string | null }>(sql`select visit_id::text as visit_id from visit_events where client_event_id = ${String(p.startRef)} limit 1`);
    visitId = r.rows[0]?.visit_id ?? null;
  }
  if (!visitId) return { result: ko(id, "WAIT", "La visite n'est pas encore arrivée.") };
  const visit = (await db.select({ delegateId: doctorVisits.delegateId, status: doctorVisits.status }).from(doctorVisits).where(eq(doctorVisits.id, visitId)))[0];
  if (!visit) return { result: ko(id, "INVALID", "Visite introuvable.") };
  if (access.scope === "OWN" && visit.delegateId !== access.user.id) return { result: ko(id, "FORBIDDEN", "Cette visite n'est pas la vôtre.") };
  if (visit.status === "EN_COURS") return { result: ko(id, "WAIT", "La fin de visite n'est pas encore arrivée.") };

  const res = await saveVisitReport(visitId, readReport(formDataFromPairs(p.fields), access.user.id));
  if (!res.ok) return { result: ko(id, "INVALID", res.message ?? "Compte rendu refusé.") };
  await db.update(doctorVisits).set({ reportClientEventId: id }).where(eq(doctorVisits.id, visitId));
  return { result: { clientEventId: id, ok: true, id: visitId } };
}

/**
 * Commande prise sans réseau : elle devient un BROUILLON, au prix public et à la remise habituelle du client. La personne la
 * confirme ensuite depuis le téléphone : c'est à ce moment que plafond de crédit, remises et stock sont contrôlés.
 */
async function saveOrderEvent(access: Access, e: WireEvent): Promise<{ result: MutationResult }> {
  const id = e.clientEventId;
  if (!can(access.perms, "commandes", "create")) return { result: ko(id, "FORBIDDEN", "Vous n'avez plus le droit de prendre une commande.") };
  const replay = async () => (await db.select({ id: salesDocuments.id }).from(salesDocuments).where(eq(salesDocuments.clientEventId, id)))[0];
  const known = await replay();
  if (known) return { result: { clientEventId: id, ok: true, id: known.id, replayed: true } };

  const p = e.payload as OrderDraftPayload;
  if (!isUuid(p?.clientId)) return { result: ko(id, "INVALID", "Client manquant.") };
  if (access.scope !== "ALL" && !access.clientIds.includes(p.clientId)) return { result: ko(id, "FORBIDDEN", "Ce client n'est pas dans votre périmètre.") };
  if (!dateInWindow(p.date, iso(today()))) return { result: ko(id, "INVALID", "Date de commande trop ancienne ou dans le futur.") };

  const data = await editorData({ clientIds: [p.clientId] });
  const client = data.clients.find((c) => c.id === p.clientId);
  if (!client) return { result: ko(id, "INVALID", "Client introuvable ou archivé.") };
  const byId = new Map(data.products.map((x) => [x.id, x]));
  const lines = [];
  for (const l of rawLines(p.lines)) {
    const product = byId.get(l.productId);
    if (!product) return { result: ko(id, "INVALID", "Un produit de la commande n'est plus au catalogue.") };
    const unitPriceHt = baseUnitPriceHt(product.publicPriceTtc, product.taxRate);
    if (unitPriceHt === null) return { result: ko(id, "INVALID", `Prix manquant pour ${product.name}.`) };
    lines.push({ productId: l.productId, quantity: l.qty, unitPriceHt, discountPct: defaultDiscount(client.defaultDiscountPct, product.brandId ? client.brandDiscounts[product.brandId] ?? null : null) });
  }
  if (!lines.length) return { result: ko(id, "INVALID", "Commande sans produit.") };

  const actor = { id: access.user.id, name: access.user.name };
  try {
    const docId = await saveDraft({
      id: null, type: "COMMANDE", clientId: p.clientId, date: p.date, site: data.sites[0], deliveryAddress: null, salesRepId: access.user.id,
      paymentModeKey: client.paymentModeKey ?? null, globalDiscountPct: "0", notes: String(p.notes ?? "").trim().slice(0, 1000) || null, clientEventId: id, lines,
    }, actor);
    await notify([access.user.id], { type: "ORDER_DRAFT", title: `Commande à confirmer — ${client.name}`, body: "Saisie sans réseau : vérifiez-la et confirmez.", href: `/gestion/pieces/${docId}`, entityType: "sales_document", entityId: docId });
    return { result: { clientEventId: id, ok: true, id: docId } };
  } catch (err) {
    if (err instanceof DuplicateOrderError) {
      const same = await replay();
      if (same) return { result: { clientEventId: id, ok: true, id: same.id, replayed: true } };
      return { result: ko(id, "CONFLICT", "Une commande vient d'être créée pour ce client.", err.existingId) };
    }
    if (!isUniqueViolation(err)) throw err;
    const again = await replay();
    if (again) return { result: { clientEventId: id, ok: true, id: again.id, replayed: true } };
    throw err;
  }
}

/** Applique une saisie. Une erreur inattendue ne bloque pas les suivantes : la saisie reste en file et sera renvoyée. */
export async function applyMutation(access: Access, e: WireEvent): Promise<{ result: MutationResult; eventId?: string | null }> {
  const id = String(e?.clientEventId ?? "");
  if (!isUuid(id) && !/^[0-9a-z-]{16,64}$/i.test(id)) return { result: ko(id, "INVALID", "Saisie illisible.") };
  // Téléphone partagé : une saisie n'est jamais enregistrée au nom de la session en cours si elle vient d'un autre compte.
  if (e.userId !== access.user.id) return { result: ko(id, "WRONG_USER", "Saisie d'un autre compte.") };
  try {
    if (e.kind === "ANIMATION") return await saveAnimationEvent(access, e);
    if (e.kind === "STOCK") return await saveStockEvent(access, e);
    if (e.kind === "VISIT_REPORT") return await saveReportEvent(access, e);
    if (e.kind === "ORDER_DRAFT") return await saveOrderEvent(access, e);
    return { result: ko(id, "INVALID", "Type de saisie inconnu.") };
  } catch (err) {
    console.error("mobile/mutations", err);
    return { result: ko(id, "SERVER", "Erreur du serveur : nouvel essai automatique.") };
  }
}
