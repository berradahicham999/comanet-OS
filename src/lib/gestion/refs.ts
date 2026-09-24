import "server-only";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { paymentModes, taxRates, warehouses } from "@/db/schema";

/** Référentiels de la gestion commerciale (modifiables dans /parametres/gestion). */

export type TaxRate = { key: string; label: string; rate: string; sort: number; active: boolean };
export type PaymentMode = { key: string; label: string; requiresDueDate: boolean; sort: number; active: boolean };
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

/** Les trois référentiels d'un coup, pour les formulaires. */
export async function gestionRefs() {
  const [rates, modes, whs] = await Promise.all([listTaxRates(), listPaymentModes(), listWarehouses()]);
  return { taxRates: rates, paymentModes: modes, warehouses: whs };
}
