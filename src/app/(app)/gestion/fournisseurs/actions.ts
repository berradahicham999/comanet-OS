"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { bool, errorParam, intOrNull, isUuid, str } from "@/lib/gestion/form";
import {
  SUPPLIER_NATURES, createSupplier, deleteSupplier, setSupplierArchived, supplierDuplicates, updateSupplier,
  type SupplierInput, type SupplierNature,
} from "@/lib/gestion/suppliers";

function readSupplier(fd: FormData): SupplierInput {
  const nature = str(fd, "nature") as SupplierNature | null;
  return {
    code: str(fd, "code"),
    legalName: str(fd, "legalName") ?? "",
    nature: nature && nature in SUPPLIER_NATURES ? nature : "MARCHANDISES",
    ice: str(fd, "ice"), ifNumber: str(fd, "ifNumber"), rc: str(fd, "rc"),
    country: str(fd, "country") ?? "Maroc",
    currency: (str(fd, "currency") ?? "MAD").toUpperCase(),
    address: str(fd, "address"), city: str(fd, "city"), contactName: str(fd, "contactName"), email: str(fd, "email"), phone: str(fd, "phone"),
    paymentDays: intOrNull(fd, "paymentDays", "Délai de paiement", 0, 365),
    paymentModeKey: str(fd, "paymentModeKey"),
    notes: str(fd, "notes"),
    brandIds: fd.getAll("brandIds").map(String).filter(isUuid),
  };
}

function done(id?: string) {
  revalidatePath("/gestion/fournisseurs");
  if (id) revalidatePath(`/gestion/fournisseurs/${id}`);
}

export async function createSupplierAction(fd: FormData) {
  const user = await requirePermission("achats", "create");
  let id: string;
  try {
    const input = readSupplier(fd);
    if (!bool(fd, "confirmDuplicate")) {
      const dups = await supplierDuplicates(input.legalName, input.ice);
      if (dups.length) throw new Error(`Fournisseur déjà présent (${dups.map((d) => `${d.legalName} — ${d.reason}`).join(" ; ")}). Cochez « Créer quand même » si ce n'est pas le même.`);
    }
    id = await createSupplier(input, { id: user.id, name: user.name });
  } catch (e) {
    redirect(`/gestion/fournisseurs/nouveau?error=${errorParam(e)}`);
  }
  done(id);
  redirect(`/gestion/fournisseurs/${id}?done=1`);
}

export async function updateSupplierAction(fd: FormData) {
  const user = await requirePermission("achats", "edit");
  const id = str(fd, "id");
  if (!isUuid(id)) return;
  try {
    await updateSupplier(id, readSupplier(fd), { id: user.id, name: user.name });
  } catch (e) {
    redirect(`/gestion/fournisseurs/${id}?error=${errorParam(e)}`);
  }
  done(id);
  redirect(`/gestion/fournisseurs/${id}?done=1`);
}

export async function archiveSupplierAction(fd: FormData) {
  const user = await requirePermission("achats", "validate");
  const id = str(fd, "id");
  if (!isUuid(id)) return;
  await setSupplierArchived(id, fd.get("archive") === "1", { id: user.id, name: user.name });
  done(id);
  redirect(`/gestion/fournisseurs/${id}`);
}

export async function deleteSupplierAction(fd: FormData) {
  const user = await requirePermission("achats", "validate");
  const id = str(fd, "id");
  if (!isUuid(id)) return;
  if (str(fd, "confirm") !== "SUPPRIMER") redirect(`/gestion/fournisseurs/${id}?error=${encodeURIComponent("Tapez SUPPRIMER pour confirmer la suppression définitive.")}`);
  try {
    await deleteSupplier(id, { id: user.id, name: user.name });
  } catch (e) {
    redirect(`/gestion/fournisseurs/${id}?error=${errorParam(e)}`);
  }
  done();
  redirect("/gestion/fournisseurs");
}
