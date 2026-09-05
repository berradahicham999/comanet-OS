"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { regulatoryFiles, documents, type RegulatoryStatus } from "@/db/schema";
import { requireAccess } from "@/lib/access";

export async function saveRegulatoryFile(formData: FormData) {
  await requireAccess("reglementaire");
  const id = String(formData.get("id") ?? "");
  const d = (k: string) => String(formData.get(k) ?? "").trim() || null;
  const values = {
    productId: d("productId"),
    brandId: d("brandId"),
    dossier: d("dossier") ?? "Dossier",
    authorizationNumber: d("authorizationNumber"),
    filingDate: d("filingDate"),
    validationDate: d("validationDate"),
    expiryDate: d("expiryDate"),
    status: (d("status") ?? "EN_COURS") as RegulatoryStatus,
    missingDocuments: d("missingDocuments"),
    responsibleId: d("responsibleId"),
    notes: d("notes"),
  };
  if (!values.brandId && values.productId) {
    const p = await db.query.products.findFirst({ where: (pr, { eq }) => eq(pr.id, values.productId!) });
    values.brandId = p?.brandId ?? null;
  }
  if (id) {
    await db.update(regulatoryFiles).set(values).where(eq(regulatoryFiles.id, id));
    revalidatePath(`/reglementaire/${id}`);
    revalidatePath("/reglementaire");
  } else {
    const [row] = await db.insert(regulatoryFiles).values(values).returning();
    revalidatePath("/reglementaire");
    redirect(`/reglementaire/${row.id}`);
  }
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
