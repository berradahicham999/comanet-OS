import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clientBrandDiscounts, clientDeliveryAddresses, clients } from "@/db/schema";
import { audit, changedFields, type AuditActor } from "@/lib/audit";
import { normKey } from "@/lib/import/normalize";
import { cityToSector } from "@/lib/sectors";
import { duplicateCandidates, normalizeIce, type DuplicateCandidate, type ExistingClient } from "./clients-shared";

/**
 * Fiche client de la gestion commerciale : création, identité légale et conditions, archivage,
 * suppression. Toute écriture laisse une trace dans `audit_logs`, dans la même transaction.
 * Le client reste le point de vente fonctionnel : aucune seconde table de clients n'est créée.
 */

export type ClientType = "PHARMACIE" | "PARAPHARMACIE" | "GROSSISTE" | "AUTRE";

/** Champs modifiables de la fiche (identité légale et conditions). */
export type ClientLegalInput = {
  name: string;
  type: ClientType;
  city: string | null;
  sector: string | null;
  phone: string | null;
  accountCode: string | null;
  legalName: string | null;
  ice: string | null;
  ifNumber: string | null;
  rc: string | null;
  patente: string | null;
  billingAddress: string | null;
  postalCode: string | null;
  email: string | null;
  contactName: string | null;
  accountManagerId: string | null;
  defaultDiscountPct: string | null;
  paymentModeKey: string | null;
  paymentDays: number | null;
  creditLimit: string | null;
};

/** Clients existants, pour la détection de doublons (actifs et archivés). */
export async function existingClients(): Promise<ExistingClient[]> {
  const r = await db.execute<{ id: string; name: string; legal_name: string | null; ice: string | null; phone: string | null; city: string | null; active: boolean; aliases: string[] | null }>(sql`
    select c.id, c.name, c.legal_name, c.ice, c.phone, c.city, c.active,
      (select array_agg(a.alias) from client_aliases a where a.client_id = c.id) as aliases
    from clients c`);
  return r.rows.map((c) => ({ id: c.id, name: c.name, legalName: c.legal_name, ice: c.ice, phone: c.phone, city: c.city, active: c.active, aliases: c.aliases ?? [] }));
}

export async function findDuplicates(input: { name: string; legalName?: string | null; ice?: string | null; phone?: string | null; city?: string | null }, excludeId?: string): Promise<DuplicateCandidate[]> {
  return duplicateCandidates(input, await existingClients(), excludeId);
}

/** Crée un client saisi à la main (non importé). Le nom fonctionnel doit être unique. */
export async function createClient(input: ClientLegalInput, actor: AuditActor): Promise<string> {
  const nameKey = normKey(input.name);
  if (!nameKey) throw new Error("Le nom du client est obligatoire.");
  return db.transaction(async (tx) => {
    const clash = (await tx.execute<{ id: string; name: string }>(sql`select id, name from clients where name_key = ${nameKey} limit 1`)).rows[0];
    if (clash) throw new Error(`Un client porte déjà ce nom : « ${clash.name} ». Ouvrez sa fiche plutôt que d'en créer une seconde.`);
    const values = { ...toColumns(input), nameKey, needsReview: false, active: true, updatedAt: new Date() };
    const [row] = await tx.insert(clients).values(values).returning({ id: clients.id });
    await audit({ actor, action: "CREATE", module: "clients", entity: "client", entityId: row.id, label: input.name, after: toColumns(input) }, tx);
    return row.id;
  });
}

