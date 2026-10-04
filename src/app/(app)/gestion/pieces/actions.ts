"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clientInScope, hasFlag, isOwnOnly, requireAccessContext, requirePermission } from "@/lib/access";
import { errorParam, isUuid, str } from "@/lib/gestion/form";
import { DOC_TYPES, isOwnOrder, moduleOfType as moduleOf, type DocType } from "@/lib/gestion/documents-shared";
import {
  CommercialBlockError, cancelBL, cancelOrder, createBLFromOrder, renameDocumentClient, createCreditNote, createInvoiceFromBLs, deleteDraft, getDocument, markDelivered,
  requestApproval, saveDraft, validateDocument, type DraftInput,
} from "@/lib/gestion/documents";
import { storedPdf } from "@/lib/gestion/pdf";

function done(id?: string) {
  revalidatePath("/gestion/pieces");
  if (id) revalidatePath(`/gestion/pieces/${id}`);
}

async function docOrThrow(id: string | null) {
  if (!isUuid(id)) throw new Error("Pièce introuvable.");
  const d = await getDocument(id);
  if (!d) throw new Error("Pièce introuvable.");
  if (!(await clientInScope(d.clientId))) throw new Error("Accès refusé : ce client n'est pas dans votre périmètre.");
  if (d.type === "COMMANDE") await assertOwnOrder(d, (await requireAccessContext()).user.id);
  return d;
}

/** Portée « ses données » : un commercial n'agit que sur les commandes qu'il a saisies ou qui lui sont attribuées. */
async function assertOwnOrder(d: { createdById: string | null; salesRepId: string | null } | null, userId: string) {
  if (d && (await isOwnOnly()) && !isOwnOrder(d, userId)) throw new Error("Accès refusé : cette commande n'est pas la vôtre.");
}

/**
 * Validation + PDF figé. Le PDF est rendu hors transaction : s'il échoue, il sera rendu à la première ouverture.
 * Confirmer une commande client ne sort pas de stock : le droit « Créer » suffit (le commercial confirme
 * ce qu'il a saisi) ; BL, facture et avoir demandent « Valider ».
 */
async function validateAndRender(id: string, type: DocType, override: boolean) {
  const user = await requirePermission(moduleOf(type), type === "COMMANDE" ? "create" : "validate");
  if (override && !(await hasFlag("overrideCommercial"))) throw new Error("Accès refusé : le droit « Lever un blocage commercial » n'est pas activé sur votre compte.");
  const r = await validateDocument(id, { id: user.id, name: user.name }, { override });
  try {
    await storedPdf(id, user.id);
  } catch (e) {
    console.error("PDF de pièce", id, e);
  }
  return r;
}

export async function saveDocumentAction(fd: FormData) {
  let input: DraftInput;
  try {
    input = JSON.parse(str(fd, "payload") ?? "{}") as DraftInput;
  } catch {
    redirect(`/gestion/pieces?error=${encodeURIComponent("Formulaire illisible.")}`);
  }
  const type = input.type;
  const back = input.id ? `/gestion/pieces/${input.id}` : `/gestion/pieces/nouveau?type=${type}`;
  let id: string | null = input.id ?? null;
  let blocked = false;
  try {
    if (!DOC_TYPES.includes(type)) throw new Error("Type de pièce inconnu.");
    const user = await requirePermission(moduleOf(type), input.id ? "edit" : "create");
    if (!isUuid(input.clientId)) throw new Error("Choisissez un client.");
    if (!(await clientInScope(input.clientId))) throw new Error("Accès refusé : ce client n'est pas dans votre périmètre.");
    if (input.id) {
      const cur = await docOrThrow(input.id);
      if (cur.type !== type) throw new Error("Le type d'une pièce ne change pas.");
    }
    id = await saveDraft({ ...input, id: input.id ?? null }, { id: user.id, name: user.name });
    if (str(fd, "intent") === "validate") {
      try {
        await validateAndRender(id, type, false);
      } catch (e) {
        if (!(e instanceof CommercialBlockError)) throw e;
        blocked = true;
      }
    }
  } catch (e) {
    redirect(`${id ? `/gestion/pieces/${id}` : back}${id ? "?" : "&"}error=${errorParam(e)}`);
  }
  done(id!);
  redirect(`/gestion/pieces/${id}?${blocked ? "blocked=1" : "done=1"}`);
}

export async function validateDocumentAction(fd: FormData) {
  const id = str(fd, "id");
  let blocked = false;
  try {
    const d = await docOrThrow(id);
    try {
      await validateAndRender(d.id, d.type as DocType, str(fd, "override") === "1");
    } catch (e) {
      if (!(e instanceof CommercialBlockError)) throw e;
      blocked = true;
    }
  } catch (e) {
    redirect(`/gestion/pieces/${id}?error=${errorParam(e)}`);
  }
  done(id!);
  redirect(`/gestion/pieces/${id}?${blocked ? "blocked=1" : "validated=1"}`);
}

