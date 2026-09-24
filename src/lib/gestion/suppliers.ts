import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { supplierBrands, suppliers } from "@/db/schema";
import { audit, changedFields, type AuditActor } from "@/lib/audit";
import { normKey } from "@/lib/import/normalize";
import { normalizeIce } from "./clients-shared";

/**
 * Fournisseurs. MARCHANDISES : laboratoires et marques (leurs réceptions entreront dans le journal
 * de stock au lot 3). HORS_STOCK : PLV, goodies, impression, transport, services (leurs achats
 * alimenteront l'inventaire marketing du module Activations). Archiver plutôt que supprimer.
 */

export const SUPPLIER_NATURES = { MARCHANDISES: "Marchandises (laboratoire, marque)", HORS_STOCK: "Hors stock (PLV, goodies, services)" } as const;
export type SupplierNature = keyof typeof SUPPLIER_NATURES;

export type SupplierInput = {
  code: string | null;
  legalName: string;
  nature: SupplierNature;
  ice: string | null;
  ifNumber: string | null;
  rc: string | null;
  country: string;
  currency: string;
  address: string | null;
  city: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  paymentDays: number | null;
  paymentModeKey: string | null;
  notes: string | null;
  brandIds: string[];
};

export type SupplierRow = {
  id: string; code: string | null; legalName: string; nature: SupplierNature; ice: string | null; country: string; currency: string;
  city: string | null; contactName: string | null; phone: string | null; email: string | null; paymentDays: number | null; active: boolean;
  brands: { id: string; name: string; color: string }[];
};

export async function listSuppliers(opts: { includeArchived?: boolean } = {}): Promise<SupplierRow[]> {
  const r = await db.execute<{ id: string; code: string | null; legal_name: string; nature: SupplierNature; ice: string | null; country: string; currency: string; city: string | null; contact_name: string | null; phone: string | null; email: string | null; payment_days: number | null; active: boolean; brands: { id: string; name: string; color: string }[] | null }>(sql`
    select s.id, s.code, s.legal_name, s.nature, s.ice, s.country, s.currency, s.city, s.contact_name, s.phone, s.email, s.payment_days, s.active,
      (select json_agg(json_build_object('id', b.id, 'name', b.name, 'color', b.color) order by b.name) from supplier_brands sb join brands b on b.id = sb.brand_id where sb.supplier_id = s.id) as brands
    from suppliers s ${opts.includeArchived ? sql`` : sql`where s.active`} order by s.active desc, s.legal_name`);
  return r.rows.map((s) => ({
    id: s.id, code: s.code, legalName: s.legal_name, nature: s.nature, ice: s.ice, country: s.country, currency: s.currency, city: s.city,
    contactName: s.contact_name, phone: s.phone, email: s.email, paymentDays: s.payment_days, active: s.active, brands: s.brands ?? [],
  }));
}

export async function getSupplier(id: string) {
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!s) return null;
  const brands = await db.execute<{ id: string }>(sql`select brand_id as id from supplier_brands where supplier_id = ${id}::uuid`);
  return { ...s, brandIds: brands.rows.map((b) => b.id) };
}

function validate(i: SupplierInput) {
  if (!i.legalName.trim()) throw new Error("La raison sociale est obligatoire.");
  if (!/^[A-Z]{3}$/.test(i.currency)) throw new Error("Devise : code sur trois lettres (MAD, EUR, USD…).");
  if (i.paymentDays !== null && (i.paymentDays < 0 || i.paymentDays > 365)) throw new Error("Délai de paiement : entre 0 et 365 jours.");
}

function columns(i: SupplierInput) {
  return {
    code: i.code, legalName: i.legalName.trim(), nameKey: normKey(i.legalName), nature: i.nature, ice: normalizeIce(i.ice), ifNumber: i.ifNumber, rc: i.rc,
    country: i.country.trim() || "Maroc", currency: i.currency, address: i.address, city: i.city, contactName: i.contactName, email: i.email, phone: i.phone,
    paymentDays: i.paymentDays, paymentModeKey: i.paymentModeKey, notes: i.notes,
  };
}