/** Met à jour l'identité légale et les conditions ; seules les valeurs modifiées sont journalisées. */
export async function updateClientLegal(id: string, input: ClientLegalInput, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(clients).where(eq(clients.id, id)).for("update");
    if (!before) throw new Error("Client introuvable.");
    const nameKey = normKey(input.name);
    if (!nameKey) throw new Error("Le nom du client est obligatoire.");
    if (nameKey !== before.nameKey) {
      const clash = (await tx.execute<{ name: string }>(sql`select name from clients where name_key = ${nameKey} and id <> ${id}::uuid limit 1`)).rows[0];
      if (clash) throw new Error(`Un autre client porte déjà ce nom : « ${clash.name} ».`);
    }
    const next = toColumns(input);
    const diff = changedFields(before as unknown as Record<string, unknown>, next);
    if (!diff) return;
    await tx.update(clients).set({ ...next, nameKey, needsReview: false, updatedAt: new Date() }).where(eq(clients.id, id));
    await audit({ actor, action: "UPDATE", module: "clients", entity: "client", entityId: id, label: input.name, before: diff.before, after: diff.after }, tx);
  });
}

function toColumns(i: ClientLegalInput) {
  return {
    name: i.name.trim(), type: i.type, city: i.city, sector: i.sector ?? cityToSector(i.city), phone: i.phone,
    accountCode: i.accountCode, legalName: i.legalName, ice: normalizeIce(i.ice), ifNumber: i.ifNumber, rc: i.rc, patente: i.patente,
    billingAddress: i.billingAddress, postalCode: i.postalCode, email: i.email, contactName: i.contactName,
    accountManagerId: i.accountManagerId, defaultDiscountPct: i.defaultDiscountPct, paymentModeKey: i.paymentModeKey,
    paymentDays: i.paymentDays, creditLimit: i.creditLimit,
  };
}

/** Bloquer / débloquer : un client bloqué ne pourra pas recevoir de pièce sans levée du blocage (lot 2). */
export async function setClientBlocked(id: string, blocked: boolean, reason: string | null, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const [c] = await tx.select({ name: clients.name, blocked: clients.blocked, reason: clients.blockedReason }).from(clients).where(eq(clients.id, id)).for("update");
    if (!c) throw new Error("Client introuvable.");
    if (blocked && !reason?.trim()) throw new Error("Indiquez le motif du blocage.");
    await tx.update(clients).set({ blocked, blockedReason: blocked ? reason!.trim() : null, updatedAt: new Date() }).where(eq(clients.id, id));
    await audit({ actor, action: blocked ? "BLOCK" : "UNBLOCK", module: "clients", entity: "client", entityId: id, label: c.name, before: { blocked: c.blocked, reason: c.reason }, after: { blocked, reason: blocked ? reason : null } }, tx);
  });
}

/** Archiver (disparaît des listes et des sélecteurs, l'historique reste) ou restaurer. */
export async function setClientArchived(id: string, archived: boolean, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const [c] = await tx.select({ name: clients.name, active: clients.active }).from(clients).where(eq(clients.id, id)).for("update");
    if (!c) throw new Error("Client introuvable.");
    if (c.active === !archived) return;
    await tx.update(clients).set({ active: !archived, updatedAt: new Date() }).where(eq(clients.id, id));
    await audit({ actor, action: archived ? "ARCHIVE" : "RESTORE", module: "clients", entity: "client", entityId: id, label: c.name }, tx);
  });
}

/**
 * Ce qui rattache un client à l'historique. Plusieurs de ces tables suppriment en cascade : une
 * suppression effacerait des ventes ou des relevés. On ne supprime donc que si tout est à zéro.
 */
