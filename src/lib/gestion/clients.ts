import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clientBrandDiscounts, clientDeliveryAddresses, clientGroups, clientLegalEntities, clients, type ClientLegalEntity } from "@/db/schema";
import { audit, changedFields, type AuditActor } from "@/lib/audit";
import { normKey } from "@/lib/import/normalize";
import { cityToSector } from "@/lib/sectors";
import { reassignDrafts } from "./documents";
import {
  duplicateCandidates, entityFromAbsorbed, isValidIce, mergeBlockers, normalizeIce, type DuplicateCandidate, type ExistingClient, type LegalIdentity,
} from "./clients-shared";

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
  /** Groupe (enseigne) saisi en clair : rattaché à un groupe existant de même nom, sinon créé ; vide = aucun groupe. */
  groupName: string | null;
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
    const groupId = await resolveGroup(tx, input.groupName);
    const values = { ...toColumns(input), groupId, nameKey, needsReview: false, active: true, updatedAt: new Date() };
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
    const next = { ...toColumns(input), groupId: await resolveGroup(tx, input.groupName) };
    const diff = changedFields(before as unknown as Record<string, unknown>, next);
    if (!diff) return;
    await tx.update(clients).set({ ...next, nameKey, needsReview: false, updatedAt: new Date() }).where(eq(clients.id, id));
    await audit({ actor, action: "UPDATE", module: "clients", entity: "client", entityId: id, label: input.name, before: diff.before, after: diff.after }, tx);
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Groupe de ce nom (comparaison normalisée), créé s'il n'existe pas encore. Nom vide : aucun groupe. */
async function resolveGroup(tx: Tx, name: string | null): Promise<string | null> {
  const nameKey = normKey(name ?? "");
  if (!nameKey) return null;
  await tx.insert(clientGroups).values({ nameKey, name: name!.trim() }).onConflictDoNothing({ target: clientGroups.nameKey });
  const [g] = await tx.select({ id: clientGroups.id }).from(clientGroups).where(eq(clientGroups.nameKey, nameKey));
  return g.id;
}

/** Groupes existants (suggestions du champ « Groupe »), avec leur nombre de clients actifs. */
export async function listClientGroups(): Promise<{ id: string; name: string; n: number }[]> {
  const r = await db.execute<{ id: string; name: string; n: number }>(sql`
    select g.id, g.name, count(c.id) filter (where c.active)::int as n
    from client_groups g left join clients c on c.group_id = g.id group by g.id order by g.name`);
  return r.rows;
}

