"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { paymentModes, taxRates, warehouses } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { audit } from "@/lib/audit";
import { getSettings, saveSettings, type CompanyIdentity, type GestionSettings } from "@/lib/settings";
import { storeAsset, COMPANY_SLOTS, type CompanySlot } from "@/lib/content/assets";
import { refKey } from "@/lib/content/shared";
import { COMPANY_FIELDS } from "@/lib/gestion/readiness";
import { saveSeries, setNextNumber } from "@/lib/gestion/numbering";
import { bool, decimalOrNull, errorParam, intOrNull, str } from "@/lib/gestion/form";

const PAGE = "/parametres/gestion";
const back = (anchor: string, q = "done=1") => redirect(`${PAGE}?${q}#${anchor}`);
const actorOf = (u: { id: string; name: string }) => ({ id: u.id, name: u.name });

/** Identité de la société, imprimée sur chaque pièce. Stockée en base, jamais dans le code (dépôt public). */
export async function saveCompanyAction(fd: FormData) {
  const user = await requireAdmin();
  const cur = await getSettings();
  const company = { ...cur.gestion.company };
  for (const f of COMPANY_FIELDS) company[f.key as keyof CompanyIdentity] = str(fd, f.key) ?? "";
  company.ice = company.ice.replace(/\D/g, "");
  if (company.ice && company.ice.length !== 15) back("societe", `error=${encodeURIComponent("ICE de la société : 15 chiffres attendus.")}`);
  await saveSettings({ ...cur, gestion: { ...cur.gestion, company } });
  await audit({ actor: actorOf(user), action: "SETTINGS", module: "administration", entity: "settings", label: "Société", before: cur.gestion.company, after: company });
  revalidatePath("/", "layout");
  back("societe");
}

/** Logo ou cachet de la société (PNG, JPEG ou WebP, 2 Mo maximum). */
export async function uploadCompanyFileAction(fd: FormData) {
  const user = await requireAdmin();
  const slot = str(fd, "slot") as CompanySlot | null;
  const file = fd.get("file");
  try {
    if (!slot || !COMPANY_SLOTS.includes(slot)) throw new Error("Emplacement inconnu.");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choisissez une image.");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Format accepté : PNG, JPEG ou WebP.");
    if (file.size > 2 * 1024 * 1024) throw new Error("Image trop lourde (2 Mo maximum).");
    const row = await storeAsset({ owner: { companySlot: slot }, kind: "VISUEL", name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()), uploadedById: user.id });
    await audit({ actor: actorOf(user), action: "SETTINGS", module: "administration", entity: "settings", label: slot === "LOGO" ? "Logo" : "Cachet", after: { version: row.version, name: file.name } });
  } catch (e) {
    back("societe", `error=${errorParam(e)}`);
  }
  revalidatePath(PAGE);
  back("societe");
}

