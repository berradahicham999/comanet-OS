"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { regulatoryFiles, regulatoryEvents, documents, type RegulatoryStatus } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { regulatoryKey, VARIANT_TYPES, type VariantType } from "@/lib/regulatory";
import { iso, today } from "@/lib/format";

function str(formData: FormData, k: string) {
  const v = String(formData.get(k) ?? "").trim();
  return v || null;
}

export async function saveRegulatoryFile(formData: FormData) {
  const user = await requireAccess("reglementaire");
  const id = String(formData.get("id") ?? "");
  const d = (k: string) => str(formData, k);
  const variantType = (d("variantType") ?? "MODELE_VENTE") as VariantType;
  const reference = d("reference") ?? "Dossier";
  const values = {
    productId: d("productId"),
    brandId: d("brandId"),
    dossier: d("dossier") ?? `Enregistrement DMP — ${VARIANT_TYPES[variantType]}`,
    reference,
    variantType,
    size: d("size"),
    packaging: d("packaging"),
    documentType: d("documentType") ?? "ATD",
    authorizationNumber: d("authorizationNumber"),
    filingDate: d("filingDate"),
    validationDate: d("validationDate"),
    expiryDate: d("expiryDate"),
    status: (d("status") ?? "EN_COURS") as RegulatoryStatus,
    certificateStatus: d("certificateStatus") ?? "A_DEMANDER",
    certificateNumber: d("certificateNumber"),
    certificateDate: d("certificateDate"),
    physicalProduct: formData.get("physicalProduct") === "" ? null : formData.get("physicalProduct") === "true",
    blocked: formData.get("blocked") === "on",
    blockedReason: d("blockedReason"),
    missingDocuments: d("missingDocuments"),
    responsibleId: d("responsibleId"),
    notes: d("notes"),
    updatedAt: new Date(),
  };
  if (!values.brandId && values.productId) {
    const p = await db.query.products.findFirst({ where: (pr, { eq }) => eq(pr.id, values.productId!) });
    values.brandId = p?.brandId ?? null;
  }
  const brandName = values.brandId
    ? (await db.query.brands.findFirst({ where: (b, { eq }) => eq(b.id, values.brandId!) }))?.name ?? null
    : null;
  const dedupeKey = regulatoryKey({ brand: brandName, reference, variantType, size: values.size });

  if (id) {
    const before = await db.query.regulatoryFiles.findFirst({ where: eq(regulatoryFiles.id, id) });
    await db.update(regulatoryFiles).set({ ...values, dedupeKey }).where(eq(regulatoryFiles.id, id));
    // Trace les étapes clés dans l'historique.
    if (before && values.certificateStatus === "OBTENU" && before.certificateStatus !== "OBTENU") {
      await db.insert(regulatoryEvents).values({
        fileId: id, date: values.certificateDate ?? iso(today()), kind: "CE",
        label: "Certificat d'enregistrement obtenu", reference: values.certificateNumber, userId: user.id,
      });
    }
    if (before && values.blocked && !before.blocked) {
      await db.insert(regulatoryEvents).values({ fileId: id, date: iso(today()), kind: "BLOCAGE", label: "Dossier bloqué", notes: values.blockedReason, userId: user.id });
    }
    revalidatePath(`/reglementaire/${id}`);
    revalidatePath("/reglementaire");
  } else {
    const [row] = await db.insert(regulatoryFiles).values({ ...values, dedupeKey }).returning();
    if (values.filingDate) {
      await db.insert(regulatoryEvents).values({ fileId: row.id, date: values.filingDate, kind: "DEPOT", label: "Dépôt DMP", reference: values.authorizationNumber, expiryDate: values.expiryDate, userId: user.id });
    }
    revalidatePath("/reglementaire");
    redirect(`/reglementaire/${row.id}`);
  }
}

/**
 * Redépôt : archive le dépôt courant dans l'historique et installe les nouvelles dates.
 * C'est l'opération à utiliser à chaque renouvellement — l'ancien ATD reste consultable.
 */
export async function registerRenewal(formData: FormData) {
  const user = await requireAccess("reglementaire");
  const id = String(formData.get("id") ?? "");
  const filingDate = str(formData, "newFilingDate");
  const expiryDate = str(formData, "newExpiryDate");
  const authorizationNumber = str(formData, "newAuthorizationNumber");
  const notes = str(formData, "renewalNotes");
  if (!id || !filingDate) return;
  const before = await db.query.regulatoryFiles.findFirst({ where: eq(regulatoryFiles.id, id) });
  if (!before) return;
  if (before.filingDate) {
    await db.insert(regulatoryEvents).values({
      fileId: id, date: before.filingDate, kind: "DEPOT", label: "Dépôt précédent",
      reference: before.authorizationNumber, expiryDate: before.expiryDate,
      notes: "Archivé lors du redépôt.", userId: user.id,
    });
  }
  await db.insert(regulatoryEvents).values({
    fileId: id, date: filingDate, kind: "RENOUVELLEMENT", label: "Redépôt DMP",
    reference: authorizationNumber, expiryDate, notes, userId: user.id,
  });
  await db.update(regulatoryFiles).set({
    filingDate, expiryDate, authorizationNumber: authorizationNumber ?? before.authorizationNumber,
    status: "VALIDE", certificateStatus: before.certificateStatus === "OBTENU" ? "A_DEMANDER" : before.certificateStatus,
    updatedAt: new Date(),
  }).where(eq(regulatoryFiles.id, id));
  revalidatePath(`/reglementaire/${id}`);
  revalidatePath("/reglementaire");
}

export async function addRegulatoryNote(formData: FormData) {
  const user = await requireAccess("reglementaire");
  const id = String(formData.get("id") ?? "");
  const notes = str(formData, "note");
  if (!id || !notes) return;
  await db.insert(regulatoryEvents).values({ fileId: id, date: iso(today()), kind: "NOTE", label: "Note", notes, userId: user.id });
  revalidatePath(`/reglementaire/${id}`);
}

export async function deleteRegulatoryFile(formData: FormData) {
  await requireAccess("reglementaire");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(regulatoryFiles).where(eq(regulatoryFiles.id, id));
  revalidatePath("/reglementaire");
  redirect("/reglementaire");
}

export async function addDocument(formData: FormData) {
  const user = await requireAccess("taches");
  const entityType = String(formData.get("entityType") ?? "");
  const entityId = String(formData.get("entityId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  if (!entityType || !entityId || !name || !url) return;
  await db.insert(documents).values({ entityType, entityId, name, url, uploadedById: user.id });
  revalidatePath(String(formData.get("path") ?? "/"));
}
