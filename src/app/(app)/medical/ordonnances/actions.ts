"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, canDo } from "@/lib/access";
import {
  resolveDoctor, createDoctorFromLabel, ignoreLabel, resolveProduct, resolvePharmacy, undoAutoMatch,
} from "@/lib/medical/prescription-resolution";

/** Résoudre la file des ordonnances = « Valider » sur Médical (décision qui engage les analyses). */
async function guard() {
  const user = await requireAccess("medical");
  if (!(await canDo("medical", "validate"))) redirect("/medical");
  return { id: user.id, name: user.name };
}

/** Une option de liste « Libellé [abcd1234] » → identifiant complet (préfixe unique dans la table). */
async function idFromPick(table: "doctors" | "products" | "clients", pick: string): Promise<string | null> {
  const m = /\[([0-9a-f]{8})\]\s*$/i.exec(pick.trim()) ?? /^([0-9a-f-]{36})$/i.exec(pick.trim());
  if (!m) return null;
  const prefix = m[1].toLowerCase();
  const r = await db.execute<{ id: string }>(sql`select id from ${sql.raw(table)} where id::text like ${prefix + "%"} limit 2`);
  return r.rows.length === 1 ? r.rows[0].id : null;
}

function done(msg: string, tab = "medecins") {
  revalidatePath("/medical/ordonnances");
  redirect(`/medical/ordonnances?tab=${tab}&ok=${encodeURIComponent(msg)}`);
}

export async function resolveDoctorAction(formData: FormData) {
  const actor = await guard();
  const key = String(formData.get("key") ?? "");
  const choice = String(formData.get("doctorId") ?? "") || String(formData.get("pick") ?? "");
  const doctorId = await idFromPick("doctors", choice);
  if (!key || !doctorId) redirect(`/medical/ordonnances?tab=medecins&error=${encodeURIComponent("Choisissez un médecin dans la liste.")}`);
  const n = await resolveDoctor(actor, key, doctorId!);
  done(`${n} ligne(s) rattachée(s). Le prochain import reconnaîtra ce libellé.`);
}

export async function createDoctorAction(formData: FormData) {
  const actor = await guard();
  const key = String(formData.get("key") ?? "");
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  if (!key || !firstName || !lastName) redirect(`/medical/ordonnances?tab=medecins&error=${encodeURIComponent("Prénom et nom obligatoires.")}`);
  await createDoctorFromLabel(actor, key, {
    firstName, lastName, city: String(formData.get("city") ?? "").trim() || null, specialtyId: String(formData.get("specialtyId") ?? "") || null,
  });
  revalidatePath("/medical/medecins");
  done(`Dr ${firstName} ${lastName} créé et rattaché (fiche à compléter : secteur, délégué).`);
}

export async function ignoreLabelAction(formData: FormData) {
  const actor = await guard();
  const kind = String(formData.get("kind") ?? "") as "DOCTOR" | "PRODUCT" | "PHARMACY";
  const key = String(formData.get("key") ?? "");
  if (!["DOCTOR", "PRODUCT", "PHARMACY"].includes(kind) || !key) return;
  await ignoreLabel(actor, kind, key, String(formData.get("label") ?? key));
  done("Libellé écarté de la file.", kind === "DOCTOR" ? "medecins" : kind === "PRODUCT" ? "produits" : "pharmacies");
}

export async function resolveProductAction(formData: FormData) {
  const actor = await guard();
  const key = String(formData.get("key") ?? "");
  const productId = await idFromPick("products", String(formData.get("pick") ?? ""));
  if (!key || !productId) redirect(`/medical/ordonnances?tab=produits&error=${encodeURIComponent("Choisissez un produit dans la liste.")}`);
  const n = await resolveProduct(actor, key, productId!);
  done(`${n} ligne(s) rattachée(s) au produit.`, "produits");
}

export async function resolvePharmacyAction(formData: FormData) {
  const actor = await guard();
  const key = String(formData.get("key") ?? "");
  const clientId = await idFromPick("clients", String(formData.get("pick") ?? ""));
  if (!key || !clientId) redirect(`/medical/ordonnances?tab=pharmacies&error=${encodeURIComponent("Choisissez une pharmacie dans la liste.")}`);
  const n = await resolvePharmacy(actor, key, clientId!);
  done(`${n} ligne(s) rattachée(s) à la pharmacie.`, "pharmacies");
}

export async function undoAutoMatchAction(formData: FormData) {
  const actor = await guard();
  const alias = String(formData.get("alias") ?? "");
  if (!alias) return;
  await undoAutoMatch(actor, alias);
  done("Rapprochement défait : le libellé repart dans la file.", "auto");
}
