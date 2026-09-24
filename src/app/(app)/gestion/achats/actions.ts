"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccessContext, can } from "@/lib/access";
import { storeAsset } from "@/lib/content/assets";
import { errorParam, isUuid, str } from "@/lib/gestion/form";
import {
  cancelOrder, closeOrder, createInvoiceFromReceptions, createReceptionFromOrder, createReturnFromReception,
  deletePurchaseDraft, getPurchase, savePurchaseDraft, validatePurchase, type PurchaseInput,
} from "@/lib/gestion/purchases";
import { PURCHASE_TYPES, type PurchaseType } from "@/lib/gestion/purchases-shared";
import { storedPurchasePdf } from "@/lib/gestion/purchase-pdf";
import type { PermissionAction } from "@/lib/permissions-shared";

/**
 * Droits : le module Achats pour tout ; la réception et le retour (gestes de magasin) sont aussi
 * ouverts au module Stock — le modèle « Magasin » réceptionne sans voir les factures fournisseurs.
 */
async function requirePurchase(type: PurchaseType, action: PermissionAction) {
  const a = await requireAccessContext();
  if (a.preview) throw new Error("Prévisualisation : lecture seule. Quittez la prévisualisation pour agir.");
  const modules = type === "RECEPTION" || type === "RETOUR" ? (["achats", "stock"] as const) : (["achats"] as const);
  if (!modules.some((m) => can(a.perms, m, action))) throw new Error(`Accès refusé : droit « ${action === "validate" ? "Valider" : action === "edit" ? "Modifier" : "Créer"} » requis sur ${modules.length > 1 ? "Achats ou Stock" : "Achats"}.`);
  return { id: a.user.id, name: a.user.name };
}

function done(id?: string) {
  revalidatePath("/gestion/achats");
  if (id) revalidatePath(`/gestion/achats/${id}`);
}

async function renderPdf(id: string, userId: string) {
  try {
    await storedPurchasePdf(id, userId);
  } catch (e) {
    console.error("PDF d'achat", id, e);
  }
}

export async function savePurchaseAction(fd: FormData) {
  let input: PurchaseInput;
  try {
    input = JSON.parse(str(fd, "payload") ?? "{}") as PurchaseInput;
  } catch {
    redirect(`/gestion/achats?error=${encodeURIComponent("Formulaire illisible.")}`);
  }
  const type = input.type;
  let id: string | null = input.id ?? null;
  try {
    if (!PURCHASE_TYPES.includes(type)) throw new Error("Type de pièce inconnu.");
    if (!isUuid(input.supplierId)) throw new Error("Choisissez un fournisseur.");
    const actor = await requirePurchase(type, input.id ? "edit" : "create");
    if (input.id) {
      const cur = await getPurchase(input.id);
      if (!cur || cur.type !== type) throw new Error("Pièce introuvable.");
    }
    id = await savePurchaseDraft({ ...input, id: input.id ?? null }, actor);
    if (str(fd, "intent") === "validate") {
      const v = await requirePurchase(type, "validate");
      await validatePurchase(id, v);
      await renderPdf(id, v.id!);
    }
  } catch (e) {
    redirect(id ? `/gestion/achats/${id}?error=${errorParam(e)}` : `/gestion/achats/nouveau?type=${type}&error=${errorParam(e)}`);
  }
  done(id!);
  redirect(`/gestion/achats/${id}?done=1`);
}

async function withDoc(fd: FormData, f: (doc: NonNullable<Awaited<ReturnType<typeof getPurchase>>>) => Promise<string | void>) {
  const id = str(fd, "id");
  let target: string | void;
  try {
    if (!isUuid(id)) throw new Error("Pièce introuvable.");
    const doc = await getPurchase(id);
    if (!doc) throw new Error("Pièce introuvable.");
    target = await f(doc);
  } catch (e) {
    redirect(`/gestion/achats/${id}?error=${errorParam(e)}`);
  }
  done(id!);
  if (target) done(target);
  redirect(`/gestion/achats/${target || id}?done=1`);
}

export async function validatePurchaseAction(fd: FormData) {
  await withDoc(fd, async (d) => {
    const actor = await requirePurchase(d.type as PurchaseType, "validate");
    await validatePurchase(d.id, actor);
    await renderPdf(d.id, actor.id!);
  });
}

export async function deletePurchaseAction(fd: FormData) {
  let type = "COMMANDE";
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new Error("Pièce introuvable.");
    const d = await getPurchase(id);
    if (!d) throw new Error("Pièce introuvable.");
    type = d.type;
    await deletePurchaseDraft(d.id, await requirePurchase(d.type as PurchaseType, "edit"));
  } catch (e) {
    redirect(`/gestion/achats/${id}?error=${errorParam(e)}`);
  }
  done();
  redirect(`/gestion/achats?type=${type}`);
}

export async function receiveOrderAction(fd: FormData) {
  await withDoc(fd, async (d) => createReceptionFromOrder(d.id, await requirePurchase("RECEPTION", "create")));
}

export async function returnReceptionAction(fd: FormData) {
  await withDoc(fd, async (d) => createReturnFromReception(d.id, await requirePurchase("RETOUR", "create")));
}

export async function closeOrderAction(fd: FormData) {
  await withDoc(fd, async (d) => { await closeOrder(d.id, str(fd, "reason") ?? "", await requirePurchase("COMMANDE", "validate")); });
}

export async function cancelOrderAction(fd: FormData) {
  await withDoc(fd, async (d) => { await cancelOrder(d.id, str(fd, "reason") ?? "", await requirePurchase("COMMANDE", "validate")); });
}

export async function invoiceReceptionsAction(fd: FormData) {
  const ids = fd.getAll("receptionIds").map(String).filter(isUuid);
  let id: string;
  try {
    id = await createInvoiceFromReceptions(ids, await requirePurchase("FACTURE", "create"));
  } catch (e) {
    redirect(`/gestion/achats/facturer?${str(fd, "supplier") ? `supplier=${str(fd, "supplier")}&` : ""}error=${errorParam(e)}`);
  }
  done(id);
  redirect(`/gestion/achats/${id}?done=1`);
}

/** Pièce du fournisseur (sa facture en PDF, son BL scanné) rattachée à la pièce d'achat. */
export async function attachSupplierFileAction(fd: FormData) {
  await withDoc(fd, async (d) => {
    const actor = await requirePurchase(d.type as PurchaseType, "edit");
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Choisissez un fichier.");
    if (file.size > 3.5 * 1024 * 1024) throw new Error("Fichier trop lourd (3,5 Mo au plus) : compressez le PDF ou scannez en qualité document.");
    if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type)) throw new Error("PDF, PNG, JPEG ou WEBP uniquement.");
    await storeAsset({ owner: { purchaseDocumentId: d.id }, kind: "FACTURE", name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()), uploadedById: actor.id });
  });
}

