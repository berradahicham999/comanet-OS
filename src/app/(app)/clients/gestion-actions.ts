"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, clientInScope } from "@/lib/access";
import { SECTORS } from "@/lib/sectors";
import { bool, decimalOrNull, errorParam, intOrNull, isUuid, str } from "@/lib/gestion/form";
import { SCALE } from "@/lib/gestion/money";
import { getSettings } from "@/lib/settings";
import type { DuplicateCandidate } from "@/lib/gestion/clients-shared";
import {
  addDeliveryAddress, createClient, deleteClient, findDuplicates, removeDeliveryAddress, setBrandDiscount, setClientArchived,
  setClientBlocked, updateClientLegal, type ClientLegalInput, type ClientType,
} from "@/lib/gestion/clients";

/**
 * Fiche client de la gestion commerciale. Créer = « Créer » sur Clients ; identité et conditions =
 * « Modifier » ; archiver, bloquer, supprimer = « Valider ». Portée respectée (client assigné).
 */

const TYPES: ClientType[] = ["PHARMACIE", "PARAPHARMACIE", "GROSSISTE", "AUTRE"];

async function readClient(fd: FormData): Promise<ClientLegalInput> {
  const type = str(fd, "type") as ClientType | null;
  const sector = str(fd, "sector");
  const days = intOrNull(fd, "paymentDays", "Délai de paiement", 0, 365);
  const { gestion } = await getSettings();
  if (days !== null && days > gestion.maxPaymentDays) throw new Error(`Délai de paiement : ${days} jours dépasse le plafond réglé (${gestion.maxPaymentDays} jours).`);
  const accountManagerId = str(fd, "accountManagerId");
  return {
    name: str(fd, "name") ?? "",
    type: type && TYPES.includes(type) ? type : "AUTRE",
    city: str(fd, "city"),
    sector: sector && (SECTORS as readonly string[]).includes(sector) ? sector : null,
    phone: str(fd, "phone"),
    accountCode: str(fd, "accountCode"),
    legalName: str(fd, "legalName"),
    ice: str(fd, "ice"),
    ifNumber: str(fd, "ifNumber"),
    rc: str(fd, "rc"),
    patente: str(fd, "patente"),
    billingAddress: str(fd, "billingAddress"),
    postalCode: str(fd, "postalCode"),
    email: str(fd, "email"),
    contactName: str(fd, "contactName"),
    accountManagerId: isUuid(accountManagerId) ? accountManagerId : null,
    defaultDiscountPct: decimalOrNull(fd, "defaultDiscountPct", "Remise par défaut", SCALE.pct, { min: 0, maxExclusive: 100 }),
    paymentModeKey: str(fd, "paymentModeKey"),
    paymentDays: days,
    creditLimit: decimalOrNull(fd, "creditLimit", "Plafond d'encours", SCALE.money, { min: 0 }),
  };
}

const actor = (u: { id: string; name: string }) => ({ id: u.id, name: u.name });

function done(id: string) {
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  revalidatePath("/gestion");
}

/** Doublons probables pendant la saisie (appelé depuis le formulaire de création). */
export async function checkClientDuplicates(input: { name: string; legalName?: string; ice?: string; phone?: string; city?: string }): Promise<DuplicateCandidate[]> {
  await requirePermission("clients", "create");
  if (!input.name?.trim() && !input.ice?.trim() && !input.phone?.trim()) return [];
  return (await findDuplicates(input)).slice(0, 8);
}

export async function createClientAction(fd: FormData) {
  const user = await requirePermission("clients", "create");
  let id: string;
  try {
    const input = await readClient(fd);
    if (!bool(fd, "confirmNotDuplicate")) {
      const dups = await findDuplicates(input);
      if (dups.length) throw new Error(`Client déjà présent ? ${dups.slice(0, 3).map((d) => `${d.name} (${d.reasons.join(", ")})`).join(" ; ")}. Cochez « Ce n'est aucun de ces clients » pour créer quand même.`);
    }
    id = await createClient(input, actor(user));
  } catch (e) {
    redirect(`/clients/nouveau?error=${errorParam(e)}`);
  }
  revalidatePath("/clients");
  redirect(`/clients/${id}?tab=infos&done=cree`);
}

async function guard(action: "edit" | "validate", fd: FormData) {
  const user = await requirePermission("clients", action);
  const id = str(fd, "id");
  if (!isUuid(id)) throw new Error("Client introuvable.");
  if (!(await clientInScope(id))) throw new Error("Ce client n'est pas dans votre portée.");
  return { user, id };
}

export async function saveClientLegalAction(fd: FormData) {
  const { user, id } = await guard("edit", fd);
  try {
    await updateClientLegal(id, await readClient(fd), actor(user));
  } catch (e) {
    redirect(`/clients/${id}?tab=infos&error=${errorParam(e)}`);
  }
  done(id);
  redirect(`/clients/${id}?tab=infos&done=1`);
}

export async function blockClientAction(fd: FormData) {
  const { user, id } = await guard("validate", fd);
  try {
    await setClientBlocked(id, fd.get("blocked") === "1", str(fd, "reason"), actor(user));
  } catch (e) {
    redirect(`/clients/${id}?tab=infos&error=${errorParam(e)}`);
  }
  done(id);
  redirect(`/clients/${id}?tab=infos`);
}

export async function archiveClientAction(fd: FormData) {
  const { user, id } = await guard("validate", fd);
  await setClientArchived(id, fd.get("archive") === "1", actor(user));
  done(id);
  redirect(`/clients/${id}?tab=infos`);
}

export async function deleteClientAction(fd: FormData) {
  const { user, id } = await guard("validate", fd);
  if (str(fd, "confirm") !== "SUPPRIMER") redirect(`/clients/${id}?tab=infos&error=${encodeURIComponent("Tapez SUPPRIMER pour confirmer la suppression définitive.")}`);
  try {
    await deleteClient(id, actor(user));
  } catch (e) {
    redirect(`/clients/${id}?tab=infos&error=${errorParam(e)}`);
  }
  revalidatePath("/clients");
  redirect("/clients");
}

export async function addAddressAction(fd: FormData) {
  const { user, id } = await guard("edit", fd);
  try {
    await addDeliveryAddress(id, { label: str(fd, "label") ?? "", address: str(fd, "address") ?? "", city: str(fd, "city"), isDefault: bool(fd, "isDefault") }, actor(user));
  } catch (e) {
    redirect(`/clients/${id}?tab=infos&error=${errorParam(e)}`);
  }
  done(id);
  redirect(`/clients/${id}?tab=infos#livraison`);
}

export async function removeAddressAction(fd: FormData) {
  const { user, id } = await guard("edit", fd);
  const addressId = str(fd, "addressId");
  if (isUuid(addressId)) await removeDeliveryAddress(id, addressId, actor(user));
  done(id);
  redirect(`/clients/${id}?tab=infos#livraison`);
}

export async function brandDiscountAction(fd: FormData) {
  const { user, id } = await guard("edit", fd);
  const brandId = str(fd, "brandId");
  try {
    if (!isUuid(brandId)) throw new Error("Choisissez une marque.");
    const pct = fd.get("remove") ? null : decimalOrNull(fd, "pct", "Remise", SCALE.pct, { min: 0, maxExclusive: 100 });
    if (!fd.get("remove") && pct === null) throw new Error("Indiquez la remise en %.");
    await setBrandDiscount(id, brandId, pct, actor(user));
  } catch (e) {
    redirect(`/clients/${id}?tab=infos&error=${errorParam(e)}`);
  }
  done(id);
  redirect(`/clients/${id}?tab=infos#remises`);
}