export async function clientLinks(id: string): Promise<{ label: string; n: number }[]> {
  const r = await db.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from sales where client_id = ${id}::uuid) as sales,
      (select count(*)::int from animations where client_id = ${id}::uuid) as animations,
      (select count(*)::int from activations where client_id = ${id}::uuid) as activations,
      (select count(*)::int from activation_clients where client_id = ${id}::uuid) as activation_clients,
      (select count(*)::int from client_stock_readings where client_id = ${id}::uuid) as readings,
      (select count(*)::int from inventory_movements where client_id = ${id}::uuid) as materiel,
      (select count(*)::int from tasks where entity_id = ${id}::uuid) as tasks`);
  const x = r.rows[0] ?? {};
  const labels: Record<string, string> = {
    sales: "lignes de vente", animations: "animations", activations: "activations", activation_clients: "activations rattachées",
    readings: "relevés de stock", materiel: "sorties de matériel", tasks: "tâches",
  };
  return Object.entries(labels).map(([k, label]) => ({ label, n: Number(x[k] ?? 0) })).filter((l) => l.n > 0);
}

/** Suppression définitive, seulement si le client n'est rattaché à rien ; sinon il faut l'archiver. */
export async function deleteClient(id: string, actor: AuditActor): Promise<void> {
  const links = await clientLinks(id);
  if (links.length) throw new Error(`Suppression impossible : ce client a ${links.map((l) => `${l.n} ${l.label}`).join(", ")}. Archivez-le : il disparaît des listes, son historique reste.`);
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(clients).where(eq(clients.id, id)).for("update");
    if (!c) throw new Error("Client introuvable.");
    await tx.execute(sql`delete from client_aliases where client_id = ${id}::uuid`);
    await tx.delete(clients).where(eq(clients.id, id));
    await audit({ actor, action: "DELETE", module: "clients", entity: "client", entityId: id, label: c.name, before: { name: c.name, legalName: c.legalName, ice: c.ice, accountCode: c.accountCode } }, tx);
  });
}

/* ------------------------------ Adresses et remises ------------------------------ */

export async function addDeliveryAddress(clientId: string, input: { label: string; address: string; city: string | null; isDefault: boolean }, actor: AuditActor): Promise<void> {
  if (!input.label.trim() || !input.address.trim()) throw new Error("Libellé et adresse sont obligatoires.");
  await db.transaction(async (tx) => {
    if (input.isDefault) await tx.update(clientDeliveryAddresses).set({ isDefault: false }).where(eq(clientDeliveryAddresses.clientId, clientId));
    await tx.insert(clientDeliveryAddresses).values({ clientId, label: input.label.trim(), address: input.address.trim(), city: input.city, isDefault: input.isDefault });
    await audit({ actor, action: "ADD_ADDRESS", module: "clients", entity: "client", entityId: clientId, label: input.label, after: input }, tx);
  });
}

export async function removeDeliveryAddress(clientId: string, addressId: string, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const r = await tx.execute<{ label: string; address: string }>(sql`delete from client_delivery_addresses where id = ${addressId}::uuid and client_id = ${clientId}::uuid returning label, address`);
    if (r.rows[0]) await audit({ actor, action: "REMOVE_ADDRESS", module: "clients", entity: "client", entityId: clientId, label: r.rows[0].label, before: r.rows[0] }, tx);
  });
}

export async function setBrandDiscount(clientId: string, brandId: string, pct: string | null, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const before = (await tx.execute<{ discount_pct: string }>(sql`select discount_pct::text from client_brand_discounts where client_id = ${clientId}::uuid and brand_id = ${brandId}::uuid`)).rows[0]?.discount_pct ?? null;
    if (pct === null) await tx.execute(sql`delete from client_brand_discounts where client_id = ${clientId}::uuid and brand_id = ${brandId}::uuid`);
    else await tx.insert(clientBrandDiscounts).values({ clientId, brandId, discountPct: pct }).onConflictDoUpdate({ target: [clientBrandDiscounts.clientId, clientBrandDiscounts.brandId], set: { discountPct: pct } });
    await audit({ actor, action: "BRAND_DISCOUNT", module: "clients", entity: "client", entityId: clientId, label: brandId, before: { pct: before }, after: { pct } }, tx);
  });
}

export async function clientCommercial(clientId: string) {
  const [addresses, discounts] = await Promise.all([
    db.select().from(clientDeliveryAddresses).where(eq(clientDeliveryAddresses.clientId, clientId)).orderBy(sql`is_default desc, created_at`),
    db.execute<{ brand_id: string; brand: string; color: string; discount_pct: string }>(sql`
      select d.brand_id, b.name as brand, b.color, d.discount_pct::text from client_brand_discounts d join brands b on b.id = d.brand_id
      where d.client_id = ${clientId}::uuid order by b.name`),
  ]);
  return { addresses, discounts: discounts.rows };
}