/** Nom du groupe d'un client (pour préremplir la fiche). */
export async function clientGroupName(groupId: string | null): Promise<string | null> {
  if (!groupId) return null;
  const [g] = await db.select({ name: clientGroups.name }).from(clientGroups).where(eq(clientGroups.id, groupId));
  return g?.name ?? null;
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
      (select count(*)::int from tasks where entity_id = ${id}::uuid) as tasks,
      (select count(*)::int from sales_documents where client_id = ${id}::uuid) as pieces,
      (select count(*)::int from payments where client_id = ${id}::uuid) as payments`);
  const x = r.rows[0] ?? {};
  const labels: Record<string, string> = {
    sales: "lignes de vente", animations: "animations", activations: "activations", activation_clients: "activations rattachées",
    readings: "relevés de stock", materiel: "sorties de matériel", tasks: "tâches", pieces: "pièces de vente", payments: "règlements",
  };
  return Object.entries(labels).map(([k, label]) => ({ label, n: Number(x[k] ?? 0) })).filter((l) => l.n > 0);
}

/** Suppression définitive, seulement si le client n'est rattaché à rien ; sinon il faut l'archiver. */
export async function deleteClient(id: string, actor: AuditActor): Promise<void> {
  const links = await clientLinks(id);
  if (links.length) throw new Error(`Suppression impossible : ce client a ${links.map((l) => `${l.n} ${l.label}`).join(", ")}. Fusionnez-le dans la bonne fiche, ou archivez-le : il disparaît des listes, son historique reste.`);
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

/* ------------------------------ Raisons sociales ------------------------------ */

export type LegalEntityInput = Omit<LegalIdentity, "legalName"> & { legalName: string };

/** Raisons sociales supplémentaires d'un client (l'identité de la fiche reste l'entité principale). */
export async function listLegalEntities(clientId: string, opts: { activeOnly?: boolean } = {}): Promise<(ClientLegalEntity & { documents: number })[]> {
  const r = await db.execute<Record<string, unknown>>(sql`
    select e.*, (select count(*)::int from sales_documents d where d.legal_entity_id = e.id) as documents
    from client_legal_entities e where e.client_id = ${clientId}::uuid ${opts.activeOnly ? sql`and e.active` : sql``}
    order by e.active desc, e.legal_name`);
  return r.rows.map((e) => ({
    id: e.id, clientId: e.client_id, legalName: e.legal_name, accountCode: e.account_code, ice: e.ice, ifNumber: e.if_number, rc: e.rc, patente: e.patente,
    billingAddress: e.billing_address, postalCode: e.postal_code, city: e.city, active: e.active, updatedAt: e.updated_at, createdAt: e.created_at, documents: e.documents,
  }) as ClientLegalEntity & { documents: number });
}

function entityColumns(input: LegalEntityInput) {
  const legalName = input.legalName.trim();
  if (!legalName) throw new Error("La raison sociale est obligatoire.");
  if (input.ice?.trim() && !isValidIce(input.ice)) throw new Error("ICE : 15 chiffres attendus.");
  const t = (v: string | null) => (v?.trim() ? v.trim() : null);
  return {
    legalName, accountCode: t(input.accountCode), ice: normalizeIce(input.ice), ifNumber: t(input.ifNumber), rc: t(input.rc), patente: t(input.patente),
    billingAddress: t(input.billingAddress), postalCode: t(input.postalCode), city: t(input.city),
  };
}

/** Ajoute (id nul) ou modifie une raison sociale. Une pièce validée garde l'identité figée à sa validation. */
export async function saveLegalEntity(clientId: string, id: string | null, input: LegalEntityInput, actor: AuditActor): Promise<void> {
  const cols = entityColumns(input);
  await db.transaction(async (tx) => {
    if (cols.accountCode) {
      const clash = (await tx.execute<{ name: string }>(sql`
        select name from clients where account_code = ${cols.accountCode}
        union all select legal_name from client_legal_entities where account_code = ${cols.accountCode} and id is distinct from ${id}::uuid limit 1`)).rows[0];
      if (clash) throw new Error(`Le code Sage ${cols.accountCode} est déjà porté par « ${clash.name} ».`);
    }
    if (!id) {
      const [row] = await tx.insert(clientLegalEntities).values({ ...cols, clientId }).returning({ id: clientLegalEntities.id });
      await audit({ actor, action: "ADD_LEGAL_ENTITY", module: "clients", entity: "client", entityId: clientId, label: cols.legalName, after: { ...cols, id: row.id } }, tx);
      return;
    }
    const [before] = await tx.select().from(clientLegalEntities).where(sql`${clientLegalEntities.id} = ${id}::uuid and ${clientLegalEntities.clientId} = ${clientId}::uuid`).for("update");
    if (!before) throw new Error("Raison sociale introuvable.");
    const diff = changedFields(before as unknown as Record<string, unknown>, cols);
    if (!diff) return;
    await tx.update(clientLegalEntities).set({ ...cols, updatedAt: new Date() }).where(eq(clientLegalEntities.id, id));
    await audit({ actor, action: "UPDATE_LEGAL_ENTITY", module: "clients", entity: "client", entityId: clientId, label: cols.legalName, before: diff.before, after: diff.after }, tx);
  });
}

/** Archive (plus proposée sur les nouvelles pièces) ou restaure une raison sociale. Rien n'est supprimé. */
export async function setLegalEntityActive(clientId: string, id: string, active: boolean, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const r = await tx.execute<{ legal_name: string }>(sql`
      update client_legal_entities set active = ${active}, updated_at = now() where id = ${id}::uuid and client_id = ${clientId}::uuid returning legal_name`);
    if (!r.rows[0]) throw new Error("Raison sociale introuvable.");
    await audit({ actor, action: active ? "RESTORE_LEGAL_ENTITY" : "ARCHIVE_LEGAL_ENTITY", module: "clients", entity: "client", entityId: clientId, label: r.rows[0].legal_name }, tx);
  });
}

/* ---------------------------------- Fusion ---------------------------------- */

/**
 * Tables rattachées à un client par `client_id` et déplacées telles quelles par une fusion.
 * Les tables à clé composée (assignations, remises, activations rattachées) et les pièces sont
 * traitées à part dans `mergeClients()`. Un test vérifie que chaque référence à `clients` y figure.
 */
export const MERGE_MOVED_TABLES = [
  "sales", "animations", "client_stock_readings", "activations", "inventory_movements", "pnl_bulk_sales",
  "client_delivery_addresses", "client_aliases", "client_legal_entities", "prescriptions",
] as const;
/** Pièces, règlements et relances (une relance porte sur une facture validée) : la fusion est refusée s'il y en a. */
export const MERGE_SPECIAL_TABLES = ["sales_documents", "payments", "payment_reminders", "user_client_assignments", "client_brand_discounts", "activation_clients"] as const;

const MOVE_LABELS: Record<string, string> = {
  sales: "lignes de vente", animations: "animations", client_stock_readings: "relevés de stock", activations: "activations",
  inventory_movements: "sorties de matériel", pnl_bulk_sales: "ventes en bloc (P&L)",
  client_delivery_addresses: "adresses de livraison", client_aliases: "libellés d'import", client_legal_entities: "raisons sociales", prescriptions: "lignes d'ordonnance",
  activation_clients: "activations rattachées", user_client_assignments: "assignations d'utilisateurs", client_brand_discounts: "remises par marque",
  drafts: "pièces en brouillon", tasks: "tâches",
};

type ClientRow = typeof clients.$inferSelect;
const identityOf = (c: ClientRow): LegalIdentity => ({
  legalName: c.legalName, accountCode: c.accountCode, ice: c.ice, ifNumber: c.ifNumber, rc: c.rc, patente: c.patente,
  billingAddress: c.billingAddress, postalCode: c.postalCode, city: c.city,
});

export type MergePreview = {
  kept: { id: string; name: string; legalName: string | null; city: string | null; code: string | null };
  absorbed: { id: string; name: string; legalName: string | null; city: string | null; code: string | null };
  moves: { label: string; n: number }[];
  newEntity: LegalIdentity | null;
  notes: string[];
  blockers: string[];
};

async function mergeState(t: Tx | typeof db, kept: ClientRow, absorbed: ClientRow): Promise<MergePreview> {
  const counts = (await t.execute<Record<string, number>>(sql`
    select ${sql.join(MERGE_MOVED_TABLES.map((tb) => sql`(select count(*)::int from ${sql.identifier(tb)} where client_id = ${absorbed.id}::uuid) as ${sql.identifier(tb)}`), sql`, `)},
      (select count(*)::int from activation_clients where client_id = ${absorbed.id}::uuid) as activation_clients,
      (select count(*)::int from user_client_assignments where client_id = ${absorbed.id}::uuid) as user_client_assignments,
      (select count(*)::int from client_brand_discounts where client_id = ${absorbed.id}::uuid) as client_brand_discounts,
      (select count(*)::int from sales_documents where client_id = ${absorbed.id}::uuid and status = 'BROUILLON') as drafts,
      (select count(*)::int from tasks where entity_id = ${absorbed.id}::uuid) as tasks,
      (select count(*)::int from sales_documents where client_id = ${absorbed.id}::uuid and status <> 'BROUILLON') as absorbed_docs,
      (select count(*)::int from payments where client_id = ${absorbed.id}::uuid) as absorbed_payments,
      (select count(*)::int from sales_documents where client_id = ${kept.id}::uuid and status <> 'BROUILLON') as kept_docs`)).rows[0];
  const keptEntities = await listLegalEntities(kept.id);
  const newEntity = entityFromAbsorbed(identityOf(kept), keptEntities, { ...identityOf(absorbed), name: absorbed.name });
  const notes: string[] = [];
  if (absorbed.code && kept.code && absorbed.code !== kept.code) notes.push(`Le code distributeur ${absorbed.code} de « ${absorbed.name} » n'est plus reconnu par code : les imports retrouveront la fiche par son nom (libellé d'import).`);
  if (absorbed.accountCode && newEntity?.accountCode) notes.push(`Code Sage ${absorbed.accountCode} repris sur la raison sociale ajoutée.`);
  if (newEntity && !billingOk(newEntity)) notes.push(`La raison sociale « ${newEntity.legalName} » est incomplète (ICE, adresse…) : complétez-la avant de la facturer.`);
  return {
    kept: { id: kept.id, name: kept.name, legalName: kept.legalName, city: kept.city, code: kept.code },
    absorbed: { id: absorbed.id, name: absorbed.name, legalName: absorbed.legalName, city: absorbed.city, code: absorbed.code },
    moves: Object.entries(MOVE_LABELS).map(([k, label]) => ({ label, n: Number(counts[k] ?? 0) })).filter((m) => m.n > 0),
    newEntity,
    notes,
    blockers: mergeBlockers({ sameClient: kept.id === absorbed.id, absorbedValidatedDocs: Number(counts.absorbed_docs), absorbedPayments: Number(counts.absorbed_payments), keptValidatedDocs: Number(counts.kept_docs) }),
  };
}

const billingOk = (e: LegalIdentity) => !!(e.legalName && e.ice && isValidIce(e.ice) && e.billingAddress && e.city);

/** Ce que ferait la fusion de `absorbedId` dans `keptId` (rien n'est écrit). */
export async function mergePreview(keptId: string, absorbedId: string): Promise<MergePreview> {
  const [kept] = await db.select().from(clients).where(eq(clients.id, keptId));
  const [absorbed] = await db.select().from(clients).where(eq(clients.id, absorbedId));
  if (!kept || !absorbed) throw new Error("Client introuvable.");
  return mergeState(db, kept, absorbed);
}

/**
 * Fusionne la fiche `absorbedId` dans `keptId` — un seul point de vente saisi deux fois (ex. LA GLOIRE
 * au terrain, PARA LA GLOIRE aux ventes). Tout ou rien, dans une transaction :
 * - tout l'historique (ventes, animations, relevés, activations, matériel, relances, brouillons, tâches,
 *   assignations, remises) passe sur la fiche gardée ; en cas de doublon (même remise, même assignation),
 *   la valeur de la fiche gardée l'emporte ;
 * - le nom de la fiche absorbée devient un libellé d'import de la fiche gardée : les prochains fichiers
 *   de ventes ou d'animations tombent au bon endroit ;
 * - son identité légale devient une raison sociale supplémentaire (facturable sur les pièces) ;
 * - les champs vides de la fiche gardée sont complétés ; puis la fiche absorbée est supprimée.
 * Refusée si la fiche absorbée porte des pièces validées ou des règlements (figés sur leur client).
 */
export async function mergeClients(keptId: string, absorbedId: string, actor: AuditActor): Promise<MergePreview> {
  return db.transaction(async (tx) => {
    const locked = await tx.select().from(clients).where(sql`${clients.id} in (${keptId}::uuid, ${absorbedId}::uuid)`).orderBy(clients.id).for("update");
    const kept = locked.find((c) => c.id === keptId);
    const absorbed = locked.find((c) => c.id === absorbedId);
    if (!kept || !absorbed) throw new Error("Client introuvable.");
    const state = await mergeState(tx, kept, absorbed);
    if (state.blockers.length) throw new Error(state.blockers.join(" "));
    const k = keptId, a = absorbedId;

    let newEntityId: string | null = null;
    if (state.newEntity) {
      const [row] = await tx.insert(clientLegalEntities).values({ ...state.newEntity, legalName: state.newEntity.legalName!, clientId: k }).returning({ id: clientLegalEntities.id });
      newEntityId = row.id;
    }
    // Brouillons : la raison sociale principale de la fiche absorbée devient l'entité ajoutée.
    await reassignDrafts(tx, a, k, newEntityId);
    for (const tb of MERGE_MOVED_TABLES) await tx.execute(sql`update ${sql.identifier(tb)} set client_id = ${k}::uuid where client_id = ${a}::uuid`);
    await tx.execute(sql`insert into activation_clients (activation_id, client_id) select activation_id, ${k}::uuid from activation_clients where client_id = ${a}::uuid on conflict do nothing`);
    await tx.execute(sql`delete from activation_clients where client_id = ${a}::uuid`);
    await tx.execute(sql`insert into user_client_assignments (user_id, client_id) select user_id, ${k}::uuid from user_client_assignments where client_id = ${a}::uuid on conflict do nothing`);
    await tx.execute(sql`delete from user_client_assignments where client_id = ${a}::uuid`);
    await tx.execute(sql`insert into client_brand_discounts (client_id, brand_id, discount_pct) select ${k}::uuid, brand_id, discount_pct from client_brand_discounts where client_id = ${a}::uuid on conflict do nothing`);
    await tx.execute(sql`delete from client_brand_discounts where client_id = ${a}::uuid`);
    await tx.execute(sql`update tasks set entity_id = ${k}::uuid where entity_id = ${a}::uuid`);
    await tx.execute(sql`update notifications set entity_id = ${k}::uuid where entity_id = ${a}::uuid`);
    // Le nom de la fiche absorbée reste reconnu par les imports.
    await tx.execute(sql`insert into client_aliases (alias, client_id, source) values (${absorbed.nameKey}, ${k}::uuid, 'FUSION')
      on conflict (alias) do update set client_id = excluded.client_id`);

    // Champs vides de la fiche gardée complétés par la fiche absorbée (la fiche gardée l'emporte toujours).
    const fill: Partial<ClientRow> = {};
    const keys = ["code", "groupId", "phone", "email", "contactName", "salesRep", "channel", "sector", "city", "accountManagerId", "paymentModeKey", "paymentDays", "defaultDiscountPct", "creditLimit"] as const;
    for (const key of keys) if ((kept[key] === null || kept[key] === "") && absorbed[key] !== null && absorbed[key] !== "") (fill as Record<string, unknown>)[key] = absorbed[key];
    // Même société (aucune raison sociale ajoutée) : son code Sage revient à la fiche gardée si elle n'en a pas.
    if (!state.newEntity && !kept.accountCode && absorbed.accountCode) fill.accountCode = absorbed.accountCode;
    if (kept.type === "AUTRE" && absorbed.type !== "AUTRE") fill.type = absorbed.type;
    if (absorbed.blocked && !kept.blocked) Object.assign(fill, { blocked: true, blockedReason: `${absorbed.blockedReason ?? "Bloqué"} (repris de ${absorbed.name})` });
    await tx.delete(clients).where(eq(clients.id, a));
    if (Object.keys(fill).length) await tx.update(clients).set({ ...fill, updatedAt: new Date() }).where(eq(clients.id, k));

    const after = { absorbed: { id: a, name: absorbed.name, legalName: absorbed.legalName, ice: absorbed.ice, code: absorbed.code, accountCode: absorbed.accountCode }, moved: state.moves, newEntity: state.newEntity?.legalName ?? null, filled: Object.keys(fill) };
    await audit({ actor, action: "MERGE", module: "clients", entity: "client", entityId: k, label: `${absorbed.name} → ${kept.name}`, after }, tx);
    await audit({ actor, action: "MERGED_INTO", module: "clients", entity: "client", entityId: a, label: `${absorbed.name} → ${kept.name}`, after: { into: k } }, tx);
    return state;
  });
}

/**
 * Fiches candidates à une fusion avec `clientId` : même groupe, doublons probables (nom, ICE,
 * téléphone), puis recherche libre. Avec leurs volumes, pour choisir la fiche à garder.
 */
export async function mergeCandidates(clientId: string, query: string | null): Promise<{ id: string; name: string; legalName: string | null; city: string | null; reason: string; sales: number; animations: number; docs: number }[]> {
  const [c] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!c) return [];
  const reasons = new Map<string, string>();
  if (c.groupId) {
    // Un grand groupe (enseigne à plusieurs magasins, grossiste) n'est pas un indice de doublon.
    const g = await db.execute<{ id: string }>(sql`select id from clients where group_id = ${c.groupId}::uuid and id <> ${clientId}::uuid limit 11`);
    if (g.rows.length <= 10) for (const r of g.rows) reasons.set(r.id, "Même groupe");
  }
  for (const d of (await findDuplicates({ name: c.name, legalName: c.legalName, ice: c.ice, phone: c.phone, city: c.city }, clientId)).slice(0, 10)) if (!reasons.has(d.id)) reasons.set(d.id, d.reasons.join(", "));
  const q = query?.trim();
  if (q && q.length >= 2) {
    const like = `%${q}%`;
    const r = await db.execute<{ id: string }>(sql`
      select id from clients where id <> ${clientId}::uuid and (name ilike ${like} or legal_name ilike ${like} or code ilike ${like}) order by name limit 15`);
    for (const x of r.rows) if (!reasons.has(x.id)) reasons.set(x.id, "Recherche");
  }
  if (!reasons.size) return [];
  const ids = [...reasons.keys()];
  const r = await db.execute<{ id: string; name: string; legal_name: string | null; city: string | null; sales: number; animations: number; docs: number }>(sql`
    select c.id, c.name, c.legal_name, c.city,
      (select count(*)::int from sales s where s.client_id = c.id) as sales,
      (select count(*)::int from animations a where a.client_id = c.id) as animations,
      (select count(*)::int from sales_documents d where d.client_id = c.id and d.status <> 'BROUILLON') as docs
    from clients c where c.id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) order by c.name`);
  return r.rows.map((x) => ({ id: x.id, name: x.name, legalName: x.legal_name, city: x.city, reason: reasons.get(x.id)!, sales: x.sales, animations: x.animations, docs: x.docs }));
}
