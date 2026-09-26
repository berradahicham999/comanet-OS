"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { decimalOrNull, errorParam, isUuid, str } from "@/lib/gestion/form";
import {
  createBulkSale, createCharge, deleteBulkSale, deleteCharge, reviseCharge, savePnlRules, stopCharge, updateBulkSale, updateCharge,
  type BulkInputForm, type ChargeInputForm,
} from "@/lib/pnl";
import { RECURRENCES, type Recurrence } from "@/lib/pnl-shared";
import type { PnlPrestation } from "@/lib/settings";

const actorOf = (u: { id: string; name: string }) => ({ id: u.id, name: u.name });
const back = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params).toString()}`;
const yearOf = (fd: FormData) => str(fd, "year") ?? String(new Date().getFullYear());

function done() {
  revalidatePath("/gestion/pnl");
  revalidatePath("/gestion/pnl/charges");
  revalidatePath("/gestion/pnl/ventes-bloc");
}

/* ------------------------------------------------------------ charges */

function readCharge(fd: FormData): ChargeInputForm {
  const rec = (str(fd, "recurrence") ?? "PONCTUELLE") as Recurrence;
  const amount = decimalOrNull(fd, "amount", "Montant", 2);
  if (amount === null) throw new Error("Le montant est obligatoire.");
  return {
    categoryKey: str(fd, "categoryKey") ?? "",
    label: str(fd, "label") ?? "",
    amount,
    recurrence: rec in RECURRENCES ? rec : "PONCTUELLE",
    startMonth: str(fd, "startMonth") ?? "",
    endMonth: str(fd, "endMonth"),
    brandId: isUuid(str(fd, "brandId")) ? str(fd, "brandId") : null,
    notes: str(fd, "notes"),
  };
}

export async function saveChargeAction(fd: FormData) {
  const user = await requireAdmin();
  const id = str(fd, "id");
  const year = yearOf(fd);
  try {
    if (isUuid(id)) await updateCharge(id, readCharge(fd), actorOf(user));
    else await createCharge(readCharge(fd), actorOf(user));
  } catch (e) {
    redirect(back("/gestion/pnl/charges", { year, error: decodeURIComponent(errorParam(e)), ...(isUuid(id) ? { edit: id } : { new: "1" }) }));
  }
  done();
  redirect(back("/gestion/pnl/charges", { year, done: "1" }));
}

export async function reviseChargeAction(fd: FormData) {
  const user = await requireAdmin();
  const id = str(fd, "id");
  const year = yearOf(fd);
  if (!isUuid(id)) return;
  try {
    const amount = decimalOrNull(fd, "amount", "Nouveau montant", 2);
    if (amount === null) throw new Error("Le nouveau montant est obligatoire.");
    await reviseCharge(id, str(fd, "fromMonth") ?? "", amount, actorOf(user));
  } catch (e) {
    redirect(back("/gestion/pnl/charges", { year, error: decodeURIComponent(errorParam(e)), edit: id }));
  }
  done();
  redirect(back("/gestion/pnl/charges", { year, done: "1" }));
}

export async function stopChargeAction(fd: FormData) {
  const user = await requireAdmin();
  const id = str(fd, "id");
  const year = yearOf(fd);
  if (!isUuid(id)) return;
  try {
    await stopCharge(id, str(fd, "lastMonth") ?? "", actorOf(user));
  } catch (e) {
    redirect(back("/gestion/pnl/charges", { year, error: decodeURIComponent(errorParam(e)), edit: id }));
  }
  done();
  redirect(back("/gestion/pnl/charges", { year, done: "1" }));
}

export async function deleteChargeAction(fd: FormData) {
  const user = await requireAdmin();
  const id = str(fd, "id");
  if (!isUuid(id)) return;
  await deleteCharge(id, actorOf(user));
  done();
  redirect(back("/gestion/pnl/charges", { year: yearOf(fd), done: "1" }));
}

/* ----------------------------------------------------- ventes en bloc */

function readBulk(fd: FormData): BulkInputForm {
  const amount = decimalOrNull(fd, "amountHt", "Montant HT facturé", 2);
  if (amount === null) throw new Error("Le montant HT facturé est obligatoire.");
  const brandId = str(fd, "brandId");
  if (!isUuid(brandId)) throw new Error("Choisissez la marque.");
  return {
    date: str(fd, "date") ?? "",
    brandId,
    clientId: isUuid(str(fd, "clientId")) ? str(fd, "clientId") : null,
    label: str(fd, "label") ?? "",
    quantity: decimalOrNull(fd, "quantity", "Quantité", 3, { min: 0 }),
    amountHt: amount,
    costAmount: decimalOrNull(fd, "costAmount", "Coût d'achat", 2),
    discountPct: decimalOrNull(fd, "discountPct", "Remise", 2, { min: 0 }),
    notes: str(fd, "notes"),
  };
}

export async function saveBulkAction(fd: FormData) {
  const user = await requireAdmin();
  const id = str(fd, "id");
  const year = yearOf(fd);
  try {
    if (isUuid(id)) await updateBulkSale(id, readBulk(fd), actorOf(user));
    else await createBulkSale(readBulk(fd), actorOf(user));
  } catch (e) {
    redirect(back("/gestion/pnl/ventes-bloc", { year, error: decodeURIComponent(errorParam(e)), ...(isUuid(id) ? { edit: id } : { new: "1" }) }));
  }
  done();
  redirect(back("/gestion/pnl/ventes-bloc", { year, done: "1" }));
}

export async function deleteBulkAction(fd: FormData) {
  const user = await requireAdmin();
  const id = str(fd, "id");
  if (!isUuid(id)) return;
  await deleteBulkSale(id, actorOf(user));
  done();
  redirect(back("/gestion/pnl/ventes-bloc", { year: yearOf(fd), done: "1" }));
}

/* ------------------------------------------------------------- règles */

const list = (v: string | null) => (v ?? "").split(/[,;\n]/).map((s) => s.trim().toUpperCase()).filter(Boolean);

export async function saveRulesAction(fd: FormData) {
  const user = await requireAdmin();
  try {
    const prestations: PnlPrestation[] = [];
    for (let i = 0; i < 10; i++) {
      const site = str(fd, `p_site_${i}`);
      if (!site) continue;
      const rate = decimalOrNull(fd, `p_rate_${i}`, `Taux de ${site}`, 2, { min: 0 });
      if (rate === null || Number(rate) > 100) throw new Error(`Taux de ${site} : entre 0 et 100 %.`);
      prestations.push({ site: site.toUpperCase(), label: str(fd, `p_label_${i}`) ?? `Commission ${site}`, ratePct: Number(rate) });
    }
    const directSites = list(str(fd, "directSites"));
    const distributorSites = list(str(fd, "distributorSites"));
    const all = [...directSites, ...distributorSites, ...prestations.map((p) => p.site)];
    const dup = all.find((s, i) => all.indexOf(s) !== i);
    if (dup) throw new Error(`Le site ${dup} est classé deux fois : un site n'a qu'une nature.`);
    await savePnlRules({ directSites, distributorSites, prestations }, actorOf(user));
  } catch (e) {
    redirect(back("/gestion/pnl/regles", { error: decodeURIComponent(errorParam(e)) }));
  }
  done();
  redirect(back("/gestion/pnl/regles", { done: "1" }));
}
