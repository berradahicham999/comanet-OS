"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { errorParam, str } from "@/lib/gestion/form";
import { setCutoverMode } from "@/lib/gestion/cutover";
import { importOpeningInvoices, type OpeningInvoice } from "@/lib/gestion/documents";
import { repriseColumns, repriseMissing } from "@/lib/gestion/receivables-shared";
import { formatScaled, parseDecimal } from "@/lib/gestion/money";
import { parseSheet } from "@/lib/import/parse";
import { normKey, toISODate } from "@/lib/import/normalize";

/** Bascule : administration uniquement (elle change la source des pièces, des ventes et du stock). */
export async function setModeAction(fd: FormData) {
  const mode = str(fd, "mode");
  try {
    const user = await requireAdmin();
    if (mode !== "OFF" && mode !== "PARALLELE" && mode !== "ACTIF") throw new Error("Mode inconnu.");
    if (mode === "ACTIF" && str(fd, "confirm") !== "BASCULER") throw new Error("Tapez BASCULER pour confirmer.");
    await setCutoverMode(mode, { id: user.id, name: user.name });
  } catch (e) {
    redirect(`/gestion/bascule?error=${errorParam(e)}`);
  }
  revalidatePath("/", "layout");
  redirect(`/gestion/bascule?done=${mode}`);
}

/**
 * Reprise des factures non soldées de Sage (export xlsx de l'état des échéances) : client retrouvé par son
 * code Sage COMANET, sinon par son nom ; chaque facture devient une pièce figée avec son reste à payer.
 */
export async function importRepriseAction(fd: FormData) {
  let msg: string;
  try {
    const user = await requireAdmin();
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Choisissez le fichier Sage des factures non soldées.");
    const sheet = parseSheet(Buffer.from(await file.arrayBuffer()));
    const cols = repriseColumns(sheet.headers);
    const missing = repriseMissing(cols);
    if (missing.length) throw new Error(`Colonnes non reconnues : ${missing.join(", ")}. En-têtes lus : ${sheet.headers.join(", ")}.`);
    const g = (await getSettings()).gestion;
    const clients = (await db.execute<{ id: string; account_code: string | null; name_key: string; legal_name: string | null }>(sql`select id, account_code, name_key, legal_name from clients`)).rows;
    const byCode = new Map(clients.filter((c) => c.account_code).map((c) => [c.account_code!.trim().toUpperCase(), c.id]));
    const byName = new Map<string, string>();
    for (const c of clients) { byName.set(c.name_key, c.id); if (c.legal_name) byName.set(normKey(c.legal_name), c.id); }
    const rows: OpeningInvoice[] = [];
    const errors: string[] = [];
    sheet.rows.forEach((r, i) => {
      const get = (k?: string) => (k ? r[k] : undefined);
      const number = String(get(cols.number) ?? "").trim();
      if (!number) return;
      const code = String(get(cols.accountCode) ?? "").trim().toUpperCase();
      const name = String(get(cols.client) ?? "").trim();
      const clientId = (code && byCode.get(code)) || (name && byName.get(normKey(name))) || null;
      const date = toISODate(get(cols.date));
      const ttc = parseDecimal(String(get(cols.ttc) ?? ""), 2), bal = parseDecimal(String(get(cols.balance) ?? ""), 2);
      if (!clientId) { errors.push(`Ligne ${i + 2} (${number}) : client « ${code || name} » introuvable`); return; }
      if (!date || ttc === null || bal === null) { errors.push(`Ligne ${i + 2} (${number}) : date ou montants illisibles`); return; }
      if (bal <= 0n) return;
      rows.push({ clientId, number, date, dueDate: toISODate(get(cols.dueDate)), ttc: formatScaled(ttc, 2), balance: formatScaled(bal, 2), site: g.cutover.sites[0] ?? "COMANET" });
    });
    const r = await importOpeningInvoices(rows, { id: user.id, name: user.name });
    msg = `${r.inserted} facture(s) reprise(s)` + (r.skipped.length ? ` · ignorées : ${r.skipped.slice(0, 5).join(" ; ")}${r.skipped.length > 5 ? "…" : ""}` : "") + (errors.length ? ` · erreurs : ${errors.slice(0, 5).join(" ; ")}${errors.length > 5 ? ` (+${errors.length - 5})` : ""}` : "");
  } catch (e) {
    redirect(`/gestion/bascule?error=${errorParam(e)}`);
  }
  revalidatePath("/gestion/bascule");
  redirect(`/gestion/bascule?reprise=${encodeURIComponent(msg)}`);
}
