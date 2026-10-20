import "server-only";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { creditReasons, paymentModes, taxRates, warehouses } from "@/db/schema";

/** Référentiels de la gestion commerciale (modifiables dans /parametres/gestion). */

export type TaxRate = { key: string; label: string; rate: string; sort: number; active: boolean };
export type PaymentMode = { key: string; label: string; requiresDueDate: boolean; collectedOnReceipt: boolean; sort: number; active: boolean };
export type Warehouse = { key: string; label: string; kind: string; sellable: boolean; notes: string | null; sort: number; active: boolean };

export async function listTaxRates(): Promise<TaxRate[]> {
  return db.select().from(taxRates).orderBy(asc(taxRates.sort), asc(taxRates.key));
}

export async function listPaymentModes(): Promise<PaymentMode[]> {
  return db.select().from(paymentModes).orderBy(asc(paymentModes.sort), asc(paymentModes.key));
}

export async function listWarehouses(): Promise<Warehouse[]> {
  return db.select().from(warehouses).orderBy(asc(warehouses.sort), asc(warehouses.key));
}

export type CreditReason = { key: string; label: string; withReturn: boolean; returnWarehouseKey: string | null; sort: number; active: boolean };
export async function listCreditReasons(): Promise<CreditReason[]> {
  return db.select().from(creditReasons).orderBy(asc(creditReasons.sort), asc(creditReasons.key));
}

/** Les trois référentiels d'un coup, pour les formulaires. */
export async function gestionRefs() {
  const [rates, modes, whs] = await Promise.all([listTaxRates(), listPaymentModes(), listWarehouses()]);
  return { taxRates: rates, paymentModes: modes, warehouses: whs };
}

/** Natures de sortie marketing (référentiel `marketing_output_natures`, Paramètres → Gestion). */
export async function outputNatures(opts: { includeInactive?: boolean } = {}): Promise<{ key: string; label: string; sort: number; active: boolean }[]> {
  const r = await db.execute<{ key: string; label: string; sort: number; active: boolean }>(sql`
    select key, label, sort, active from marketing_output_natures ${opts.includeInactive ? sql`` : sql`where active`} order by sort, label`);
  return r.rows;
}