/** Fournisseurs de même nom ou de même ICE : affichés avant création pour éviter un doublon. */
export async function supplierDuplicates(legalName: string, ice: string | null, excludeId?: string): Promise<{ id: string; legalName: string; reason: string }[]> {
  const key = normKey(legalName);
  const i = normalizeIce(ice);
  const r = await db.execute<{ id: string; legal_name: string; same_ice: boolean }>(sql`
    select id, legal_name, (${i}::text is not null and ice = ${i}::text) as same_ice from suppliers
    where (name_key = ${key} or (${i}::text is not null and ice = ${i}::text)) ${excludeId ? sql`and id <> ${excludeId}::uuid` : sql``}`);
  return r.rows.map((x) => ({ id: x.id, legalName: x.legal_name, reason: x.same_ice ? "Même ICE" : "Même raison sociale" }));
}

export async function createSupplier(input: SupplierInput, actor: AuditActor): Promise<string> {
  validate(input);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(suppliers).values({ ...columns(input), createdById: actor.id }).returning({ id: suppliers.id });
    if (input.brandIds.length) await tx.insert(supplierBrands).values(input.brandIds.map((brandId) => ({ supplierId: row.id, brandId }))).onConflictDoNothing();
    await audit({ actor, action: "CREATE", module: "achats", entity: "supplier", entityId: row.id, label: input.legalName, after: columns(input) }, tx);
    return row.id;
  });
}

export async function updateSupplier(id: string, input: SupplierInput, actor: AuditActor): Promise<void> {
  validate(input);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(suppliers).where(eq(suppliers.id, id)).for("update");
    if (!before) throw new Error("Fournisseur introuvable.");
    const next = columns(input);
    const diff = changedFields(before as unknown as Record<string, unknown>, next);
    const prevBrands = (await tx.execute<{ id: string }>(sql`select brand_id as id from supplier_brands where supplier_id = ${id}::uuid`)).rows.map((b) => b.id).sort();
    const nextBrands = [...new Set(input.brandIds)].sort();
    const brandsChanged = prevBrands.join() !== nextBrands.join();
    if (!diff && !brandsChanged) return;
    await tx.update(suppliers).set({ ...next, updatedAt: new Date() }).where(eq(suppliers.id, id));
    if (brandsChanged) {
      await tx.delete(supplierBrands).where(eq(supplierBrands.supplierId, id));
      if (nextBrands.length) await tx.insert(supplierBrands).values(nextBrands.map((brandId) => ({ supplierId: id, brandId })));
    }
    await audit({
      actor, action: "UPDATE", module: "achats", entity: "supplier", entityId: id, label: input.legalName,
      before: { ...(diff?.before ?? {}), ...(brandsChanged ? { brandIds: prevBrands } : {}) },
      after: { ...(diff?.after ?? {}), ...(brandsChanged ? { brandIds: nextBrands } : {}) },
    }, tx);
  });
}

export async function setSupplierArchived(id: string, archived: boolean, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const [s] = await tx.select({ name: suppliers.legalName, active: suppliers.active }).from(suppliers).where(eq(suppliers.id, id)).for("update");
    if (!s) throw new Error("Fournisseur introuvable.");
    if (s.active === !archived) return;
    await tx.update(suppliers).set({ active: !archived, updatedAt: new Date() }).where(eq(suppliers.id, id));
    await audit({ actor, action: archived ? "ARCHIVE" : "RESTORE", module: "achats", entity: "supplier", entityId: id, label: s.name }, tx);
  });
}

/**
 * Suppression définitive : tant qu'aucune pièce d'achat n'existe (lot 3), un fournisseur n'est
 * rattaché à rien d'autre que ses marques. Le lot 3 ajoutera ici le contrôle des commandes et réceptions.
 */
export async function deleteSupplier(id: string, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, id)).for("update");
    if (!s) throw new Error("Fournisseur introuvable.");
    await tx.delete(suppliers).where(eq(suppliers.id, id));
    await audit({ actor, action: "DELETE", module: "achats", entity: "supplier", entityId: id, label: s.legalName, before: { legalName: s.legalName, ice: s.ice, code: s.code } }, tx);
  });
}