export async function requestApprovalAction(fd: FormData) {
  const id = str(fd, "id");
  try {
    const d = await docOrThrow(id);
    const user = await requirePermission(moduleOf(d.type as DocType), "edit");
    await requestApproval(d.id, { id: user.id, name: user.name });
  } catch (e) {
    redirect(`/gestion/pieces/${id}?error=${errorParam(e)}`);
  }
  done(id!);
  redirect(`/gestion/pieces/${id}?requested=1`);
}

export async function deleteDraftAction(fd: FormData) {
  const id = str(fd, "id");
  let type: DocType = "BL";
  try {
    const d = await docOrThrow(id);
    type = d.type as DocType;
    const user = await requirePermission(moduleOf(type), "edit");
    await deleteDraft(d.id, { id: user.id, name: user.name });
  } catch (e) {
    redirect(`/gestion/pieces/${id}?error=${errorParam(e)}`);
  }
  done();
  redirect(`/gestion/pieces?type=${type}`);
}

export async function deliverAction(fd: FormData) {
  const id = str(fd, "id");
  try {
    const d = await docOrThrow(id);
    const user = await requirePermission("livraisons", "edit");
    await markDelivered(d.id, { id: user.id, name: user.name });
  } catch (e) {
    redirect(`/gestion/pieces/${id}?error=${errorParam(e)}`);
  }
  done(id!);
  redirect(`/gestion/pieces/${id}?done=1`);
}

export async function cancelBLAction(fd: FormData) {
  const id = str(fd, "id");
  try {
    const d = await docOrThrow(id);
    const user = await requirePermission("livraisons", "validate");
    await cancelBL(d.id, str(fd, "reason") ?? "", { id: user.id, name: user.name });
  } catch (e) {
    redirect(`/gestion/pieces/${id}?error=${errorParam(e)}`);
  }
  done(id!);
  redirect(`/gestion/pieces/${id}?done=1`);
}

/** Commande confirmée → BL brouillon (lignes au reste à livrer), ouvert dans l'éditeur. */
export async function prepareBLAction(fd: FormData) {
  const orderId = str(fd, "id");
  let id: string;
  try {
    const order = await docOrThrow(orderId);
    const user = await requirePermission("livraisons", "create");
    id = await createBLFromOrder(order.id, { id: user.id, name: user.name });
  } catch (e) {
    redirect(`/gestion/pieces/${orderId}?error=${errorParam(e)}`);
  }
  done(id);
  redirect(`/gestion/pieces/${id}?done=1`);
}

export async function cancelOrderAction(fd: FormData) {
  const id = str(fd, "id");
  try {
    const d = await docOrThrow(id);
    const user = await requirePermission("commandes", "edit");
    await cancelOrder(d.id, str(fd, "reason") ?? "", { id: user.id, name: user.name });
  } catch (e) {
    redirect(`/gestion/pieces/${id}?error=${errorParam(e)}`);
  }
  done(id!);
  redirect(`/gestion/pieces/${id}?done=1`);
}

export async function invoiceBLsAction(fd: FormData) {
  const ids = fd.getAll("blIds").map(String).filter(isUuid);
  let id: string;
  try {
    const user = await requirePermission("facturation", "create");
    for (const blId of ids) await docOrThrow(blId);
    id = await createInvoiceFromBLs(ids, { id: user.id, name: user.name });
  } catch (e) {
    redirect(`/gestion/pieces/facturer?${str(fd, "client") ? `client=${str(fd, "client")}&` : ""}error=${errorParam(e)}`);
  }
  done(id);
  redirect(`/gestion/pieces/${id}?done=1`);
}

export async function creditNoteAction(fd: FormData) {
  const invoiceId = str(fd, "id");
  let id: string;
  try {
    const inv = await docOrThrow(invoiceId);
    const user = await requirePermission("facturation", "create");
    id = await createCreditNote(inv.id, { id: user.id, name: user.name });
  } catch (e) {
    redirect(`/gestion/pieces/${invoiceId}?error=${errorParam(e)}`);
  }
  done(id);
  redirect(`/gestion/pieces/${id}?done=1`);
}

/** Corrige le nom du client imprimé sur une pièce validée (droit Valider du module de la pièce), puis régénère le PDF. */
export async function renameClientAction(fd: FormData) {
  const id = str(fd, "id");
  try {
    const d = await docOrThrow(id);
    const user = await requirePermission(moduleOf(d.type as DocType), "validate");
    await renameDocumentClient(d.id, str(fd, "name") ?? "", str(fd, "reason") ?? "", { id: user.id, name: user.name });
    try { await storedPdf(d.id, user.id); } catch (e) { console.error("PDF de pièce", d.id, e); }
  } catch (e) {
    redirect(`/gestion/pieces/${id}?error=${errorParam(e)}`);
  }
  done(id!);
  redirect(`/gestion/pieces/${id}?done=1`);
}