/** Politiques de la gestion commerciale et paramètres de bascule. */
export async function savePoliciesAction(fd: FormData) {
  const user = await requireAdmin();
  const cur = await getSettings();
  let next: GestionSettings;
  try {
    const g = cur.gestion;
    const maxDays = intOrNull(fd, "maxPaymentDays", "Plafond du délai de paiement", 1, 365) ?? g.maxPaymentDays;
    const defDays = intOrNull(fd, "defaultPaymentDays", "Délai de paiement par défaut", 0, 365) ?? g.defaultPaymentDays;
    if (defDays > maxDays) throw new Error("Le délai par défaut dépasse le plafond.");
    const date = str(fd, "cutoverDate");
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date de bascule invalide.");
    const sites = (str(fd, "cutoverSites") ?? "").split(/[,;\n]/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    if (!sites.length) throw new Error("Indiquez au moins un site qui bascule (ex. COMANET).");
    next = {
      ...g,
      defaultTaxRateKey: str(fd, "defaultTaxRateKey") ?? g.defaultTaxRateKey,
      defaultPaymentDays: defDays,
      maxPaymentDays: maxDays,
      insufficientStock: str(fd, "insufficientStock") === "WARN" ? "WARN" : "BLOCK",
      expiryAlertDays: intOrNull(fd, "expiryAlertDays", "Alerte péremption", 1, 730) ?? g.expiryAlertDays,
      readinessWindowDays: intOrNull(fd, "readinessWindowDays", "Fenêtre de préparation", 30, 1095) ?? g.readinessWindowDays,
      // Le mode reste OFF tant que les pièces de vente (lot 2) et la bascule (lot 5) ne sont pas livrées.
      cutover: { mode: "OFF", date, sites },
    };
  } catch (e) {
    back("politiques", `error=${errorParam(e)}`);
  }
  await saveSettings({ ...cur, gestion: next! });
  await audit({ actor: actorOf(user), action: "SETTINGS", module: "administration", entity: "settings", label: "Gestion commerciale", before: { ...cur.gestion, company: undefined }, after: { ...next!, company: undefined } });
  revalidatePath("/", "layout");
  back("politiques");
}

/* ------------------------------ Référentiels ------------------------------ */

export async function saveTaxRateAction(fd: FormData) {
  const user = await requireAdmin();
  try {
    const label = str(fd, "label");
    const key = str(fd, "key") ?? (label ? refKey(label) : null);
    if (!key || !label) throw new Error("Libellé obligatoire.");
    const rate = decimalOrNull(fd, "rate", "Taux", 2, { min: 0, maxExclusive: 100 });
    if (rate === null) throw new Error("Taux obligatoire.");
    const values = { label, rate, sort: intOrNull(fd, "sort", "Ordre", 0, 999) ?? 0, active: bool(fd, "active") };
    await db.insert(taxRates).values({ key, ...values }).onConflictDoUpdate({ target: taxRates.key, set: values });
    await audit({ actor: actorOf(user), action: "SETTINGS", module: "administration", entity: "tax_rate", label: key, after: values });
  } catch (e) {
    back("tva", `error=${errorParam(e)}`);
  }
  revalidatePath(PAGE);
  back("tva");
}

export async function savePaymentModeAction(fd: FormData) {
  const user = await requireAdmin();
  try {
    const label = str(fd, "label");
    const key = str(fd, "key") ?? (label ? refKey(label) : null);
    if (!key || !label) throw new Error("Libellé obligatoire.");
    const values = { label, requiresDueDate: bool(fd, "requiresDueDate"), sort: intOrNull(fd, "sort", "Ordre", 0, 999) ?? 0, active: bool(fd, "active") };
    await db.insert(paymentModes).values({ key, ...values }).onConflictDoUpdate({ target: paymentModes.key, set: values });
    await audit({ actor: actorOf(user), action: "SETTINGS", module: "administration", entity: "payment_mode", label: key, after: values });
  } catch (e) {
    back("paiement", `error=${errorParam(e)}`);
  }
  revalidatePath(PAGE);
  back("paiement");
}

export async function saveWarehouseAction(fd: FormData) {
  const user = await requireAdmin();
  try {
    const label = str(fd, "label");
    const key = str(fd, "key") ?? (label ? refKey(label) : null);
    if (!key || !label) throw new Error("Libellé obligatoire.");
    const kind = str(fd, "kind") === "EXTERNE" ? "EXTERNE" : "INTERNE";
    const existing = (await db.select({ kind: warehouses.kind }).from(warehouses).where(eq(warehouses.key, key)))[0];
    if (existing && existing.kind !== kind) {
      const n = (await db.execute<{ n: number }>(sql`select count(*)::int as n from stock_movements where warehouse_key = ${key} or counterpart_warehouse_key = ${key}`)).rows[0]?.n ?? 0;
      if (n) throw new Error(`Le dépôt ${key} a ${n} mouvement(s) : il ne peut plus changer de nature (interne / externe).`);
    }
    const values = { label, kind, sellable: bool(fd, "sellable"), notes: str(fd, "notes"), sort: intOrNull(fd, "sort", "Ordre", 0, 999) ?? 0, active: bool(fd, "active") };
    await db.insert(warehouses).values({ key, ...values }).onConflictDoUpdate({ target: warehouses.key, set: values });
    await audit({ actor: actorOf(user), action: "SETTINGS", module: "administration", entity: "warehouse", label: key, after: values });
  } catch (e) {
    back("depots", `error=${errorParam(e)}`);
  }
  revalidatePath(PAGE);
  revalidatePath("/gestion/stock");
  back("depots");
}

/* ------------------------------- Numérotation ------------------------------ */

export async function saveSeriesAction(fd: FormData) {
  const user = await requireAdmin();
  try {
    const key = str(fd, "key");
    if (!key) throw new Error("Série inconnue.");
    await saveSeries({ key, label: str(fd, "label") ?? key, pattern: str(fd, "pattern") ?? "", active: bool(fd, "active") }, actorOf(user));
  } catch (e) {
    back("numerotation", `error=${errorParam(e)}`);
  }
  revalidatePath(PAGE);
  back("numerotation");
}

export async function setNextNumberAction(fd: FormData) {
  const user = await requireAdmin();
  try {
    const key = str(fd, "key");
    if (!key) throw new Error("Série inconnue.");
    const year = intOrNull(fd, "year", "Année", 2020, 2100);
    const next = intOrNull(fd, "next", "Prochain numéro", 1, 999_999_999);
    if (year === null || next === null) throw new Error("Année et prochain numéro sont obligatoires.");
    await setNextNumber(key, year, next, actorOf(user));
  } catch (e) {
    back("numerotation", `error=${errorParam(e)}`);
  }
  revalidatePath(PAGE);
  revalidatePath("/gestion");
  back("numerotation");
}
